import net from 'net';
import { execSync } from 'child_process';

// Faixa de portas reservada para as instâncias de IA
const PORTA_INICIO = parseInt(process.env.PORTA_INICIO || '5300');
const PORTA_FIM = parseInt(process.env.PORTA_FIM || '5399');

// Verifica se uma porta está livre tentando abrir um servidor TCP nela
function portaEstaLivre(porta) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(porta, '0.0.0.0');
  });
}

// Retorna set de portas já em uso pelas instâncias PM2
function portasEmUsoPM2() {
  try {
    const saida = execSync('pm2 jlist', { stdio: 'pipe' }).toString();
    const lista = JSON.parse(saida);
    return new Set(
      lista
        .map((p) => parseInt(p.pm2_env?.PORT || p.pm2_env?.env?.PORT))
        .filter((p) => !isNaN(p))
    );
  } catch {
    return new Set();
  }
}

// Encontra e retorna a próxima porta livre dentro da faixa configurada
export async function proximaPortaLivre() {
  const emUsoPM2 = portasEmUsoPM2();

  for (let porta = PORTA_INICIO; porta <= PORTA_FIM; porta++) {
    // Pula portas que o PM2 já declarou como em uso
    if (emUsoPM2.has(porta)) continue;

    // Confirma que a porta realmente está livre no sistema operacional
    const livre = await portaEstaLivre(porta);
    if (livre) return porta;
  }

  throw new Error(
    `Nenhuma porta disponível na faixa ${PORTA_INICIO}–${PORTA_FIM}. ` +
    `Ajuste PORTA_INICIO e PORTA_FIM no .env.`
  );
}
