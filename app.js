import 'dotenv/config';
import express from 'express';
import { router as iaRouter } from './src/routes/iaRoutes.js';

const app = express();
app.use(express.json());

app.use('/api/ia', iaRouter);

app.get('/', (_req, res) => {
  res.json({ mensagem: 'Único Integra — Módulo de IAs rodando!' });
});

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
