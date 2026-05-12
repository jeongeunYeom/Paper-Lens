import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import PDFDocument from 'pdfkit';

const execFileAsync = promisify(execFile);
const DEFAULT_RENDER_DPI = Number(process.env.LAYOUT_TRANSLATION_RENDER_DPI || 180);
const POPPLER_TIMEOUT_MS = Number(process.env.LAYOUT_TRANSLATION_POPPLER_TIMEOUT_MS || 180000);
const RENDER_DPI_CANDIDATES = [...new Set([DEFAULT_RENDER_DPI, 140, 110, 90].filter((dpi) => Number.isFinite(dpi) && dpi > 0))];
const EMPTY_TRANSLATION_MESSAGE = '번역할 본문을 찾지 못했습니다.';
const FONT_CANDIDATES = [
  process.env.REPORT_FONT_PATH,
  path.resolve('fonts/NotoSansKR-Regular.otf'),
  path.resolve('fonts/NotoSansKR-Regular.ttf'),
  path.resolve('fonts/Pretendard-Regular.otf'),
  path.resolve('node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-korean-400-normal.woff'),
  path.resolve('node_modules/@fontsource/noto-sans-kr/files/noto-sans-kr-400-normal.woff'),
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf',
  '/usr/share/fonts/truetype/nanum/NanumGothic.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
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
    const paragraphs = splitTranslationParagraphs(translation.body);
    let paragraphIndex = 0;

    layout.pages.forEach((page, pageIndex) => {
      if (layout.referenceStart && pageIndex > layout.referenceStart.pageIndex) return;
      doc.addPage({ size: [page.width, page.height], margin: 0 });
      if (pageImages[pageIndex]) doc.image(pageImages[pageIndex], 0, 0, { width: page.width, height: page.height });

      const blocks = page.blocks.filter((block) => shouldTranslateBlock(block, pageIndex, layout.referenceStart));
      for (const block of blocks) {
        const translatedText = paragraphs[paragraphIndex] || '';
        if (!translatedText) continue;

        coverBlock(doc, block);
        drawTranslatedBlock(doc, block, translatedText);
        paragraphIndex += 1;
      }

      if (layout.referenceStart?.pageIndex === pageIndex) {
        coverReferenceTail(doc, page, layout.referenceStart.yMin);
      }
    });

    if (!paragraphs.length) {
      doc.addPage({ size: 'A4', margin: 44 });
      doc.fontSize(12).fillColor('#111827').text(EMPTY_TRANSLATION_MESSAGE);
    }
    addPageNumbers(doc);
    doc.end();
  });
}

function shouldTranslateBlock(block, pageIndex, referenceStart) {
  if (referenceStart && pageIndex === referenceStart.pageIndex && block.yMin >= referenceStart.yMin) return false;
  return block.text.length > 12 && /[A-Za-z가-힣]/.test(block.text);
}

function splitTranslationParagraphs(body) {
  const paragraphs = String(body || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  return paragraphs.flatMap((paragraph) => splitLongParagraphForBlocks(paragraph));
}

function splitLongParagraphForBlocks(paragraph) {
  if (paragraph.length <= 420) return [paragraph];

  const sentences = paragraph
    .replace(/([.!?。다])\s*(?=[A-Z가-힣0-9])/g, '$1|')
    .split('|')
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const chunks = [];
  let current = '';
  for (const sentence of sentences.length ? sentences : [paragraph]) {
    if (`${current} ${sentence}`.trim().length > 420 && current) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function coverBlock(doc, block) {
  const padding = 1.8;
  doc.save()
    .rect(block.xMin - padding, block.yMin - padding, block.xMax - block.xMin + padding * 2, block.yMax - block.yMin + padding * 2)
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
  const width = Math.max(block.xMax - block.xMin, 80);
  const height = Math.max(block.yMax - block.yMin, 16);
  const fontSize = chooseFontSize(doc, text, width, height);
  doc.fillColor('#111827').fontSize(fontSize).text(text, block.xMin, block.yMin, {
    width,
    height,
    lineGap: 1,
    ellipsis: true
  });
}

function chooseFontSize(doc, text, width, height) {
  for (let size = 9.5; size >= 5.5; size -= 0.5) {
    doc.fontSize(size);
    if (doc.heightOfString(text, { width, lineGap: 1 }) <= height + 2) return size;
  }
  return 5.5;
}

function registerFont(doc) {
  for (const fontPath of FONT_CANDIDATES) {
    if (!fontPath || !fsSync.existsSync(fontPath)) continue;
    try {
      doc.font(fontPath);
      return;
    } catch (_) {
      // Try next font candidate.
    }
  }
}

function addPageNumbers(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    doc.fontSize(7.5).fillColor('#64748b').text(`Translated page ${i + 1} / ${range.count}`, 0, doc.page.height - 18, { align: 'center' });
  }
}
