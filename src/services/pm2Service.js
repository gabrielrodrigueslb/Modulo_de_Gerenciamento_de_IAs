import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { reservarProximaPortaLivre } from '../utils/portaManager.js';

const MAX_BUFFER = 10 * 1024 * 1024;
const ENV_TEMPLATE_FILES = ['.env.example', '.env.exemplo'];
const INSTANCE_METADATA_FILE = 'instance.json';
const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const DEFAULT_APPS_ROOT = path.resolve(
  process.env.APPS_DIR || path.join(ROOT_DIR, 'servicos_ias'),
);
const TYPE_CONFIGS = {
  alpha: {
    tipo: 'alpha',
    appsDir: DEFAULT_APPS_ROOT,
    repoUrl: process.env.REPO_URL || null,
    repoBranch: process.env.REPO_BRANCH || null,
  },
  trier: {
    tipo: 'trier',
    appsDir: path.resolve(
      process.env.APPS_DIR_TRIER || path.join(DEFAULT_APPS_ROOT, 'trier'),
    ),
    repoUrl: process.env.TRIER_REPO_URL || null,
    repoBranch: process.env.TRIER_REPO_BRANCH || null,
  },
};
const TIPOS_SUPORTADOS = Object.keys(TYPE_CONFIGS);
let filaAtualizacoes = Promise.resolve();
let sequenciaAtualizacao = 0;

function normalizeTipo(tipo = 'alpha') {
  const normalizado = String(tipo || 'alpha').trim().toLowerCase();

  if (!TIPOS_SUPORTADOS.includes(normalizado)) {
    throw new Error(
      `Tipo "${tipo}" invalido. Tipos aceitos: ${TIPOS_SUPORTADOS.join(', ')}.`,
    );
  }

  return normalizado;
}

function obterConfigTipo(tipo = 'alpha') {
  return TYPE_CONFIGS[normalizeTipo(tipo)];
}

function caminhoBinarioLocal(nome) {
  const extensao = process.platform === 'win32' ? '.cmd' : '';
  return path.join(ROOT_DIR, 'node_modules', '.bin', `${nome}${extensao}`);
}

