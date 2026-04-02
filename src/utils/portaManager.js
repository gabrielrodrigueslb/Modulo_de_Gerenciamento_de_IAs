import net from 'net';
import { execFileSync } from 'child_process';

const reservas = new Map();

function binarioPm2() {
  return process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
}

function obterFaixaPortas() {
  const inicio = Number.parseInt(process.env.PORTA_INICIO || '5300', 10);
  const fim = Number.parseInt(process.env.PORTA_FIM || '5399', 10);

  if (Number.isNaN(inicio) || Number.isNaN(fim)) {
    throw new Error('PORTA_INICIO e PORTA_FIM devem ser numeros inteiros.');
  }

  if (inicio > fim) {
    throw new Error('PORTA_INICIO nao pode ser maior que PORTA_FIM.');
  }

  return { inicio, fim };
}

function portasEmUsoPM2() {
  try {
    const saida = execFileSync(binarioPm2(), ['jlist'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    const lista = JSON.parse(saida);

    return new Set(
      lista
        .map((processo) =>
          Number.parseInt(
            processo.pm2_env?.PORT || processo.pm2_env?.env?.PORT,
            10,
          ),
        )
        .filter((porta) => !Number.isNaN(porta)),
    );
  } catch {
    return new Set();
  }
}

function fecharServidor(server) {
  return new Promise((resolve, reject) => {
    server.close((erro) => {
      if (erro) {
        reject(erro);
        return;
      }

      resolve();
    });
  });
}

function criarReserva(porta) {
  return new Promise((resolve) => {
    if (reservas.has(porta)) {
      resolve(null);
      return;
    }

    const server = net.createServer();
    server.unref();

    server.once('error', () => {
      resolve(null);
    });

    server.once('listening', () => {
      const reserva = {
        porta,
        server,
        encerrada: false,
        prontaParaUso: false,
        async liberarParaUso() {
          if (this.encerrada || this.prontaParaUso) {
            return;
          }

          await fecharServidor(this.server);
          this.server = null;
          this.prontaParaUso = true;
        },
        async concluir() {
          if (this.encerrada) {
            return;
          }

          reservas.delete(this.porta);
          this.encerrada = true;
          this.server = null;
          this.prontaParaUso = true;
        },
        async descartar() {
          if (this.encerrada) {
            return;
          }

          if (this.server) {
            await fecharServidor(this.server);
          }

          reservas.delete(this.porta);
          this.encerrada = true;
          this.server = null;
          this.prontaParaUso = true;
        },
      };

      reservas.set(porta, reserva);
      resolve(reserva);
    });

    server.listen(porta, '0.0.0.0');
  });
}

export async function reservarProximaPortaLivre() {
  const { inicio, fim } = obterFaixaPortas();
  const emUsoPM2 = portasEmUsoPM2();

  for (let porta = inicio; porta <= fim; porta += 1) {
    if (emUsoPM2.has(porta) || reservas.has(porta)) {
      continue;
    }

    const reserva = await criarReserva(porta);

    if (reserva) {
      return reserva;
    }
  }

  throw new Error(
    `Nenhuma porta disponivel na faixa ${inicio}-${fim}. Ajuste PORTA_INICIO e PORTA_FIM no .env.`,
  );
}

export async function proximaPortaLivre() {
  const reserva = await reservarProximaPortaLivre();

  try {
    return reserva.porta;
  } finally {
    await reserva.descartar();
  }
}
