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

export async function criarInstancia(dados) {
  const { nome } = dados;

  if (!REPO_URL) {
    throw new Error('REPO_URL não configurada no .env do servidor.');
  }

  garantirDiretorioBase();

  const destino = path.join(APPS_DIR, nome);

  if (fs.existsSync(destino)) {
    throw new Error(`Já existe uma instância com o nome "${nome}".`);
  }

  // 1. Encontrar porta livre automaticamente
  const porta = await proximaPortaLivre();
  console.log(`[IA] Porta alocada automaticamente: ${porta}`);

  // 2. Clonar repositório a partir da URL fixa no .env
  console.log(`[IA] Clonando ${REPO_URL} em ${destino}...`);
  execSync(`git clone ${REPO_URL} ${destino}`, { stdio: 'pipe' });

  // 3. Criar arquivo .env com a porta alocada
  const envContent = montarEnv(dados, porta);
  fs.writeFileSync(path.join(destino, '.env'), envContent, 'utf8');
  console.log(`[IA] .env criado para "${nome}" na porta ${porta}.`);

  // 4. Instalar dependências
  console.log(`[IA] Instalando dependências...`);
  execSync(`npm install`, { cwd: destino, stdio: 'pipe' });

  // 5. Subir no PM2 usando ecosystem.config.js se existir
  const ecosystemPath = path.join(destino, 'ecosystem.config.js');

  if (fs.existsSync(ecosystemPath)) {
    // Corrige o nome hardcoded no ecosystem para usar o nome da instância
    const conteudo = fs.readFileSync(ecosystemPath, 'utf8');
    const corrigido = conteudo.replace(
      /name:\s*['"][^'"]+['"]/,
      `name: '${nome}'`
    );
    fs.writeFileSync(ecosystemPath, corrigido, 'utf8');
    console.log(`[IA] ecosystem.config.js atualizado com nome "${nome}".`);
  }

  const scriptPath = fs.existsSync(ecosystemPath)
    ? ecosystemPath
    : path.join(destino, 'app.js');

  console.log(`[IA] Subindo no PM2 como "${nome}"...`);
  execSync(`pm2 start ${scriptPath} --name ${nome}`, { stdio: 'pipe' });
  execSync(`pm2 save`, { stdio: 'pipe' });

  console.log(`[IA] ✅ Instância "${nome}" criada e rodando na porta ${porta}.`);
  return {
    sucesso: true,
    mensagem: `Instância "${nome}" criada com sucesso.`,
    porta,
  };
}

export async function statusInstancia(nome) {
  try {
    const saida = execSync(`pm2 jlist`, { stdio: 'pipe' }).toString();
    const lista = JSON.parse(saida);
    const instancia = lista.find((p) => p.name === nome);

    if (!instancia) {
      return { nome, status: 'não encontrada', pm2_id: null };
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
    throw new Error(`Não foi possível obter status de "${nome}".`);
  }
}

export async function logsInstancia(nome, linhas = 50) {
  return new Promise((resolve, reject) => {
    exec(
      `pm2 logs ${nome} --lines ${linhas} --nostream --raw`,
      { timeout: 10000 },
      (erro, stdout, stderr) => {
        if (erro && !stdout && !stderr) {
          return reject(new Error(`Erro ao buscar logs de "${nome}": ${erro.message}`));
        }
        const saida = (stdout + stderr).trim();
        const linhasLog = saida.split('\n').filter(Boolean);
        resolve({ nome, linhas: linhasLog });
      }
    );
  });
}

export async function reiniciarInstancia(nome) {
  try {
    execSync(`pm2 restart ${nome}`, { stdio: 'pipe' });
    return { sucesso: true, mensagem: `Instância "${nome}" reiniciada.` };
  } catch {
    throw new Error(`Não foi possível reiniciar "${nome}". Verifique se ela existe no PM2.`);
  }
}

export async function pararInstancia(nome) {
  try {
    execSync(`pm2 stop ${nome}`, { stdio: 'pipe' });
    return { sucesso: true, mensagem: `Instância "${nome}" parada.` };
  } catch {
    throw new Error(`Não foi possível parar "${nome}". Verifique se ela existe no PM2.`);
  }
}

export async function listarInstancias() {
  garantirDiretorioBase();

  const pastas = fs.readdirSync(APPS_DIR).filter((item) => {
    return fs.statSync(path.join(APPS_DIR, item)).isDirectory();
  });

  const saida = execSync(`pm2 jlist`, { stdio: 'pipe' }).toString();
  const pm2Lista = JSON.parse(saida);
  const pm2Map = new Map(pm2Lista.map((p) => [p.name, p]));

  return pastas.map((nome) => {
    const pm2 = pm2Map.get(nome);
    return {
      nome,
      status: pm2?.pm2_env?.status || 'parada/não registrada',
      porta: pm2?.pm2_env?.PORT || null,
    };
  });
}