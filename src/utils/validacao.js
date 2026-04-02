const CAMPOS_OBRIGATORIOS = [
  'nome',
  'openai_api_key',
  'db_host',
  'db_name',
  'db_user',
  'db_password',
];

export function validarCriacaoInstancia(req, res, next) {
  const ausentes = CAMPOS_OBRIGATORIOS.filter((campo) => !req.body[campo]);

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
    req.body.env !== undefined &&
    (typeof req.body.env !== 'object' ||
      req.body.env === null ||
      Array.isArray(req.body.env))
  ) {
    return res.status(400).json({
      erro: 'O campo "env" deve ser um objeto com pares chave/valor.',
    });
  }

  next();
}
