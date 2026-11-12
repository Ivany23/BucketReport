// Gera public/data/provincias_mz.geojson (mapa leve para o browser) a partir dos limites oficiais
// OCHA COD-AB Moçambique (admin1 = 11 províncias, incl. Cidade de Maputo; licença CC BY-IGO),
// guardados em scripts/fontes/moz_admin1.geojson.
// Uso: npm run preparar-mapa   (precisa de internet a primeira vez: corre o mapshaper via npx, sem o instalar no projecto)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'scripts/fontes/moz_admin1.geojson';
const OUT = 'public/data/provincias_mz.geojson';
execFileSync('npx', ['--yes', 'mapshaper@0.6.102', SRC, '-simplify', '6%', 'keep-shapes',
  '-filter-fields', 'adm1_name,adm1_pcode', '-o', OUT, 'format=geojson', 'precision=0.00001'],
  { stdio: 'inherit', shell: true });

const g = JSON.parse(readFileSync(OUT, 'utf8'));
if (g.features.length !== 11) throw new Error(`esperadas 11 províncias, há ${g.features.length}`);
g.features = g.features.map((f) => ({
  type: 'Feature',
  properties: { nome: f.properties.adm1_name, codigo: f.properties.adm1_pcode },
  geometry: f.geometry,
}));
g.fonte = 'OCHA COD-AB Mozambique admin1 (v02, válido desde 2025-01-01), CC BY-IGO — simplificado a 6% com mapshaper';
writeFileSync(OUT, JSON.stringify(g));
console.log(`OK: ${OUT} (${(JSON.stringify(g).length / 1024).toFixed(0)} KB) — ${g.features.map((f) => f.properties.nome).join(', ')}`);
