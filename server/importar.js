// Ler relatórios de uma pasta (Node) e enviá-los pelo MESMO fluxo que o browser usa:
// criar -> partes (com sha256) -> validar (com assinatura calculada localmente) -> publicar.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvText, parseWorkbook, detectReport, eBruto, parseBruto } from '../src/lib/reports.js';
import { prepararEnvio } from '../src/lib/envio.js';
import { buildModel } from '../src/lib/model.js';
import { mesDosRelatorios, juntarAuditores } from '../src/lib/referencia.js';
import { assinaturaDe } from '../src/lib/assinatura.js';
import { sha256 } from './auth.js';
import * as C from './carregamentos.js';

/**
 * Lê todos os relatórios de uma pasta (e subpastas) + ficheiros extra.
 * @returns { entradas: { tipo: { colunas, rows } }, nomes, ignorados }
 */
export function lerPasta(pasta, { extra = [] } = {}) {
  if (!existsSync(pasta)) throw new Error(`pasta não encontrada: ${pasta}`);
  const ficheiros = [];
  const andar = (p) => {
    for (const f of readdirSync(p).sort()) {
      const c = join(p, f);
      if (statSync(c).isDirectory()) andar(c);
      else if (/\.(csv|xlsx)$/i.test(f)) ficheiros.push(c);
    }
  };
  andar(pasta);
  const entradas = {};
  const nomes = {};
  const ignorados = [];
  for (const c of [...ficheiros, ...extra]) {
    const f = c.split(/[\\/]/).pop();
    let tipo, rows, colunas;
    if (/\.csv$/i.test(f)) {
      const t = readFileSync(c, 'utf8');
      if (eBruto(t)) { tipo = 'beatroute'; rows = parseBruto(t); colunas = Object.keys(rows[0] ?? {}); } else {
        const p = parseCsvText(t); tipo = detectReport(p.columns, f); rows = p.rows; colunas = p.columns;
      }
    } else {
      const p = parseWorkbook(new Uint8Array(readFileSync(c)));
      tipo = detectReport(p.columns, f); rows = p.rows; colunas = p.columns;
    }
    if (tipo === 'beatroute') {
      entradas.beatroute = { colunas, rows: [...(entradas.beatroute?.rows ?? []), ...rows] };
      (nomes.beatroute ??= []).push(f);
      continue;
    }
    if (!tipo || tipo === 'feedbackCleaned' || entradas[tipo]) { ignorados.push(`${f} (${tipo ?? 'desconhecido'})`); continue; }
    entradas[tipo] = { colunas, rows };
    nomes[tipo] = f;
  }
  return { entradas, nomes, ignorados };
}

/** Envia relatórios (já lidos) pelo fluxo completo, directamente sobre a base de dados */
export async function importar(db, user, { entradas, nomes = {}, tipo = 'mensal', publicarNo = true, confirmar = false }) {
  const env = prepararEnvio(entradas, nomes);
  const mes = mesDosRelatorios(env.objetos.visitDb);
  const { id } = await C.criar(db, user, { mes, tipo, ficheiros: env.ficheiros });
  for (const [k, ps] of Object.entries(env.partes)) {
    for (let i = 0; i < ps.length; i++) {
      await C.receberParte(db, user, id, { relatorio: k, parte: i, total_partes: ps.length, linhas: ps[i].length, sha256: sha256(JSON.stringify(ps[i])), dados: ps[i] });
    }
  }
  let assinatura;
  if (tipo === 'mensal') {
    const referencia = await C.referenciaPara(db, mes);
    const m = buildModel(env.objetos, referencia, C.geoProvincias().locate, juntarAuditores(await C.auditoresBase(db), env.objetos.beatroute));
    assinatura = await assinaturaDe(m);
  }
  const resumo = await C.validar(db, user, id, { assinatura });
  const pub = publicarNo ? await C.publicar(db, user, id, { confirmar }) : null;
  return { id, mes, resumo, publicado: pub };
}
