// Gera dados_locais/lojas_referencia.json = todas as lojas dos meses anteriores (as "esperadas"),
// a partir do demographic_file.csv e survey_visit_db.csv de cada mês em scripts/meses_referencia.json.
// Uso: npm run gerar-referencia
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvText } from '../src/lib/reports.js';
import { displayValue } from '../src/lib/model.js';
import { cleanId, cleanText, parseDate, monthName } from '../src/lib/normalize.js';
import { provinceFromReport } from '../src/lib/provinces.js';

const cfg = JSON.parse(readFileSync('scripts/meses_referencia.json', 'utf8'));
const lojas = new Map();
const meses = [];
for (const { chave, pasta } of cfg.meses) {
  const demo = parseCsvText(readFileSync(join(pasta, 'demographic_file.csv'), 'utf8')).rows;
  const vdb = parseCsvText(readFileSync(join(pasta, 'survey_visit_db.csv'), 'utf8')).rows;
  // estado da ÚLTIMA visita de cada loja nesse mês
  const ultimo = new Map();
  for (const r of vdb) {
    const id = cleanId(r.store_nu), d = parseDate(r.survey_date, 'dmy');
    if (!d.startsWith(chave)) throw new Error(`${pasta}: visita fora do mês ${chave}: ${r.visit_nu} ${r.survey_date}`);
    if (!ultimo.has(id) || ultimo.get(id).d <= d) ultimo.set(id, { d, status: cleanText(r.status) });
  }
  let n = 0;
  for (const r of demo) {
    const id = cleanId(r['Store No']);
    if (!id) continue;
    if (!provinceFromReport(r.Province)) throw new Error(`${pasta}: província desconhecida "${r.Province}" (loja ${id})`);
    const row = {};
    for (const [k, v] of Object.entries(r)) row[k] = displayValue(v);
    const l = lojas.get(id) ?? { id, meses: [], estados: {} };
    if (!l.meses.includes(chave)) { l.meses.push(chave); n++; }
    l.estados[chave] = ultimo.get(id)?.status ?? '';
    l.demo = row;                       // ficha do mês mais recente
    lojas.set(id, l);
  }
  // lojas que só estão no PAP (recolocadas sem External Id): também são lojas já visitadas
  const papFile = join(pasta, 'product_availability_price.csv');
  let nPap = 0;
  if (existsSync(papFile)) {
    const vistas = new Set(demo.map((r) => cleanId(r['Store No'])));
    for (const r of parseCsvText(readFileSync(papFile, 'utf8')).rows) {
      const id = cleanId(r.store_nu);
      if (!id || vistas.has(id)) continue;
      vistas.add(id);
      const row = { 'Store No': id, 'S.E.M. ID': displayValue(r.sem_id), 'Store Name': cleanText(r.store_name),
        Channel: cleanText(r.channel), Classification: cleanText(r.classification), Region: cleanText(r.region),
        Province: cleanText(r.province), District: cleanText(r.district), Neighborhood: cleanText(r.neighborhood),
        Category: cleanText(r.category), Market: cleanText(r.market), Dimension: cleanText(r.dimension),
        'Owner-Manager name': cleanText(r.owner_manager_name), 'Contact no.': displayValue(r.contact_no),
        StoreLatitude: displayValue(r.storelatitude), StoreLongitude: displayValue(r.storelongitude),
        'Date Modified': cleanText(r.survey_date) };
      const l = lojas.get(id) ?? { id, meses: [], estados: {} };
      if (!l.meses.includes(chave)) { l.meses.push(chave); n++; nPap++; }
      l.estados[chave] = ultimo.get(id)?.status ?? 'Audit done';
      if (!l.demo || !lojas.get(id)?.meses.some((m) => m !== chave)) l.demo = row;
      l.soPap = true;
      lojas.set(id, l);
    }
  }
  meses.push({ chave, nome: monthName(chave), lojas: n, soPap: nPap, fonte: pasta });
  console.log(`${monthName(chave)}: ${n} lojas (das quais ${nPap} só no PAP) (${pasta})`);
}
const out = { gerado: new Date().toISOString(), meses, lojas: [...lojas.values()] };
writeFileSync('dados_locais/lojas_referencia.json', JSON.stringify(out));
console.log(`OK: dados_locais/lojas_referencia.json — ${out.lojas.length} lojas distintas`);
