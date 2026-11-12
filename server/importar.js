// Ler relatórios de uma pasta (Node) e enviá-los pelo MESMO fluxo que o browser usa:
// criar -> partes (com sha256) -> validar (com assinatura calculada localmente) -> publicar.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvText, parseWorkbook, detectReport, eBruto, parseBruto, prepararLinhas } from '../src/lib/reports.js';
import { dividirEmPartes } from '../src/lib/envio.js';
import { buildModel } from '../src/lib/model.js';
import { mesDosRelatorios, juntarAuditores } from '../src/lib/referencia.js';
import { assinaturaDe } from '../src/lib/assinatura.js';
import { sha256 } from './auth.js';
import * as C from './carregamentos.js';

/** Lê todos os relatórios de uma pasta (e subpastas). Ficheiros repetidos/duplicados são ignorados e listados. */
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
  const rep = {};
  const nomes = {};
  const ignorados = [];
  for (const c of [...ficheiros, ...extra]) {
    const f = c.split(/[\\/]/).pop();
    let tipo, rows;
    if (/\.csv$/i.test(f)) {
      const t = readFileSync(c, 'utf8');
      if (eBruto(t)) { tipo = 'beatroute'; rows = parseBruto(t); } else { const p = parseCsvText(t); tipo = detectReport(p.columns, f); rows = p.rows; }
    } else {
      const p = parseWorkbook(new Uint8Array(readFileSync(c)));
      tipo = detectReport(p.columns, f); rows = p.rows;
    }
    if (tipo === 'beatroute') { rep.beatroute = [...(rep.beatroute ?? []), ...rows]; (nomes.beatroute ??= []).push(f); continue; }
    if (!tipo || tipo === 'feedbackCleaned' || rep[tipo]) { ignorados.push(`${f} (${tipo ?? 'desconhecido'})`); continue; }
    rep[tipo] = rows;
    nomes[tipo] = f;
  }
  return { rep, nomes, ignorados };
}

/** Envia relatórios (já lidos) pelo fluxo completo, directamente sobre a base de dados */
export async function importar(db, user, { rep, nomes = {}, tipo = 'mensal', publicarNo = true, confirmar = false }) {
  const prep = {};
  for (const [k, rows] of Object.entries(rep)) prep[k] = prepararLinhas(k, rows, { todasColunas: tipo === 'referencia' });
  const mes = mesDosRelatorios(prep.visitDb);
  const partes = Object.fromEntries(Object.entries(prep).map(([k, rows]) => [k, dividirEmPartes(rows)]));
  const { id } = await C.criar(db, user, {
    mes, tipo,
    ficheiros: Object.entries(prep).map(([k, rows]) => ({ tipo: k, nome: Array.isArray(nomes[k]) ? nomes[k].join(', ') : nomes[k] ?? k, linhas: rows.length, partes: partes[k].length })),
  });
  for (const [k, ps] of Object.entries(partes)) {
    for (let i = 0; i < ps.length; i++) {
      await C.receberParte(db, user, id, { relatorio: k, parte: i, total_partes: ps.length, linhas: ps[i].length, sha256: sha256(JSON.stringify(ps[i])), dados: ps[i] });
    }
  }
  let assinatura;
  if (tipo === 'mensal') {
    const referencia = await C.referenciaPara(db, mes);
    const m = buildModel(prep, referencia, C.geoProvincias().locate, juntarAuditores(await C.auditoresBase(db), prep.beatroute));
    assinatura = await assinaturaDe(m);
  }
  const resumo = await C.validar(db, user, id, { assinatura });
  const pub = publicarNo ? await C.publicar(db, user, id, { confirmar }) : null;
  return { id, mes, resumo, publicado: pub };
}
