// Chaves da API de dados. Formato: hk_<43 caracteres aleatórios>. Só o sha256 fica na base de dados;
// a chave completa é mostrada UMA vez, ao criar. Uma chave revogada deixa de funcionar imediatamente.
import { randomBytes } from 'node:crypto';
import { ErroHttp, sha256, registar } from './auth.js';

export async function criarChave(db, user, nome) {
  nome = String(nome ?? '').trim();
  if (!nome) throw new ErroHttp(400, 'Dê um nome à chave (ex.: "Power BI — Equipa comercial")');
  if (nome.length > 120) throw new ErroHttp(400, 'Nome demasiado longo');
  const chave = `hk_${randomBytes(32).toString('base64url')}`;
  const r = (await db.query(
    `INSERT INTO api_chaves (nome, prefixo, chave_hash, criada_por) VALUES ($1, $2, $3, $4)
     RETURNING id, nome, prefixo, criada_em`, [nome, chave.slice(0, 10), sha256(chave), user.id])).rows[0];
  await registar(db, user.id, 'criar_chave_api', { id: r.id, nome });
  return { ...r, chave };
}

export async function listarChaves(db) {
  return (await db.query(
    `SELECT k.id, k.nome, k.prefixo, k.criada_em, k.revogada_em, k.ultimo_uso, k.usos, u.nome AS criada_por_nome
       FROM api_chaves k LEFT JOIN utilizadores u ON u.id = k.criada_por ORDER BY k.criada_em DESC`)).rows;
}

export async function revogarChave(db, user, id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new ErroHttp(404, 'Chave não encontrada');
  const r = await db.query('UPDATE api_chaves SET revogada_em = now() WHERE id = $1 AND revogada_em IS NULL RETURNING nome', [id]);
  if (!r.rows.length) throw new ErroHttp(404, 'Chave não encontrada ou já revogada');
  await registar(db, user.id, 'revogar_chave_api', { id, nome: r.rows[0].nome });
  return { ok: true };
}

/** Lê a chave do pedido: cabeçalho X-API-Key, "Authorization: Bearer ..." ou parâmetro api_key (Power BI) */
export function chaveDoPedido(req, query) {
  const h = req.headers;
  const bearer = /^Bearer\s+(\S+)$/i.exec(String(h.authorization ?? ''))?.[1];
  return String(h['x-api-key'] ?? bearer ?? query.get('api_key') ?? '').trim();
}

export async function autenticarChave(db, req, query) {
  const chave = chaveDoPedido(req, query);
  if (!chave) throw new ErroHttp(401, 'Falta a chave da API (cabeçalho X-API-Key ou parâmetro api_key)');
  if (!/^hk_[A-Za-z0-9_-]{43}$/.test(chave)) throw new ErroHttp(401, 'Chave da API inválida');
  const r = (await db.query(
    `UPDATE api_chaves SET ultimo_uso = now(), usos = usos + 1
      WHERE chave_hash = $1 AND revogada_em IS NULL RETURNING id, nome`, [sha256(chave)])).rows[0];
  if (!r) throw new ErroHttp(401, 'Chave da API inválida ou revogada');
  return { chave: r };
}
