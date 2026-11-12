// API do Mapa de Lojas. Uma só função na Vercel (api/index.js) encaminha todas as rotas para aqui;
// o servidor local (server/dev.mjs) usa o mesmo código.
import { gzipSync } from 'node:zlib';
import { getDb } from './db.js';
import { ErroHttp, COOKIE, SESSAO_HORAS, entrar, sair, sessao, criarUtilizador, alterarUtilizador, publico } from './auth.js';
import * as C from './carregamentos.js';

const LIMITE_CORPO = 4 * 1024 * 1024;

function cookies(req) {
  const o = {};
  for (const p of String(req.headers.cookie ?? '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  }
  return o;
}

function cookieSessao(token, maxAge) {
  const seguro = process.env.COOKIE_INSEGURO === '1' ? '' : '; Secure';
  return `${COOKIE}=${token ? encodeURIComponent(token) : ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${seguro}`;
}

async function lerCorpo(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;   // Vercel já leu
  let texto;
  if (typeof req.body === 'string') texto = req.body;
  else if (Buffer.isBuffer(req.body)) texto = req.body.toString('utf8');
  else {
    const partes = [];
    let n = 0;
    for await (const ch of req) {
      n += ch.length;
      if (n > LIMITE_CORPO) throw new ErroHttp(413, 'Pedido demasiado grande');
      partes.push(ch);
    }
    texto = Buffer.concat(partes).toString('utf8');
  }
  if (!texto) return {};
  try { return JSON.parse(texto); } catch { throw new ErroHttp(400, 'JSON inválido'); }
}

function enviarJson(req, res, status, obj) {
  let corpo = Buffer.from(JSON.stringify(obj));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (corpo.length > 64 * 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
    corpo = gzipSync(corpo);
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
  }
  res.statusCode = status;
  res.end(corpo);
}

// [método, padrão, papel exigido ('publico' | 'leitor' | 'admin'), função]
const ROTAS = [
  ['GET', '/api/saude', 'publico', async ({ db }) => {
    const m = await db.query('SELECT nome FROM migracoes ORDER BY nome');
    return { ok: true, migracoes: m.rows.map((r) => r.nome) };
  }],
  ['POST', '/api/auth/entrar', 'publico', async ({ db, corpo, res }) => {
    const { token, utilizador } = await entrar(db, corpo.email, corpo.senha);
    res.setHeader('Set-Cookie', cookieSessao(token, SESSAO_HORAS * 3600));
    return { utilizador };
  }],
  ['POST', '/api/auth/sair', 'publico', async ({ db, req, res }) => {
    await sair(db, cookies(req)[COOKIE]);
    res.setHeader('Set-Cookie', cookieSessao('', 0));
    return { ok: true };
  }],
  // sem sessão responde { utilizador: null } (não é um erro: é o arranque normal antes de entrar)
  ['GET', '/api/auth/eu', 'publico', async ({ db, req }) => ({ utilizador: await sessao(db, cookies(req)[COOKIE]) })],

  ['GET', '/api/meses', 'leitor', async ({ db }) => ({ meses: await C.mesesPublicados(db) })],
  ['GET', '/api/carregamentos/:id/pacote', 'leitor', async ({ db, user, params, query, res }) => {
    const p = await C.pacoteParte(db, user, params.id, query.get('parte'));
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('X-Partes', String(p.partes));
    res.setHeader('X-Sha256', p.sha256);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');   // o conteúdo de um id nunca muda
    res.end(p.bytes);
    return undefined;
  }],

  ['GET', '/api/referencia', 'admin', async ({ db, query }) => {
    const mes = query.get('mes');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes))) throw new ErroHttp(400, 'Mês inválido');
    return { referencia: await C.referenciaPara(db, mes), auditores: await C.auditoresBase(db) };
  }],
  ['GET', '/api/carregamentos', 'admin', async ({ db }) => ({ carregamentos: await C.listar(db) })],
  ['GET', '/api/carregamentos/:id', 'admin', async ({ db, params }) => ({ carregamento: await C.detalhe(db, params.id) })],
  ['POST', '/api/carregamentos', 'admin', async ({ db, user, corpo }) => C.criar(db, user, corpo)],
  ['PUT', '/api/carregamentos/:id/partes', 'admin', async ({ db, user, params, corpo }) => C.receberParte(db, user, params.id, corpo)],
  ['POST', '/api/carregamentos/:id/validar', 'admin', async ({ db, user, params, corpo }) => ({ resumo: await C.validar(db, user, params.id, corpo) })],
  ['POST', '/api/carregamentos/:id/publicar', 'admin', async ({ db, user, params, corpo }) => C.publicar(db, user, params.id, corpo)],
  ['POST', '/api/carregamentos/:id/cancelar', 'admin', async ({ db, user, params }) => C.cancelar(db, user, params.id)],

  ['GET', '/api/utilizadores', 'admin', async ({ db }) => ({
    utilizadores: (await db.query('SELECT * FROM utilizadores ORDER BY nome')).rows.map(publico),
  })],
  ['POST', '/api/utilizadores', 'admin', async ({ db, user, corpo }) => ({ utilizador: await criarUtilizador(db, corpo, user.id) })],
  ['PATCH', '/api/utilizadores/:id', 'admin', async ({ db, user, params, corpo }) => ({ utilizador: await alterarUtilizador(db, params.id, corpo, user.id) })],
];

function casar(padrao, caminho) {
  const a = padrao.split('/'), b = caminho.split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

/** Trata um pedido HTTP (Node: req/res) */
export async function tratar(req, res) {
  try {
    const url = new URL(req.url, 'http://local');
    // na Vercel o pedido chega como /api/index?rota=<resto> (rewrite em vercel.json)
    const rota = url.searchParams.get('rota');
    const caminho = (rota !== null ? `/api/${rota}` : url.pathname).replace(/\/+$/, '') || '/';
    url.searchParams.delete('rota');
    const metodo = req.method.toUpperCase();
    let achada = null, params = null, metodoErrado = false;
    for (const r of ROTAS) {
      const p = casar(r[1], caminho);
      if (!p) continue;
      if (r[0] !== metodo) { metodoErrado = true; continue; }
      achada = r; params = p; break;
    }
    if (!achada) throw new ErroHttp(metodoErrado ? 405 : 404, metodoErrado ? 'Método não permitido' : 'Rota inexistente');
    // protecção CSRF: pedidos que alteram dados têm de trazer este cabeçalho (um formulário de outro site não consegue)
    if (metodo !== 'GET' && req.headers['x-requested-with'] !== 'mapa-lojas') throw new ErroHttp(403, 'Pedido recusado');
    const db = await getDb();
    let user = null;
    if (achada[2] !== 'publico') {
      user = await sessao(db, cookies(req)[COOKIE]);
      if (!user) throw new ErroHttp(401, 'Sessão terminada. Entre de novo.');
      if (achada[2] === 'admin' && user.papel !== 'admin') throw new ErroHttp(403, 'Só administradores');
    }
    const corpo = metodo === 'GET' ? {} : await lerCorpo(req);
    const out = await achada[3]({ db, req, res, user, params, corpo, query: url.searchParams });
    if (out !== undefined) enviarJson(req, res, 200, out);
  } catch (e) {
    const status = e instanceof ErroHttp ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) {
      enviarJson(req, res, status, { erro: status === 500 ? 'Erro interno no servidor' : e.message, ...(e.extra ?? {}) });
    } else {
      res.end();
    }
  }
}
