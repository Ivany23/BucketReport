import { useCallback, useMemo, useState } from 'react';
import Mapa from './Mapa.jsx';
import FichaLoja from './FichaLoja.jsx';
import { ESTADOS, ORDEM_ESTADOS } from '../lib/labels.js';
import { fold, fmtDate, monthShort } from '../lib/normalize.js';

const n = (x) => x.toLocaleString('pt-PT');

function boundsDe(lojas) {
  const pts = lojas.filter((s) => Number.isFinite(s.lat)).map((s) => [s.lat, s.lon]);
  if (!pts.length) return null;
  const lats = pts.map((p) => p[0]), lons = pts.map((p) => p[1]);
  return [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]];
}

function Barra({ valor, total, cor }) {
  const w = total ? Math.min(100, (valor / total) * 100) : valor ? 100 : 0;
  return <div className="barra"><div style={{ width: `${w}%`, background: cor ?? '#2a78d6' }} /></div>;
}

function Contagens({ c }) {
  return (
    <div className="mini-contagens">
      {ORDEM_ESTADOS.map((k) => c[k] > 0 && (
        <span key={k} title={ESTADOS[k].label}><i style={{ '--c': ESTADOS[k].cor }} className={k === 'por_visitar' ? 'oco' : ''} />{n(c[k])}</span>
      ))}
    </div>
  );
}

