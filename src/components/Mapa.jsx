import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { labelPoint } from '../lib/provinces.js';
import { ESTADOS, ORDEM_ESTADOS, corCobertura, COBERTURA } from '../lib/labels.js';

const MZ_BOUNDS = [[-26.9, 30.2], [-10.4, 40.9]];
// etiquetas que se sobrepunham no centróide: posição ajustada à mão (dentro da própria província)
const POS_ETIQUETA = {
  Manica: [-18.2, 33.25],
  Sofala: [-18.7, 34.75],
  Maputo: [-24.75, 32.35],
};
const CIDADE_MAPUTO_PONTO = [-25.93, 32.58];   // etiqueta lateral (sobre a baía) com traço até à cidade

/** Pontos das lojas: camada imperativa em canvas (rápida com milhares de pontos) */
function Pontos({ lojas, selecionada, onSelect }) {
  const map = useMap();
  const camada = useRef(null);
  const renderer = useMemo(() => L.canvas({ padding: 0.3 }), []);

  useEffect(() => {
    const g = L.layerGroup().addTo(map);
    camada.current = g;
    return () => g.remove();
  }, [map]);

  useEffect(() => {
    const g = camada.current;
    if (!g) return;
    g.clearLayers();
    const ordem = { por_visitar: 0, auditada: 1, so_feedback: 2, nao_auditada: 3 };
    const lista = [...lojas].sort((a, b) => ordem[a.estado] - ordem[b.estado]);
    for (const s of lista) {
      const e = ESTADOS[s.estado];
      const pv = s.estado === 'por_visitar';
      const sel = s.id === selecionada;
      const mk = L.circleMarker([s.lat, s.lon], {
        renderer,
        radius: sel ? 10 : pv ? 4.5 : 6,
        color: sel ? '#0b0b0b' : pv ? e.cor : '#ffffff',
        weight: sel ? 3 : pv ? 1.5 : 1.5,
        fillColor: pv ? '#ffffff' : e.cor,
        fillOpacity: 1,
      });
      mk.bindTooltip(`<b>${escapar(s.nome)}</b><br>${e.icon} ${e.label}`, { direction: 'top', offset: [0, -6] });
      mk.on('click', () => onSelect(s.id));
      g.addLayer(mk);
    }
    // a loja seleccionada por cima de todas
    const s = lojas.find((x) => x.id === selecionada);
    if (s) {
      g.addLayer(L.circleMarker([s.lat, s.lon], { renderer, radius: 10, color: '#0b0b0b', weight: 3,
        fillColor: s.estado === 'por_visitar' ? '#ffffff' : ESTADOS[s.estado].cor, fillOpacity: 1, interactive: false }));
    }
  }, [lojas, selecionada, onSelect, renderer]);
  return null;
}

