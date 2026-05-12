import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import PDFDocument from 'pdfkit';

const execFileAsync = promisify(execFile);
const serviceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(serviceDir, '../..');
const DEFAULT_RENDER_DPI = Number(process.env.LAYOUT_TRANSLATION_RENDER_DPI || 180);
const POPPLER_TIMEOUT_MS = Number(process.env.LAYOUT_TRANSLATION_POPPLER_TIMEOUT_MS || 180000);
const RENDER_DPI_CANDIDATES = [...new Set([DEFAULT_RENDER_DPI, 140, 110, 90].filter((dpi) => Number.isFinite(dpi) && dpi > 0))];
const EMPTY_TRANSLATION_MESSAGE = '번역할 본문을 찾지 못했습니다.';
const OVERLAY_FONT_SIZE = Number(process.env.LAYOUT_TRANSLATION_FONT_SIZE || 8.8);
const OVERLAY_LINE_GAP = Number(process.env.LAYOUT_TRANSLATION_LINE_GAP || 2);
const MIN_WRITABLE_BLOCK_WIDTH = 110;
const MIN_WRITABLE_BLOCK_HEIGHT = 12;
const FONT_CANDIDATES = [
  process.env.REPORT_FONT_PATH,
  path.join(repoRoot, 'fonts/NotoSansKR-Regular.otf'),
  path.join(repoRoot, 'fonts/NotoSansKR-Regular.ttf'),
  path.join(repoRoot, 'fonts/Pretendard-Regular.otf'),
  path.join(repoRoot, 'node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff'),
  path.join(repoRoot, 'node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff2'),
  path.join(repoRoot, 'node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-400-normal.woff'),
  path.join(repoRoot, 'node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-400-normal.woff2'),
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf',
  '/usr/share/fonts/truetype/nanum/NanumGothic.ttf'
].filter(Boolean);

export async function createFigurePreservingTranslationPdf(sourcePdfPath, translation, { reportId = 'unknown' } = {}) {
  if (!translation || !['translated', 'partial'].includes(translation.status) || !translation.body) {
    return null;
  }

  await assertCommand('pdftoppm');
  await assertCommand('pdftotext');

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-lens-layout-'));
  try {
    const normalizedPdfPath = path.join(workDir, 'source.pdf');
    await fs.copyFile(sourcePdfPath, normalizedPdfPath);
    const layout = await extractLayout(normalizedPdfPath, workDir);
    const pageImages = await renderPages(normalizedPdfPath, workDir);
    const pdf = await renderTranslatedOverlayPdf({ layout, pageImages, translation, reportId });
    return pdf;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function assertCommand(command) {
  try {
    await execFileAsync(command, ['-v'], { timeout: 5000 });
  } catch (error) {
    if (command === 'pdftotext') {
      await execFileAsync(command, ['-h'], { timeout: 5000 }).catch(() => {
        throw buildMissingToolError(command, error);
      });
      return;
    }
    throw buildMissingToolError(command, error);
  }
}

function buildMissingToolError(command, cause) {
  const error = new Error(`Figure 보존 번역 PDF를 만들려면 Poppler 도구(${command})가 서버에 설치되어 있어야 합니다.`);
  error.status = 501;
  error.cause = cause;
  return error;
}

async function extractLayout(sourcePdfPath, workDir) {
  const htmlPath = path.join(workDir, 'layout.html');
  await runPoppler('pdftotext', ['-bbox-layout', '-enc', 'UTF-8', sourcePdfPath, htmlPath]);
  const html = await fs.readFile(htmlPath, 'utf8');
  return parseBboxLayout(html);
}

async function renderPages(sourcePdfPath, workDir) {
  let lastError;
  for (const dpi of RENDER_DPI_CANDIDATES) {
    const prefix = path.join(workDir, `page-${dpi}`);
    try {
      await runPoppler('pdftoppm', ['-png', '-r', String(dpi), sourcePdfPath, prefix]);
      const images = await collectRenderedPages(workDir, `page-${dpi}`);
      if (images.length) return images;
      lastError = new Error(`pdftoppm 실행은 완료됐지만 ${dpi} DPI 이미지가 생성되지 않았습니다.`);
    } catch (error) {
      lastError = error;
      await removeRenderedPages(workDir, `page-${dpi}`);
      console.warn(`pdftoppm failed at ${dpi} DPI; trying fallback if available:`, error.message);
    }
  }
  throw makePopplerFailure('pdftoppm', lastError, '원본 PDF 페이지를 이미지로 변환하지 못했습니다. PDF가 손상됐거나 Render 메모리/시간 제한에 걸렸을 수 있습니다.');
}

async function collectRenderedPages(workDir, prefixName) {
  const entries = await fs.readdir(workDir);
  return entries
    .filter((entry) => new RegExp(`^${escapeRegExp(prefixName)}-\\d+\\.png$`).test(entry))
    .sort((a, b) => Number(a.match(/(\\d+)\\.png$/)?.[1] || 0) - Number(b.match(/(\\d+)\\.png$/)?.[1] || 0))
    .map((entry) => path.join(workDir, entry));
}

async function removeRenderedPages(workDir, prefixName) {
  const entries = await fs.readdir(workDir).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.startsWith(`${prefixName}-`) && entry.endsWith('.png'))
    .map((entry) => fs.rm(path.join(workDir, entry), { force: true })));
}

