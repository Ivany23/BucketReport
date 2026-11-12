// Vercel: única função da API. vercel.json reencaminha /api/* para aqui (?rota=...).
import { tratar } from '../server/router.js';

export default function handler(req, res) {
  return tratar(req, res);
}
