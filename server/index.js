import 'dotenv/config';

import path from 'node:path';
import express from 'express';
import cors from 'cors';
import analyzeRouter from './routes/analyze.js';

const app = express();
const port = process.env.PORT || 4000;

if (process.env.CLIENT_ORIGIN) {
  app.use(cors({ origin: process.env.CLIENT_ORIGIN }));
}
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.resolve('client')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'paper-lens-api' });
});

app.use('/api', analyzeRouter);

app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ message: err.message || '서버 오류가 발생했습니다.' });
});

app.listen(port, () => {
  console.log(`Paper Lens API server listening on http://localhost:${port}`);
});
