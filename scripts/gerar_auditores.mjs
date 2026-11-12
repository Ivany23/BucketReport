// Gera db/seed/auditores.json = nome + iniciais de cada auditor do mês, a partir dos ficheiros BRUTOS do
// BeatRoute (Feedback Report e Heineken Retail Audit Survey: coluna submitted_by_name).
// Serve para dar nome a iniciais que nunca aparecem com nome nos relatórios (ex.: um auditor que só registou feedback).
// Uso: npm run gerar-auditores            (pasta e mês por omissão: Downloads, Nov2026)
//      npm run gerar-auditores -- "C:\pasta" Dez2026
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseCsvText } from '../src/lib/reports.js';
import { auditorInitials } from '../src/lib/normalize.js';

const pasta = process.argv[2] ?? join(homedir(), 'Downloads');
const mes = process.argv[3] ?? 'Nov2026';
const OUT = 'db/seed/auditores.json';
const ficheiros = readdirSync(pasta).filter((f) => /^response-(Feedback-Report|Heineken-Retail-Audit-Survey)-.*\.csv$/.test(f) && f.includes(mes));
if (!ficheiros.length) throw new Error(`nenhum ficheiro response-*${mes}*.csv em ${pasta}`);
const nomes = new Map();
for (const f of ficheiros) {
  const txt = readFileSync(join(pasta, f), 'utf8').replace(/^\ufeff/, '');
  const { rows } = parseCsvText(txt.slice(txt.indexOf('\n') + 1));   // 1.ª linha = título do BeatRoute
  for (const r of rows) {
    const n = String(r.submitted_by_name ?? '').trim().replace(/\s+/g, ' ');
    if (n) nomes.set(n, auditorInitials(n));
  }
  console.log(`${f}: ${rows.length} respostas`);
}
const antes = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).auditores : [];
for (const a of antes) if (!nomes.has(a.nome)) nomes.set(a.nome, a.iniciais);   // nunca apaga nomes já conhecidos
const auditores = [...nomes].map(([nome, iniciais]) => ({ nome, iniciais })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt'));
writeFileSync(OUT, JSON.stringify({ gerado: new Date().toISOString(), fonte: ficheiros, auditores }, null, 1));
const rep = auditores.reduce((m, a) => m.set(a.iniciais, [...(m.get(a.iniciais) ?? []), a.nome]), new Map());
console.log(`OK: ${OUT} — ${auditores.length} auditores; iniciais repetidas:`, [...rep].filter(([, v]) => v.length > 1));
