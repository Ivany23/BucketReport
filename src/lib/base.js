// Dados fixos públicos da app: só o mapa das províncias (os dados das lojas vêm da API, com sessão).
import { makeLocator } from './provinces.js';

export async function carregarBase() {
  const r = await fetch(`${import.meta.env.BASE_URL}data/provincias_mz.geojson`);
  if (!r.ok) throw new Error(`não foi possível ler o mapa das províncias (${r.status})`);
  const provincias = await r.json();
  return { provincias, locate: makeLocator(provincias) };
}
