const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Diretório base onde todas as instâncias de IA serão instaladas na VPS
const BASE_DIR = process.env.IA_BASE_DIR || '/apps/ias';

// Garante que o diretório base existe
function garantirDiretorioBase() {
  if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
  }
}

// Executa comando e retorna stdout como string
function executar(comando, cwd) {
  return execSync(comando, {
    cwd: cwd || undefined,
    encoding: 'utf8',
    timeout: 120000 // 2 minutos de timeout
  }).toString().trim();
}

// Monta o conteúdo do .env a partir dos dados recebidos
function montarEnv(dados) {
  return [
    `PORT=${dados.porta}`,
    `OPENAI_API_KEY=${dados.openai_api_key}`,
    `DB_HOST=${dados.db_host}`,
    `DB_PORT=${dados.db_porta || 5432}`,
    `DB_NAME=${dados.db_nome}`,
    `DB_USER=${dados.db_usuario}`,
    `DB_PASSWORD=${dados.db_senha}`,
    `UNIDADE_NEGOCIO_ID=${dados.unidade_negocio_id || 65984}`
  ].join('\n');
}

// Valida os campos obrigatórios
function validarDados(dados) {
  const obrigatorios = ['nome', 'porta', 'openai_api_key', 'db_host', 'db_nome', 'db_usuario', 'db_senha'];
  const faltando = obrigatorios.filter(campo => !dados[campo]);
  if (faltando.length > 0) {
    throw new Error(`Campos obrigatórios faltando: ${faltando.join(', ')}`);
  }

  // Nome só pode ter letras, números e hífen
  if (!/^[a-zA-Z0-9-_]+$/.test(dados.nome)) {
    throw new Error('Nome da instância deve conter apenas letras, números, hífens e underscores');
  }
}

