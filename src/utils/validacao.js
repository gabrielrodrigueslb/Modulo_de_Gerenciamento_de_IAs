const TIPOS_SUPORTADOS = ['alpha', 'trier'];
const CAMPOS_OBRIGATORIOS_ALPHA = [
  'nome',
  'openai_api_key',
  'db_host',
  'db_name',
  'db_user',
  'db_password',
];

export function validarCriacaoInstancia(req, res, next) {
  const tipo = String(req.body.tipo || 'alpha').trim().toLowerCase();

  if (!TIPOS_SUPORTADOS.includes(tipo)) {
    return res.status(400).json({
      erro: 'O campo "tipo" deve ser "alpha" ou "trier".',
    });
  }

  const camposObrigatorios =
    tipo === 'alpha' ? CAMPOS_OBRIGATORIOS_ALPHA : ['nome'];
  const ausentes = camposObrigatorios.filter((campo) => !req.body[campo]);

  if (ausentes.length > 0) {
    return res.status(400).json({
      erro: 'Campos obrigatorios ausentes.',
      campos: ausentes,
    });
  }

  if (!/^[a-zA-Z0-9-_]+$/.test(req.body.nome)) {
    return res.status(400).json({
      erro: 'O campo "nome" so pode conter letras, numeros, hifens e underscores.',
    });
  }

  if (
    req.body.tipo !== undefined &&
    !TIPOS_SUPORTADOS.includes(String(req.body.tipo).trim().toLowerCase())
  ) {
    return res.status(400).json({
      erro: 'O campo "tipo" deve ser "alpha" ou "trier".',
    });
  }

  if (
    req.body.env !== undefined &&
    (typeof req.body.env !== 'object' ||
      req.body.env === null ||
      Array.isArray(req.body.env))
  ) {
    return res.status(400).json({
      erro: 'O campo "env" deve ser um objeto com pares chave/valor.',
    });
  }

  if (tipo === 'trier') {
    const tokenTrier = req.body.env?.TRIER_TOKEN;

    if (!tokenTrier || !String(tokenTrier).trim()) {
      return res.status(400).json({
        erro: 'Para instancias Trier, envie env.TRIER_TOKEN.',
      });
    }
  }

  next();
}
