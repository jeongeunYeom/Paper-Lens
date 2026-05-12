import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { extractTextFromPdf } from '../services/pdfService.js';
import { summarizePaper, translatePaperToKorean } from '../services/openaiService.js';
import { searchSimilarPapers } from '../services/paperSearchService.js';
import { createSummaryReportPdf } from '../services/pdfReportService.js';
import { createFigurePreservingTranslationPdf } from '../services/layoutTranslationService.js';

const router = express.Router();
const routeDir = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.resolve(routeDir, '../uploads');
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const reportCache = new Map();
const layoutTranslationCache = new Map();

const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf' || !file.originalname.toLowerCase().endsWith('.pdf')) {
      const error = new Error('PDF 파일만 업로드할 수 있습니다.');
      error.status = 400;
      return cb(error);
    }
    return cb(null, true);
  }
});

router.post('/analyze', upload.single('paper'), async (req, res, next) => {
  const uploadedPath = req.file?.path;

  try {
    if (!req.file) {
      const error = new Error('분석할 PDF 파일을 업로드해 주세요.');
      error.status = 400;
      throw error;
    }

    const extracted = await extractTextFromPdf(uploadedPath);
    const summaryResult = await summarizePaper(extracted.text, extracted.info);
    const { _tokenUsage: tokenUsage = null, ...summary } = summaryResult;
    const translation = await translatePaperSafely(extracted.text, extracted.info);
    const reportId = crypto.randomUUID();
    const layoutTranslation = await buildLayoutTranslationReport(uploadedPath, translation, reportId);
    const recommendations = await searchSimilarPapers(summary);
    const analysis = {
      reportId,
      fileName: req.file.originalname,
      pageCount: extracted.pageCount,
      summary,
      translation,
      layoutTranslation,
      recommendations,
      tokenUsage
    };

    reportCache.set(reportId, analysis);
    setTimeout(() => reportCache.delete(reportId), 30 * 60 * 1000).unref();

    res.json(analysis);
  } catch (error) {
    next(error);
  } finally {
    if (uploadedPath) {
      await fs.unlink(uploadedPath).catch(() => {});
    }
  }
});


router.post('/reports/pdf', async (req, res, next) => {
  try {
    const analysis = req.body;
    if (!analysis?.summary) {
      const error = new Error('요약 보고서를 생성할 분석 결과가 없습니다. PDF를 다시 분석해 주세요.');
      error.status = 400;
      throw error;
    }

    const pdfBuffer = await createSummaryReportPdf({
      ...analysis,
      reportId: analysis.reportId || crypto.randomUUID(),
      recommendations: analysis.recommendations || [],
      tokenUsage: analysis.tokenUsage || null
    });
    sendPdfBuffer(res, pdfBuffer, buildReportFileName(analysis));
  } catch (error) {
    next(error);
  }
});

router.get('/reports/:reportId.layout-translated.pdf', async (req, res, next) => {
  try {
    const report = layoutTranslationCache.get(req.params.reportId);
    if (!report) {
      const error = new Error('Figure 보존 번역 PDF를 찾을 수 없습니다. 다시 분석해 주세요.');
      error.status = 404;
      throw error;
    }

    sendPdfBuffer(res, report.buffer, report.fileName);
  } catch (error) {
    next(error);
  }
});

router.get('/reports/:reportId.pdf', async (req, res, next) => {
  try {
    const analysis = reportCache.get(req.params.reportId);
    if (!analysis) {
      const error = new Error('요약 보고서를 찾을 수 없습니다. 다시 분석해 주세요.');
      error.status = 404;
      throw error;
    }

    const pdfBuffer = await createSummaryReportPdf(analysis);
    sendPdfBuffer(res, pdfBuffer, buildReportFileName(analysis));
  } catch (error) {
    next(error);
  }
});


async function translatePaperSafely(text, metadata) {
  try {
    return await translatePaperToKorean(text, metadata);
  } catch (error) {
    console.warn('OpenAI translation failed without aborting analysis:', error.message);
    return {
      sourceLanguage: 'unknown',
      targetLanguage: 'ko',
      status: 'failed',
      title: '한국어 번역본',
      body: '',
      note: `번역 처리 중 오류가 발생했습니다. 요약 결과는 계속 제공합니다. (${error.message})`
    };
  }
}

async function buildLayoutTranslationReport(sourcePdfPath, translation, reportId) {
  if (!sourcePdfPath || !['translated', 'partial'].includes(translation?.status)) return null;

  try {
    const buffer = await createFigurePreservingTranslationPdf(sourcePdfPath, translation, { reportId });
    if (!buffer) return null;

    const report = {
      reportId,
      status: 'ready',
      downloadPath: `/api/reports/${reportId}.layout-translated.pdf`,
      fileName: `${sanitizeFileName(translation.title || '한국어_번역본')}.pdf`
    };
    layoutTranslationCache.set(reportId, { ...report, buffer });
    setTimeout(() => layoutTranslationCache.delete(reportId), 30 * 60 * 1000).unref();
    return report;
  } catch (error) {
    console.warn('Figure-preserving translation PDF unavailable:', error.message);
    return {
      reportId,
      status: 'unavailable',
      message: error.message
    };
  }
}

function buildReportFileName(analysis = {}) {
  const title = analysis.summary?.title || path.parse(analysis.fileName || '').name || '논문';
  return `${sanitizeFileName(title)}_요약.pdf`;
}

function sanitizeFileName(value) {
  return String(value || '논문')
    .normalize('NFC')
    .replace(/[\/\?%*:|"<>]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || '논문';
}

function ensurePdfExtension(fileName) {
  return fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`;
}

function buildContentDisposition(fileName) {
  const asciiFallback = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRFC5987ValueChars(fileName)}`;
}

function encodeRFC5987ValueChars(value) {
  return encodeURIComponent(value).replace(/['()]/g, escape).replace(/\*/g, '%2A');
}

function sendPdfBuffer(res, pdfBuffer, fileName) {
  if (!Buffer.isBuffer(pdfBuffer) || pdfBuffer.length < 1500) {
    const error = new Error('요약 보고서 PDF 생성에 실패했습니다. 파일 크기가 비정상적으로 작습니다.');
    error.status = 500;
    throw error;
  }
  const safeFileName = ensurePdfExtension(fileName || '논문_요약');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', buildContentDisposition(safeFileName));
  res.setHeader('Content-Length', String(pdfBuffer.length));
  res.send(pdfBuffer);
}

router.use((err, _req, _res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    err.message = 'PDF 파일 크기는 20MB 이하만 업로드할 수 있습니다.';
    err.status = 400;
  }
  next(err);
});

export default router;
