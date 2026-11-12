// Províncias: nomes dos relatórios <-> nomes do mapa oficial (OCHA) e localização de um ponto GPS.
import { fold } from './normalize.js';

/** As 11 províncias do mapa, de norte para sul (ordem usada nas listas) */
export const PROVINCIAS = ['Niassa', 'Cabo Delgado', 'Nampula', 'Zambézia', 'Tete', 'Manica', 'Sofala',
  'Inhambane', 'Gaza', 'Maputo', 'Cidade de Maputo'];

/** Nome no relatório (Province / province) -> nome no mapa. Comparação sem acentos nem maiúsculas. */
const ALIASES = {
  'maputo (city)': 'Cidade de Maputo',
  'maputo city': 'Cidade de Maputo',
  'cidade de maputo': 'Cidade de Maputo',
  'maputo cidade': 'Cidade de Maputo',
  'maputo (cidade)': 'Cidade de Maputo',
  'maputo (province)': 'Maputo',
  'maputo province': 'Maputo',
  'maputo provincia': 'Maputo',
  'maputo (provincia)': 'Maputo',
  'provincia de maputo': 'Maputo',
  maputo: 'Maputo',
};
for (const p of PROVINCIAS) ALIASES[fold(p)] ??= p;

/** "Maputo (City)" -> "Cidade de Maputo"; "Zambézia"/"Zambezia" -> "Zambézia"; desconhecido -> "" */
export function provinceFromReport(name) {
  return ALIASES[fold(name)] ?? '';
}

// ---------- geometria ----------
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** polígono GeoJSON (anel exterior + buracos) */
function inPolygon(x, y, rings) {
  if (!inRing(x, y, rings[0])) return false;
  for (let k = 1; k < rings.length; k++) if (inRing(x, y, rings[k])) return false;
  return true;
}

function polygonsOf(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  throw new Error(`geometria não suportada: ${geom.type}`);
}

/** distância aproximada (km) de um ponto a um segmento, em projecção local equirectangular */
function segDistKm(lon, lat, a, b) {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.57;
  const ax = (a[0] - lon) * kx, ay = (a[1] - lat) * ky, bx = (b[0] - lon) * kx, by = (b[1] - lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const px = ax + t * dx, py = ay + t * dy;
  return Math.sqrt(px * px + py * py);
}

/** Tolerância da costa: o mapa simplificado corta alguns metros da linha de costa / baías */
export const COSTA_KM = 3;

/**
 * Cria a função locate(lat, lon) a partir do GeoJSON das províncias.
 * Devolve { provincia, estado: 'dentro' | 'costa' | 'fora', km } :
 *   dentro = ponto dentro do polígono; costa = fora de todos mas a <= COSTA_KM de uma província
 *   (ex.: loja à beira-mar); fora = fora de Moçambique (km = distância à província mais próxima)
 */
export function makeLocator(geojson) {
  const shapes = geojson.features.map((f) => {
    const polys = polygonsOf(f.geometry);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const poly of polys) for (const [x, y] of poly[0]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { nome: f.properties.nome, polys, bbox: [minX, minY, maxX, maxY] };
  });
  const names = shapes.map((s) => s.nome);
  if (names.length !== 11 || PROVINCIAS.some((p) => !names.includes(p))) {
    throw new Error(`mapa das províncias incompleto: ${names.join(', ')}`);
  }
  return function locate(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { provincia: '', estado: 'sem_gps', km: null };
    for (const s of shapes) {
      const [a, b, c, d] = s.bbox;
      if (lon < a || lon > c || lat < b || lat > d) continue;
      if (s.polys.some((p) => inPolygon(lon, lat, p))) return { provincia: s.nome, estado: 'dentro', km: 0 };
    }
    let best = { provincia: '', km: Infinity };
    for (const s of shapes) for (const poly of s.polys) for (const ring of poly) {
      for (let i = 1; i < ring.length; i++) {
        const km = segDistKm(lon, lat, ring[i - 1], ring[i]);
        if (km < best.km) best = { provincia: s.nome, km };
      }
    }
    return { provincia: best.provincia, estado: best.km <= COSTA_KM ? 'costa' : 'fora', km: Math.round(best.km * 10) / 10 };
  };
}

/** Centro para a etiqueta: centróide (área) do maior polígono da província */
export function labelPoint(feature) {
  const polys = polygonsOf(feature.geometry);
  let best = null;
  for (const poly of polys) {
    const ring = poly[0];
    let A = 0, cx = 0, cy = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      A += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f;
    }
    A /= 2;
    if (!best || Math.abs(A) > Math.abs(best.A)) best = { A, lon: cx / (6 * A), lat: cy / (6 * A) };
  }
  return [best.lat, best.lon];
}
