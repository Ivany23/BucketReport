// Preparação do envio de um carregamento (usado pelo browser, pelo importador e pelos testes — mesmo código).
//
// Cada relatório segue como { colunas: [...pela ordem do ficheiro], linhas: [[v1, v2, ...], ...] }, todos os valores
// em TEXTO (igual venha de CSV ou XLSX). Os 5 relatórios do cliente seguem COMPLETOS (para a API de dados);
// o QA e os ficheiros brutos do BeatRoute só com as colunas que a app usa.
import { COLUNAS, REPORTS } from './reports.js';

export const BYTES_PARTE = 1_200_000;   // ~1,2 MB de JSON por pedido (a Vercel aceita até 4,5 MB)
export const MAX_LINHAS = 20000;

/** Relatórios guardados completos e servidos pela API de dados (tipo interno -> nome do relatório) */
export const TABELAS_API = ['demographic', 'visitDb', 'feedback', 'pap', 'vq'];
export const nomeTabela = (tipo) => REPORTS[tipo].nome;

/** Valor -> texto estável: vazio -> "", data -> "AAAA-MM-DD", número -> como o JavaScript o escreve */
export function texto(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return String(v);
}

/** Divide as linhas em partes de ~1,2 MB (JSON), mantendo a ordem. Devolve sempre pelo menos 1 parte. */
export function dividirEmPartes(rows, bytes = BYTES_PARTE) {
  const partes = [];
  let atual = [], tam = 2;
  for (const r of rows) {
    const t = JSON.stringify(r).length + 1;
    if (atual.length && (tam + t > bytes || atual.length >= MAX_LINHAS)) {
      partes.push(atual);
      atual = []; tam = 2;
    }
    atual.push(r); tam += t;
  }
  partes.push(atual);
  return partes;
}

/** Linhas em listas -> objetos { coluna: valor } (para o modelo) */
export function paraObjetos(colunas, linhas) {
  return linhas.map((l) => {
    const o = {};
    for (let i = 0; i < colunas.length; i++) o[colunas[i]] = l[i];
    return o;
  });
}

/**
 * @param entradas { tipo: { colunas: [cabeçalho do ficheiro], rows: [objetos lidos] } }
 * @returns { ficheiros: [{ tipo, colunas, linhas, partes }], partes: { tipo: [[linha, ...], ...] }, objetos: { tipo: [...] } }
 */
export function prepararEnvio(entradas, nomes = {}) {
  const ficheiros = [], partes = {}, objetos = {};
  for (const [tipo, { colunas: cab, rows }] of Object.entries(entradas)) {
    if (!(tipo in COLUNAS)) throw new Error(`relatório desconhecido: ${tipo}`);
    const colunas = TABELAS_API.includes(tipo) ? [...(cab?.length ? cab : Object.keys(rows[0] ?? {}))] : COLUNAS[tipo];
    if (new Set(colunas).size !== colunas.length) throw new Error(`${REPORTS[tipo].nome}: colunas com nome repetido`);
    const linhas = rows.map((r) => colunas.map((c) => texto(r[c])));
    partes[tipo] = dividirEmPartes(linhas);
    objetos[tipo] = paraObjetos(colunas, linhas);
    const n = nomes[tipo];
    ficheiros.push({ tipo, nome: Array.isArray(n) ? n.join(', ') : n ?? tipo, colunas, linhas: linhas.length, partes: partes[tipo].length });
  }
  return { ficheiros, partes, objetos };
}
