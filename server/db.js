// Acesso à base de dados. Interface única para o resto do servidor:
//   db.query(sql, params) -> { rows }      db.transacao(async (t) => { await t.query(...) })
// Produção (Vercel -> Neon): pg Pool com DATABASE_URL. Testes: PGlite (PostgreSQL real em memória).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

let atual = null;

/** Adaptador sobre node-postgres (Neon) */
export async function ligarPg(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL não definido');
  const { default: pg } = await import('pg');
  // aceita também o formato JDBC (jdbc:postgresql://host/db?user=..&password=..)
  const u = new URL(url.replace(/^jdbc:/, '').replace(/^postgres:/, 'postgresql:'));
  if (u.searchParams.get('user')) { u.username = u.searchParams.get('user'); u.searchParams.delete('user'); }
  if (u.searchParams.get('password')) { u.password = u.searchParams.get('password'); u.searchParams.delete('password'); }
  // os parâmetros de TLS do endereço sobrepor-se-iam à configuração abaixo: a TLS é definida só aqui
  for (const p of ['sslmode', 'channel_binding', 'channelBinding', 'ssl']) u.searchParams.delete(p);
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  // Neon / Neon exigem TLS; o certificado é validado (PGSSL_VERIFY=0 desliga a validação, só se for preciso)
  const ssl = local ? false : { rejectUnauthorized: process.env.PGSSL_VERIFY !== '0' };
  const pool = new pg.Pool({ connectionString: u.toString(), ssl, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 15_000 });
  return {
    query: (sql, params) => pool.query(sql, params),
    async transacao(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const r = await fn({ query: (sql, params) => c.query(sql, params) });
        await c.query('COMMIT');
        return r;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
    fechar: () => pool.end(),
  };
}

/** Adaptador sobre PGlite (testes e demonstração local sem servidor de base de dados) */
export async function ligarPglite(pasta) {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = pasta ? new PGlite(pasta) : new PGlite();
  await pg.waitReady;
  const q = (exec) => async (sql, params = []) => {
    const r = await exec.query(sql, params);
    return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length };
  };
  return {
    query: q(pg),
    transacao: (fn) => pg.transaction((tx) => fn({ query: q(tx) })),
    fechar: () => pg.close(),
  };
}

export function definirDb(db) { atual = db; }

/** Ligação partilhada (reutilizada entre pedidos na mesma instância da função) */
export async function getDb() {
  if (!atual) atual = await ligarPg();
  return atual;
}

/** Aplica as migrações em db/migracoes que ainda não foram aplicadas (ordem alfabética, cada uma numa transacção) */
export async function migrar(db, pasta = join(process.cwd(), 'db', 'migracoes')) {
  await db.query(`CREATE TABLE IF NOT EXISTS migracoes (nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`);
  const feitas = new Set((await db.query('SELECT nome FROM migracoes')).rows.map((r) => r.nome));
  const novas = [];
  for (const f of readdirSync(pasta).filter((x) => x.endsWith('.sql')).sort()) {
    if (feitas.has(f)) continue;
    const sql = readFileSync(join(pasta, f), 'utf8');
    await db.transacao(async (t) => {
      for (const cmd of dividirSql(sql)) await t.query(cmd);
      await t.query('INSERT INTO migracoes (nome) VALUES ($1)', [f]);
    });
    novas.push(f);
  }
  return novas;
}

/** Divide um ficheiro .sql em comandos (sem funções com $$ — não usadas aqui) */
function dividirSql(sql) {
  return sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);
}

/** bytea -> Buffer (pg devolve Buffer, PGlite devolve Uint8Array) */
export const buf = (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v));
