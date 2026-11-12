// API do Mapa de Lojas. Uma só função na Vercel (api/index.js) encaminha todas as rotas para aqui;
// o servidor local (server/dev.mjs) usa o mesmo código.
import { gzipSync, gunzipSync } from 'node:zlib';
import { getDb } from './db.js';
import { ErroHttp, COOKIE, SESSAO_HORAS, entrar, sair, sessao, criarUtilizador, alterarUtilizador, publico } from './auth.js';
import * as C from './carregamentos.js';
import { criarChave, listarChaves, revogarChave, autenticarChave } from './chaves.js';
import { TABELAS_API, nomeTabela } from '../src/lib/envio.js';

/** CSV (RFC 4180, separador vírgula, UTF-8 com BOM para o Excel) a partir de { colunas, linhas } */
function paraCsv(colunas, linhas) {
  const esc = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return '﻿' + [colunas, ...linhas].map((l) => l.map(esc).join(',')).join('\r\n') + '\r\n';
}

const aceitaGzip = (req) => /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));

/** Página de uma tabela da API de dados (JSON já comprimido na base de dados, ou CSV) */
async function servirTabela({ db, req, res, params, query }) {
  const formato = (query.get('formato') ?? 'json').toLowerCase();
  if (!['json', 'csv'].includes(formato)) throw new ErroHttp(400, 'formato tem de ser json ou csv');
  const p = await C.paginaTabela(db, params.tabela, query.get('mes'), query.get('pagina'));
  res.statusCode = 200;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Versao', p.versao);
  res.setHeader('X-Paginas', String(p.paginas));
  let corpo;
  if (formato === 'csv') {
    const j = JSON.parse(gunzipSync(p.gz).toString('utf8'));
    corpo = Buffer.from(paraCsv(j.colunas, j.linhas), 'utf8');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${params.tabela}_${query.get('mes')}_p${j.pagina}.csv"`);
    if (aceitaGzip(req)) { corpo = gzipSync(corpo); res.setHeader('Content-Encoding', 'gzip'); }
  } else {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (aceitaGzip(req)) { corpo = p.gz; res.setHeader('Content-Encoding', 'gzip'); } else corpo = gunzipSync(p.gz);
  }
  res.setHeader('Vary', 'Accept-Encoding');
  res.end(corpo);
}

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

  // ---- API de dados (Power BI, Excel, ...): autenticação por chave de API, só leitura, só versões publicadas
  ['GET', '/api/v1', 'chave', async () => ({
    api: 'Mapa de Lojas — dados dos relatórios', versao: 1,
    autenticacao: 'cabeçalho "X-API-Key: <chave>" ou "Authorization: Bearer <chave>" ou parâmetro ?api_key=<chave>',
    tabelas: TABELAS_API.map(nomeTabela),
    rotas: {
      meses: '/api/v1/meses — meses publicados, tabelas, nº de linhas e de páginas, colunas pela ordem original',
      tabela: '/api/v1/tabelas/{tabela}?mes=AAAA-MM&pagina=1[&formato=csv] — 10 000 linhas por página',
    },
    formato_json: '{ tabela, mes, pagina, paginas, linhas_total, linhas_pagina, colunas: [...], linhas: [[...], ...] } — cada linha tem os valores pela ordem de "colunas"; todos os valores são texto',
  })],
  ['GET', '/api/v1/meses', 'chave', async ({ db }) => ({ meses: await C.catalogoDados(db) })],
  ['GET', '/api/v1/tabelas/:tabela', 'chave', async (ctx) => { await servirTabela(ctx); return undefined; }],

  // ---- gestão das chaves (administrador, com sessão)
  ['GET', '/api/chaves', 'admin', async ({ db }) => ({ chaves: await listarChaves(db) })],
  ['POST', '/api/chaves', 'admin', async ({ db, user, corpo }) => ({ chave: await criarChave(db, user, corpo.nome) })],
  ['POST', '/api/chaves/:id/revogar', 'admin', async ({ db, user, params }) => revogarChave(db, user, params.id)],
  ['GET', '/api/dados/catalogo', 'admin', async ({ db }) => ({ meses: await C.catalogoDados(db), tabelas: TABELAS_API.map(nomeTabela) })],

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
    // HEAD = GET sem corpo (o Power BI e outras ferramentas testam a ligação com HEAD)
    const metodo = req.method.toUpperCase() === 'HEAD' ? 'GET' : req.method.toUpperCase();
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
    if (achada[2] === 'chave') {
      user = await autenticarChave(db, req, url.searchParams);
    } else if (achada[2] !== 'publico') {
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