// ─────────────────────────────────────────
// CRIAR INSTÂNCIA
// ─────────────────────────────────────────
async function criarInstancia(dados) {
  validarDados(dados);
  garantirDiretorioBase();

  const nomePM2 = `ia-${dados.nome}`;
  const dirInstancia = path.join(BASE_DIR, dados.nome);

  // Verifica se já existe
  if (fs.existsSync(dirInstancia)) {
    throw new Error(`Já existe uma instância com o nome "${dados.nome}". Use outro nome ou delete a existente.`);
  }

  const repo = dados.repo_url || 'https://github.com/UnicoContato/alpha7_IA_view.git';

  const etapas = [];

  // 1. Clonar repositório
  etapas.push({ etapa: 'clone', status: 'iniciando' });
  executar(`git clone ${repo} ${dirInstancia}`);
  etapas[0].status = 'ok';

  // 2. Criar arquivo .env
  etapas.push({ etapa: 'env', status: 'iniciando' });
  const envContent = montarEnv(dados);
  fs.writeFileSync(path.join(dirInstancia, '.env'), envContent, 'utf8');
  etapas[1].status = 'ok';

  // 3. Instalar dependências
  etapas.push({ etapa: 'npm_install', status: 'iniciando' });
  executar('npm install --omit=dev', dirInstancia);
  etapas[2].status = 'ok';

  // 4. Criar diretório de logs
  const logsDir = path.join(dirInstancia, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  // 5. Subir no PM2
  etapas.push({ etapa: 'pm2_start', status: 'iniciando' });
  executar(`pm2 start ${path.join(dirInstancia, 'ecosystem.config.js')} --name ${nomePM2}`);
  executar('pm2 save');
  etapas[3].status = 'ok';

  return {
    sucesso: true,
    mensagem: `Instância "${dados.nome}" criada e rodando com sucesso!`,
    instancia: {
      nome: dados.nome,
      nome_pm2: nomePM2,
      porta: dados.porta,
      diretorio: dirInstancia
    },
    etapas
  };
}

// ─────────────────────────────────────────
// STATUS DA INSTÂNCIA
// ─────────────────────────────────────────
function statusInstancia(nome) {
  const nomePM2 = `ia-${nome}`;

  try {
    const saida = executar(`pm2 jlist`);
    const processos = JSON.parse(saida);
    const processo = processos.find(p => p.name === nomePM2);

    if (!processo) {
      return {
        sucesso: false,
        mensagem: `Instância "${nome}" não encontrada no PM2`,
        status: 'não encontrada'
      };
    }

    return {
      sucesso: true,
      instancia: {
        nome,
        nome_pm2: nomePM2,
        status: processo.pm2_env?.status || 'desconhecido',
        pid: processo.pid,
        uptime: processo.pm2_env?.pm_uptime ? new Date(processo.pm2_env.pm_uptime).toISOString() : null,
        reinicializacoes: processo.pm2_env?.restart_time || 0,
        memoria_mb: processo.monit?.memory ? Math.round(processo.monit.memory / 1024 / 1024) : 0,
        cpu_percent: processo.monit?.cpu || 0,
        porta: processo.pm2_env?.PORT || null
      }
    };
  } catch (err) {
    throw new Error(`Erro ao consultar PM2: ${err.message}`);
  }
}

// ─────────────────────────────────────────
// LOGS DA INSTÂNCIA
// ─────────────────────────────────────────
function logsInstancia(nome, linhas = 50) {
  const nomePM2 = `ia-${nome}`;
  const dirInstancia = path.join(BASE_DIR, nome);

  // Tenta ler o arquivo de log direto (mais confiável)
  const logOut = path.join(dirInstancia, 'logs', 'out.log');
  const logErr = path.join(dirInstancia, 'logs', 'err.log');

  const resultado = { nome, nome_pm2: nomePM2, logs: {} };

  if (fs.existsSync(logOut)) {
    const linhasArquivo = fs.readFileSync(logOut, 'utf8').split('\n');
    resultado.logs.stdout = linhasArquivo.slice(-linhas).join('\n');
  } else {
    resultado.logs.stdout = '(nenhum log de saída ainda)';
  }

  if (fs.existsSync(logErr)) {
    const linhasArquivo = fs.readFileSync(logErr, 'utf8').split('\n');
    resultado.logs.stderr = linhasArquivo.slice(-linhas).join('\n');
  } else {
    resultado.logs.stderr = '(nenhum log de erro)';
  }

  return { sucesso: true, ...resultado };
}

// ─────────────────────────────────────────
// REINICIAR INSTÂNCIA
// ─────────────────────────────────────────
function reiniciarInstancia(nome) {
  const nomePM2 = `ia-${nome}`;
  try {
    executar(`pm2 restart ${nomePM2}`);
    return {
      sucesso: true,
      mensagem: `Instância "${nome}" reiniciada com sucesso!`
    };
  } catch (err) {
    throw new Error(`Erro ao reiniciar: ${err.message}`);
  }
}

// ─────────────────────────────────────────
// PARAR INSTÂNCIA
// ─────────────────────────────────────────
function pararInstancia(nome) {
  const nomePM2 = `ia-${nome}`;
  try {
    executar(`pm2 stop ${nomePM2}`);
    return {
      sucesso: true,
      mensagem: `Instância "${nome}" parada com sucesso!`
    };
  } catch (err) {
    throw new Error(`Erro ao parar: ${err.message}`);
  }
}

// ─────────────────────────────────────────
// LISTAR TODAS AS INSTÂNCIAS
// ─────────────────────────────────────────
function listarInstancias() {
  try {
    const saida = executar('pm2 jlist');
    const processos = JSON.parse(saida);

    const instancias = processos
      .filter(p => p.name && p.name.startsWith('ia-'))
      .map(p => ({
        nome: p.name.replace(/^ia-/, ''),
        nome_pm2: p.name,
        status: p.pm2_env?.status || 'desconhecido',
        pid: p.pid,
        reinicializacoes: p.pm2_env?.restart_time || 0,
        memoria_mb: p.monit?.memory ? Math.round(p.monit.memory / 1024 / 1024) : 0,
        cpu_percent: p.monit?.cpu || 0,
        porta: p.pm2_env?.PORT || null
      }));

    return { sucesso: true, total: instancias.length, instancias };
  } catch (err) {
    throw new Error(`Erro ao listar instâncias: ${err.message}`);
  }
}

module.exports = {
  criarInstancia,
  statusInstancia,
  logsInstancia,
  reiniciarInstancia,
  pararInstancia,
  listarInstancias
};