function binario(nome) {
  const binarioLocal = caminhoBinarioLocal(nome);
  if (fs.existsSync(binarioLocal)) {
    return binarioLocal;
  }

  if (
    process.platform === 'win32' &&
    (nome === 'npm' || nome === 'pm2' || nome === 'npx')
  ) {
    return `${nome}.cmd`;
  }

  return nome;
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

function lerRemoteOriginUrl(destino) {
  try {
    return executarGit(['remote', 'get-url', 'origin'], destino).trim();
  } catch {
    return null;
  }
}

function lerBranchAtual(destino) {
  return executarGit(['rev-parse', '--abbrev-ref', 'HEAD'], destino).trim();
}

function nomePm2Padrao(tipo, nome) {
  return `ia-${normalizeTipo(tipo)}-${nome}`;
}

function caminhoMetadata(destino) {
  return path.join(destino, INSTANCE_METADATA_FILE);
}

function normalizarCaminhoFs(caminho) {
  return path.resolve(caminho || '').replace(/[\\/]+$/, '').toLowerCase();
}

function caminhoDentroDe(diretorioFilho, diretorioPai) {
  const filho = normalizarCaminhoFs(diretorioFilho);
  const pai = normalizarCaminhoFs(diretorioPai);

  if (!filho || !pai) {
    return false;
  }

  if (filho === pai) {
    return true;
  }

  const relativo = path.relative(pai, filho);
  return relativo !== '' && !relativo.startsWith('..') && !path.isAbsolute(relativo);
}

function garantirDiretorio(caminho) {
  if (!fs.existsSync(caminho)) {
    fs.mkdirSync(caminho, { recursive: true });
  }
}

function listarDiretoriosFilhos(diretorio) {
  if (!fs.existsSync(diretorio)) {
    return [];
  }

  return fs.readdirSync(diretorio).filter((item) => {
    return fs.statSync(path.join(diretorio, item)).isDirectory();
  });
}

function diretoriosIgnoradosPorTipo(tipo) {
  if (tipo !== 'alpha') {
    return new Set();
  }

  const ignorados = new Set();
  const trierRoot = obterConfigTipo('trier').appsDir;

  if (caminhoDentroDe(trierRoot, obterConfigTipo('alpha').appsDir)) {
    ignorados.add(normalizarCaminhoFs(trierRoot));
  }

  return ignorados;
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

function montarVariaveisInstancia(dados, porta, tipo) {
  const variaveis = {
    PORT: String(porta),
  };

  if (tipo === 'alpha') {
    const variaveisAlpha = {
      OPENAI_API_KEY: dados.openai_api_key,
      DB_HOST: dados.db_host,
      DB_PORT: String(dados.db_port ?? 5432),
      DB_NAME: dados.db_name,
      DB_USER: dados.db_user,
      DB_PASSWORD: dados.db_password,
      UNIDADE_NEGOCIO_ID: String(dados.unidade_negocio_id ?? 65984),
    };

    for (const [chave, valor] of Object.entries(variaveisAlpha)) {
      if (valor !== undefined && valor !== null && valor !== '') {
        variaveis[chave] = String(valor);
      }
    }
  }

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

function prepararEnvInstancia(destino, dados, porta, tipo) {
  const envPath = path.join(destino, '.env');
  const templatePath = templateEnvPath(destino);
  const conteudoBase = templatePath
    ? fs.readFileSync(templatePath, 'utf8')
    : '';

  const conteudoFinal = aplicarVariaveisEnv(
    conteudoBase,
    montarVariaveisInstancia(dados, porta, tipo),
  );

  fs.writeFileSync(envPath, conteudoFinal, 'utf8');

  return {
    envPath,
    templatePath,
  };
}

function criarMetadataPadrao({ nome, tipo, diretorio, repoUrl, repoBranch, nomePm2 }) {
  const tipoNormalizado = normalizeTipo(tipo);

  return {
    nome,
    tipo: tipoNormalizado,
    diretorio,
    repo_url: repoUrl || null,
    repo_branch: repoBranch || null,
    nome_pm2: nomePm2 || nomePm2Padrao(tipoNormalizado, nome),
    created_at: null,
  };
}

function lerMetadataInstancia(destino, tipo) {
  const nome = path.basename(destino);
  const config = obterConfigTipo(tipo);
  const padrao = criarMetadataPadrao({
    nome,
    tipo,
    diretorio: destino,
    repoUrl: config.repoUrl,
    repoBranch: config.repoBranch,
  });

  const metadataPath = caminhoMetadata(destino);
  if (!fs.existsSync(metadataPath)) {
    return padrao;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    return {
      ...padrao,
      ...parsed,
      nome: parsed.nome || nome,
      tipo: normalizeTipo(parsed.tipo || tipo),
      diretorio: destino,
      nome_pm2:
        parsed.nome_pm2 || nomePm2Padrao(parsed.tipo || tipo, parsed.nome || nome),
    };
  } catch {
    return padrao;
  }
}

function salvarMetadataInstancia(destino, metadata) {
  fs.writeFileSync(
    caminhoMetadata(destino),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8',
  );
}

function obterListaPm2() {
  try {
    const saida = executarArquivo('pm2', ['jlist']);
    return JSON.parse(saida);
  } catch {
    return [];
  }
}

function extrairInstanciaPm2(processo) {
  const nomeProcesso = processo.name || '';
  const match = /^ia-(alpha|trier)-(.+)$/.exec(nomeProcesso);
  const cwd = processo.pm2_env?.pm_cwd || processo.pm2_env?.cwd || null;

  let tipo = null;
  let nome = null;

  if (match) {
    [, tipo, nome] = match;
  }

  if (!tipo && cwd) {
    for (const config of Object.values(TYPE_CONFIGS)) {
      if (caminhoDentroDe(cwd, config.appsDir)) {
        tipo = config.tipo;
        nome = path.basename(cwd);
        break;
      }
    }
  }

  if (!tipo || !nome) {
    return null;
  }

  return {
    nome,
    tipo,
    nome_pm2: nomeProcesso,
    diretorio: cwd || path.join(obterConfigTipo(tipo).appsDir, nome),
    processo,
  };
}

function inventariarInstancias(tipoFiltro = null) {
  const tipos = tipoFiltro
    ? [normalizeTipo(tipoFiltro)]
    : TIPOS_SUPORTADOS;

  const mapa = new Map();

  for (const tipo of tipos) {
    const config = obterConfigTipo(tipo);
    garantirDiretorio(config.appsDir);
    const ignorados = diretoriosIgnoradosPorTipo(tipo);

    for (const nomeDiretorio of listarDiretoriosFilhos(config.appsDir)) {
      const diretorio = path.join(config.appsDir, nomeDiretorio);
      if (ignorados.has(normalizarCaminhoFs(diretorio))) {
        continue;
      }
      const metadata = lerMetadataInstancia(diretorio, tipo);
      const chave = `${metadata.tipo}:${metadata.nome}`;

      mapa.set(chave, {
        chave,
        nome: metadata.nome,
        tipo: metadata.tipo,
        diretorio,
        metadata,
        pm2: null,
      });
    }
  }

  for (const processo of obterListaPm2()) {
    const pm2 = extrairInstanciaPm2(processo);
    if (!pm2 || (tipoFiltro && pm2.tipo !== normalizeTipo(tipoFiltro))) {
      continue;
    }

    const chave = `${pm2.tipo}:${pm2.nome}`;
    const existente = mapa.get(chave);

    if (existente) {
      existente.pm2 = pm2;
      if (!existente.metadata.nome_pm2) {
        existente.metadata.nome_pm2 = pm2.nome_pm2;
      }
      continue;
    }

    const config = obterConfigTipo(pm2.tipo);
    const metadata = criarMetadataPadrao({
      nome: pm2.nome,
      tipo: pm2.tipo,
      diretorio: pm2.diretorio,
      repoUrl: config.repoUrl,
      repoBranch: config.repoBranch,
      nomePm2: pm2.nome_pm2,
    });

    mapa.set(chave, {
      chave,
      nome: pm2.nome,
      tipo: pm2.tipo,
      diretorio: pm2.diretorio,
      metadata,
      pm2,
    });
  }

  return [...mapa.values()].sort((a, b) => {
    if (a.tipo !== b.tipo) {
      return a.tipo.localeCompare(b.tipo);
    }

    return a.nome.localeCompare(b.nome);
  });
}

function determinarIntegridade(instancia) {
  const temDiretorio =
    instancia.diretorio &&
    fs.existsSync(instancia.diretorio) &&
    fs.statSync(instancia.diretorio).isDirectory();
  const temPm2 = Boolean(instancia.pm2);

  if (temDiretorio && temPm2) {
    const cwdPm2 = instancia.pm2?.diretorio;
    if (
      cwdPm2 &&
      normalizarCaminhoFs(cwdPm2) !== normalizarCaminhoFs(instancia.diretorio)
    ) {
      return 'inconsistente';
    }

    return 'ok';
  }

  if (temDiretorio) {
    return 'sem_pm2';
  }

  if (temPm2) {
    return 'sem_diretorio';
  }

  return 'inexistente';
}

function obterPortaInstancia(instancia) {
  const portaEnv = instancia.diretorio
    ? lerValorEnv(instancia.diretorio, 'PORT')
    : null;
  const portaPm2 =
    instancia.pm2?.processo?.pm2_env?.PORT ||
    instancia.pm2?.processo?.pm2_env?.env?.PORT ||
    null;

  if (portaEnv && portaPm2 && String(portaEnv) !== String(portaPm2)) {
    console.warn(
      `[IA] Porta divergente para "${instancia.tipo}/${instancia.nome}": .env=${portaEnv}, PM2=${portaPm2}.`,
    );
  }

  return portaEnv || portaPm2 || null;
}

function localizarInstancia(nome, tipo = null) {
  const lista = inventariarInstancias(tipo).filter((instancia) => {
    return instancia.nome === nome;
  });

  if (lista.length === 0) {
    return null;
  }

  if (lista.length > 1) {
    throw new Error(
      `Existe mais de uma instancia com o nome "${nome}". Informe o tipo explicitamente.`,
    );
  }

  return lista[0];
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

function sincronizarRepositorioComEnv(instancia, destino, prefixoLog) {
  const config = obterConfigTipo(instancia.tipo);
  const repoUrlDesejado = config.repoUrl || instancia.metadata?.repo_url || null;
  const branchDesejada = config.repoBranch || instancia.metadata?.repo_branch || null;

  if (!repoUrlDesejado) {
    throw new Error(
      `Repositorio nao configurado para "${instancia.tipo}". Ajuste ${
        instancia.tipo === 'alpha' ? 'REPO_URL' : 'TRIER_REPO_URL'
      } no .env do modulo.`,
    );
  }

  const remoteAtual = lerRemoteOriginUrl(destino);
  if (remoteAtual !== repoUrlDesejado) {
    console.log(
      `${prefixoLog} Ajustando remote origin de "${remoteAtual || 'indefinido'}" para "${repoUrlDesejado}".`,
    );
    executarGit(['remote', 'set-url', 'origin', repoUrlDesejado], destino);
  }

  if (branchDesejada) {
    console.log(
      `${prefixoLog} Sincronizando branch com o .env: ${branchDesejada}.`,
    );
    executarGit(['fetch', 'origin', branchDesejada, '--prune'], destino);

    const branchAtual = lerBranchAtual(destino);
    if (branchAtual !== branchDesejada) {
      try {
        executarGit(['checkout', branchDesejada], destino);
      } catch {
        executarGit(
          ['checkout', '-B', branchDesejada, `origin/${branchDesejada}`],
          destino,
        );
      }
    }

    try {
      executarGit(
        ['branch', '--set-upstream-to', `origin/${branchDesejada}`, branchDesejada],
        destino,
      );
    } catch {
      // segue sem bloquear; o pull abaixo usa origin/branch explicitamente
    }
  }

  const metadataAtualizada = {
    ...instancia.metadata,
    repo_url: repoUrlDesejado,
    repo_branch: branchDesejada,
  };
  salvarMetadataInstancia(destino, metadataAtualizada);
  instancia.metadata = metadataAtualizada;

  return {
    repoUrlDesejado,
    branchDesejada,
  };
}

function precisaInstalarDependencias(arquivosAlterados) {
  const arquivosDependencias = new Set([
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
  ]);

  return arquivosAlterados.some((arquivo) => arquivosDependencias.has(arquivo));
}

function resolverNomePm2(instancia) {
  const candidatos = [
    instancia.pm2?.nome_pm2,
    instancia.metadata?.nome_pm2,
    nomePm2Padrao(instancia.tipo, instancia.nome),
    instancia.nome,
    `ia-${instancia.nome}`,
    `${instancia.tipo}-${instancia.nome}`,
  ].filter(Boolean);

  return [...new Set(candidatos)][0];
}

async function atualizarInstanciaInterna(instancia, contexto = {}) {
  const { jobId = null, indice = null, total = null } = contexto;
  const prefixoFila =
    jobId === null ? '[ATUALIZAR]' : `[ATUALIZAR][fila=${jobId}]`;
  const prefixoItem =
    indice && total ? `${prefixoFila}[${indice}/${total}]` : prefixoFila;

  if (determinarIntegridade(instancia) === 'sem_diretorio') {
    throw new Error(
      `Instancia "${instancia.tipo}/${instancia.nome}" sem diretorio na VPS.`,
    );
  }

  const destino = instancia.diretorio;
  console.log(
    `${prefixoItem} Iniciando atualizacao de "${instancia.tipo}/${instancia.nome}".`,
  );

  if (repositorioPossuiAlteracoesLocais(destino)) {
    throw new Error(
      `Instancia "${instancia.tipo}/${instancia.nome}" possui alteracoes locais no diretorio clonado.`,
    );
  }

  const { branchDesejada } = sincronizarRepositorioComEnv(
    instancia,
    destino,
    prefixoItem,
  );

  const commitAnterior = lerHeadCommit(destino);
  console.log(`${prefixoItem} HEAD antes do pull: ${commitAnterior}`);

  if (branchDesejada) {
    executarGit(['pull', '--ff-only', 'origin', branchDesejada], destino);
  } else {
    executarGit(['pull', '--ff-only'], destino);
  }

  const commitAtual = lerHeadCommit(destino);
  const arquivosAlterados = listarArquivosAlterados(
    destino,
    commitAnterior,
    commitAtual,
  );
  const houveMudanca = commitAnterior !== commitAtual;
  const dependenciasAtualizadas =
    houveMudanca && precisaInstalarDependencias(arquivosAlterados);
  const nomePm2 = resolverNomePm2(instancia);

  if (dependenciasAtualizadas) {
    console.log(`${prefixoItem} Dependencias alteradas; executando npm ci.`);
    executarArquivo('npm', ['ci', '--omit=dev'], { cwd: destino });
  }

  if (houveMudanca && instancia.pm2) {
    console.log(`${prefixoItem} Reiniciando processo no PM2.`);
    executarArquivo('pm2', ['restart', nomePm2]);
    executarArquivo('pm2', ['save']);
  } else if (houveMudanca) {
    console.log(`${prefixoItem} Atualizada sem PM2 registrado.`);
  } else {
    console.log(
      `${prefixoItem} Nenhum commit novo para "${instancia.tipo}/${instancia.nome}".`,
    );
  }

  return {
    nome: instancia.nome,
    tipo: instancia.tipo,
    atualizado: houveMudanca,
    reiniciado: houveMudanca && Boolean(instancia.pm2),
    dependencias_atualizadas: dependenciasAtualizadas,
    integridade: determinarIntegridade(instancia),
    commit_anterior: commitAnterior,
    commit_atual: commitAtual,
    arquivos_alterados: arquivosAlterados,
    mensagem: houveMudanca
      ? `Instancia "${instancia.tipo}/${instancia.nome}" atualizada com sucesso.`
      : `Instancia "${instancia.tipo}/${instancia.nome}" ja estava atualizada.`,
  };
}

export async function criarInstancia(dados) {
  const nome = dados.nome;
  const tipo = normalizeTipo(dados.tipo || 'alpha');
  const config = obterConfigTipo(tipo);

  if (!config.repoUrl) {
    throw new Error(
      `Repositorio nao configurado para o tipo "${tipo}". Ajuste ${
        tipo === 'alpha' ? 'REPO_URL' : 'TRIER_REPO_URL'
      } no .env.`,
    );
  }

  garantirDiretorio(config.appsDir);

  const destino = path.join(config.appsDir, nome);
  const existente = localizarInstancia(nome, tipo);

  if (fs.existsSync(destino) || existente) {
    throw new Error(`Ja existe uma instancia ${tipo} com o nome "${nome}".`);
  }

  const reservaPorta = await reservarProximaPortaLivre();
  let reservaConcluida = false;

  try {
    const { porta } = reservaPorta;
    const nomePm2 = nomePm2Padrao(tipo, nome);
    const metadata = {
      ...criarMetadataPadrao({
        nome,
        tipo,
        diretorio: destino,
        repoUrl: config.repoUrl,
        repoBranch: config.repoBranch,
        nomePm2,
      }),
      created_at: new Date().toISOString(),
    };

    console.log(`[IA] Porta reservada automaticamente: ${porta}`);
    console.log(`[IA] Clonando ${config.repoUrl} em ${destino}...`);

    const cloneArgs = ['clone'];
    if (config.repoBranch) {
      cloneArgs.push('--branch', config.repoBranch, '--single-branch');
    }
    cloneArgs.push(config.repoUrl, destino);

    executarArquivo('git', cloneArgs);

    console.log('[IA] Instalando dependencias...');
    executarArquivo('npm', ['install'], { cwd: destino });

    const { templatePath } = prepararEnvInstancia(destino, dados, porta, tipo);
    if (templatePath) {
      console.log(`[IA] .env criado a partir de ${path.basename(templatePath)}.`);
    } else {
      console.warn(
        '[IA] Repositorio clonado sem .env.example; .env criado apenas com os dados enviados.',
      );
    }

    salvarMetadataInstancia(destino, metadata);

    console.log(
      `[IA] Liberando a reserva da porta ${porta} para iniciar o processo...`,
    );
    await reservaPorta.liberarParaUso();

    console.log(`[IA] Subindo "${tipo}/${nome}" com pm2 start app.js...`);
    executarPm2(['start', 'app.js', '--name', nomePm2], destino, {
      PORT: String(porta),
    });
    executarArquivo('pm2', ['save']);
    await reservaPorta.concluir();
    reservaConcluida = true;

    return {
      sucesso: true,
      mensagem: `Instancia "${tipo}/${nome}" criada com sucesso.`,
      nome,
      tipo,
      nome_pm2: nomePm2,
      porta,
      diretorio: destino,
    };
  } finally {
    if (!reservaConcluida) {
      await reservaPorta.descartar();
    }
  }
}

export async function statusInstancia(nome, tipo = null) {
  const instancia = localizarInstancia(nome, tipo);

  if (!instancia) {
    return {
      nome,
      tipo: tipo ? normalizeTipo(tipo) : null,
      status: 'nao encontrada',
      pm2_id: null,
      integridade: 'inexistente',
    };
  }

  const processo = instancia.pm2?.processo || null;
  return {
    nome: instancia.nome,
    tipo: instancia.tipo,
    nome_pm2: resolverNomePm2(instancia),
    diretorio: instancia.diretorio,
    integridade: determinarIntegridade(instancia),
    pm2_id: processo?.pm_id ?? null,
    status: processo?.pm2_env?.status || 'parada/nao registrada',
    uptime: processo?.pm2_env?.pm_uptime || null,
    reinicializacoes: processo?.pm2_env?.restart_time || 0,
    memoria_mb: processo?.monit?.memory
      ? Math.round(processo.monit.memory / 1024 / 1024)
      : null,
    cpu_percent: processo?.monit?.cpu ?? null,
    porta: obterPortaInstancia(instancia),
  };
}

export async function logsInstancia(nome, linhas = 50, tipo = null) {
  const instancia = localizarInstancia(nome, tipo);

  if (!instancia) {
    throw new Error(`Instancia "${tipo ? `${tipo}/` : ''}${nome}" nao encontrada.`);
  }

  try {
    const saida = executarArquivo('pm2', [
      'logs',
      resolverNomePm2(instancia),
      '--lines',
      String(linhas),
      '--nostream',
      '--raw',
    ], {
      timeout: 10000,
    });

    return {
      nome: instancia.nome,
      tipo: instancia.tipo,
      linhas: saida.split('\n').filter(Boolean),
    };
  } catch (erro) {
    const saida = `${erro.stdout || ''}${erro.stderr || ''}`.trim();
    if (saida) {
      return {
        nome: instancia.nome,
        tipo: instancia.tipo,
        linhas: saida.split('\n').filter(Boolean),
      };
    }

    throw new Error(
      `Erro ao buscar logs de "${instancia.tipo}/${instancia.nome}": ${erro.message}`,
    );
  }
}

export async function reiniciarInstancia(nome, tipo = null) {
  const instancia = localizarInstancia(nome, tipo);

  if (!instancia) {
    throw new Error(`Instancia "${tipo ? `${tipo}/` : ''}${nome}" nao encontrada.`);
  }

  if (!instancia.pm2) {
    throw new Error(
      `Instancia "${instancia.tipo}/${instancia.nome}" nao esta registrada no PM2.`,
    );
  }

  executarArquivo('pm2', ['restart', resolverNomePm2(instancia)]);
  executarArquivo('pm2', ['save']);
  return {
    sucesso: true,
    mensagem: `Instancia "${instancia.tipo}/${instancia.nome}" reiniciada.`,
  };
}

export async function pararInstancia(nome, tipo = null) {
  const instancia = localizarInstancia(nome, tipo);

  if (!instancia) {
    throw new Error(`Instancia "${tipo ? `${tipo}/` : ''}${nome}" nao encontrada.`);
  }

  if (!instancia.pm2) {
    throw new Error(
      `Instancia "${instancia.tipo}/${instancia.nome}" nao esta registrada no PM2.`,
    );
  }

  executarArquivo('pm2', ['stop', resolverNomePm2(instancia)]);
  executarArquivo('pm2', ['save']);
  return {
    sucesso: true,
    mensagem: `Instancia "${instancia.tipo}/${instancia.nome}" parada.`,
  };
}

export async function listarInstancias(tipo = null) {
  return inventariarInstancias(tipo).map((instancia) => {
    return {
      nome: instancia.nome,
      tipo: instancia.tipo,
      nome_pm2: resolverNomePm2(instancia),
      diretorio: instancia.diretorio,
      integridade: determinarIntegridade(instancia),
      status:
        instancia.pm2?.processo?.pm2_env?.status || 'parada/nao registrada',
      porta: obterPortaInstancia(instancia),
    };
  });
}

export async function atualizarInstancia(nome, tipo = null) {
  return enfileirarAtualizacao(async (jobId) => {
    const instancia = localizarInstancia(nome, tipo);

    if (!instancia) {
      throw new Error(
        `Instancia "${tipo ? `${normalizeTipo(tipo)}/` : ''}${nome}" nao encontrada.`,
      );
    }

    return atualizarInstanciaInterna(instancia, { jobId });
  });
}

export async function atualizarTodasInstancias(tipo = null) {
  return enfileirarAtualizacao(async (jobId) => {
    const instancias = inventariarInstancias(tipo).filter((instancia) => {
      return determinarIntegridade(instancia) !== 'sem_diretorio';
    });
    const resultados = [];

    for (let indice = 0; indice < instancias.length; indice += 1) {
      const instancia = instancias[indice];

      try {
        const resultado = await atualizarInstanciaInterna(instancia, {
          jobId,
          indice: indice + 1,
          total: instancias.length,
        });
        resultados.push({
          nome: instancia.nome,
          tipo: instancia.tipo,
          sucesso: true,
          ...resultado,
        });
      } catch (erro) {
        resultados.push({
          nome: instancia.nome,
          tipo: instancia.tipo,
          sucesso: false,
          erro: erro.message,
        });
      }
    }

    return {
      sucesso: resultados.every((item) => item.sucesso),
      tipo: tipo ? normalizeTipo(tipo) : null,
      total: resultados.length,
      atualizadas: resultados.filter((item) => item.atualizado).length,
      falhas: resultados.filter((item) => !item.sucesso).length,
      resultados,
    };
  });
}
