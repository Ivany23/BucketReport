// Autenticação: palavras-passe com scrypt (sal aleatório), sessão = token aleatório num cookie httpOnly;
// na base de dados fica só o sha256 do token. Bloqueio após 10 tentativas falhadas em 15 minutos.
import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(_scrypt);
const N = 16384, R = 8, P = 1, KEYLEN = 64;
export const SESSAO_HORAS = 12;
export const COOKIE = 'sessao';
const MAX_TENTATIVAS = 10;

export class ErroHttp extends Error {
  constructor(status, mensagem, extra) { super(mensagem); this.status = status; this.extra = extra; }
}

export function validarSenha(senha) {
  if (typeof senha !== 'string' || senha.length < 10) throw new ErroHttp(400, 'A palavra-passe tem de ter pelo menos 10 caracteres');
  if (senha.length > 200) throw new ErroHttp(400, 'Palavra-passe demasiado longa');
}

export async function hashSenha(senha) {
  validarSenha(senha);
  const sal = randomBytes(16);
  const h = await scrypt(senha, sal, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${h.toString('base64')}`;
}

export async function verificarSenha(senha, guardado) {
  const [alg, n, r, p, sal, h] = String(guardado).split('$');
  if (alg !== 'scrypt' || typeof senha !== 'string') return false;
  const esperado = Buffer.from(h, 'base64');
  const obtido = await scrypt(senha, Buffer.from(sal, 'base64'), esperado.length, { N: +n, r: +r, p: +p });
  return obtido.length === esperado.length && timingSafeEqual(obtido, esperado);
}

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const normEmail = (e) => String(e ?? '').trim().toLowerCase();

/** Entrar: devolve { token, utilizador } ou lança 401/429 */
export async function entrar(db, email, senha) {
  email = normEmail(email);
  const n = (await db.query(`SELECT count(*)::int AS n FROM tentativas_login WHERE email = $1 AND quando > now() - interval '15 minutes'`, [email])).rows[0].n;
  if (n >= MAX_TENTATIVAS) throw new ErroHttp(429, 'Demasiadas tentativas. Espere 15 minutos.');
  const u = (await db.query('SELECT * FROM utilizadores WHERE email = $1', [email])).rows[0];
  // compara sempre (mesmo sem utilizador) para não revelar quais emails existem pelo tempo de resposta
  const ok = await verificarSenha(String(senha ?? ''), u?.senha_hash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + 'A'.repeat(86) + '==');
  if (!u || !ok || !u.ativo) {
    await db.query('INSERT INTO tentativas_login (email) VALUES ($1)', [email]);
    throw new ErroHttp(401, 'Email ou palavra-passe errados');
  }
  await db.query('DELETE FROM tentativas_login WHERE email = $1 OR quando < now() - interval \'1 day\'', [email]);
  await db.query('DELETE FROM sessoes WHERE expira_em < now()');
  const token = randomBytes(32).toString('base64url');
  await db.query(`INSERT INTO sessoes (token_hash, utilizador_id, expira_em) VALUES ($1, $2, now() + interval '${SESSAO_HORAS} hours')`, [sha256(token), u.id]);
  await registar(db, u.id, 'entrar', {});
  return { token, utilizador: publico(u) };
}

export async function sair(db, token) {
  if (token) await db.query('DELETE FROM sessoes WHERE token_hash = $1', [sha256(token)]);
}

/** Utilizador da sessão (ou null) */
export async function sessao(db, token) {
  if (!token) return null;
  const u = (await db.query(
    `SELECT u.* FROM sessoes s JOIN utilizadores u ON u.id = s.utilizador_id
     WHERE s.token_hash = $1 AND s.expira_em > now() AND u.ativo`, [sha256(token)])).rows[0];
  return u ? publico(u) : null;
}

export const publico = (u) => ({ id: u.id, email: u.email, nome: u.nome, papel: u.papel, ativo: u.ativo });

export async function criarUtilizador(db, { email, nome, papel, senha }, porId = null) {
  email = normEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ErroHttp(400, 'Email inválido');
  if (!String(nome ?? '').trim()) throw new ErroHttp(400, 'Falta o nome');
  if (!['admin', 'leitor'].includes(papel)) throw new ErroHttp(400, 'Papel inválido (admin ou leitor)');
  const h = await hashSenha(senha);
  try {
    const u = (await db.query('INSERT INTO utilizadores (email, nome, papel, senha_hash) VALUES ($1, $2, $3, $4) RETURNING *',
      [email, String(nome).trim(), papel, h])).rows[0];
    await registar(db, porId, 'criar_utilizador', { email, papel });
    return publico(u);
  } catch (e) {
    if (String(e.message).includes('utilizadores_email_key') || e.code === '23505') throw new ErroHttp(409, 'Já existe um utilizador com esse email');
    throw e;
  }
}

export async function alterarUtilizador(db, id, { nome, papel, ativo, senha }, porId) {
  const u = (await db.query('SELECT * FROM utilizadores WHERE id = $1', [id])).rows[0];
  if (!u) throw new ErroHttp(404, 'Utilizador não encontrado');
  if (id === porId && (ativo === false || (papel && papel !== 'admin'))) throw new ErroHttp(400, 'Não pode desactivar nem tirar admin a si próprio');
  if (papel && !['admin', 'leitor'].includes(papel)) throw new ErroHttp(400, 'Papel inválido');
  const h = senha ? await hashSenha(senha) : u.senha_hash;
  const r = (await db.query(`UPDATE utilizadores SET nome = $2, papel = $3, ativo = $4, senha_hash = $5 WHERE id = $1 RETURNING *`,
    [id, nome?.trim() || u.nome, papel ?? u.papel, ativo ?? u.ativo, h])).rows[0];
  if (senha || ativo === false) await db.query('DELETE FROM sessoes WHERE utilizador_id = $1', [id]);
  await registar(db, porId, 'alterar_utilizador', { email: u.email, papel: r.papel, ativo: r.ativo, senha: Boolean(senha) });
  return publico(r);
}

export async function registar(db, utilizadorId, acao, detalhe) {
  await db.query('INSERT INTO registo (utilizador_id, acao, detalhe) VALUES ($1, $2, $3::jsonb)', [utilizadorId, acao, JSON.stringify(detalhe)]);
}