async function runPoppler(command, args) {
  try {
    return await execFileAsync(command, args, { timeout: POPPLER_TIMEOUT_MS, maxBuffer: 1024 * 1024 * 8 });
  } catch (error) {
    throw makePopplerFailure(command, error);
  }
}

function makePopplerFailure(command, error, fallbackMessage = '') {
  const details = sanitizePopplerDetails(error?.stderr || error?.stdout || error?.message || '');
  const message = fallbackMessage || `${command} 처리 중 오류가 발생했습니다.`;
  const wrapped = new Error(details ? `${message} (${details})` : message);
  wrapped.status = error?.status || 422;
  wrapped.cause = error;
  return wrapped;
}

function sanitizePopplerDetails(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\/[^ ]+/g, '[path]')
    .trim()
    .slice(0, 240);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseBboxLayout(html) {
  const pages = [];
  const pageRegex = /<page\b([^>]*)>([\s\S]*?)<\/page>/g;
  let pageMatch;
  while ((pageMatch = pageRegex.exec(html)) !== null) {
    const attrs = parseAttributes(pageMatch[1]);
    const words = parseWords(pageMatch[2]);
    const lines = groupWordsIntoLines(words);
    pages.push({
      width: Number(attrs.width || 612),
      height: Number(attrs.height || 792),
      words,
      lines,
      blocks: groupLinesIntoBlocks(lines)
    });
  }
  return { pages, referenceStart: findReferenceStart(pages) };
}

function parseWords(pageHtml) {
  const words = [];
  const wordRegex = /<word\b([^>]*)>([\s\S]*?)<\/word>/g;
  let wordMatch;
  while ((wordMatch = wordRegex.exec(pageHtml)) !== null) {
    const attrs = parseAttributes(wordMatch[1]);
    const text = decodeHtml(wordMatch[2]);
    if (!text) continue;
    words.push({
      text,
      xMin: Number(attrs.xMin || 0),
      yMin: Number(attrs.yMin || 0),
      xMax: Number(attrs.xMax || 0),
      yMax: Number(attrs.yMax || 0)
    });
  }
  return words.sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
}

