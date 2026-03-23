import { Router } from 'express';
import {
  criarInstancia,
  statusInstancia,
  logsInstancia,
  reiniciarInstancia,
  pararInstancia,
  listarInstancias,
} from '../services/pm2Service.js';
import { validarCriacaoInstancia } from '../utils/validacao.js';

export const router = Router();

// POST /api/ia/criar
router.post('/criar', validarCriacaoInstancia, async (req, res) => {
  try {
    const resultado = await criarInstancia(req.body);
    return res.status(201).json(resultado);
  } catch (erro) {
    console.error('[CRIAR]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

// GET /api/ia/listar
router.get('/listar', async (_req, res) => {
  try {
    const lista = await listarInstancias();
    return res.status(200).json({ instancias: lista });
  } catch (erro) {
    console.error('[LISTAR]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

// GET /api/ia/:nome/status
router.get('/:nome/status', async (req, res) => {
  try {
    const status = await statusInstancia(req.params.nome);
    return res.status(200).json(status);
  } catch (erro) {
    console.error('[STATUS]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

// GET /api/ia/:nome/logs?linhas=100
router.get('/:nome/logs', async (req, res) => {
  try {
    const linhas = parseInt(req.query.linhas) || 50;
    const logs = await logsInstancia(req.params.nome, linhas);
    return res.status(200).json(logs);
  } catch (erro) {
    console.error('[LOGS]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

// POST /api/ia/:nome/reiniciar
router.post('/:nome/reiniciar', async (req, res) => {
  try {
    const resultado = await reiniciarInstancia(req.params.nome);
    return res.status(200).json(resultado);
  } catch (erro) {
    console.error('[REINICIAR]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

// POST /api/ia/:nome/parar
router.post('/:nome/parar', async (req, res) => {
  try {
    const resultado = await pararInstancia(req.params.nome);
    return res.status(200).json(resultado);
  } catch (erro) {
    console.error('[PARAR]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});
