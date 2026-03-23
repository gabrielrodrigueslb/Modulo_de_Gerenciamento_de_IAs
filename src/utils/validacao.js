// Campos obrigatórios para criar uma nova instância de IA
// Porta NÃO está aqui — é alocada automaticamente pelo servidor
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
      erro: 'Campos obrigatórios ausentes.',
      campos: ausentes,
    });
  }

  // Nome só pode ter letras, números, hífen e underscore — vira nome do processo no PM2
  if (!/^[a-zA-Z0-9-_]+$/.test(req.body.nome)) {
    return res.status(400).json({
      erro: 'O campo "nome" só pode conter letras, números, hífens e underscores.',
    });
  }

  next();
}