function parseAttributes(value) {
  const attrs = {};
  const attrRegex = /(\w+)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(value)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function groupWordsIntoLines(words) {
  const lines = [];
  for (const word of words) {
    const line = lines.find((item) => Math.abs(item.yMin - word.yMin) < 2.5);
    if (line) {
      line.words.push(word);
      line.xMin = Math.min(line.xMin, word.xMin);
      line.yMin = Math.min(line.yMin, word.yMin);
      line.xMax = Math.max(line.xMax, word.xMax);
      line.yMax = Math.max(line.yMax, word.yMax);
      line.text = line.words.sort((a, b) => a.xMin - b.xMin).map((item) => item.text).join(' ');
    } else {
      lines.push({ ...word, words: [word] });
    }
  }
  return lines.sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
}

function groupLinesIntoBlocks(lines) {
  const blocks = [];
  for (const line of lines) {
    const previous = blocks.at(-1);
    const lineHeight = Math.max(line.yMax - line.yMin, 8);
    const gap = previous ? line.yMin - previous.yMax : Infinity;
    const sameColumn = previous ? Math.abs(line.xMin - previous.xMin) < 42 : false;
    if (previous && gap < lineHeight * 1.7 && sameColumn) {
      previous.lines.push(line);
      previous.xMin = Math.min(previous.xMin, line.xMin);
      previous.yMin = Math.min(previous.yMin, line.yMin);
      previous.xMax = Math.max(previous.xMax, line.xMax);
      previous.yMax = Math.max(previous.yMax, line.yMax);
      previous.text = previous.lines.map((item) => item.text).join(' ');
    } else {
      blocks.push({
        xMin: line.xMin,
        yMin: line.yMin,
        xMax: line.xMax,
        yMax: line.yMax,
        text: line.text,
        lines: [line]
      });
    }
  }
  return blocks;
}

function findReferenceStart(pages) {
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const line = pages[pageIndex].lines.find((item) => /^(references|bibliography|works cited|참고문헌)$/i.test(item.text.trim()));
    if (line) return { pageIndex, yMin: line.yMin };
  }
  return null;
}

async function renderTranslatedOverlayPdf({ layout, pageImages, translation, reportId }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0, bufferPages: true, info: { Title: `${translation.title || '한국어 번역본'} (${reportId})` } });
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    registerFont(doc);
    const translatedText = normalizeTranslationText(translation.body);
    let cursor = 0;
    let renderedPageCount = 0;

    for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex += 1) {
      const page = layout.pages[pageIndex];
      if (layout.referenceStart && pageIndex > layout.referenceStart.pageIndex) break;
      if (cursor >= translatedText.length && renderedPageCount > 0) break;

      const blocks = getWritableBlocks(page, pageIndex, layout.referenceStart);
      if (!blocks.length) continue;

      doc.addPage({ size: [page.width, page.height], margin: 0 });
      renderedPageCount += 1;
      if (pageImages[pageIndex]) doc.image(pageImages[pageIndex], 0, 0, { width: page.width, height: page.height });

      coverDetectedText(doc, page, pageIndex, layout.referenceStart);
      for (const block of blocks) {
        if (cursor >= translatedText.length) break;
        const next = takeTextForBlock(doc, translatedText, cursor, block);
        if (!next.text) continue;
        drawTranslatedBlock(doc, block, next.text);
        cursor = next.cursor;
      }

      if (layout.referenceStart?.pageIndex === pageIndex) {
        coverReferenceTail(doc, page, layout.referenceStart.yMin);
      }
    }

    if (!renderedPageCount) {
      doc.addPage({ size: 'A4', margin: 44 });
      registerFont(doc);
      doc.fontSize(12).fillColor('#111827').text(EMPTY_TRANSLATION_MESSAGE);
    }
    addPageNumbers(doc);
    doc.end();
  });
}

function coverDetectedText(doc, page, pageIndex, referenceStart) {
  for (const line of page.lines) {
    if (referenceStart && pageIndex === referenceStart.pageIndex && line.yMin >= referenceStart.yMin) continue;
    coverRect(doc, line.xMin, line.yMin, line.xMax, line.yMax, 2.4);
  }
}

function getWritableBlocks(page, pageIndex, referenceStart) {
  return page.blocks
    .filter((block) => isWritableBlock(block, pageIndex, referenceStart))
    .sort((a, b) => a.yMin - b.yMin || a.xMin - b.xMin);
}

function isWritableBlock(block, pageIndex, referenceStart) {
  if (referenceStart && pageIndex === referenceStart.pageIndex && block.yMin >= referenceStart.yMin) return false;
  const width = block.xMax - block.xMin;
  const height = block.yMax - block.yMin;
  if (width < MIN_WRITABLE_BLOCK_WIDTH || height < MIN_WRITABLE_BLOCK_HEIGHT) return false;
  if (!/[A-Za-z가-힣]/.test(block.text) || block.text.length < 18) return false;
  return true;
}

