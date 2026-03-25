import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { router as iaRouter } from './src/routes/iaRoutes.js';

const allowedOrigins = process.env.CORS_ORIGIN
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();
app.use(
  cors(
    allowedOrigins && allowedOrigins.length > 0 && !allowedOrigins.includes('*')
      ? { origin: allowedOrigins }
      : undefined
  )
);
app.use(express.json());

app.use('/api/ia', iaRouter);

app.get('/', (_req, res) => {
  res.json({ mensagem: 'Único Integra — Módulo de IAs rodando!' });
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
