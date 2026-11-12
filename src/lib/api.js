// Chamadas à API (mesma origem; a sessão vai no cookie httpOnly).
import { sha256Hex } from './assinatura.js';

export class ErroApi extends Error {
  constructor(status, corpo) {
    super(corpo?.erro ?? `Erro ${status}`);
    this.status = status;
    this.corpo = corpo ?? {};
  }
}

export async function api(metodo, caminho, corpo) {
  let r;
  try {
    r = await fetch(caminho, {
      method: metodo,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mapa-lojas' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new ErroApi(0, { erro: 'Sem ligação ao servidor. Verifique a internet.' });
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && caminho !== '/api/auth/entrar') window.dispatchEvent(new Event('sessao-terminada'));
    throw new ErroApi(r.status, j);
  }
  return j;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Repete pedidos que falham por rede ou erro temporário do servidor (os envios de partes são idempotentes) */
export async function comRepeticao(fn, tentativas = 4) {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const temporario = e instanceof ErroApi && (e.status === 0 || e.status >= 500 || e.status === 429);
      if (!temporario || i >= tentativas) throw e;
      await esperar(800 * 2 ** (i - 1));
    }
  }
}

/** Descarrega o pacote de um mês publicado: fatias -> verifica sha256 -> descomprime -> JSON */
export async function baixarPacote(id, onProgresso = () => {}) {
  const fatias = [];
  let total = 1, sha = '';
  for (let i = 0; i < total; i++) {
    const r = await comRepeticao(async () => {
      let x;
      try {
        x = await fetch(`/api/carregamentos/${id}/pacote?parte=${i}`, { credentials: 'same-origin' });
      } catch {
        throw new ErroApi(0, { erro: 'Sem ligação ao servidor' });
      }
      if (!x.ok) throw new ErroApi(x.status, await x.json().catch(() => ({})));
      return x;
    });
    total = Number(r.headers.get('X-Partes'));
    sha = r.headers.get('X-Sha256');
    fatias.push(new Uint8Array(await r.arrayBuffer()));
    onProgresso(i + 1, total);
  }
  const tam = fatias.reduce((a, f) => a + f.length, 0);
  const gz = new Uint8Array(tam);
  let o = 0;
  for (const f of fatias) { gz.set(f, o); o += f.length; }
  const h = await crypto.subtle.digest('SHA-256', gz);
  const hex = [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== sha) throw new Error('Os dados descarregados estão incompletos ou danificados. Recarregue a página.');
  const texto = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(texto);
}

export { sha256Hex };