function normalizeTranslationText(body) {
  return String(body || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
}

function takeTextForBlock(doc, text, cursor, block) {
  let start = skipWhitespace(text, cursor);
  if (start >= text.length) return { text: '', cursor: start };

  const width = Math.max(block.xMax - block.xMin - 4, 40);
  const height = Math.max(block.yMax - block.yMin - 4, 10);
  const capacity = estimateCharacterCapacity(width, height);
  if (capacity < 12) return { text: '', cursor: start };

  let end = Math.min(text.length, start + capacity);
  if (end < text.length) {
    const paragraphBreak = text.slice(start, end).lastIndexOf('\n\n');
    const sentenceBreak = Math.max(
      text.slice(start, end).lastIndexOf('. '),
      text.slice(start, end).lastIndexOf('다. '),
      text.slice(start, end).lastIndexOf('? '),
      text.slice(start, end).lastIndexOf('! ')
    );
    const wordBreak = text.slice(start, end).lastIndexOf(' ');
    const breakAt = [paragraphBreak, sentenceBreak >= 0 ? sentenceBreak + 1 : -1, wordBreak]
      .filter((index) => index > Math.min(24, capacity * 0.35))
      .sort((a, b) => b - a)[0];
    if (breakAt) end = start + breakAt;
  }

  let candidate = text.slice(start, end).trim();
  while (candidate && !fitsBlock(doc, candidate, width, height)) {
    const shorter = candidate.slice(0, Math.floor(candidate.length * 0.9));
    const lastSpace = shorter.lastIndexOf(' ');
    candidate = shorter.slice(0, lastSpace > 20 ? lastSpace : shorter.length).trim();
    end = start + candidate.length;
  }

  return { text: candidate, cursor: skipWhitespace(text, end) };
}

function skipWhitespace(text, cursor) {
  let index = cursor;
  while (index < text.length && /\s/.test(text[index])) index += 1;
  return index;
}

function estimateCharacterCapacity(width, height) {
  const charsPerLine = Math.max(8, Math.floor(width / (OVERLAY_FONT_SIZE * 0.62)));
  const lineCount = Math.max(1, Math.floor(height / (OVERLAY_FONT_SIZE + OVERLAY_LINE_GAP)));
  return Math.floor(charsPerLine * lineCount * 0.9);
}

function fitsBlock(doc, text, width, height) {
  doc.fontSize(OVERLAY_FONT_SIZE);
  return doc.heightOfString(text, { width, lineGap: OVERLAY_LINE_GAP }) <= height + 1;
}

function coverRect(doc, xMin, yMin, xMax, yMax, padding = 1.8) {
  doc.save()
    .rect(xMin - padding, yMin - padding, xMax - xMin + padding * 2, yMax - yMin + padding * 2)
    .fill('#ffffff')
    .restore();
}

function coverReferenceTail(doc, page, yMin) {
  doc.save()
    .rect(0, yMin - 4, page.width, page.height - yMin + 4)
    .fill('#ffffff')
    .restore();
}

function drawTranslatedBlock(doc, block, text) {
  const x = block.xMin + 2;
  const y = block.yMin + 1;
  const width = Math.max(block.xMax - block.xMin - 4, 40);
  const height = Math.max(block.yMax - block.yMin - 2, 10);
  doc.fillColor('#111827').fontSize(OVERLAY_FONT_SIZE).text(text, x, y, {
    width,
    height,
    align: 'left',
    lineGap: OVERLAY_LINE_GAP,
    ellipsis: true
  });
}

function registerFont(doc) {
  for (const fontPath of FONT_CANDIDATES) {
    if (!fontPath || !fsSync.existsSync(fontPath)) continue;
    try {
      doc.font(fontPath);
      console.log(`Using layout translation font: ${fontPath}`);
      return;
    } catch (error) {
      console.warn(`Skipping unsupported layout translation font ${fontPath}: ${error.message}`);
    }
  }

  const error = new Error('Figure 보존 번역 PDF에 사용할 한글 폰트를 찾지 못했습니다. REPORT_FONT_PATH 또는 fonts/NotoSansKR-Regular.otf를 설정해 주세요.');
  error.status = 501;
  throw error;
}

function addPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.fontSize(7.5).fillColor('#64748b').text(`Translated page ${i + 1} / ${range.count}`, 0, doc.page.height - 18, { align: 'center' });
  }
}
