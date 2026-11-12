// Cria / actualiza as tabelas e carrega a lista inicial de auditores. Pode correr várias vezes (idempotente).
// Uso: npm run migrar      (lê DATABASE_URL ou PGLITE_DIR do .env)
import { readFileSync, existsSync } from 'node:fs';
import { migrar } from '../server/db.js';
import { ligarDaConfig } from '../server/ligar.js';

const db = await ligarDaConfig();
const novas = await migrar(db);
console.log(novas.length ? `Migrações aplicadas: ${novas.join(', ')}` : 'Base de dados já actualizada.');
let n = 0;
const seed = 'db/seed/auditores.json';      // fica só no computador (não vai para o GitHub público)
for (const a of existsSync(seed) ? JSON.parse(readFileSync(seed, 'utf8')).auditores : []) {
  n += (await db.query('INSERT INTO auditores (nome, iniciais) VALUES ($1, $2) ON CONFLICT (nome) DO NOTHING RETURNING nome', [a.nome, a.iniciais])).rows.length;
}
console.log(`Auditores novos: ${n}`);
await db.fechar();
