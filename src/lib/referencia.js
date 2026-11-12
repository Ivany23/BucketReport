// Lojas de cada mês publicado e montagem das "lojas esperadas" de um mês (= lojas dos meses anteriores).
// Usado pelo servidor (ao validar / publicar) e pelos testes. Mesmo resultado que o antigo lojas_referencia.json.
import { cleanId, cleanText, parseDate, monthName, auditorInitials } from './normalize.js';
import { displayValue } from './model.js';
import { provinceFromReport } from './provinces.js';

/**
 * Lojas de um mês de REFERÊNCIA (relatórios antigos, ex.: Setembro/Outubro): demographic_file + lojas que só
 * estão no PAP (recolocadas sem External Id). Estado = status da última visita do mês no survey_visit_db.
 * @returns [{ store_id, estado, demo }]
 */
export function lojasDoMesReferencia(rep, mes) {
  const ultimo = new Map();
  for (const r of rep.visitDb ?? []) {
    const id = cleanId(r.store_nu), d = parseDate(r.survey_date, 'dmy');
    if (!d.startsWith(mes)) throw new Error(`survey_visit_db: visita fora de ${mes}: ${r.visit_nu} ${r.survey_date}`);
    if (!ultimo.has(id) || ultimo.get(id).d <= d) ultimo.set(id, { d, status: cleanText(r.status) });
  }
  const out = new Map();
  for (const r of rep.demographic ?? []) {
    const id = cleanId(r['Store No']);
    if (!id || out.has(id)) continue;
    if (!provinceFromReport(r.Province)) throw new Error(`demographic_file: província desconhecida "${r.Province}" (loja ${id})`);
    const demo = {};
    for (const [k, v] of Object.entries(r)) demo[k] = displayValue(v);
    out.set(id, { store_id: id, estado: ultimo.get(id)?.status ?? '', demo });
  }
  for (const r of rep.pap ?? []) {
    const id = cleanId(r.store_nu);
    if (!id || out.has(id)) continue;
    out.set(id, {
      store_id: id, estado: ultimo.get(id)?.status ?? 'Audit done', soPap: true,
      demo: {
        'Store No': id, 'S.E.M. ID': displayValue(r.sem_id), 'Store Name': cleanText(r.store_name),
        Channel: cleanText(r.channel), Classification: cleanText(r.classification), Region: cleanText(r.region),
        Province: cleanText(r.province), District: cleanText(r.district), Neighborhood: cleanText(r.neighborhood),
        Category: cleanText(r.category), Market: cleanText(r.market), Dimension: cleanText(r.dimension),
        'Owner-Manager name': cleanText(r.owner_manager_name), 'Contact no.': displayValue(r.contact_no),
        StoreLatitude: displayValue(r.storelatitude), StoreLongitude: displayValue(r.storelongitude),
        'Date Modified': cleanText(r.survey_date),
      },
    });
  }
  return [...out.values()];
}

/** Lojas de um mês MENSAL já publicado (modelo da app): as lojas com visita ou feedback nesse mês */
export function lojasDoMesMensal(m) {
  return m.stores.filter((s) => s.ativo).map((s) => {
    const v = s.visitas.at(-1);
    const f = s.soFeedback.at(-1);
    const estado = v && (!f || v.date >= f.date) ? v.status : f?.categoria ?? '';
    return { store_id: s.id, estado, demo: s.demo, soPap: s.fonteDados !== m.mes };   // ficha completa só se veio do demographic_file deste mês
  });
}

/**
 * Junta as lojas dos meses anteriores (linhas { mes, store_id, estado, demo }) no formato que o modelo usa:
 * { meses: [{ chave, nome, lojas }], lojas: [{ id, meses, estados, demo }] }. A ficha (demo) é a do mês mais recente,
 * excepto se nesse mês a loja só estava no PAP (ficha incompleta) e havia uma ficha completa antes.
 */
export function montarReferencia(linhas) {
  const ord = [...linhas].sort((a, b) => a.mes.localeCompare(b.mes));
  const lojas = new Map();
  const porMes = new Map();
  for (const l of ord) {
    porMes.set(l.mes, (porMes.get(l.mes) ?? 0) + 1);
    const x = lojas.get(l.store_id) ?? { id: l.store_id, meses: [], estados: {}, demo: null, soPap: true };
    if (!x.meses.includes(l.mes)) x.meses.push(l.mes);
    x.estados[l.mes] = l.estado;
    if (!x.demo || !l.soPap || x.soPap) { x.demo = l.demo; x.soPap = Boolean(l.soPap); }
    lojas.set(l.store_id, x);
  }
  return {
    meses: [...porMes].map(([chave, n]) => ({ chave, nome: monthName(chave), lojas: n })),
    lojas: [...lojas.values()].map(({ soPap, ...x }) => x),
  };
}

/** Lista de auditores para o modelo: a da base de dados + nomes dos ficheiros brutos do BeatRoute deste carregamento */
export function juntarAuditores(daBase, linhasBrutas = []) {
  const m = new Map(daBase.map((a) => [a.nome, a.iniciais]));
  for (const r of linhasBrutas) {
    const n = cleanText(r.submitted_by_name).replace(/\s+/g, ' ');
    if (n && !m.has(n)) m.set(n, auditorInitials(n));
  }
  return [...m].map(([nome, iniciais]) => ({ nome, iniciais })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
}

/** Mês dos relatórios (o das visitas do survey_visit_db) — antes de construir o modelo */
export function mesDosRelatorios(visitDb) {
  const c = new Map();
  for (const r of visitDb ?? []) {
    const d = parseDate(r.survey_date, 'dmy');
    if (d) c.set(d.slice(0, 7), (c.get(d.slice(0, 7)) ?? 0) + 1);
  }
  if (!c.size) throw new Error('survey_visit_db sem datas');
  return [...c].sort((a, b) => b[1] - a[1])[0][0];
}
