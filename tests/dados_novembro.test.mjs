// Testes com os relatórios REAIS do mês (por omissão ../Tangerine/WorkDay30/FReport30; outra pasta: HEINEKEN_DADOS=...)
import { homedir } from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DADOS, modelo, lerPasta, geoCompleto, referencia } from './carregar.mjs';
import { makeLocator, provinceFromReport, PROVINCIAS } from '../src/lib/provinces.js';
import { cleanId, parseDate, auditorInitials } from '../src/lib/normalize.js';
import { parseCsvText } from '../src/lib/reports.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

const CSV = join(DADOS, 'CSV', 'November_csv');
const XLSX = join(DADOS, 'XLSX', 'November_Reports');
const { m, rep, ignorados } = modelo(CSV);
const ref = referencia();

test('os 5 relatórios do mês foram reconhecidos', () => {
  for (const k of ['demographic', 'visitDb', 'feedback', 'pap', 'vq', 'qa']) assert.ok(rep[k]?.length, `falta ${k}`);
  assert.deepEqual(ignorados, []);
  assert.equal(m.mes, '2026-11');
});

test('CSV e XLSX dão exactamente o mesmo resultado', () => {
  const x = modelo(XLSX).m;
  const resumo = (mm) => JSON.stringify({ stores: mm.stores, provincias: mm.provincias, auditores: mm.auditores, totais: mm.totais, checks: mm.checks });
  assert.equal(resumo(x), resumo(m));
});

test('nenhuma visita do survey_visit_db se perde', () => {
  const ids = new Set(rep.visitDb.map((r) => r.visit_nu));
  const noModelo = m.stores.flatMap((s) => s.visitas.filter((v) => v.origem === 'survey_visit_db').map((v) => v.visit_nu));
  assert.equal(noModelo.length, ids.size);
  assert.deepEqual(new Set(noModelo), ids);
  for (const s of m.stores) for (const v of s.visitas) assert.equal(v.store, s.id);
});

test('nenhuma visita do PAP se perde e todas têm 23 produtos', () => {
  const papVis = new Set(rep.pap.map((r) => r.visit_nu));
  const comProdutos = m.stores.flatMap((s) => s.visitas.filter((v) => v.produtos).map((v) => v.visit_nu));
  assert.deepEqual(new Set(comProdutos), papVis);
  for (const s of m.stores) for (const v of s.visitas) if (v.produtos) assert.equal(v.produtos.length, 23, v.visit_nu);
});

test('cada feedback aparece exactamente uma vez (na visita do mesmo dia ou como "só feedback")', () => {
  const ligados = m.stores.flatMap((s) => [...s.visitas.flatMap((v) => v.feedback ?? []), ...s.soFeedback]).map((f) => f.visit_nu);
  assert.equal(ligados.length, rep.feedback.length);
  assert.deepEqual(new Set(ligados), new Set(rep.feedback.map((f) => f.visit_nu)));
  // independente: feedback sem visita da mesma loja + dia
  const vd = new Set(rep.visitDb.map((r) => `${cleanId(r.store_nu)}|${parseDate(r.survey_date, 'dmy')}`));
  for (const r of rep.pap) vd.add(`${cleanId(r.store_nu)}|${parseDate(r.survey_date, 'dmy')}`);
  const so = rep.feedback.filter((f) => !vd.has(`${cleanId(f.store_nu)}|${parseDate(f.survey_date, 'ymd')}`));
  assert.equal(m.totais.soFeedback, so.length);
});

test('questionários: todos ligados a uma loja', () => {
  const n = m.stores.reduce((a, s) => a + s.questionarios.length, 0);
  assert.equal(n, new Set(rep.vq.map((r) => r.visit_nu)).size);
  for (const s of m.stores) for (const q of s.questionarios) assert.equal(q.itens.length, 15);
});

test('estado de cada loja (contado de forma independente)', () => {
  const done = new Set(), any = new Set(), fb = new Set();
  for (const r of rep.visitDb) { any.add(cleanId(r.store_nu)); if (r.status === 'Audit done') done.add(cleanId(r.store_nu)); }
  for (const r of rep.pap) { any.add(cleanId(r.store_nu)); done.add(cleanId(r.store_nu)); }
  for (const r of rep.feedback) fb.add(cleanId(r.store_nu));
  for (const s of m.stores) {
    const esperado = done.has(s.id) ? 'auditada' : any.has(s.id) ? 'nao_auditada' : fb.has(s.id) ? 'so_feedback' : 'por_visitar';
    assert.equal(s.estado, esperado, `${s.id} ${s.nome}`);
  }
  assert.equal(m.totais.visitadas, new Set([...any, ...fb]).size);
  // casos conhecidos de 12/11
  assert.equal(m.storeById.get('331082').estado, 'auditada');           // fechada a 07/11, auditada a 11/11
  assert.equal(m.storeById.get('4790073').visitas.at(-1).status, 'Audit not done');   // "nao vende bebidas alcoolicas"
});

