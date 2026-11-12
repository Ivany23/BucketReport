// Teste de integração do servidor: PostgreSQL real (PGlite) + API HTTP real + relatórios reais.
// Ciclo completo: migrar -> utilizadores -> importar Set/Out (referência) -> carregar Novembro pela API
// -> publicar -> descarregar o pacote -> o painel reconstrói exactamente os mesmos números.
import { homedir } from 'node:os';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ligarPglite, definirDb, migrar } from '../server/db.js';
import { tratar } from '../server/router.js';
import { criarUtilizador, sha256 } from '../server/auth.js';
import { lerPasta, importar } from '../server/importar.js';
import * as C from '../server/carregamentos.js';
import { prepararLinhas, parseWorkbook } from '../src/lib/reports.js';
import { dividirEmPartes } from '../src/lib/envio.js';
import { buildModel } from '../src/lib/model.js';
import { mesDosRelatorios, juntarAuditores } from '../src/lib/referencia.js';
import { assinaturaDe, resumoParaAssinatura } from '../src/lib/assinatura.js';
import { modelo as modeloLocal, DADOS } from './carregar.mjs';

process.env.COOKIE_INSEGURO = '1';
const T = '../Tangerine';
const SET = `${T}/WorkDay19/FReport19/CSV`;
const OUT = `${T}/WorkDay27/FReport27/CSV`;
const NOV = join(DADOS, 'CSV', 'November_csv');
const QA = join(DADOS, 'QA_WD30.xlsx');
const DL = process.env.HEINEKEN_BRUTOS ?? join(homedir(), 'Downloads');
const brutos = existsSync(DL) ? readdirSync(DL).filter((f) => /^response-(Feedback-Report|Heineken-Retail-Audit-Survey)-.*Nov2026.*\.csv$/.test(f)).map((f) => join(DL, f)) : [];

let db, srv, base, admin, leitor;
const SENHA_ADMIN = 'senha-admin-123', SENHA_LEITOR = 'senha-leitor-123';

