// Modelo da app: junta os relatórios do mês numa ficha por loja, com estado, visitas, auditor, produtos,
// questionário, totais por província (visitadas / esperadas) e por auditor, e a lista de verificações.
import { cleanId, cleanText, toNum, parseDate, initialsOf, monthName, monthShort } from './normalize.js';
import { PROVINCIAS, provinceFromReport } from './provinces.js';

const AUDIT_DONE = 'Audit done';
const AUDIT_NOT_DONE = 'Audit not done';

/** Valor para mostrar: igual em CSV ("23724.0") e XLSX (23724) */
export function displayValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const s = cleanText(v);
  return /^-?\d+\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s;
}

function cleanRow(r) {
  const o = {};
  for (const [k, v] of Object.entries(r)) o[k] = displayValue(v);
  return o;
}

function groupBy(arr, key) {
  const m = new Map();
  for (const x of arr) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

const flag = (v) => cleanId(v) === '-1';

/**
 * @param {object} rep  linhas por relatório: { demographic, visitDb, feedback?, pap?, vq?, qa? }
 * @param {object} reference  public/data/lojas_referencia.json
 * @param {function} locate  makeLocator(geojson)
 * @param {Array} auditoresLista  public/data/auditores.json .auditores ([{ nome, iniciais }])
 */
export function buildModel(rep, reference, locate, auditoresLista = []) {
  if (!rep.demographic?.length) throw new Error('Falta o demographic_file');
  if (!rep.visitDb?.length) throw new Error('Falta o survey_visit_db');
  const avisos = [];

  // ---------- visitas (survey_visit_db) ----------
  const visits = rep.visitDb.map((r, i) => {
    const v = {
      visit_nu: cleanText(r.visit_nu), store: cleanId(r.store_nu), sem: cleanId(r.sem_id),
      date: parseDate(r.survey_date, 'dmy'), status: cleanText(r.status), origem: 'survey_visit_db',
    };
    if (!v.visit_nu || !v.store || !v.date) throw new Error(`survey_visit_db linha ${i + 2}: visit_nu / store_nu / survey_date vazio`);
    if (v.status !== AUDIT_DONE && v.status !== AUDIT_NOT_DONE) throw new Error(`survey_visit_db linha ${i + 2}: status desconhecido "${v.status}"`);
    return v;
  });
  const visitById = new Map();
  for (const v of visits) {
    if (visitById.has(v.visit_nu)) throw new Error(`survey_visit_db: visit_nu repetido ${v.visit_nu}`);
    visitById.set(v.visit_nu, v);
  }

  // mês do relatório = mês da maioria das visitas
  const porMes = groupBy(visits, (v) => v.date.slice(0, 7));
  const mes = [...porMes.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
  const outrosMeses = [...porMes.keys()].filter((m) => m !== mes);
  if (outrosMeses.length) avisos.push(`O survey_visit_db tem visitas de outros meses: ${outrosMeses.join(', ')}`);

  // ---------- produtos (PAP) ----------
  const papByVisit = groupBy(rep.pap ?? [], (r) => cleanText(r.visit_nu));
  const produtos = new Map();
  const papStoreRow = new Map();
  for (const [vnu, rows] of papByVisit) {
    produtos.set(vnu, rows.map((r) => ({
      sku: cleanId(r.sku), produto: cleanText(r.product), marca: cleanText(r.brand),
      estado: flag(r.on_shelf) ? 'on_shelf' : flag(r.out_of_stock) ? 'out_of_stock' : flag(r.not_stocked) ? 'not_stocked' : 'sem_leitura',
      unit_price: toNum(r.unit_price), pack_price: toNum(r.pack_price), validade: displayValue(r.validity),
    })));
    const r0 = rows[0];
    if (!papStoreRow.has(cleanId(r0.store_nu))) papStoreRow.set(cleanId(r0.store_nu), r0);
    // visitas do PAP que não estão no survey_visit_db: lojas sem External Id recolocadas pelo pipeline
    if (!visitById.has(vnu)) {
      const v = { visit_nu: vnu, store: cleanId(r0.store_nu), sem: cleanId(r0.sem_id), date: parseDate(r0.survey_date, 'dmy'),
        status: AUDIT_DONE, origem: 'product_availability_price' };
      visits.push(v);
      visitById.set(vnu, v);
    }
  }

  // ---------- auditor ----------
  const exact = new Map();
  for (const r of rep.qa ?? []) exact.set(cleanText(r.visit_nu), cleanText(r['User Name']));
  for (const [vnu, rows] of papByVisit) {
    const n = cleanText(rows[0].auditor_name);
    if (!n) continue;
    if (exact.has(vnu) && exact.get(vnu) !== n) avisos.push(`Auditor diferente no QA e no PAP para ${vnu}: ${exact.get(vnu)} / ${n}`);
    else exact.set(vnu, n);
  }
  const byIni = new Map();
  for (const [vnu, n] of exact) {
    const ini = initialsOf(vnu);
    if (!byIni.has(ini)) byIni.set(ini, new Set());
    byIni.get(ini).add(n);
  }
  // lista de auditores do mês (public/data/auditores.json): nomes de iniciais que não aparecem com nome nos relatórios
  for (const a of auditoresLista ?? []) {
    if (!byIni.has(a.iniciais)) byIni.set(a.iniciais, new Set());
    byIni.get(a.iniciais).add(a.nome);
  }
  const pendentes = [];   // [auditor, store] com iniciais de 2+ auditores: resolvidos depois pela província
  function auditorOf(vnu, store) {
    if (exact.has(vnu)) return { nome: exact.get(vnu), como: 'exacto' };
    const ini = initialsOf(vnu);
    const s = byIni.get(ini);
    if (s?.size === 1) return { nome: [...s][0], como: 'iniciais' };
    if (s?.size > 1) {
      const a = { nome: `${ini} (${[...s].sort().join(' ou ')})`, como: 'ambiguo', candidatos: [...s].sort(), visit_nu: vnu };
      pendentes.push([a, store]);
      return a;
    }
    return { nome: ini || '?', como: 'desconhecido' };
  }
  for (const v of visits) Object.assign(v, { auditor: auditorOf(v.visit_nu, v.store) });

  // ---------- feedback ----------
  const visitByStoreDay = new Map();
  for (const v of visits) {
    const k = `${v.store}|${v.date}`;
    if (!visitByStoreDay.has(k) || v.origem === 'survey_visit_db') visitByStoreDay.set(k, v);
  }
  const feedbackOnly = [];
  for (const r of rep.feedback ?? []) {
    const f = {
      visit_nu: cleanText(r.visit_nu), store: cleanId(r.store_nu), date: parseDate(r.survey_date, 'ymd'),
      categoria: cleanText(r.category), detalhes: cleanText(r.details), provincia: cleanText(r.province),
      loja: cleanText(r.shop_name), row: cleanRow(r),
    };
    f.auditor = auditorOf(f.visit_nu, f.store);
    const v = visitByStoreDay.get(`${f.store}|${f.date}`);
    if (v) (v.feedback ??= []).push(f);
    else feedbackOnly.push(f);
  }

  // ---------- questionário (Visibility_Quality) ----------
  const vqByStore = new Map();
  for (const [vnu, rows] of groupBy(rep.vq ?? [], (r) => cleanText(r.visit_nu))) {
    const r0 = rows[0];
    const q = { visit_nu: vnu, date: parseDate(r0.survey_date, 'mdy'), auditor: auditorOf(vnu, cleanId(r0.store_nu)),
      itens: rows.map((r) => ({ item: cleanText(r.item), valor: displayValue(r.value) })) };
    const s = cleanId(r0.store_nu);
    if (!vqByStore.has(s)) vqByStore.set(s, []);
    vqByStore.get(s).push(q);
  }

  // ---------- lojas ----------
  const demo = new Map();
  for (const r of rep.demographic) {
    const id = cleanId(r['Store No']);
    if (!id) continue;
    if (demo.has(id)) avisos.push(`demographic_file: Store No repetido ${id} (fica a primeira linha)`);
    else demo.set(id, cleanRow(r));
  }
  const ref = new Map((reference?.lojas ?? []).map((l) => [l.id, l]));
  const refMeses = reference?.meses ?? [];

  const visitsByStore = groupBy(visits, (v) => v.store);
  const fbOnlyByStore = groupBy(feedbackOnly, (f) => f.store);
  const ids = new Set([...demo.keys(), ...visitsByStore.keys(), ...fbOnlyByStore.keys(), ...ref.keys()]);

  const stores = [];
  for (const id of ids) {
    const vs = (visitsByStore.get(id) ?? []).sort((a, b) => a.date.localeCompare(b.date) || a.visit_nu.localeCompare(b.visit_nu));
    const fo = (fbOnlyByStore.get(id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    const rl = ref.get(id);
    let d = demo.get(id), fonte = mes;
    if (!d && rl) { d = rl.demo; fonte = rl.meses[rl.meses.length - 1]; }
    if (!d && papStoreRow.has(id)) {
      const p = papStoreRow.get(id);
      d = { 'Store No': id, 'S.E.M. ID': displayValue(p.sem_id), 'Store Name': cleanText(p.store_name), Channel: cleanText(p.channel),
        Classification: cleanText(p.classification), Region: cleanText(p.region), Province: cleanText(p.province),
        District: cleanText(p.district), Neighborhood: cleanText(p.neighborhood), Category: cleanText(p.category),
        Market: cleanText(p.market), StoreLatitude: displayValue(p.storelatitude), StoreLongitude: displayValue(p.storelongitude) };
      fonte = 'pap';
    }
    if (!d && fo.length) {
      const f = fo[0];
      d = { 'Store No': id, 'Store Name': f.loja, Region: f.row.region, Province: f.provincia, Neighborhood: f.row.neighborhood,
        Market: f.row.market, Channel: f.row.channel, 'S.E.M. ID': f.row.sem_id };
      fonte = 'feedback';
    }
    const lat = toNum(d['StoreLatitude']), lon = toNum(d['StoreLongitude']);
    const gps = locate(lat, lon);
    // província do relatório; se vier vazia (lojas recolocadas sem External Id só no PAP) -> a do ponto GPS
    let provincia = provinceFromReport(d.Province), provinciaPeloGps = false;
    if (!provincia && !cleanText(d.Province) && ['dentro', 'costa'].includes(gps.estado)) {
      provincia = gps.provincia;
      provinciaPeloGps = true;
    }
    const ativo = vs.length > 0 || fo.length > 0;
    const estado = vs.some((v) => v.status === AUDIT_DONE) ? 'auditada'
      : vs.length ? 'nao_auditada' : fo.length ? 'so_feedback' : 'por_visitar';
    stores.push({
      id, nome: d['Store Name'] || `Loja ${id}`, sem: d['S.E.M. ID'] ?? '', provincia, provinciaRelatorio: d.Province ?? '',
      distrito: d.District ?? '', bairro: d.Neighborhood ?? '', canal: d.Channel ?? '', classificacao: d.Classification ?? '',
      lat, lon, gps, provinciaPeloGps, demo: d, fonteDados: fonte, estado, ativo,
      visitas: vs.map((v) => ({ ...v, produtos: produtos.get(v.visit_nu) ?? null })),
      soFeedback: fo, questionarios: (vqByStore.get(id) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
      auditores: [], referencia: rl ? { meses: rl.meses, estados: rl.estados } : null, nova: ativo && !rl,
      ultimaData: [...vs.map((v) => v.date), ...fo.map((f) => f.date)].sort().pop() ?? '',
    });
  }
  stores.sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
  const storeById = new Map(stores.map((s) => [s.id, s]));

  // iniciais de 2+ auditores (ex.: as mesmas iniciais "RM" para 2 auditores) sem nome exacto (feedback, questionário):
  // se a loja está numa província onde SÓ um dos candidatos trabalhou este mês (visitas com nome exacto) -> esse auditor
  const provDe = new Map();
  for (const v of visits) {
    if (v.auditor.como !== 'exacto') continue;
    const p = storeById.get(v.store)?.provincia;
    if (!p) continue;
    if (!provDe.has(v.auditor.nome)) provDe.set(v.auditor.nome, new Set());
    provDe.get(v.auditor.nome).add(p);
  }
  for (const [a, store] of pendentes) {
    const p = storeById.get(store)?.provincia;
    const c = a.candidatos.filter((n) => p && provDe.get(n)?.has(p));
    // (o PAP / QA dão o nome exacto das visitas de stock; um candidato sem visitas exactas nesta província fica de fora)
    if (c.length === 1) Object.assign(a, { nome: c[0], como: 'provincia', provinciaUsada: p });
  }
  const ambiguos = pendentes.filter(([a]) => a.como === 'ambiguo').map(([a, store]) => ({ visit_nu: a.visit_nu, store }));
  for (const s of stores) s.auditores = [...new Set([...s.visitas.map((v) => v.auditor.nome), ...s.soFeedback.map((f) => f.auditor.nome)])];

  // ---------- províncias ----------
  const contar = (arr) => {
    const c = { auditada: 0, nao_auditada: 0, so_feedback: 0, por_visitar: 0 };
    for (const s of arr) c[s.estado]++;
    return c;
  };
  const provincias = PROVINCIAS.map((nome) => {
    const lojas = stores.filter((s) => s.provincia === nome);
    const esperadas = lojas.filter((s) => s.referencia).length;
    const visitadas = lojas.filter((s) => s.ativo).length;
    return { nome, esperadas, visitadas, novas: lojas.filter((s) => s.nova).length, porEstado: contar(lojas), total: lojas.length };
  });

  // ---------- auditores ----------
  const aud = new Map();
  const getAud = (a) => {
    if (!aud.has(a.nome)) aud.set(a.nome, { nome: a.nome, como: a.como, visitas: 0, auditadas: 0, naoAuditadas: 0, soFeedback: 0,
      lojas: new Set(), dias: new Map(), provincias: new Set() });
    return aud.get(a.nome);
  };
  for (const v of visits) {
    const a = getAud(v.auditor);
    a.visitas++;
    if (v.status === AUDIT_DONE) a.auditadas++; else a.naoAuditadas++;
    a.lojas.add(v.store);
    a.dias.set(v.date, (a.dias.get(v.date) ?? 0) + 1);
    const p = storeById.get(v.store)?.provincia; if (p) a.provincias.add(p);
  }
  for (const f of feedbackOnly) {
    const a = getAud(f.auditor);
    a.soFeedback++;
    a.lojas.add(f.store);
    a.dias.set(f.date, (a.dias.get(f.date) ?? 0) + 1);
    const p = storeById.get(f.store)?.provincia; if (p) a.provincias.add(p);
  }
  const auditores = [...aud.values()].map((a) => ({
    ...a, lojas: [...a.lojas], nLojas: a.lojas.size, provincias: [...a.provincias],
    dias: [...a.dias.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([data, n]) => ({ data, n })),
  })).sort((x, y) => y.nLojas - x.nLojas || x.nome.localeCompare(y.nome, 'pt'));

  // ---------- verificações ----------
  const naoMapa = stores.filter((s) => s.gps.estado === 'sem_gps');
  const checks = [
    { id: 'gps_outra', titulo: 'GPS noutra província', desc: 'O ponto GPS cai numa província diferente da coluna Province.',
      lojas: stores.filter((s) => s.provincia && s.gps.provincia && ['dentro', 'costa'].includes(s.gps.estado) && s.gps.provincia !== s.provincia).map((s) => s.id) },
    { id: 'gps_fora', titulo: 'GPS fora de Moçambique', desc: 'O ponto GPS está fora do mapa de Moçambique.',
      lojas: stores.filter((s) => s.gps.estado === 'fora').map((s) => s.id) },
    { id: 'sem_gps', titulo: 'Sem GPS (não aparecem no mapa)', desc: 'Lojas sem latitude / longitude.', lojas: naoMapa.map((s) => s.id) },
    { id: 'sem_provincia', titulo: 'Província desconhecida', desc: 'O valor de Province não corresponde a nenhuma das 11 províncias.',
      lojas: stores.filter((s) => !s.provincia).map((s) => s.id) },
    { id: 'auditor_ambiguo', titulo: 'Auditor com iniciais repetidas', desc: 'Registos sem nome exacto do auditor, com iniciais de 2 auditores que trabalharam na mesma província.',
      lojas: [...new Set(ambiguos.map((x) => x.store))] },
    { id: 'provincia_gps', titulo: 'Província pelo GPS', desc: 'O relatório não trazia a província; foi usada a do ponto GPS no mapa oficial.',
      lojas: stores.filter((s) => s.provinciaPeloGps).map((s) => s.id), info: true },
    { id: 'auditor_provincia', titulo: 'Auditor deduzido pela província', desc: 'Iniciais de 2 auditores (ex.: RM); escolhido o único que trabalhou nessa província este mês.',
      lojas: [...new Set(pendentes.filter(([a]) => a.como === 'provincia').map(([, s]) => s))], info: true },
    { id: 'visita_sem_ficha', titulo: 'Visita sem ficha da loja', desc: 'Loja no survey_visit_db que não está no demographic_file (dados vindos de outro relatório).',
      lojas: [...new Set(visits.filter((v) => v.origem === 'survey_visit_db' && !demo.has(v.store)).map((v) => v.store))] },
    { id: 'nova', titulo: 'Lojas novas', desc: `Lojas visitadas em ${monthName(mes)} que não estavam nos meses anteriores (${refMeses.map((m) => monthShort(m.chave)).join(', ')}).`,
      lojas: stores.filter((s) => s.nova).map((s) => s.id), info: true },
  ];

  const ativas = stores.filter((s) => s.ativo);
  return {
    mes, mesNome: monthName(mes), refMeses, stores, storeById, provincias, auditores, checks, avisos,
    totais: {
      visitadas: ativas.length, esperadas: stores.filter((s) => s.referencia).length,
      visitadasDasEsperadas: ativas.filter((s) => s.referencia).length, novas: ativas.filter((s) => s.nova).length,
      porEstado: contar(stores), visitas: visits.length, soFeedback: feedbackOnly.length, auditores: auditores.length,
      semMapa: naoMapa.length,
    },
    fontes: { qa: Boolean(rep.qa?.length), pap: Boolean(rep.pap?.length), feedback: Boolean(rep.feedback?.length), vq: Boolean(rep.vq?.length) },
  };
}
