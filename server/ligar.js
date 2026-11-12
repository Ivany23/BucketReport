// Escolhe a base de dados: DATABASE_URL (Neon / PostgreSQL) ou PGLITE_DIR (base local numa pasta, para testar).
import { ligarPg, ligarPglite, definirDb } from './db.js';

export async function ligarDaConfig() {
  let db;
  if (process.env.DATABASE_URL) db = await ligarPg(process.env.DATABASE_URL);
  else if (process.env.PGLITE_DIR) db = await ligarPglite(process.env.PGLITE_DIR);
  else throw new Error('Defina DATABASE_URL (Neon) ou PGLITE_DIR (base local) no ficheiro .env');
  definirDb(db);
  return db;
}
