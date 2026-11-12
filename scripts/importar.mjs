// Importa uma pasta de relatórios pelo mesmo fluxo da app (criar -> partes -> validar -> publicar).
// Uso:
//   npm run importar -- --pasta "../Tangerine/WorkDay19/FReport19/CSV" --tipo referencia     (meses antigos: só lojas esperadas)
//   npm run importar -- --pasta "../Tangerine/WorkDay30/FReport30/CSV/November_csv" --extra "../Tangerine/WorkDay30/FReport30/QA_WD30.xlsx"
// Opções: --tipo mensal|referencia   --extra ficheiro (repetível)   --nao-publicar   --confirmar (aceita visitas removidas)
import { ligarDaConfig } from '../server/ligar.js';
import { lerPasta, importar } from '../server/importar.js';

const a = process.argv.slice(2);
const opt = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
const pasta = opt('--pasta');
if (!pasta) { console.error('Falta --pasta'); process.exit(1); }
const extra = a.flatMap((x, i) => (x === '--extra' ? [a[i + 1]] : []));
const db = await ligarDaConfig();
try {
  const admin = (await db.query(`SELECT * FROM utilizadores WHERE papel = 'admin' AND ativo ORDER BY criado_em LIMIT 1`)).rows[0];
  if (!admin) console.log('(ainda sem administrador: o carregamento fica sem autor)');
  const { entradas, nomes, ignorados } = lerPasta(pasta, { extra });
  console.log('Relatórios:', Object.entries(nomes).map(([k, v]) => `${k}=${v}`).join(' | '));
  if (ignorados.length) console.log('Ignorados:', ignorados.join(' | '));
  const r = await importar(db, admin, { entradas, nomes, tipo: opt('--tipo') ?? 'mensal', publicarNo: !a.includes('--nao-publicar'), confirmar: a.includes('--confirmar') });
  console.log(`OK: ${r.mes} — carregamento ${r.id} ${r.publicado ? 'PUBLICADO' : 'validado (não publicado)'}`);
  console.log(JSON.stringify(r.resumo.totais ?? { lojas: r.resumo.lojas }));
} catch (e) {
  console.error('Erro:', e.message, e.extra ? JSON.stringify(e.extra).slice(0, 500) : '');
  process.exitCode = 1;
} finally {
  await db.fechar();
}
