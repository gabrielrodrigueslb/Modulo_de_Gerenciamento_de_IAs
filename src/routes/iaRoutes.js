import { Router } from 'express';
import {
  criarInstancia,
  statusInstancia,
  logsInstancia,
  reiniciarInstancia,
  pararInstancia,
  listarInstancias,
  atualizarInstancia,
  atualizarTodasInstancias,
} from '../services/pm2Service.js';
import { validarCriacaoInstancia } from '../utils/validacao.js';

export const router = Router();

function tipoDaRequisicao(req) {
  return req.params.tipo || req.query.tipo || req.body?.tipo || null;
}

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
router.get('/listar', async (req, res) => {
  try {
    const lista = await listarInstancias(tipoDaRequisicao(req));
    return res.status(200).json({ instancias: lista });
  } catch (erro) {
    console.error('[LISTAR]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

// GET /api/ia/:nome/status
router.get('/:tipo/:nome/status', async (req, res) => {
  try {
    const status = await statusInstancia(req.params.nome, req.params.tipo);
    return res.status(200).json(status);
  } catch (erro) {
    console.error('[STATUS_TIPO]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

router.get('/:nome/status', async (req, res) => {
  try {
    const status = await statusInstancia(req.params.nome, tipoDaRequisicao(req));
    return res.status(200).json(status);
  } catch (erro) {
    console.error('[STATUS]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

// GET /api/ia/:nome/logs?linhas=100
router.get('/:tipo/:nome/logs', async (req, res) => {
  try {
    const linhas = parseInt(req.query.linhas) || 50;
    const logs = await logsInstancia(req.params.nome, linhas, req.params.tipo);
    return res.status(200).json(logs);
  } catch (erro) {
    console.error('[LOGS_TIPO]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

router.get('/:nome/logs', async (req, res) => {
  try {
    const linhas = parseInt(req.query.linhas) || 50;
    const logs = await logsInstancia(
      req.params.nome,
      linhas,
      tipoDaRequisicao(req),
    );
    return res.status(200).json(logs);
  } catch (erro) {
    console.error('[LOGS]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

// POST /api/ia/:nome/reiniciar
router.post('/:tipo/:nome/reiniciar', async (req, res) => {
  try {
    const resultado = await reiniciarInstancia(req.params.nome, req.params.tipo);
    return res.status(200).json(resultado);
  } catch (erro) {
    console.error('[REINICIAR_TIPO]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

router.post('/:nome/reiniciar', async (req, res) => {
  try {
    const resultado = await reiniciarInstancia(
      req.params.nome,
      tipoDaRequisicao(req),
    );
    return res.status(200).json(resultado);
  } catch (erro) {
    console.error('[REINICIAR]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

// POST /api/ia/:nome/atualizar
router.post('/:tipo/:nome/atualizar', async (req, res) => {
  try {
    const resultado = await atualizarInstancia(req.params.nome, req.params.tipo);
    return res.status(200).json(resultado);
  } catch (erro) {
    console.error('[ATUALIZAR_TIPO]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

router.post('/:nome/atualizar', async (req, res) => {
  try {
    const resultado = await atualizarInstancia(
      req.params.nome,
      tipoDaRequisicao(req),
    );
    return res.status(200).json(resultado);
  } catch (erro) {
    console.error('[ATUALIZAR]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

// POST /api/ia/atualizar-todas
router.post('/atualizar-todas', async (req, res) => {
  try {
    const resultado = await atualizarTodasInstancias(tipoDaRequisicao(req));
    return res.status(200).json(resultado);
  } catch (erro) {
    console.error('[ATUALIZAR_TODAS]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

// POST /api/ia/:nome/parar
router.post('/:tipo/:nome/parar', async (req, res) => {
  try {
    const resultado = await pararInstancia(req.params.nome, req.params.tipo);
    return res.status(200).json(resultado);
  } catch (erro) {
    console.error('[PARAR_TIPO]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});

router.post('/:nome/parar', async (req, res) => {
  try {
    const resultado = await pararInstancia(req.params.nome, tipoDaRequisicao(req));
    return res.status(200).json(resultado);
  } catch (erro) {
    console.error('[PARAR]', erro.message);
    return res.status(500).json({ erro: erro.message });
  }
});
