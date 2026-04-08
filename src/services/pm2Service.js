import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { reservarProximaPortaLivre } from '../utils/portaManager.js';

const APPS_DIR = path.resolve(process.env.APPS_DIR || '/apps/ias');
const REPO_URL = process.env.REPO_URL;
const MAX_BUFFER = 10 * 1024 * 1024;
const ENV_TEMPLATE_FILES = ['.env.example', '.env.exemplo'];
const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
let filaAtualizacoes = Promise.resolve();
let sequenciaAtualizacao = 0;

function caminhoBinarioLocal(nome) {
  const extensao = process.platform === 'win32' ? '.cmd' : '';
  return path.join(ROOT_DIR, 'node_modules', '.bin', `${nome}${extensao}`);
}

function binario(nome) {
  const binarioLocal = caminhoBinarioLocal(nome);
  if (fs.existsSync(binarioLocal)) {
    return binarioLocal;
  }

  if (process.platform === 'win32' && (nome === 'npm' || nome === 'pm2' || nome === 'npx')) {
    return `${nome}.cmd`;
  }

  return nome;
}

function garantirDiretorioBase() {
  if (!fs.existsSync(APPS_DIR)) {
    fs.mkdirSync(APPS_DIR, { recursive: true });
  }
}

function executarArquivo(comando, args, opcoes = {}) {
  const executavel = binario(comando);
  return execFileSync(executavel, args, {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
    stdio: 'pipe',
    shell:
      process.platform === 'win32' &&
      executavel.toLowerCase().endsWith('.cmd'),
    ...opcoes,
  });
}

function executarGit(args, destino) {
  return executarArquivo('git', args, { cwd: destino });
}

function lerEnvArquivo(destino) {
  const envPath = path.join(destino, '.env');

  if (!fs.existsSync(envPath)) {
    return {};
  }

  return fs
    .readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .reduce((acc, linha) => {
      const conteudo = linha.trim();

      if (!conteudo || conteudo.startsWith('#')) {
        return acc;
      }

      const separador = conteudo.indexOf('=');
      if (separador === -1) {
        return acc;
      }

      const chave = conteudo.slice(0, separador).trim();
      const valor = conteudo
        .slice(separador + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');

      if (chave) {
        acc[chave] = valor;
      }

      return acc;
    }, {});
}

function lerValorEnv(destino, chave) {
  return lerEnvArquivo(destino)[chave] ?? null;
}

function montarAmbienteInstancia(destino, sobrescritas = {}) {
  return {
    ...process.env,
    ...lerEnvArquivo(destino),
    ...sobrescritas,
  };
}

function executarPm2(args, destino, sobrescritasEnv = {}) {
  return executarArquivo('pm2', args, {
    cwd: destino,
    env: montarAmbienteInstancia(destino, sobrescritasEnv),
  });
}

function listarDiretoriosInstancias() {
  garantirDiretorioBase();

  return fs.readdirSync(APPS_DIR).filter((item) => {
    return fs.statSync(path.join(APPS_DIR, item)).isDirectory();
  });
}

function enfileirarAtualizacao(execucao) {
  const jobId = ++sequenciaAtualizacao;
  const anterior = filaAtualizacoes.catch(() => null);
  const atual = anterior.then(async () => execucao(jobId));

  filaAtualizacoes = atual.catch(() => null);

  return atual;
}

function lerHeadCommit(destino) {
  return executarGit(['rev-parse', 'HEAD'], destino).trim();
}

function listarArquivosAlterados(destino, commitAnterior, commitAtual) {
  if (!commitAnterior || !commitAtual || commitAnterior === commitAtual) {
    return [];
  }

  const saida = executarGit(
    ['diff', '--name-only', commitAnterior, commitAtual],
    destino,
  );

  return saida
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);
}

function repositorioPossuiAlteracoesLocais(destino) {
  return executarGit(['status', '--porcelain'], destino).trim().length > 0;
}

function precisaInstalarDependencias(arquivosAlterados) {
  const arquivosDependencias = new Set([
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
  ]);

  return arquivosAlterados.some((arquivo) => arquivosDependencias.has(arquivo));
}

