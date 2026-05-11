import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { extractTextFromPdf } from '../services/pdfService.js';
import { summarizePaper } from '../services/openaiService.js';
import { searchSimilarPapers } from '../services/paperSearchService.js';
import { createSummaryReportPdf } from '../services/pdfReportService.js';

const router = express.Router();
const uploadsDir = path.resolve('server/uploads');
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const reportCache = new Map();

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
    const summary = await summarizePaper(extracted.text, extracted.info);
    const recommendations = await searchSimilarPapers(summary);
    const reportId = crypto.randomUUID();
    const analysis = {
      reportId,
      fileName: req.file.originalname,
      pageCount: extracted.pageCount,
      summary,
      recommendations
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

router.get('/reports/:reportId.pdf', async (req, res, next) => {
  try {
    const analysis = reportCache.get(req.params.reportId);
    if (!analysis) {
      const error = new Error('요약 보고서를 찾을 수 없습니다. 다시 분석해 주세요.');
      error.status = 404;
      throw error;
    }

    const pdfBuffer = await createSummaryReportPdf(analysis);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="paper-lens-${analysis.reportId}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
});

router.use((err, _req, _res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    err.message = 'PDF 파일 크기는 20MB 이하만 업로드할 수 있습니다.';
    err.status = 400;
  }
  next(err);
});

export default router;
