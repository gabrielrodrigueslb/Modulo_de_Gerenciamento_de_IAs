import { execSync, exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { proximaPortaLivre } from '../utils/portaManager.js';

const APPS_DIR = process.env.APPS_DIR || '/apps/ias';
const REPO_URL = process.env.REPO_URL;

function garantirDiretorioBase() {
  if (!fs.existsSync(APPS_DIR)) {
    fs.mkdirSync(APPS_DIR, { recursive: true });
  }
}

function montarEnv(dados, porta) {
  return [
    `PORT=${porta}`,
    `OPENAI_API_KEY=${dados.openai_api_key}`,
    `DB_HOST=${dados.db_host}`,
    `DB_PORT=${dados.db_port || 5432}`,
    `DB_NAME=${dados.db_name}`,
    `DB_USER=${dados.db_user}`,
    `DB_PASSWORD=${dados.db_password}`,
    `UNIDADE_NEGOCIO_ID=${dados.unidade_negocio_id || 65984}`,
  ].join('\n');
}

function lerValorEnv(destino, chave) {
  const envPath = path.join(destino, '.env');

  if (!fs.existsSync(envPath)) {
    return null;
  }

  const linha = fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((item) => item.startsWith(`${chave}=`));

  if (!linha) {
    return null;
  }

  return linha.slice(chave.length + 1).trim().replace(/^['"]|['"]$/g, '');
}

function sincronizarEcosystem(destino, nome) {
  const ecosystemPath = path.join(destino, 'ecosystem.config.js');

  if (!fs.existsSync(ecosystemPath)) {
    return null;
  }

  const portaAtual = lerValorEnv(destino, 'PORT');
  const conteudo = fs.readFileSync(ecosystemPath, 'utf8');
  let atualizado = conteudo.replace(
    /name:\s*['"][^'"]+['"]/,
    `name: '${nome}'`,
  );

  if (portaAtual) {
    if (/PORT:\s*['"]?[^,'"\n]+['"]?/.test(atualizado)) {
      atualizado = atualizado.replace(
        /PORT:\s*['"]?[^,'"\n]+['"]?/,
        `PORT: ${portaAtual}`,
      );
    } else if (/NODE_ENV:\s*['"][^'"]+['"],?/.test(atualizado)) {
      atualizado = atualizado.replace(
        /NODE_ENV:\s*['"][^'"]+['"],?/,
        (match) => `${match}\n        PORT: ${portaAtual},`,
      );
    }
  }

  if (atualizado !== conteudo) {
    fs.writeFileSync(ecosystemPath, atualizado, 'utf8');
  }

  return ecosystemPath;
}

export async function criarInstancia(dados) {
  const { nome } = dados;

  if (!REPO_URL) {
    throw new Error('REPO_URL nao configurada no .env do servidor.');
  }

  garantirDiretorioBase();

  const destino = path.join(APPS_DIR, nome);

  if (fs.existsSync(destino)) {
    throw new Error(`Ja existe uma instancia com o nome "${nome}".`);
  }

  const porta = await proximaPortaLivre();
  console.log(`[IA] Porta alocada automaticamente: ${porta}`);

  console.log(`[IA] Clonando ${REPO_URL} em ${destino}...`);
  execSync(`git clone ${REPO_URL} ${destino}`, { stdio: 'pipe' });

  const envContent = montarEnv(dados, porta);
  fs.writeFileSync(path.join(destino, '.env'), envContent, 'utf8');
  console.log(`[IA] .env criado para "${nome}" na porta ${porta}.`);

  console.log('[IA] Instalando dependencias...');
  execSync('npm install', { cwd: destino, stdio: 'pipe' });

  const ecosystemPath = sincronizarEcosystem(destino, nome);

  if (ecosystemPath) {
    console.log(
      `[IA] ecosystem.config.js sincronizado com nome "${nome}" e porta ${porta}.`,
    );
  }

  const scriptPath = ecosystemPath || path.join(destino, 'app.js');

  console.log(`[IA] Subindo no PM2 como "${nome}"...`);
  execSync(`pm2 start "${scriptPath}" --name "${nome}"`, { stdio: 'pipe' });
  execSync('pm2 save', { stdio: 'pipe' });

  const portaConfirmada = parseInt(lerValorEnv(destino, 'PORT'), 10);

  console.log(
    `[IA] Instancia "${nome}" criada e rodando na porta ${portaConfirmada}.`,
  );

  return {
    sucesso: true,
    mensagem: `Instancia "${nome}" criada com sucesso.`,
    porta: portaConfirmada,
  };
}

export async function statusInstancia(nome) {
  try {
    const saida = execSync('pm2 jlist', { stdio: 'pipe' }).toString();
    const lista = JSON.parse(saida);
    const instancia = lista.find((processo) => processo.name === nome);

    if (!instancia) {
      return { nome, status: 'nao encontrada', pm2_id: null };
    }

    return {
      nome: instancia.name,
      pm2_id: instancia.pm_id,
      status: instancia.pm2_env?.status || 'desconhecido',
      uptime: instancia.pm2_env?.pm_uptime || null,
      reinicializacoes: instancia.pm2_env?.restart_time || 0,
      memoria_mb: instancia.monit?.memory
        ? Math.round(instancia.monit.memory / 1024 / 1024)
        : null,
      cpu_percent: instancia.monit?.cpu ?? null,
      porta: instancia.pm2_env?.PORT || null,
    };
  } catch {
    throw new Error(`Nao foi possivel obter status de "${nome}".`);
  }
}

export async function logsInstancia(nome, linhas = 50) {
  return new Promise((resolve, reject) => {
    exec(
      `pm2 logs ${nome} --lines ${linhas} --nostream --raw`,
      { timeout: 10000 },
      (erro, stdout, stderr) => {
        if (erro && !stdout && !stderr) {
          return reject(
            new Error(`Erro ao buscar logs de "${nome}": ${erro.message}`),
          );
        }

        const saida = (stdout + stderr).trim();
        const linhasLog = saida.split('\n').filter(Boolean);
        resolve({ nome, linhas: linhasLog });
      },
    );
  });
}

export async function reiniciarInstancia(nome) {
  try {
    const destino = path.join(APPS_DIR, nome);
    const ecosystemPath = sincronizarEcosystem(destino, nome);

    if (ecosystemPath && fs.existsSync(ecosystemPath)) {
      execSync(
        `pm2 restart "${ecosystemPath}" --only "${nome}" --update-env`,
        { stdio: 'pipe' },
      );
    } else {
      execSync(`pm2 restart "${nome}" --update-env`, { stdio: 'pipe' });
    }

    return { sucesso: true, mensagem: `Instancia "${nome}" reiniciada.` };
  } catch {
    throw new Error(
      `Nao foi possivel reiniciar "${nome}". Verifique se ela existe no PM2.`,
    );
  }
}

export async function pararInstancia(nome) {
  try {
    execSync(`pm2 stop "${nome}"`, { stdio: 'pipe' });
    return { sucesso: true, mensagem: `Instancia "${nome}" parada.` };
  } catch {
    throw new Error(
      `Nao foi possivel parar "${nome}". Verifique se ela existe no PM2.`,
    );
  }
}

export async function listarInstancias() {
  garantirDiretorioBase();

  const pastas = fs.readdirSync(APPS_DIR).filter((item) => {
    return fs.statSync(path.join(APPS_DIR, item)).isDirectory();
  });

  const saida = execSync('pm2 jlist', { stdio: 'pipe' }).toString();
  const pm2Lista = JSON.parse(saida);
  const pm2Map = new Map(pm2Lista.map((processo) => [processo.name, processo]));

  return pastas.map((nome) => {
    const pm2 = pm2Map.get(nome);
    return {
      nome,
      status: pm2?.pm2_env?.status || 'parada/nao registrada',
      porta: pm2?.pm2_env?.PORT || null,
    };
  });
}