function escapar(t) {
  return String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Etiquetas das províncias: "Sofala 143/293" */
function Etiquetas({ geo, provincias, provSel, onProvincia }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  useEffect(() => {
    const g = L.layerGroup().addTo(map);
    const porNome = Object.fromEntries(provincias.map((p) => [p.nome, p]));
    const compacto = zoom <= 5;
    for (const f of geo.features) {
      const nome = f.properties.nome;
      const p = porNome[nome];
      const cidade = nome === 'Cidade de Maputo';
      const pos = cidade ? CIDADE_MAPUTO_PONTO : POS_ETIQUETA[nome] ?? labelPoint(f);
      const num = p.esperadas || p.visitadas ? `${p.visitadas}/${p.esperadas}` : 'sem lojas';
      const html = `<div class="prov-etq ${cidade ? 'prov-etq-lateral' : ''} ${provSel === nome ? 'sel' : ''} ${compacto ? 'compacto' : ''}">
          ${cidade ? '<span class="prov-traco"></span>' : ''}
          <span class="prov-nome">${escapar(compacto && cidade ? 'Cidade' : nome)}</span>
          <span class="prov-num">${num}</span></div>`;
      const icon = L.divIcon({ className: 'prov-etq-wrap', html, iconSize: null, iconAnchor: cidade ? [0, 14] : [0, 0] });
      const mk = L.marker(pos, { icon, keyboard: false, zIndexOffset: 1000, title: `${nome}: ${num}` });
      mk.on('click', () => onProvincia(nome));
      g.addLayer(mk);
    }
    return () => g.remove();
  }, [map, geo, provincias, provSel, onProvincia, zoom]);
  return null;
}

/** Mover o mapa quando o painel pede (província, auditor, loja) */
function Mover({ alvo }) {
  const map = useMap();
  useEffect(() => {
    if (!alvo) return;
    if (alvo.bounds) map.flyToBounds(alvo.bounds, { padding: [40, 40], maxZoom: alvo.maxZoom ?? 13, duration: 0.6 });
    else if (alvo.ponto) map.flyTo(alvo.ponto, Math.max(map.getZoom(), alvo.zoom ?? 14), { duration: 0.6 });
  }, [alvo, map]);
  return null;
}

/** Zoom alto (cidade): o azul das províncias fica quase transparente para se verem as ruas */
function VigiarZoom({ onPerto }) {
  const map = useMapEvents({ zoomend: () => onPerto(map.getZoom() >= 9) });
  return null;
}

export default function Mapa({ geo, provincias, lojas, selecionada, onSelect, provSel, onProvincia, alvo, contagens }) {
  const [perto, setPerto] = useState(false);
  const porNome = useMemo(() => Object.fromEntries(provincias.map((p) => [p.nome, p])), [provincias]);
  const estilo = (f) => {
    const p = porNome[f.properties.nome];
    const cor = corCobertura(p.visitadas, p.esperadas);
    const sel = provSel === f.properties.nome;
    return {
      color: sel ? '#0d366b' : '#1c5cab', weight: sel ? 3 : 1.2, opacity: 0.9,
      fillColor: cor ?? '#e1e0d9', fillOpacity: perto ? 0.04 : cor ? 0.35 : 0.15, dashArray: cor ? null : '4 4',
    };
  };
  return (
    <div className="mapa">
      <MapContainer bounds={MZ_BOUNDS} preferCanvas zoomSnap={0.25} minZoom={4} maxZoom={19} className="mapa-leaflet">
        {/* Política de tiles do OSM: cada pedido tem de levar o cabeçalho Referer (sem ele o servidor devolve
            "Access blocked"). referrerPolicy nas imagens garante-o mesmo que a página tenha uma política restritiva. */}
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          referrerPolicy="strict-origin-when-cross-origin"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> | Limites: OCHA COD-AB (CC BY-IGO)'
        />
        <GeoJSON
          key={`${provSel}|${perto}|${provincias.map((p) => p.visitadas).join(',')}`}
          data={geo}
          style={estilo}
          onEachFeature={(f, layer) => layer.on('click', () => onProvincia(f.properties.nome))}
        />
        <Pontos lojas={lojas} selecionada={selecionada} onSelect={onSelect} />
        <Etiquetas geo={geo} provincias={provincias} provSel={provSel} onProvincia={onProvincia} />
        <Mover alvo={alvo} />
        <VigiarZoom onPerto={setPerto} />
      </MapContainer>
      <div className="legenda">
        <div className="legenda-titulo">Lojas no mapa</div>
        {ORDEM_ESTADOS.map((k) => (
          <div key={k} className="legenda-linha">
            <span className={`ponto ${k === 'por_visitar' ? 'oco' : ''}`} style={{ '--c': ESTADOS[k].cor }} />
            {ESTADOS[k].label} <span className="legenda-n">{contagens[k].toLocaleString('pt-PT')}</span>
          </div>
        ))}
        <div className="legenda-titulo">Província: visitadas / esperadas</div>
        <div className="legenda-escala">
          {[...COBERTURA].reverse().map((c) => (
            <div key={c.label} title={c.label}><span style={{ background: c.cor }} />{c.label}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