async function atualizarInstanciaInterna(nome, contexto = {}) {
  const destino = path.join(APPS_DIR, nome);
  const { jobId = null, indice = null, total = null } = contexto;

  if (!fs.existsSync(destino) || !fs.statSync(destino).isDirectory()) {
    throw new Error(`Instancia "${nome}" nao encontrada em ${APPS_DIR}.`);
  }

  const prefixoFila =
    jobId === null ? '[ATUALIZAR]' : `[ATUALIZAR][fila=${jobId}]`;
  const prefixoItem =
    indice && total ? `${prefixoFila}[${indice}/${total}]` : prefixoFila;

  console.log(`${prefixoItem} Iniciando atualizacao de "${nome}".`);

  if (repositorioPossuiAlteracoesLocais(destino)) {
    throw new Error(
      `Instancia "${nome}" possui alteracoes locais no diretorio clonado.`,
    );
  }

  const commitAnterior = lerHeadCommit(destino);
  console.log(`${prefixoItem} HEAD antes do pull: ${commitAnterior}`);

  executarGit(['pull', '--ff-only'], destino);

  const commitAtual = lerHeadCommit(destino);
  const arquivosAlterados = listarArquivosAlterados(
    destino,
    commitAnterior,
    commitAtual,
  );
  const houveMudanca = commitAnterior !== commitAtual;
  const instalouDependencias =
    houveMudanca && precisaInstalarDependencias(arquivosAlterados);

  if (instalouDependencias) {
    console.log(`${prefixoItem} Dependencias alteradas; executando npm ci.`);
    executarArquivo('npm', ['ci', '--omit=dev'], { cwd: destino });
  }

  if (houveMudanca) {
    console.log(`${prefixoItem} Reiniciando processo no PM2.`);
    executarArquivo('pm2', ['restart', nome]);
    executarArquivo('pm2', ['save']);
  } else {
    console.log(`${prefixoItem} Nenhum commit novo para "${nome}".`);
  }

  return {
    nome,
    atualizado: houveMudanca,
    reiniciado: houveMudanca,
    dependencias_atualizadas: instalouDependencias,
    commit_anterior: commitAnterior,
    commit_atual: commitAtual,
    arquivos_alterados: arquivosAlterados,
    mensagem: houveMudanca
      ? `Instancia "${nome}" atualizada com sucesso.`
      : `Instancia "${nome}" ja estava atualizada.`,
  };
}

function obterPortaInstancia(nome, instanciaPm2 = null) {
  const destino = path.join(APPS_DIR, nome);
  const portaEnv = lerValorEnv(destino, 'PORT');
  const portaPm2 = instanciaPm2?.pm2_env?.PORT || instanciaPm2?.pm2_env?.env?.PORT;

  if (portaEnv && portaPm2 && String(portaEnv) !== String(portaPm2)) {
    console.warn(
      `[IA] Porta divergente para "${nome}": .env=${portaEnv}, PM2=${portaPm2}.`,
    );
  }

  return portaEnv || portaPm2 || null;
}

function escaparRegex(texto) {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function serializarValorEnv(valor) {
  const texto = String(valor ?? '');

  if (texto === '') {
    return '""';
  }

  if (/^[A-Za-z0-9_./:@-]+$/.test(texto)) {
    return texto;
  }

  return JSON.stringify(texto);
}

function templateEnvPath(destino) {
  for (const nomeArquivo of ENV_TEMPLATE_FILES) {
    const caminho = path.join(destino, nomeArquivo);

    if (fs.existsSync(caminho)) {
      return caminho;
    }
  }

  return null;
}

function montarVariaveisInstancia(dados, porta) {
  const variaveis = {
    PORT: String(porta),
    OPENAI_API_KEY: dados.openai_api_key,
    DB_HOST: dados.db_host,
    DB_PORT: String(dados.db_port ?? 5432),
    DB_NAME: dados.db_name,
    DB_USER: dados.db_user,
    DB_PASSWORD: dados.db_password,
    UNIDADE_NEGOCIO_ID: String(dados.unidade_negocio_id ?? 65984),
  };

  if (dados.env && typeof dados.env === 'object' && !Array.isArray(dados.env)) {
    for (const [chave, valor] of Object.entries(dados.env)) {
      if (valor === undefined || valor === null) {
        continue;
      }

      variaveis[chave] = String(valor);
    }
  }

  return variaveis;
}

function aplicarVariaveisEnv(conteudoBase, variaveis) {
  let conteudo = conteudoBase.replace(/\r\n/g, '\n');

  for (const [chave, valor] of Object.entries(variaveis)) {
    if (!chave || valor === undefined || valor === null) {
      continue;
    }

    const linha = `${chave}=${serializarValorEnv(valor)}`;
    const regex = new RegExp(`^\\s*${escaparRegex(chave)}\\s*=.*$`, 'm');

    if (regex.test(conteudo)) {
      conteudo = conteudo.replace(regex, linha);
      continue;
    }

    if (conteudo && !conteudo.endsWith('\n')) {
      conteudo += '\n';
    }

    conteudo += `${linha}\n`;
  }

  return conteudo;
}

function prepararEnvInstancia(destino, dados, porta) {
  const envPath = path.join(destino, '.env');
  const templatePath = templateEnvPath(destino);
  const conteudoBase = templatePath
    ? fs.readFileSync(templatePath, 'utf8')
    : '';

  const conteudoFinal = aplicarVariaveisEnv(
    conteudoBase,
    montarVariaveisInstancia(dados, porta),
  );

  fs.writeFileSync(envPath, conteudoFinal, 'utf8');

  return {
    envPath,
    templatePath,
  };
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

  const reservaPorta = await reservarProximaPortaLivre();
  let reservaConcluida = false;

  try {
    const { porta } = reservaPorta;
    console.log(`[IA] Porta reservada automaticamente: ${porta}`);

    console.log(`[IA] Clonando ${REPO_URL} em ${destino}...`);
    executarArquivo('git', ['clone', REPO_URL, destino]);

    console.log('[IA] Instalando dependencias...');
    executarArquivo('npm', ['install'], { cwd: destino });

    const { templatePath } = prepararEnvInstancia(destino, dados, porta);
    if (templatePath) {
      console.log(`[IA] .env criado a partir de ${path.basename(templatePath)}.`);
    } else {
      console.warn(
        '[IA] Repositorio clonado sem .env.example; .env criado apenas com os dados enviados.',
      );
    }

    console.log(`[IA] Liberando a reserva da porta ${porta} para iniciar o processo...`);
    await reservaPorta.liberarParaUso();

    console.log(`[IA] Subindo "${nome}" com pm2 start app.js...`);
    executarPm2(['start', 'app.js', '--name', nome], destino, {
      PORT: String(porta),
    });
    executarArquivo('pm2', ['save']);
    await reservaPorta.concluir();
    reservaConcluida = true;

    const portaConfirmada = parseInt(lerValorEnv(destino, 'PORT'), 10);

    console.log(
      `[IA] Instancia "${nome}" criada e rodando na porta ${portaConfirmada}.`,
    );

    return {
      sucesso: true,
      mensagem: `Instancia "${nome}" criada com sucesso.`,
      porta: portaConfirmada,
    };
  } finally {
    if (!reservaConcluida) {
      await reservaPorta.descartar();
    }
  }
}

export async function statusInstancia(nome) {
  try {
    const saida = executarArquivo('pm2', ['jlist']);
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
      porta: obterPortaInstancia(nome, instancia),
    };
  } catch {
    throw new Error(`Nao foi possivel obter status de "${nome}".`);
  }
}

