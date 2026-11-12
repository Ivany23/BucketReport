// Normalização dos valores lidos de CSV (texto) e XLSX (números / datas) para que os dois formatos
// produzam exactamente o mesmo resultado.

/** ID como texto: 23724 / "23724.0" / " 23724 " -> "23724"; vazio -> "" */
export function cleanId(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return '';
    return Number.isInteger(v) ? String(v) : String(v).replace(/\.0+$/, '');
  }
  return String(v).trim().replace(/\.0+$/, '');
}

/** Texto limpo (null/undefined -> "") */
export function cleanText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return isoDate(v);
  return String(v).trim();
}

/** Número ou null */
export function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function isoDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Data -> "AAAA-MM-DD". order = ordem dos campos no texto de ESTE relatório:
 *   'dmy' (2/11/2026), 'mdy' (11/3/2026 no Visibility_Quality), 'ymd' (2026-11-02)
 * Devolve "" se o valor estiver vazio; lança erro se não for uma data válida (nunca adivinha).
 */
export function parseDate(v, order) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return isoDate(v);
  const s = String(v).trim().slice(0, 10);
  if (!s) return '';
  // AAAA-MM-DD é inequívoco em qualquer relatório (ex.: datas de XLSX convertidas para texto antes do envio)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && order !== 'ymd') return parseDate(s, 'ymd');
  const parts = s.split(/[/-]/).map((x) => Number(x));
  if (parts.length !== 3 || parts.some((x) => !Number.isInteger(x))) throw new Error(`data inválida: "${v}"`);
  let y, m, d;
  if (order === 'ymd') [y, m, d] = parts;
  else if (order === 'dmy') [d, m, y] = parts;
  else if (order === 'mdy') [m, d, y] = parts;
  else throw new Error(`ordem de data desconhecida: ${order}`);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) throw new Error(`data inválida: "${v}" (${order})`);
  return isoDate(dt);
}

/** "2026-11-02" -> "02/11/2026" */
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Remove acentos e põe em minúsculas (para comparar nomes) */
export function fold(s) {
  return cleanText(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Iniciais do auditor no início do visit_nu: "NCM2026..." -> "NCM", "AJC - Survey - 1" -> "AJC" */
export function initialsOf(visitNu) {
  const m = /^([A-Za-z]+)/.exec(cleanText(visitNu));
  return m ? m[1].toUpperCase() : '';
}

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro',
  'Outubro', 'Novembro', 'Dezembro'];

/** "2026-11" -> "Novembro 2026" */
export function monthName(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MESES[m - 1]} ${y}`;
}

/** "2026-11" -> "Nov" */
export function monthShort(key) {
  return monthName(key).slice(0, 3);
}

/** Iniciais como no pipeline (P.initials): 1.ª letra das 3 primeiras palavras -> "Ana Maria dos Santos" = "AMD" */
export function auditorInitials(nome) {
  return cleanText(nome).split(/\s+/).filter((w) => /^\p{L}/u.test(w)).map((w) => w[0].toUpperCase()).join('').slice(0, 3);
}
