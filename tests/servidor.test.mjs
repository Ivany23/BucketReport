// Teste de integração do servidor: PostgreSQL real (PGlite) + API HTTP real + relatórios reais.
// Ciclo completo: migrar -> utilizadores -> importar Set/Out (referência) -> carregar Novembro pela API
// -> publicar -> descarregar o pacote -> o painel reconstrói exactamente os mesmos números
// -> API de dados: as tabelas devolvidas são iguais, célula a célula, aos ficheiros CSV originais.
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
import { parseCsvText, detectReport } from '../src/lib/reports.js';
import { prepararEnvio, texto, TABELAS_API, nomeTabela } from '../src/lib/envio.js';
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

async function pedir(metodo, caminho, { corpo, cookie, semCabecalho = false, bruto = false, headers = {} } = {}) {
  const h = { 'Content-Type': 'application/json', ...headers };
  if (!semCabecalho) h['X-Requested-With'] = 'mapa-lojas';
  if (cookie) h.Cookie = cookie;
  const r = await fetch(base + caminho, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined });
  if (bruto) return r;
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
const entrarComo = async (email, senha) => (await pedir('POST', '/api/auth/entrar', { corpo: { email, senha } })).cookie;

/** O que o browser faz: preparar, dividir, enviar, assinar, validar */
async function carregarPelaApi(cookie, entradas, { mesForcado, estragarAssinatura = false, saltarParte = false } = {}) {
  const env = prepararEnvio(entradas);
  const mes = mesForcado ?? mesDosRelatorios(env.objetos.visitDb);
  const c = await pedir('POST', '/api/carregamentos', { cookie, corpo: { mes, ficheiros: env.ficheiros } });
  assert.equal(c.status, 200, JSON.stringify(c.j));
  const id = c.j.id;
  for (const [k, ps] of Object.entries(env.partes)) {
    for (let i = 0; i < ps.length; i++) {
      if (saltarParte && k === 'pap' && i === 1) continue;
      const r = await pedir('PUT', `/api/carregamentos/${id}/partes`, { cookie, corpo: { relatorio: k, parte: i, total_partes: ps.length, linhas: ps[i].length, sha256: sha256(JSON.stringify(ps[i])), dados: ps[i] } });
      assert.equal(r.status, 200, JSON.stringify(r.j));
    }
  }
  const ref = await pedir('GET', `/api/referencia?mes=${mes}`, { cookie });
  const m = buildModel(env.objetos, ref.j.referencia, C.geoProvincias().locate, juntarAuditores(ref.j.auditores, env.objetos.beatroute));
  const assinatura = estragarAssinatura ? 'x'.repeat(64) : await assinaturaDe(m);
  const v = await pedir('POST', `/api/carregamentos/${id}/validar`, { cookie, corpo: { assinatura } });
  return { id, v, m, env };
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

/** Tabela original de um CSV, no formato da API: { colunas, linhas: [[texto...]] } */
function original(pasta, tipo) {
  for (const f of readdirSync(pasta)) {
    if (!f.endsWith('.csv')) continue;
    const p = parseCsvText(readFileSync(join(pasta, f), 'utf8'));
    if (detectReport(p.columns, f) === tipo) return { colunas: p.columns, linhas: p.rows.map((r) => p.columns.map((c) => texto(r[c]))) };
  }
  return null;
}

/** Tabela inteira pela API de dados (todas as páginas) */
async function tabelaPelaApi(chave, tabela, mes) {
  const linhas = [];
  let colunas = null, paginas = 1, total = 0;
  for (let p = 1; p <= paginas; p++) {
    const r = await pedir('GET', `/api/v1/tabelas/${tabela}?mes=${mes}&pagina=${p}`, { headers: { 'X-API-Key': chave } });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    if (colunas) assert.deepEqual(r.j.colunas, colunas, 'colunas iguais em todas as páginas');
    colunas = r.j.colunas; paginas = r.j.paginas; total = r.j.linhas_total;
    assert.equal(r.j.pagina, p);
    assert.equal(r.j.linhas.length, r.j.linhas_pagina);
    for (const l of r.j.linhas) linhas.push(l);
  }
  assert.equal(linhas.length, total);
  return { colunas, linhas, paginas };
}

let entNov, chave;
before(async () => {
  db = await ligarPglite();
  definirDb(db);
  assert.deepEqual(await migrar(db), ['001_inicial.sql', '002_api_tabelas.sql']);
  assert.deepEqual(await migrar(db), []);                       // idempotente
  for (const a of JSON.parse(readFileSync('db/seed/auditores.json', 'utf8')).auditores) {
    await db.query('INSERT INTO auditores (nome, iniciais) VALUES ($1, $2)', [a.nome, a.iniciais]);
  }
  admin = await criarUtilizador(db, { email: 'Admin@Teste.co.mz', nome: 'Admin', papel: 'admin', senha: SENHA_ADMIN });
  leitor = await criarUtilizador(db, { email: 'leitor@teste.co.mz', nome: 'Leitor', papel: 'leitor', senha: SENHA_LEITOR });
  srv = http.createServer((req, res) => tratar(req, res));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  entNov = lerPasta(NOV, { extra: [QA, ...brutos] }).entradas;
});
after(async () => { srv?.close(); await db?.fechar(); });

test('referência: Setembro e Outubro importados = lojas_referencia.json', async () => {
  for (const pasta of [SET, OUT]) {
    const { entradas, nomes } = lerPasta(pasta);
    const r = await importar(db, admin, { entradas, nomes, tipo: 'referencia' });
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
  assert.equal((await pedir('GET', '/api/chaves', { cookie: cl })).status, 403);
  assert.equal((await pedir('POST', '/api/chaves', { cookie: cl, corpo: { nome: 'x' } })).status, 403);
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
  const { id, v, m } = await carregarPelaApi(ck, entNov);
  assert.equal(v.status, 200, JSON.stringify(v.j));
  assert.equal(v.j.resumo.comparacao.publicadoId, null);
  assert.equal(v.j.resumo.visitas, undefined, 'lista de visitas não sai na API');
  console.log('      totais:', JSON.stringify(v.j.resumo.totais));
  const cl = await entrarComo('leitor@teste.co.mz', SENHA_LEITOR);
  assert.equal((await pedir('GET', `/api/carregamentos/${id}/pacote?parte=0`, { cookie: cl, bruto: true })).status, 404);
  assert.equal((await pedir('POST', `/api/carregamentos/${id}/publicar`, { cookie: ck, corpo: {} })).status, 200);
  const meses = await pedir('GET', '/api/meses', { cookie: cl });
  assert.deepEqual(meses.j.meses.filter((x) => x.tipo === 'mensal').map((x) => x.mes), ['2026-11']);
  const p = await descarregarPacote(cl, id);
  const m2 = buildModel(p.rep, p.referencia, C.geoProvincias().locate, p.auditores);
  assert.deepEqual(resumoParaAssinatura(m2), resumoParaAssinatura(m));
  const local = modeloLocal(NOV).m;
  assert.deepEqual(resumoParaAssinatura(m2).totais, resumoParaAssinatura(local).totais);
  assert.deepEqual(resumoParaAssinatura(m2).provincias, resumoParaAssinatura(local).provincias);
  for (const s of local.stores) {
    const t = m2.storeById.get(s.id);
    assert.equal(t.estado, s.estado, s.id);
    assert.deepEqual(t.visitas.map((x) => [x.visit_nu, x.status, x.auditor.nome, x.produtos?.length ?? 0]),
      s.visitas.map((x) => [x.visit_nu, x.status, x.auditor.nome, x.produtos?.length ?? 0]), s.id);
  }
  const info = (await db.query('SELECT pacote_bytes FROM carregamentos WHERE id = $1', [id])).rows[0];
  console.log(`      pacote do painel: ${info.pacote_bytes} bytes`);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM carregamento_partes')).rows[0].n, 0, 'partes temporárias apagadas');
});

test('API de dados: chaves (criar, usar, revogar) e erros', async () => {
  const ck = await entrarComo('admin@teste.co.mz', SENHA_ADMIN);
  assert.equal((await pedir('POST', '/api/chaves', { cookie: ck, corpo: { nome: '' } })).status, 400);
  const c = await pedir('POST', '/api/chaves', { cookie: ck, corpo: { nome: 'Power BI — teste' } });
  assert.equal(c.status, 200);
  chave = c.j.chave.chave;
  assert.match(chave, /^hk_[A-Za-z0-9_-]{43}$/);
  const lista = await pedir('GET', '/api/chaves', { cookie: ck });
  assert.equal(lista.j.chaves.length, 1);
  assert.equal(lista.j.chaves[0].chave, undefined, 'a chave não volta a ser mostrada');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM api_chaves WHERE chave_hash = $1', [sha256(chave)])).rows[0].n, 1);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM api_chaves WHERE chave_hash = $1`, [chave])).rows[0].n, 0, 'só o hash é guardado');
  // sem chave / chave errada / sessão do site não serve para a API
  assert.equal((await pedir('GET', '/api/v1/meses')).status, 401);
  assert.equal((await pedir('GET', '/api/v1/meses', { headers: { 'X-API-Key': 'hk_' + 'A'.repeat(43) } })).status, 401);
  assert.equal((await pedir('GET', '/api/v1/meses', { cookie: ck })).status, 401);
  // as 3 formas de enviar a chave
  assert.equal((await pedir('GET', '/api/v1/meses', { headers: { 'X-API-Key': chave } })).status, 200);
  assert.equal((await pedir('GET', '/api/v1/meses', { headers: { Authorization: `Bearer ${chave}` } })).status, 200);
  assert.equal((await pedir('GET', `/api/v1/meses?api_key=${chave}`)).status, 200);
  assert.equal((await pedir('GET', '/api/v1', { headers: { 'X-API-Key': chave } })).j.tabelas.length, 5);
  // erros claros
  const h = { headers: { 'X-API-Key': chave } };
  assert.equal((await pedir('GET', '/api/v1/tabelas/utilizadores?mes=2026-11', h)).status, 404, 'só as 5 tabelas dos relatórios');
  assert.equal((await pedir('GET', '/api/v1/tabelas/survey_visit_db', h)).status, 400, 'falta o mês');
  assert.equal((await pedir('GET', '/api/v1/tabelas/survey_visit_db?mes=2026-12', h)).status, 404, 'mês sem dados');
  assert.equal((await pedir('GET', '/api/v1/tabelas/survey_visit_db?mes=2026-11&pagina=99', h)).status, 404);
  assert.equal((await pedir('GET', '/api/v1/tabelas/survey_visit_db?mes=2026-11&pagina=0', h)).status, 400);
  assert.equal((await pedir('POST', '/api/v1/meses', h)).status, 405, 'só leitura');
  // usos contados
  const usos = (await db.query('SELECT usos FROM api_chaves WHERE chave_hash = $1', [sha256(chave)])).rows[0].usos;
  assert.ok(Number(usos) >= 9);
});

test('API de dados: Setembro, Outubro e Novembro = ficheiros CSV originais, célula a célula, colunas na mesma ordem', async () => {
  const cat = (await pedir('GET', '/api/v1/meses', { headers: { 'X-API-Key': chave } })).j.meses;
  assert.deepEqual(cat.map((x) => x.mes), ['2026-09', '2026-10', '2026-11']);
  for (const [mes, pasta] of [['2026-09', SET], ['2026-10', OUT], ['2026-11', NOV]]) {
    const doMes = cat.find((x) => x.mes === mes);
    for (const tipo of TABELAS_API) {
      const orig = original(pasta, tipo);
      if (!orig) continue;
      const nome = nomeTabela(tipo);
      const noCat = doMes.tabelas.find((t) => t.tabela === nome);
      assert.ok(noCat, `${mes} ${nome} no catálogo`);
      assert.deepEqual(noCat.colunas.map((c) => c.nome), orig.colunas, `${mes} ${nome}: colunas pela ordem original`);
      assert.deepEqual(noCat.colunas.map((c) => c.posicao), orig.colunas.map((_, i) => i + 1));
      const api = await tabelaPelaApi(chave, nome, mes);
      assert.deepEqual(api.colunas, orig.colunas, `${mes} ${nome}: colunas`);
      assert.equal(api.linhas.length, orig.linhas.length, `${mes} ${nome}: nº de linhas`);
      for (let i = 0; i < orig.linhas.length; i++) {
        if (JSON.stringify(api.linhas[i]) !== JSON.stringify(orig.linhas[i])) assert.fail(`${mes} ${nome}: linha ${i + 1} diferente`);
      }
      console.log(`      ${mes} ${nome}: ${api.linhas.length} linhas × ${api.colunas.length} colunas em ${api.paginas} página(s) = CSV original`);
    }
  }
  // nenhuma página passa de 3 MB sem compressão (limite de resposta da Vercel: 4,5 MB)
  const pags = (await db.query('SELECT relatorio, pagina, dados_gz FROM carregamento_tabela_paginas')).rows;
  const maior = Math.max(...pags.map((p) => gunzipSync(Buffer.from(p.dados_gz)).length));
  console.log(`      maior página sem compressão: ${(maior / 1e6).toFixed(2)} MB`);
  assert.ok(maior < 3_000_000);
});

test('API de dados: formato CSV e resposta sem compressão também iguais', async () => {
  const orig = original(NOV, 'pap');
  const r = await fetch(`${base}/api/v1/tabelas/product_availability_price?mes=2026-11&pagina=1&formato=csv`, { headers: { 'X-API-Key': chave } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  const csv = parseCsvText(await r.text());
  assert.deepEqual(csv.columns, orig.colunas);
  assert.ok(csv.rows.length > 1000);
  assert.deepEqual(csv.rows.map((x) => csv.columns.map((c) => x[c])), orig.linhas.slice(0, csv.rows.length));
  // cliente que não aceita gzip: recebe JSON normal
  const res = await new Promise((resolve) => http.get(`${base}/api/v1/tabelas/survey_visit_db?mes=2026-11`, { headers: { 'X-API-Key': chave } }, (x) => {
    const ch = []; x.on('data', (d) => ch.push(d)); x.on('end', () => resolve({ enc: x.headers['content-encoding'], corpo: Buffer.concat(ch).toString('utf8') }));
  }));
  assert.equal(res.enc, undefined);
  assert.deepEqual(JSON.parse(res.corpo).linhas, original(NOV, 'visitDb').linhas);
});

test('falhas: parte em falta, corrompida, repetida, formato errado, assinatura diferente, mês errado', async () => {
  const ck = await entrarComo('admin@teste.co.mz', SENHA_ADMIN);
  const a = await carregarPelaApi(ck, entNov, { saltarParte: true });
  assert.equal(a.v.status, 422);
  assert.match(a.v.j.erros[0], /faltam as partes 1/);
  assert.equal((await db.query('SELECT estado FROM carregamentos WHERE id = $1', [a.id])).rows[0].estado, 'falhado');
  assert.equal((await pedir('POST', `/api/carregamentos/${a.id}/publicar`, { cookie: ck, corpo: {} })).status, 409);

  const b = await carregarPelaApi(ck, entNov, { estragarAssinatura: true });
  assert.equal(b.v.status, 409);
  assert.match(b.v.j.erro, /mesmos números/);

  const c = await carregarPelaApi(ck, entNov, { mesForcado: '2026-10' });
  assert.equal(c.v.status, 422);
  assert.match(c.v.j.erro, /Novembro/);

  const env = prepararEnvio({ visitDb: entNov.visitDb, demographic: { colunas: entNov.demographic.colunas, rows: [] } });
  const fic = env.ficheiros;
  // colunas que não são deste relatório
  assert.equal((await pedir('POST', '/api/carregamentos', { cookie: ck, corpo: { mes: '2026-11', ficheiros: fic.map((f) => (f.tipo === 'visitDb' ? { ...f, colunas: ['a', 'b'] } : f)) } })).status, 400);
  const d = await pedir('POST', '/api/carregamentos', { cookie: ck, corpo: { mes: '2026-11', ficheiros: fic } });
  assert.equal(d.status, 200, JSON.stringify(d.j));
  const linhas = env.partes.visitDb[0];
  const parte = { relatorio: 'visitDb', parte: 0, total_partes: 1, linhas: linhas.length, sha256: sha256(JSON.stringify(linhas)), dados: linhas };
  assert.equal((await pedir('PUT', `/api/carregamentos/${d.j.id}/partes`, { cookie: ck, corpo: { ...parte, sha256: 'a'.repeat(64) } })).status, 400);
  const curta = linhas.map((l) => l.slice(1));
  assert.equal((await pedir('PUT', `/api/carregamentos/${d.j.id}/partes`, { cookie: ck, corpo: { ...parte, dados: curta, sha256: sha256(JSON.stringify(curta)) } })).status, 400, 'nº de colunas errado');
  assert.equal((await pedir('PUT', `/api/carregamentos/${d.j.id}/partes`, { cookie: ck, corpo: parte })).j.repetida, false);
  assert.equal((await pedir('PUT', `/api/carregamentos/${d.j.id}/partes`, { cookie: ck, corpo: parte })).j.repetida, true);
  const outra = linhas.slice(1);
  assert.equal((await pedir('PUT', `/api/carregamentos/${d.j.id}/partes`, { cookie: ck, corpo: { ...parte, linhas: outra.length, dados: outra, sha256: sha256(JSON.stringify(outra)) } })).status, 409);
  assert.equal((await pedir('POST', `/api/carregamentos/${d.j.id}/cancelar`, { cookie: ck })).status, 200);
  assert.equal((await pedir('POST', '/api/carregamentos', { cookie: ck, corpo: { mes: '2026-11', ficheiros: fic.filter((f) => f.tipo === 'visitDb') } })).status, 400);
  const pub = (await db.query(`SELECT count(*)::int AS n FROM carregamentos WHERE mes = '2026-11' AND estado = 'publicado'`)).rows[0].n;
  assert.equal(pub, 1);
});

test('nova versão do mês: substitui a anterior; visitas removidas exigem confirmação; concorrência; reverter; arquivo', async () => {
  const ck = await entrarComo('admin@teste.co.mz', SENHA_ADMIN);
  const antes = (await db.query(`SELECT id FROM carregamentos WHERE mes = '2026-11' AND estado = 'publicado'`)).rows[0].id;
  const a = await carregarPelaApi(ck, entNov);
  assert.equal(a.v.j.resumo.comparacao.publicadoId, antes);
  assert.equal(a.v.j.resumo.comparacao.nRemovidas, 0);
  const b = await carregarPelaApi(ck, entNov);
  assert.equal((await pedir('POST', `/api/carregamentos/${a.id}/publicar`, { cookie: ck, corpo: {} })).status, 200);
  const rb = await pedir('POST', `/api/carregamentos/${b.id}/publicar`, { cookie: ck, corpo: {} });
  assert.equal(rb.status, 409, 'b foi validada contra a versão anterior: não pode ser publicada');
  assert.equal((await db.query('SELECT estado FROM carregamentos WHERE id = $1', [b.id])).rows[0].estado, 'cancelado');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM carregamento_tabelas WHERE carregamento_id = $1', [b.id])).rows[0].n, 0, 'dados de b apagados');
  // a API de dados passa a servir a nova versão
  const r = await fetch(`${base}/api/v1/tabelas/survey_visit_db?mes=2026-11`, { headers: { 'X-API-Key': chave } });
  assert.equal(r.headers.get('x-versao'), a.id);
  // versão com 1 visita a menos -> pede confirmação
  const noPap = new Set(entNov.pap.rows.map((x) => x.visit_nu));
  const tirar = entNov.visitDb.rows.find((x) => !noPap.has(x.visit_nu)).visit_nu;
  const semUma = { ...entNov, visitDb: { colunas: entNov.visitDb.colunas, rows: entNov.visitDb.rows.filter((x) => x.visit_nu !== tirar) } };
  const c = await carregarPelaApi(ck, semUma);
  assert.equal(c.v.j.resumo.comparacao.nRemovidas, 1);
  assert.deepEqual(c.v.j.resumo.comparacao.removidas, [tirar]);
  const r1 = await pedir('POST', `/api/carregamentos/${c.id}/publicar`, { cookie: ck, corpo: {} });
  assert.equal(r1.status, 409);
  assert.equal(r1.j.precisaConfirmar, 'remocoes');
  assert.equal((await pedir('POST', `/api/carregamentos/${c.id}/publicar`, { cookie: ck, corpo: { confirmar: true } })).status, 200);
  // reverter para a (substituída) -> pede confirmação, depois volta
  assert.equal((await pedir('POST', `/api/carregamentos/${a.id}/publicar`, { cookie: ck, corpo: {} })).j.precisaConfirmar, 'reverter');
  assert.equal((await pedir('POST', `/api/carregamentos/${a.id}/publicar`, { cookie: ck, corpo: { confirmar: true } })).status, 200);
  const estados = async () => (await db.query(`SELECT id, estado, dados_arquivados FROM carregamentos WHERE mes = '2026-11' AND tipo = 'mensal' AND estado IN ('publicado', 'substituido') ORDER BY publicado_em DESC`)).rows;
  let est = await estados();
  assert.deepEqual(est.filter((x) => x.estado === 'publicado').map((x) => x.id), [a.id]);
  assert.deepEqual(est.filter((x) => x.dados_arquivados), [], 'com 2 substituídas ainda nada é arquivado');
  // mais uma versão publicada -> 3 substituídas -> a mais antiga ("antes") é arquivada
  const d = await carregarPelaApi(ck, entNov);
  assert.equal((await pedir('POST', `/api/carregamentos/${d.id}/publicar`, { cookie: ck, corpo: {} })).status, 200);
  est = await estados();
  assert.deepEqual(est.filter((x) => x.dados_arquivados).map((x) => x.id), [antes]);
  assert.equal(est.filter((x) => x.estado === 'substituido' && !x.dados_arquivados).length, 2);
  for (const t of ['carregamento_pacote', 'carregamento_lojas', 'carregamento_tabelas', 'carregamento_tabela_paginas']) {
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${t} WHERE carregamento_id = $1`, [antes])).rows[0].n, 0, t);
  }
  const rv = await pedir('POST', `/api/carregamentos/${antes}/publicar`, { cookie: ck, corpo: { confirmar: true } });
  assert.equal(rv.status, 409);
  assert.match(rv.j.erro, /arquivada/);
  await assert.rejects(db.query(`UPDATE carregamentos SET estado = 'publicado' WHERE id = $1`, [c.id]));
  const lista = await pedir('GET', '/api/carregamentos', { cookie: ck });
  assert.ok(lista.j.carregamentos.every((x) => x.resumo?.visitas === undefined));
  const reg = (await db.query(`SELECT acao, count(*)::int AS n FROM registo GROUP BY acao ORDER BY acao`)).rows;
  console.log('      registo:', reg.map((x) => `${x.acao}=${x.n}`).join(' '));
});

test('chave revogada deixa de funcionar imediatamente', async () => {
  const ck = await entrarComo('admin@teste.co.mz', SENHA_ADMIN);
  const id = (await pedir('GET', '/api/chaves', { cookie: ck })).j.chaves[0].id;
  assert.equal((await pedir('POST', `/api/chaves/${id}/revogar`, { cookie: ck })).status, 200);
  assert.equal((await pedir('GET', '/api/v1/meses', { headers: { 'X-API-Key': chave } })).status, 401);
  assert.equal((await pedir('POST', `/api/chaves/${id}/revogar`, { cookie: ck })).status, 404);
});

test('utilizadores e bloqueio após 10 tentativas', async () => {
  const ck = await entrarComo('admin@teste.co.mz', SENHA_ADMIN);
  assert.equal((await pedir('POST', '/api/utilizadores', { cookie: ck, corpo: { email: 'novo@teste.co.mz', nome: 'Novo', papel: 'leitor', senha: 'curta' } })).status, 400);
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
  // a API de dados pelo mesmo caminho da Vercel (/api/v1/... -> ?rota=v1/...)
  const ck = await entrarComo('admin@teste.co.mz', SENHA_ADMIN);
  const nova = (await pedir('POST', '/api/chaves', { cookie: ck, corpo: { nome: 'vercel' } })).j.chave.chave;
  const v = await chamar('GET', `/api/index?rota=v1%2Fmeses&api_key=${nova}`);
  assert.equal(v.status, 200);
  assert.equal(v.corpo.meses.length, 3);
});