export async function logsInstancia(nome, linhas = 50) {
  try {
    const saida = executarArquivo(
      'pm2',
      ['logs', nome, '--lines', String(linhas), '--nostream', '--raw'],
      { timeout: 10000 },
    );

    return {
      nome,
      linhas: saida.split('\n').filter(Boolean),
    };
  } catch (erro) {
    const saida = `${erro.stdout || ''}${erro.stderr || ''}`.trim();
    if (saida) {
      return {
        nome,
        linhas: saida.split('\n').filter(Boolean),
      };
    }

    throw new Error(`Erro ao buscar logs de "${nome}": ${erro.message}`);
  }
}

export async function reiniciarInstancia(nome) {
  try {
    executarArquivo('pm2', ['restart', nome]);
    return { sucesso: true, mensagem: `Instancia "${nome}" reiniciada.` };
  } catch {
    throw new Error(
      `Nao foi possivel reiniciar "${nome}". Verifique se ela existe no PM2.`,
    );
  }
}

export async function pararInstancia(nome) {
  try {
    executarArquivo('pm2', ['stop', nome]);
    return { sucesso: true, mensagem: `Instancia "${nome}" parada.` };
  } catch {
    throw new Error(
      `Nao foi possivel parar "${nome}". Verifique se ela existe no PM2.`,
    );
  }
}

export async function listarInstancias() {
  const pastas = listarDiretoriosInstancias();

  const saida = executarArquivo('pm2', ['jlist']);
  const pm2Lista = JSON.parse(saida);
  const pm2Map = new Map(pm2Lista.map((processo) => [processo.name, processo]));

  return pastas.map((nome) => {
    const pm2 = pm2Map.get(nome);
    return {
      nome,
      status: pm2?.pm2_env?.status || 'parada/nao registrada',
      porta: obterPortaInstancia(nome, pm2),
    };
  });
}

export async function atualizarInstancia(nome) {
  return enfileirarAtualizacao(async (jobId) => {
    return atualizarInstanciaInterna(nome, { jobId });
  });
}

export async function atualizarTodasInstancias() {
  return enfileirarAtualizacao(async (jobId) => {
    const instancias = listarDiretoriosInstancias();
    const resultados = [];

    for (let indice = 0; indice < instancias.length; indice += 1) {
      const nome = instancias[indice];

      try {
        const resultado = await atualizarInstanciaInterna(nome, {
          jobId,
          indice: indice + 1,
          total: instancias.length,
        });
        resultados.push({
          nome,
          sucesso: true,
          ...resultado,
        });
      } catch (erro) {
        resultados.push({
          nome,
          sucesso: false,
          erro: erro.message,
        });
      }
    }

    return {
      sucesso: resultados.every((item) => item.sucesso),
      total: resultados.length,
      atualizadas: resultados.filter((item) => item.atualizado).length,
      falhas: resultados.filter((item) => !item.sucesso).length,
      resultados,
    };
  });
}