test('províncias: visitadas / esperadas batem com a referência e com os totais', () => {
  assert.equal(m.totais.esperadas, ref.lojas.length);
  const somaEsp = m.provincias.reduce((a, p) => a + p.esperadas, 0);
  const somaVis = m.provincias.reduce((a, p) => a + p.visitadas, 0);
  assert.equal(somaEsp, ref.lojas.length);
  assert.equal(somaVis, m.totais.visitadas);
  const full = makeLocator(geoCompleto());
  const provDe = (d) => provinceFromReport(d.Province) || (!String(d.Province ?? '').trim()
    ? full(Number(d.StoreLatitude), Number(d.StoreLongitude)).provincia : '');
  for (const p of m.provincias) {
    const esp = ref.lojas.filter((l) => provDe(m.storeById.get(l.id).demo) === p.nome).length;
    assert.equal(p.esperadas, esp, p.nome);
    assert.equal(p.porEstado.auditada + p.porEstado.nao_auditada + p.porEstado.so_feedback, p.visitadas, p.nome);
  }
  assert.deepEqual(m.stores.filter((s) => s.ativo && !s.provincia).map((s) => s.id), []);
  const pg = m.checks.find((c) => c.id === 'provincia_gps').lojas;
  console.log('      província pelo GPS:', pg.map((id) => `${id} ${m.storeById.get(id).nome} -> ${m.storeById.get(id).provincia}`));
  assert.equal(m.provincias.length, 11);
  assert.deepEqual(m.provincias.map((p) => p.nome), PROVINCIAS);
});

test('auditores: somas batem e o QA resolve as iniciais repetidas (RM)', () => {
  assert.equal(m.auditores.reduce((a, x) => a + x.visitas, 0), m.totais.visitas);
  assert.equal(m.auditores.reduce((a, x) => a + x.soFeedback, 0), m.totais.soFeedback);
  assert.equal(m.checks.find((c) => c.id === 'auditor_ambiguo').lojas.length, 0);
  for (const a of m.auditores) assert.ok(!a.nome.includes(' ou '), a.nome);
  const semQA = modelo(CSV, { comQA: false }).m;
  const amb = semQA.auditores.filter((a) => a.nome.includes(' ou ')).map((a) => a.nome);
  console.log('      sem o QA, auditores ambíguos:', amb);
  assert.ok(amb.every((n) => n.startsWith('RM ')));
  for (const a of m.auditores) assert.ok(['exacto', 'iniciais'].includes(a.como) || a.visitas === 0, `${a.nome} ${a.como}`);
  assert.ok(!m.auditores.some((a) => /^[A-Z]{1,3}$/.test(a.nome)), 'auditor só com iniciais (falta na lista de auditores)');
});

// prova contra o ficheiro BRUTO do BeatRoute: o auditor de cada feedback = submitted_by_name
const DL = process.env.HEINEKEN_BRUTOS ?? join(homedir(), 'Downloads');
const brutos = existsSync(DL) ? readdirSync(DL).filter((f) => /^response-Feedback-Report-.*Nov2026.*\.csv$/.test(f)) : [];
test('auditor de cada feedback = nome no ficheiro bruto do BeatRoute', { skip: !brutos.length && 'sem ficheiros brutos' }, () => {
  const real = new Map();
  for (const f of brutos) {
    const t = readFileSync(join(DL, f), 'utf8').replace(/^\ufeff/, '');
    for (const r of parseCsvText(t.slice(t.indexOf('\n') + 1)).rows) {
      const ext = cleanId(r.customer_external_id);
      if (!ext) continue;
      const d = new Date(`${r.response_date} 12:00`);
      const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      const k = `${auditorInitials(r.submitted_by_name)}${ymd}000000${ext}`;
      real.set(k, [...new Set([...(real.get(k) ?? []), r.submitted_by_name.trim()])]);
    }
  }
  let comparados = 0;
  const erros = [];
  const como = {};
  for (const s of m.stores) for (const f of [...s.soFeedback, ...s.visitas.flatMap((v) => v.feedback ?? [])]) {
    const r = real.get(f.visit_nu);
    if (!r) continue;
    comparados++;
    como[f.auditor.como] = (como[f.auditor.como] ?? 0) + 1;
    if (r.length !== 1 || r[0] !== f.auditor.nome) erros.push(`${f.visit_nu}: app=${f.auditor.nome} (${f.auditor.como}) bruto=${r.join('/')}`);
  }
  console.log(`      feedbacks comparados com o bruto: ${comparados} de ${rep.feedback.length}`, como, erros.slice(0, 5));
  assert.ok(comparados > rep.feedback.length * 0.9);
  assert.deepEqual(erros, []);
});

test('mapa simplificado localiza as lojas como o mapa oficial completo', () => {
  const full = makeLocator(geoCompleto());
  const dif = [];
  for (const s of m.stores) {
    if (s.gps.estado === 'sem_gps') continue;
    const f = full(s.lat, s.lon);
    if (f.provincia !== s.gps.provincia) dif.push(`${s.id} ${s.nome}: simples=${s.gps.provincia}/${s.gps.estado} completo=${f.provincia}/${f.estado}`);
  }
  console.log(`      ${m.stores.length} lojas comparadas; diferenças: ${dif.length}`, dif.slice(0, 10));
  assert.deepEqual(dif, []);
});

test('verificações (só informação)', () => {
  for (const c of m.checks) console.log(`      ${c.titulo}: ${c.lojas.length}`);
  console.log('      avisos:', m.avisos);
  console.log('      totais:', JSON.stringify(m.totais));
  console.log('      províncias:', m.provincias.map((p) => `${p.nome} ${p.visitadas}/${p.esperadas}`).join(' | '));
});
