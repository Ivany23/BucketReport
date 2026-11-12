// Leitura dos relatórios (CSV ou XLSX) e identificação automática de cada um pelas colunas.
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

/** Os relatórios que a app conhece (ordem = ordem no ecrã de carregamento) */
export const REPORTS = {
  demographic: { nome: 'demographic_file', papel: 'Lojas: nome, província, GPS e todos os dados da loja', obrigatorio: true },
  visitDb: { nome: 'survey_visit_db', papel: 'Visitas e estado (Audit done / Audit not done)', obrigatorio: true },
  feedback: { nome: 'survey_feedback', papel: 'Motivo da visita (fechada, recusou…) e lojas visitadas só com feedback', obrigatorio: false },
  pap: { nome: 'product_availability_price', papel: 'Produtos e preços de cada visita + nome do auditor', obrigatorio: false },
  vq: { nome: 'Visibility_Quality', papel: 'Questionário de visibilidade e qualidade', obrigatorio: false },
  qa: { nome: 'QA_WD30.xlsx', papel: 'Nome exacto do auditor de todas as visitas (folha mapa_visitas_N)', obrigatorio: false },
  beatroute: { nome: 'Ficheiros brutos BeatRoute', papel: 'response-Feedback-Report / Survey: nomes dos auditores (pode juntar vários)', obrigatorio: false, varios: true },
};

/** Colunas que seguem para o servidor (null = todas). O resto dos ficheiros não é usado pela app. */
export const COLUNAS = {
  demographic: null,
  visitDb: null,
  feedback: null,
  pap: ['visit_nu', 'auditor_name', 'store_nu', 'sem_id', 'store_name', 'channel', 'classification', 'region', 'province',
    'district', 'neighborhood', 'category', 'market', 'sku', 'product', 'brand', 'on_shelf', 'out_of_stock', 'not_stocked',
    'unit_price', 'pack_price', 'validity', 'storelatitude', 'storelongitude', 'survey_date'],
  vq: ['visit_nu', 'store_nu', 'item', 'value', 'survey_date'],
  qa: ['visit_nu', 'User Name'],
  beatroute: ['submitted_by_name'],
};

/** Linhas prontas para enviar/guardar: só as colunas usadas; datas -> "AAAA-MM-DD"; vazios -> "" (JSON estável) */
export function prepararLinhas(tipo, rows, { todasColunas = false } = {}) {
  if (!(tipo in COLUNAS)) throw new Error(`relatório desconhecido: ${tipo}`);
  const cols = todasColunas ? null : COLUNAS[tipo];
  const val = (v) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) {
      const p = (n) => String(n).padStart(2, '0');
      return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
    }
    if (typeof v === 'number') return Number.isFinite(v) ? v : '';
    return String(v);
  };
  return rows.map((r) => {
    const o = {};
    for (const k of cols ?? Object.keys(r)) o[k] = val(r[k]);
    return o;
  });
}

const semBom = (t) => t.replace(/^﻿/, '');

/** Ficheiro bruto do BeatRoute: 1.ª linha = títulos agrupados, 2.ª = cabeçalho com submitted_by_name */
export function eBruto(text) {
  const l2 = semBom(text).split(/\r?\n/, 2)[1] ?? '';
  return l2.startsWith('response_br_id,') && l2.includes('submitted_by_name');
}

/** Linhas de um ficheiro bruto do BeatRoute (salta a 1.ª linha de títulos) */
export function parseBruto(text) {
  const t = semBom(text);
  return parseCsvText(t.slice(t.indexOf('\n') + 1)).rows;
}

const has = (cols, ...names) => names.every((n) => cols.includes(n));

/** Identifica o relatório pelas colunas. Devolve a chave de REPORTS, 'feedbackCleaned' ou null. */
export function detectReport(columns, fileName = '') {
  const c = columns.map((x) => semBom(String(x)).trim());
  if (has(c, 'visit_nu', 'User Name', 'sn')) return 'qa';
  if (has(c, 'Store No', 'StoreLatitude', 'StoreLongitude', 'Province')) return 'demographic';
  if (has(c, 'visit_nu', 'sku', 'on_shelf')) return 'pap';          // auditor_name só existe desde Outubro
  if (has(c, 'visit_nu', 'item', 'value', 'store_nu')) return 'vq';
  if (has(c, 'visit_nu', 'category', 'details', 'store_nu', 'shop_name')) {
    return /cleaned/i.test(fileName) ? 'feedbackCleaned' : 'feedback';
  }
  if (has(c, 'visit_nu', 'store_nu', 'survey_date', 'status')) return 'visitDb';
  return null;
}

function stripBom(rows) {
  return rows.map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) o[semBom(String(k)).trim()] = v;
    return o;
  });
}

/** CSV (texto) -> { columns, rows } */
export function parseCsvText(text) {
  const res = Papa.parse(semBom(text), { header: true, skipEmptyLines: 'greedy' });
  if (res.errors.length) {
    const e = res.errors[0];
    throw new Error(`CSV com erro${e.row !== undefined ? ` na linha ${e.row + 2}` : ''}: ${e.message}`);
  }
  return { columns: res.meta.fields.map((f) => semBom(f).trim()), rows: stripBom(res.data) };
}

/** XLSX (bytes) -> { columns, rows } da folha certa (QA: mapa_visitas_N; outros: a primeira) */
export function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheet = wb.SheetNames.includes('mapa_visitas_N') ? 'mapa_visitas_N' : wb.SheetNames[0];
  const ws = wb.Sheets[sheet];
  const header = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, blankrows: false })[0] ?? [];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  return { columns: header.map((h) => String(h).trim()), rows: stripBom(rows), sheet };
}

/** Lê um ficheiro do browser (File) e identifica-o */
export async function readReportFile(file) {
  const name = file.name;
  const ext = name.toLowerCase().split('.').pop();
  let parsed;
  if (ext === 'csv') {
    const text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
    if (eBruto(text)) {
      const rows = parseBruto(text);
      return { name, tipo: 'beatroute', columns: Object.keys(rows[0] ?? {}), rows, erro: null };
    }
    parsed = parseCsvText(text);
  } else if (ext === 'xlsx' || ext === 'xls') {
    parsed = parseWorkbook(new Uint8Array(await file.arrayBuffer()));
  } else {
    return { name, tipo: null, erro: 'formato não suportado (use CSV ou XLSX)' };
  }
  const tipo = detectReport(parsed.columns, name);
  return { name, tipo, columns: parsed.columns, rows: parsed.rows, erro: tipo ? null : 'não é um dos relatórios conhecidos' };
}
