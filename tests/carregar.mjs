// Carrega os relatórios do mês a partir de uma pasta (como a app faz no browser) — usado pelos testes e pelo verificar.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvText, parseWorkbook, detectReport } from '../src/lib/reports.js';
import { buildModel } from '../src/lib/model.js';
import { makeLocator } from '../src/lib/provinces.js';

export const DADOS = process.env.HEINEKEN_DADOS ?? '../Tangerine/WorkDay30/FReport30';

export function lerPasta(pasta) {
  if (!existsSync(pasta)) throw new Error(`pasta não encontrada: ${pasta}`);
  const rep = {};
  const ignorados = [];
  for (const f of readdirSync(pasta)) {
    const ext = f.toLowerCase().split('.').pop();
    if (!['csv', 'xlsx'].includes(ext)) continue;
    const p = ext === 'csv' ? parseCsvText(readFileSync(join(pasta, f), 'utf8')) : parseWorkbook(new Uint8Array(readFileSync(join(pasta, f))));
    const tipo = detectReport(p.columns, f);
    if (!tipo || tipo === 'feedbackCleaned' || rep[tipo]) { ignorados.push(`${f} (${tipo ?? 'desconhecido'})`); continue; }
    rep[tipo] = p.rows;
  }
  return { rep, ignorados };
}

export const geoSimples = () => JSON.parse(readFileSync('public/data/provincias_mz.geojson', 'utf8'));
export function geoCompleto() {
  const g = JSON.parse(readFileSync('scripts/fontes/moz_admin1.geojson', 'utf8'));
  g.features = g.features.map((f) => ({ ...f, properties: { nome: f.properties.adm1_name } }));
  return g;
}
export const referencia = () => JSON.parse(readFileSync('dados_locais/lojas_referencia.json', 'utf8'));

export function modelo(pasta, { comQA = true } = {}) {
  const { rep, ignorados } = lerPasta(pasta);
  if (comQA) {
    const qa = join(DADOS, 'QA_WD30.xlsx');
    if (existsSync(qa)) rep.qa = parseWorkbook(new Uint8Array(readFileSync(qa))).rows;
  }
  const lista = JSON.parse(readFileSync('db/seed/auditores.json', 'utf8')).auditores;
  return { m: buildModel(rep, referencia(), makeLocator(geoSimples()), lista), rep, ignorados };
}