export default function Painel({ base, m, barra, aviso }) {
  const [estados, setEstados] = useState(() => new Set(ORDEM_ESTADOS));
  const [auditor, setAuditor] = useState('');
  const [provincia, setProvincia] = useState('');
  const [aba, setAba] = useState('provincias');
  const [busca, setBusca] = useState('');
  const [buscaAud, setBuscaAud] = useState('');
  const [selecionada, setSelecionada] = useState(null);
  const [alvo, setAlvo] = useState(null);
  const [checkAberto, setCheckAberto] = useState('');
  const [audAberto, setAudAberto] = useState('');

  const audInfo = useMemo(() => m.auditores.find((a) => a.nome === auditor), [m, auditor]);
  const audLojas = useMemo(() => (audInfo ? new Set(audInfo.lojas) : null), [audInfo]);

  // lojas que passam os filtros (província, auditor) — antes do filtro de estado, para as contagens
  const base1 = useMemo(() => m.stores.filter((s) =>
    (!provincia || s.provincia === provincia) && (!audLojas || audLojas.has(s.id))), [m, provincia, audLojas]);
  const contagens = useMemo(() => {
    const c = { auditada: 0, nao_auditada: 0, so_feedback: 0, por_visitar: 0 };
    for (const s of base1) c[s.estado]++;
    return c;
  }, [base1]);
  const noMapa = useMemo(() => base1.filter((s) => estados.has(s.estado) && Number.isFinite(s.lat) && Number.isFinite(s.lon)), [base1, estados]);

  const loja = selecionada ? m.storeById.get(selecionada) : null;

  const abrirLoja = useCallback((id, voar = true) => {
    setSelecionada(id);
    const s = m.storeById.get(id);
    if (voar && s && Number.isFinite(s.lat)) setAlvo({ ponto: [s.lat, s.lon], zoom: 14, t: Date.now() });
  }, [m]);
  const onSelectMapa = useCallback((id) => setSelecionada(id), []);

  // enquadrar pela fronteira oficial da província (não pelos pontos: um GPS errado não pode desviar o zoom)
  const caixaProv = useMemo(() => Object.fromEntries(base.provincias.features.map((f) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of polys) for (const [x, y] of p[0]) { a = Math.min(a, y); b = Math.min(b, x); c = Math.max(c, y); d = Math.max(d, x); }
    return [f.properties.nome, [[a, b], [c, d]]];
  })), [base]);

  const escolherProvincia = useCallback((nome) => {
    const novo = provincia === nome ? '' : nome;
    setProvincia(novo);
    setAlvo({ bounds: novo ? caixaProv[novo] : [[-26.9, 30.2], [-10.4, 40.9]], maxZoom: 11, t: Date.now() });
  }, [caixaProv, provincia]);

  function escolherAuditor(nome, forcar = false) {
    const novo = auditor === nome && !forcar ? '' : nome;
    setAuditor(novo);
    setAudAberto(novo);
    if (novo) {
      const a = m.auditores.find((x) => x.nome === novo);
      const b = boundsDe(a.lojas.map((id) => m.storeById.get(id)).filter(Boolean));
      if (b) setAlvo({ bounds: b, maxZoom: 14, t: Date.now() });
    }
  }

  function alternarEstado(k) {
    setEstados((prev) => {
      const s = new Set(prev);
      if (s.has(k) && s.size === 1) return new Set(ORDEM_ESTADOS);      // não deixar o mapa vazio: volta a todos
      if (s.has(k)) s.delete(k); else s.add(k);
      return s;
    });
  }
  function soEstado(k) { setEstados(new Set([k])); }

  function limparFiltros() {
    setEstados(new Set(ORDEM_ESTADOS));
    setAuditor('');
    setProvincia('');
    setAlvo({ bounds: [[-26.9, 30.2], [-10.4, 40.9]], t: Date.now() });
  }

  const resultados = useMemo(() => {
    const q = fold(busca);
    if (!q) return base1.filter((s) => estados.has(s.estado));
    return base1.filter((s) => estados.has(s.estado) && (fold(s.nome).includes(q) || s.id.includes(q) || String(s.sem).includes(q)
      || fold(s.bairro).includes(q) || fold(s.distrito).includes(q)));
  }, [base1, busca, estados]);

  const t = m.totais;
  const filtrosAtivos = provincia || auditor || estados.size !== ORDEM_ESTADOS.length;
  const refTxt = m.refMeses.map((x) => monthShort(x.chave)).join(' + ');
  const audFiltrados = m.auditores.filter((a) => !buscaAud || fold(a.nome).includes(fold(buscaAud)));

  return (
    <div className="painel">
      <header className="topo">
        <div className="topo-titulo">
          <h1>Mapa de lojas <span>{m.mesNome}</span></h1>
          <div className="topo-barra">{barra}</div>
        </div>
        {aviso && <div className="aviso-topo">{aviso}</div>}
        <div className="kpis">
          <div className="kpi kpi-principal" title={`Lojas com visita em ${m.mesNome} / lojas visitadas em ${refTxt}`}>
            <div className="kpi-rotulo">Lojas visitadas</div>
            <div className="kpi-valor">{n(t.visitadas)}<small> / {n(t.esperadas)}</small></div>
            <Barra valor={t.visitadasDasEsperadas} total={t.esperadas} />
            <div className="kpi-nota">visitadas este mês / lojas de {refTxt}{t.novas ? ` · +${n(t.novas)} novas` : ''}</div>
          </div>
          {ORDEM_ESTADOS.map((k) => (
            <button key={k} type="button" className={`kpi kpi-estado ${estados.has(k) ? '' : 'desligado'}`}
              onClick={() => alternarEstado(k)} onDoubleClick={() => soEstado(k)}
              title={`${ESTADOS[k].desc}\nClique: mostrar/esconder · Duplo clique: só este`}>
              <div className="kpi-rotulo"><span className={`ponto ${k === 'por_visitar' ? 'oco' : ''}`} style={{ '--c': ESTADOS[k].cor }} />{ESTADOS[k].label}</div>
              <div className="kpi-valor">{n(t.porEstado[k])}</div>
              <div className="kpi-nota">{k === 'so_feedback' ? `${n(t.soFeedback)} feedbacks sem leitura` : k === 'por_visitar' ? `de ${refTxt}, ainda sem visita` : k === 'auditada' ? `${n(t.visitas)} visitas no total` : 'fechadas, recusaram…'}</div>
            </button>
          ))}
          <div className="kpi">
            <div className="kpi-rotulo">Auditores</div>
            <div className="kpi-valor">{n(t.auditores)}</div>
            <div className="kpi-nota">com visitas este mês</div>
          </div>
        </div>
      </header>

      <div className="corpo">
        <aside className="lateral">
          <nav className="abas" role="tablist">
            {[['provincias', 'Províncias'], ['auditores', 'Auditores'], ['lojas', 'Lojas'], ['verificacao', 'Verificação']].map(([k, l]) => (
              <button key={k} role="tab" aria-selected={aba === k} className={aba === k ? 'ativa' : ''} onClick={() => setAba(k)}>
                {l}{k === 'verificacao' && m.checks.some((c) => !c.info && c.lojas.length) ? <span className="aviso-dot" /> : null}
              </button>
            ))}
          </nav>

          {filtrosAtivos && (
            <div className="filtros-ativos">
              {provincia && <span className="chip" onClick={() => escolherProvincia(provincia)}>📍 {provincia} ✕</span>}
              {auditor && <span className="chip" onClick={() => escolherAuditor(auditor)}>👤 {auditor} ✕</span>}
              {estados.size !== ORDEM_ESTADOS.length && <span className="chip" onClick={() => setEstados(new Set(ORDEM_ESTADOS))}>{[...estados].map((k) => ESTADOS[k].label).join(' + ')} ✕</span>}
              <button type="button" className="btn-link" onClick={limparFiltros}>Limpar tudo</button>
            </div>
          )}

          <div className="lista">
            {aba === 'provincias' && (
              <>
                <p className="ajuda">Visitadas este mês / lojas visitadas em {refTxt}. Clique para ver no mapa.</p>
                {m.provincias.map((p) => (
                  <button key={p.nome} type="button" className={`linha-prov ${provincia === p.nome ? 'sel' : ''}`} onClick={() => escolherProvincia(p.nome)}>
                    <div className="linha-topo">
                      <b>{p.nome}</b>
                      <span className="num">{p.esperadas || p.visitadas ? <>{n(p.visitadas)}<small>/{n(p.esperadas)}</small></> : <small>sem lojas</small>}</span>
                    </div>
                    {(p.esperadas > 0 || p.visitadas > 0) && (
                      <>
                        <Barra valor={p.visitadas} total={p.esperadas} />
                        <div className="linha-baixo">
                          <Contagens c={p.porEstado} />
                          {p.novas > 0 && <span className="pct">+{p.novas} novas</span>}
                        </div>
                      </>
                    )}
                  </button>
                ))}
              </>
            )}

            {aba === 'auditores' && (
              <>
                <input className="busca" placeholder="Procurar auditor…" value={buscaAud} onChange={(e) => setBuscaAud(e.target.value)} />
                <p className="ajuda">Lojas = lojas diferentes onde o auditor registou visita ou feedback. Clique para ver as lojas dele no mapa.</p>
                {audFiltrados.map((a) => (
                  <div key={a.nome} className={`linha-aud ${auditor === a.nome ? 'sel' : ''}`}>
                    <button type="button" className="linha-aud-cab" onClick={() => escolherAuditor(a.nome)}>
                      <div className="aud-nome"><b>{a.nome}</b><span>{a.provincias.join(', ')}</span></div>
                      <div className="aud-lojas"><b>{n(a.nLojas)}</b><span>lojas</span></div>
                    </button>
                    <div className="aud-chips">
                      <span title="Visitas com auditoria feita"><i style={{ '--c': ESTADOS.auditada.cor }} />{a.auditadas} auditadas</span>
                      <span title="Visitas sem auditoria (fechada, recusou…)"><i style={{ '--c': ESTADOS.nao_auditada.cor }} />{a.naoAuditadas} não auditadas</span>
                      <span title="Feedback sem leitura de stock"><i style={{ '--c': ESTADOS.so_feedback.cor }} />{a.soFeedback} só feedback</span>
                    </div>
                    {audAberto === a.nome && (
                      <div className="aud-detalhe">
                        <div className="aud-dias">
                          {a.dias.map((d) => (
                            <div key={d.data} className="dia" title={`${fmtDate(d.data)}: ${d.n} registos`}>
                              <div className="dia-barra" style={{ height: `${Math.max(8, (d.n / Math.max(...a.dias.map((x) => x.n))) * 48)}px` }} />
                              <span>{d.data.slice(8)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="aud-lista">
                          {a.lojas.map((id) => m.storeById.get(id)).filter(Boolean).sort((x, y) => y.ultimaData.localeCompare(x.ultimaData)).map((s) => (
                            <button key={s.id} type="button" className="mini-loja" onClick={() => abrirLoja(s.id)}>
                              <span className={`ponto ${s.estado === 'por_visitar' ? 'oco' : ''}`} style={{ '--c': ESTADOS[s.estado].cor }} />
                              <span className="mini-nome">{s.nome}</span><span className="mini-data">{fmtDate(s.ultimaData).slice(0, 5)}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {aba === 'lojas' && (
              <>
                <input className="busca" placeholder="Nome, Store No, S.E.M. ID, bairro…" value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus />
                <p className="ajuda">{n(resultados.length)} lojas{resultados.length > 200 ? ' — a mostrar as primeiras 200, escreva para procurar' : ''}</p>
                {resultados.slice(0, 200).map((s) => (
                  <button key={s.id} type="button" className={`mini-loja grande ${selecionada === s.id ? 'sel' : ''}`} onClick={() => abrirLoja(s.id)}>
                    <span className={`ponto ${s.estado === 'por_visitar' ? 'oco' : ''}`} style={{ '--c': ESTADOS[s.estado].cor }} />
                    <span className="mini-nome">{s.nome}<small>{s.id} · {s.provincia}{s.bairro ? ` · ${s.bairro}` : ''}</small></span>
                    <span className="mini-data">{s.ultimaData ? fmtDate(s.ultimaData).slice(0, 5) : ''}</span>
                  </button>
                ))}
              </>
            )}

            {aba === 'verificacao' && (
              <>
                <p className="ajuda">Pontos a confirmar nos dados. Clique para ver as lojas.</p>
                {m.avisos.map((a, i) => <div key={i} className="aviso">⚠ {a}</div>)}
                {m.checks.map((c) => (
                  <div key={c.id} className={`check ${c.lojas.length ? (c.info ? 'info' : 'alerta') : 'ok'}`}>
                    <button type="button" className="check-cab" onClick={() => setCheckAberto(checkAberto === c.id ? '' : c.id)} disabled={!c.lojas.length}>
                      <span className="check-icone">{!c.lojas.length ? '✓' : c.info ? 'i' : '!'}</span>
                      <span className="check-titulo">{c.titulo}<small>{c.desc}</small></span>
                      <b>{n(c.lojas.length)}</b>
                    </button>
                    {checkAberto === c.id && (
                      <div className="aud-lista">
                        {c.lojas.map((id) => m.storeById.get(id)).map((s) => (
                          <button key={s.id} type="button" className="mini-loja" onClick={() => abrirLoja(s.id)}>
                            <span className={`ponto ${s.estado === 'por_visitar' ? 'oco' : ''}`} style={{ '--c': ESTADOS[s.estado].cor }} />
                            <span className="mini-nome">{s.nome}<small>{c.id === 'gps_outra' ? `dados: ${s.provincia} · GPS: ${s.gps.provincia}` : c.id === 'provincia_gps' ? `GPS: ${s.provincia}` : `${s.id} · ${s.provincia}`}</small></span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div className="fontes">
                  <b>Fontes carregadas</b>
                  <div>Produtos (PAP): {m.fontes.pap ? '✓' : '—'} · Feedback: {m.fontes.feedback ? '✓' : '—'} · Questionário: {m.fontes.vq ? '✓' : '—'} · QA (auditor exacto): {m.fontes.qa ? '✓' : '—'}</div>
                  <div>Lojas esperadas: {m.refMeses.map((x) => `${x.nome} (${n(x.lojas)})`).join(', ')}</div>
                </div>
              </>
            )}
          </div>
        </aside>

        <main className="area-mapa">
          <Mapa geo={base.provincias} provincias={m.provincias} lojas={noMapa} selecionada={selecionada}
            onSelect={onSelectMapa} provSel={provincia} onProvincia={escolherProvincia} alvo={alvo} contagens={contagens} />
          {loja && <FichaLoja loja={loja} m={m} onFechar={() => setSelecionada(null)} onAuditor={(nome) => { setAba('auditores'); escolherAuditor(nome, true); }} />}
        </main>
      </div>
    </div>
  );
}