async function pedir(metodo, caminho, { corpo, cookie, semCabecalho = false, bruto = false } = {}) {
  const h = { 'Content-Type': 'application/json' };
  if (!semCabecalho) h['X-Requested-With'] = 'mapa-lojas';
  if (cookie) h.Cookie = cookie;
  const r = await fetch(base + caminho, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
  if (bruto) return r;
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const entrarComo = async (email, senha) => (await pedir('POST', '/api/auth/entrar', { corpo: { email, senha } })).cookie;

/** O que o browser faz: preparar linhas, dividir, enviar, assinar, validar */
async function carregarPelaApi(cookie, rep, { mesForcado, estragarAssinatura = false, saltarParte = false } = {}) {
  const prep = Object.fromEntries(Object.entries(rep).map(([k, rows]) => [k, prepararLinhas(k, rows)]));
  const mes = mesForcado ?? mesDosRelatorios(prep.visitDb);
  const partes = Object.fromEntries(Object.entries(prep).map(([k, rows]) => [k, dividirEmPartes(rows)]));
  const c = await pedir('POST', '/api/carregamentos', { cookie, corpo: { mes, ficheiros: Object.entries(prep).map(([k, rows]) => ({ tipo: k, nome: k, linhas: rows.length, partes: partes[k].length })) } });
  assert.equal(c.status, 200, JSON.stringify(c.j));
  const id = c.j.id;
  for (const [k, ps] of Object.entries(partes)) {
    for (let i = 0; i < ps.length; i++) {
      if (saltarParte && k === 'pap' && i === 1) continue;
      const r = await pedir('PUT', `/api/carregamentos/${id}/partes`, { cookie, corpo: { relatorio: k, parte: i, total_partes: ps.length, linhas: ps[i].length, sha256: sha256(JSON.stringify(ps[i])), dados: ps[i] } });
      assert.equal(r.status, 200, JSON.stringify(r.j));
    }
  }
  const ref = await pedir('GET', `/api/referencia?mes=${mes}`, { cookie });
  const m = buildModel(prep, ref.j.referencia, C.geoProvincias().locate, juntarAuditores(ref.j.auditores, prep.beatroute));
  const assinatura = estragarAssinatura ? 'x'.repeat(64) : await assinaturaDe(m);
  const v = await pedir('POST', `/api/carregamentos/${id}/validar`, { cookie, corpo: { assinatura } });
  return { id, v, m, partes };
}

async function descarregarPacote(cookie, id) {
  const fatias = [];
  let total = 1, sha = '';
  for (let i = 0; i < total; i++) {
    const r = await pedir('GET', `/api/carregamentos/${id}/pacote?parte=${i}`, { cookie, bruto: true });
    assert.equal(r.status, 200);
    total = Number(r.headers.get('x-partes'));
    sha = r.headers.get('x-sha256');
    fatias.push(Buffer.from(await r.arrayBuffer()));
  }
  const gz = Buffer.concat(fatias);
  assert.equal(sha256(gz), sha, 'pacote com sha256 diferente');
  return JSON.parse(gunzipSync(gz).toString('utf8'));
}

let repNov;
before(async () => {
  db = await ligarPglite();
  definirDb(db);
  assert.deepEqual(await migrar(db), ['001_inicial.sql']);
  assert.deepEqual(await migrar(db), []);                       // idempotente
  for (const a of JSON.parse(readFileSync('db/seed/auditores.json', 'utf8')).auditores) {
    await db.query('INSERT INTO auditores (nome, iniciais) VALUES ($1, $2)', [a.nome, a.iniciais]);
  }
  admin = await criarUtilizador(db, { email: 'Admin@Teste.co.mz', nome: 'Admin', papel: 'admin', senha: SENHA_ADMIN });
  leitor = await criarUtilizador(db, { email: 'leitor@teste.co.mz', nome: 'Leitor', papel: 'leitor', senha: SENHA_LEITOR });
  srv = http.createServer((req, res) => tratar(req, res));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  repNov = lerPasta(NOV, { extra: [QA, ...brutos] }).rep;
});
after(async () => { srv?.close(); await db?.fechar(); });

test('referência: Setembro e Outubro importados = lojas_referencia.json', async () => {
  for (const pasta of [SET, OUT]) {
    const { rep, nomes } = lerPasta(pasta);
    const r = await importar(db, admin, { rep, nomes, tipo: 'referencia' });
    console.log(`      ${r.mes}: ${r.resumo.lojas} lojas (referência)`);
  }
  const daBase = await C.referenciaPara(db, '2026-11');
  const ficheiro = JSON.parse(readFileSync('dados_locais/lojas_referencia.json', 'utf8'));
  assert.deepEqual(daBase.meses.map((m) => [m.chave, m.lojas]), ficheiro.meses.map((m) => [m.chave, m.lojas]));
  const porId = new Map(ficheiro.lojas.map((l) => [l.id, l]));
  assert.equal(daBase.lojas.length, ficheiro.lojas.length);
  for (const l of daBase.lojas) {
    const f = porId.get(l.id);
    assert.ok(f, l.id);
    assert.deepEqual(l.meses, f.meses, l.id);
    assert.deepEqual(l.estados, f.estados, l.id);
    assert.deepEqual(l.demo, f.demo, l.id);
  }
});

test('segurança: sem sessão, sem cabeçalho, leitor e palavra-passe errada', async () => {
  assert.equal((await pedir('GET', '/api/saude')).status, 200);
  assert.equal((await pedir('GET', '/api/meses')).status, 401);
  assert.deepEqual((await pedir('GET', '/api/auth/eu')).j, { utilizador: null });
  assert.equal((await pedir('POST', '/api/auth/entrar', { corpo: { email: 'admin@teste.co.mz', senha: 'errada-errada' } })).status, 401);
  assert.equal((await pedir('POST', '/api/auth/entrar', { corpo: { email: 'admin@teste.co.mz', senha: SENHA_ADMIN }, semCabecalho: true })).status, 403);
  const cl = await entrarComo('leitor@teste.co.mz', SENHA_LEITOR);
  assert.ok(cl);
  assert.equal((await pedir('GET', '/api/meses', { cookie: cl })).status, 200);
  assert.equal((await pedir('POST', '/api/carregamentos', { cookie: cl, corpo: {} })).status, 403);
  assert.equal((await pedir('GET', '/api/utilizadores', { cookie: cl })).status, 403);
  const eu = await pedir('GET', '/api/auth/eu', { cookie: cl });
  assert.equal(eu.j.utilizador.papel, 'leitor');
  assert.equal(eu.j.utilizador.senha_hash, undefined);
  await pedir('POST', '/api/auth/sair', { cookie: cl });
  assert.equal((await pedir('GET', '/api/meses', { cookie: cl })).status, 401, 'sessão terminada');
  const guardado = (await db.query('SELECT token_hash FROM sessoes')).rows;
  assert.ok(guardado.every((s) => !cl.includes(s.token_hash)), 'o token não é guardado em claro');
});

test('Novembro pela API: validar, publicar e o pacote reconstrói os mesmos números', async () => {
  const ck = await entrarComo('admin@teste.co.mz', SENHA_ADMIN);
  const { id, v, m } = await carregarPelaApi(ck, repNov);
  assert.equal(v.status, 200, JSON.stringify(v.j));
  assert.equal(v.j.resumo.comparacao.publicadoId, null);
  assert.equal(v.j.resumo.visitas, undefined, 'lista de visitas não sai na API');
  console.log('      totais:', JSON.stringify(v.j.resumo.totais));
  // o leitor ainda não vê (só validado)
  const cl = await entrarComo('leitor@teste.co.mz', SENHA_LEITOR);
  assert.equal((await pedir('GET', `/api/carregamentos/${id}/pacote?parte=0`, { cookie: cl, bruto: true })).status, 404);
  assert.equal((await pedir('POST', `/api/carregamentos/${id}/publicar`, { cookie: ck, corpo: {} })).status, 200);
  const meses = await pedir('GET', '/api/meses', { cookie: cl });
  assert.deepEqual(meses.j.meses.filter((x) => x.tipo === 'mensal').map((x) => x.mes), ['2026-11']);
  // painel: descarrega e reconstrói
  const p = await descarregarPacote(cl, id);
  const m2 = buildModel(p.rep, p.referencia, C.geoProvincias().locate, p.auditores);
  assert.deepEqual(resumoParaAssinatura(m2), resumoParaAssinatura(m));
  // e é igual ao modelo construído directamente dos ficheiros (sem servidor)
  const local = modeloLocal(NOV).m;
  assert.deepEqual(resumoParaAssinatura(m2).totais, resumoParaAssinatura(local).totais);
  assert.deepEqual(resumoParaAssinatura(m2).provincias, resumoParaAssinatura(local).provincias);
  // as fichas das lojas (com produtos) chegam iguais
  for (const s of local.stores) {
    const t = m2.storeById.get(s.id);
    assert.equal(t.estado, s.estado, s.id);
    assert.deepEqual(t.visitas.map((x) => [x.visit_nu, x.status, x.auditor.nome, x.produtos?.length ?? 0]),
      s.visitas.map((x) => [x.visit_nu, x.status, x.auditor.nome, x.produtos?.length ?? 0]), s.id);
  }
  console.log(`      pacote: ${(await db.query('SELECT pacote_bytes, pacote_partes FROM carregamentos WHERE id = $1', [id])).rows[0].pacote_bytes} bytes`);
  const partesRestantes = (await db.query('SELECT count(*)::int AS n FROM carregamento_partes')).rows[0].n;
  assert.equal(partesRestantes, 0, 'partes temporárias apagadas');
});

test('falhas: parte em falta, parte corrompida, parte repetida, assinatura diferente, mês errado', async () => {
  const ck = await entrarComo('admin@teste.co.mz', SENHA_ADMIN);
  const a = await carregarPelaApi(ck, repNov, { saltarParte: true });
  assert.equal(a.v.status, 422);
  assert.match(a.v.j.erros[0], /faltam as partes 1/);
  assert.equal((await db.query('SELECT estado FROM carregamentos WHERE id = $1', [a.id])).rows[0].estado, 'falhado');
  assert.equal((await pedir('POST', `/api/carregamentos/${a.id}/publicar`, { cookie: ck, corpo: {} })).status, 409);

  const b = await carregarPelaApi(ck, repNov, { estragarAssinatura: true });
  assert.equal(b.v.status, 409);
  assert.match(b.v.j.erro, /mesmos números/);

  const c = await carregarPelaApi(ck, repNov, { mesForcado: '2026-10' });
  assert.equal(c.v.status, 422);
  assert.match(c.v.j.erro, /Novembro/);

  // parte corrompida / repetida
  const rows = prepararLinhas('visitDb', repNov.visitDb);
  const d = await pedir('POST', '/api/carregamentos', { cookie: ck, corpo: { mes: '2026-11', ficheiros: [{ tipo: 'demographic', linhas: 0, partes: 1 }, { tipo: 'visitDb', linhas: rows.length, partes: 1 }] } });
  const parte = { relatorio: 'visitDb', parte: 0, total_partes: 1, linhas: rows.length, sha256: sha256(JSON.stringify(rows)), dados: rows };
  assert.equal((await pedir('PUT', `/api/carregamentos/${d.j.id}/partes`, { cookie: ck, corpo: { ...parte, sha256: 'a'.repeat(64) } })).status, 400);
  assert.equal((await pedir('PUT', `/api/carregamentos/${d.j.id}/partes`, { cookie: ck, corpo: parte })).j.repetida, false);
  assert.equal((await pedir('PUT', `/api/carregamentos/${d.j.id}/partes`, { cookie: ck, corpo: parte })).j.repetida, true);
  const outra = rows.slice(1);
  assert.equal((await pedir('PUT', `/api/carregamentos/${d.j.id}/partes`, { cookie: ck, corpo: { ...parte, linhas: outra.length, dados: outra, sha256: sha256(JSON.stringify(outra)) } })).status, 409);
  assert.equal((await pedir('POST', `/api/carregamentos/${d.j.id}/cancelar`, { cookie: ck })).status, 200);
  // falta relatório obrigatório
  assert.equal((await pedir('POST', '/api/carregamentos', { cookie: ck, corpo: { mes: '2026-11', ficheiros: [{ tipo: 'visitDb', linhas: 1, partes: 1 }] } })).status, 400);
  // a versão publicada continua intacta
  const pub = (await db.query(`SELECT count(*)::int AS n FROM carregamentos WHERE mes = '2026-11' AND estado = 'publicado'`)).rows[0].n;
  assert.equal(pub, 1);
});

test('nova versão do mês: substitui a anterior; visitas removidas exigem confirmação; concorrência; reverter', async () => {
  const ck = await entrarComo('admin@teste.co.mz', SENHA_ADMIN);
  const antes = (await db.query(`SELECT id FROM carregamentos WHERE mes = '2026-11' AND estado = 'publicado'`)).rows[0].id;
  // 1) mesma informação -> 0 removidas, publica
  const a = await carregarPelaApi(ck, repNov);
  assert.equal(a.v.j.resumo.comparacao.publicadoId, antes);
  assert.equal(a.v.j.resumo.comparacao.nRemovidas, 0);
  // 2) duas validações contra a mesma versão: só a primeira a publicar ganha
  const b = await carregarPelaApi(ck, repNov);
  assert.equal((await pedir('POST', `/api/carregamentos/${a.id}/publicar`, { cookie: ck, corpo: {} })).status, 200);
  const rb = await pedir('POST', `/api/carregamentos/${b.id}/publicar`, { cookie: ck, corpo: {} });
  assert.equal(rb.status, 409);
  assert.match(rb.j.erro, /Outra versão/);
  // 3) versão com 1 visita a menos -> pede confirmação
  const noPap = new Set(repNov.pap.map((r) => r.visit_nu));
  const tirar = repNov.visitDb.find((r) => !noPap.has(r.visit_nu)).visit_nu;   // visita só no survey_visit_db
  const semUma = { ...repNov, visitDb: repNov.visitDb.filter((r) => r.visit_nu !== tirar) };
  const c = await carregarPelaApi(ck, semUma);
  assert.equal(c.v.j.resumo.comparacao.nRemovidas, 1);
  assert.deepEqual(c.v.j.resumo.comparacao.removidas, [tirar]);
  const r1 = await pedir('POST', `/api/carregamentos/${c.id}/publicar`, { cookie: ck, corpo: {} });
  assert.equal(r1.status, 409);
  assert.equal(r1.j.precisaConfirmar, 'remocoes');
  assert.equal((await pedir('POST', `/api/carregamentos/${c.id}/publicar`, { cookie: ck, corpo: { confirmar: true } })).status, 200);
  // 4) reverter para a versão a (substituída) -> pede confirmação, depois volta
  assert.equal((await pedir('POST', `/api/carregamentos/${a.id}/publicar`, { cookie: ck, corpo: {} })).j.precisaConfirmar, 'reverter');
  assert.equal((await pedir('POST', `/api/carregamentos/${a.id}/publicar`, { cookie: ck, corpo: { confirmar: true } })).status, 200);
  const est = (await db.query(`SELECT id, estado FROM carregamentos WHERE mes = '2026-11' AND tipo = 'mensal' AND estado IN ('publicado', 'substituido')`)).rows;
  assert.deepEqual(est.filter((x) => x.estado === 'publicado').map((x) => x.id), [a.id]);
  // a base de dados recusa 2 publicados no mesmo mês, mesmo que a app falhe
  await assert.rejects(db.query(`UPDATE carregamentos SET estado = 'publicado' WHERE id = $1`, [c.id]));
  const lista = await pedir('GET', '/api/carregamentos', { cookie: ck });
  assert.ok(lista.j.carregamentos.every((x) => x.resumo?.visitas === undefined));
  const reg = (await db.query(`SELECT acao, count(*)::int AS n FROM registo GROUP BY acao ORDER BY acao`)).rows;
  console.log('      registo:', reg.map((x) => `${x.acao}=${x.n}`).join(' '));
});

test('utilizadores e bloqueio após 10 tentativas', async () => {
  const ck = await entrarComo('admin@teste.co.mz', SENHA_ADMIN);
  const novo = await pedir('POST', '/api/utilizadores', { cookie: ck, corpo: { email: 'novo@teste.co.mz', nome: 'Novo', papel: 'leitor', senha: 'curta' } });
  assert.equal(novo.status, 400);
  const n2 = await pedir('POST', '/api/utilizadores', { cookie: ck, corpo: { email: 'novo@teste.co.mz', nome: 'Novo', papel: 'leitor', senha: 'uma-senha-boa' } });
  assert.equal(n2.status, 200);
  assert.equal((await pedir('POST', '/api/utilizadores', { cookie: ck, corpo: { email: 'NOVO@teste.co.mz', nome: 'X', papel: 'leitor', senha: 'uma-senha-boa' } })).status, 409);
  const cn = await entrarComo('novo@teste.co.mz', 'uma-senha-boa');
  assert.equal((await pedir('PATCH', `/api/utilizadores/${n2.j.utilizador.id}`, { cookie: ck, corpo: { ativo: false } })).status, 200);
  assert.equal((await pedir('GET', '/api/meses', { cookie: cn })).status, 401, 'desactivado perde a sessão');
  assert.equal((await pedir('PATCH', `/api/utilizadores/${admin.id}`, { cookie: ck, corpo: { papel: 'leitor' } })).status, 400);
  for (let i = 0; i < 10; i++) await pedir('POST', '/api/auth/entrar', { corpo: { email: 'leitor@teste.co.mz', senha: 'errada-' + i } });
  assert.equal((await pedir('POST', '/api/auth/entrar', { corpo: { email: 'leitor@teste.co.mz', senha: SENHA_LEITOR } })).status, 429);
});

test('formato da Vercel: /api/index?rota=... e corpo já lido pela plataforma', async () => {
  const chamar = (metodo, url, { body, headers = {} } = {}) => new Promise((resolve) => {
    const req = { method: metodo, url, headers: { 'x-requested-with': 'mapa-lojas', ...headers }, body };
    const h = {};
    const res = { statusCode: 200, headersSent: false, setHeader: (k, v) => { h[k.toLowerCase()] = v; },
      end: (b) => resolve({ status: res.statusCode, h, corpo: b ? JSON.parse(Buffer.from(b).toString()) : null }) };
    tratar(req, res);
  });
  assert.equal((await chamar('GET', '/api/index?rota=saude')).status, 200);
  const e = await chamar('POST', '/api/index?rota=auth%2Fentrar', { body: { email: 'admin@teste.co.mz', senha: SENHA_ADMIN } });
  assert.equal(e.status, 200, JSON.stringify(e.corpo));
  const cookie = e.h['set-cookie'].split(';')[0];
  assert.match(e.h['set-cookie'], /HttpOnly; SameSite=Lax/);
  const r = await chamar('GET', '/api/index?rota=referencia&mes=2026-11', { headers: { cookie } });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.referencia.lojas.length, 3462);
  assert.equal((await chamar('GET', '/api/index?rota=nao%2Fexiste', { headers: { cookie } })).status, 404);
});
