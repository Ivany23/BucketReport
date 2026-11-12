// Servidor local: a mesma API da Vercel + a app React (Vite) em http://127.0.0.1:5173
// Uso: npm run dev     (lê .env: DATABASE_URL do Render, ou PGLITE_DIR para uma base local)
import http from 'node:http';
import { createServer as criarVite } from 'vite';
import { tratar } from './router.js';
import { ligarDaConfig } from './ligar.js';
import { migrar } from './db.js';

process.env.COOKIE_INSEGURO = '1';            // http local (sem https)
const db = await ligarDaConfig();
await migrar(db);
const vite = await criarVite({ server: { middlewareMode: true }, appType: 'spa' });
const porta = Number(process.env.PORT ?? 5173);
http.createServer((req, res) => {
  if (req.url.startsWith('/api/') || req.url === '/api') return tratar(req, res);
  vite.middlewares(req, res);
}).listen(porta, '127.0.0.1', () => console.log(`Mapa de Lojas: http://127.0.0.1:${porta}`));
