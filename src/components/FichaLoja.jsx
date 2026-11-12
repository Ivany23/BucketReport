import { useEffect, useMemo, useState } from 'react';
import { ESTADOS, STATUS_PT, categoriaPT, PRATELEIRA, CAMPOS_LOJA } from '../lib/labels.js';
import { fmtDate, monthName } from '../lib/normalize.js';

const preco = (v) => (v === null || v === undefined ? '' : `${v.toLocaleString('pt-PT')} MT`);

function Auditor({ a, onAuditor }) {
  const nota = a.como === 'provincia' ? `deduzido pela província (iniciais de ${a.candidatos.join(' / ')})`
    : a.como === 'ambiguo' ? 'iniciais de mais de um auditor' : a.como === 'desconhecido' ? 'só as iniciais' : '';
  return (
    <span className="auditor">
      👤 <button type="button" className="btn-link" onClick={() => onAuditor(a.nome)}>{a.nome}</button>
      {nota && <small title={nota}> ({nota})</small>}
    </span>
  );
}

function Feedback({ f }) {
  return (
    <div className="fb">
      <b>{categoriaPT(f.categoria)}</b>{f.categoria && categoriaPT(f.categoria) !== f.categoria ? <small> · {f.categoria}</small> : null}
      {f.detalhes && <p>“{f.detalhes}”</p>}
    </div>
  );
}

export default function FichaLoja({ loja: s, m, onFechar, onAuditor }) {
  const [aba, setAba] = useState('visitas');
  const comProdutos = useMemo(() => s.visitas.filter((v) => v.produtos), [s]);
  const [visProd, setVisProd] = useState('');
  const [visQ, setVisQ] = useState('');
  useEffect(() => {
    setAba('visitas');
    setVisProd(comProdutos.at(-1)?.visit_nu ?? '');
    setVisQ(s.questionarios.at(-1)?.visit_nu ?? '');
  }, [s, comProdutos]);

  const e = ESTADOS[s.estado];
  const prod = comProdutos.find((v) => v.visit_nu === visProd);
  const q = s.questionarios.find((x) => x.visit_nu === visQ);
  const registos = [
    ...s.visitas.map((v) => ({ tipo: 'visita', data: v.date, v })),
    ...s.soFeedback.map((f) => ({ tipo: 'fb', data: f.date, f })),
  ].sort((a, b) => b.data.localeCompare(a.data));
  const camposConhecidos = new Set(CAMPOS_LOJA.flatMap(([, c]) => c));
  const extra = Object.keys(s.demo).filter((k) => !camposConhecidos.has(k) && s.demo[k]);
  const fonteTxt = s.fonteDados === m.mes ? `demographic_file de ${m.mesNome}`
    : s.fonteDados === 'pap' ? `product_availability_price de ${m.mesNome}`
      : s.fonteDados === 'feedback' ? 'survey_feedback (sem ficha completa)'
        : /^\d{4}-\d{2}$/.test(s.fonteDados) ? `ficha de ${monthName(s.fonteDados)} (sem ficha este mês)` : s.fonteDados;
  const gpsTxt = {
    dentro: `dentro de ${s.gps.provincia}`, costa: `junto à costa de ${s.gps.provincia} (${s.gps.km} km)`,
    fora: `fora de Moçambique (${s.gps.km} km de ${s.gps.provincia})`, sem_gps: 'sem GPS',
  }[s.gps.estado];
  const gpsDiferente = s.provincia && s.gps.provincia && s.gps.estado !== 'sem_gps' && s.gps.provincia !== s.provincia;

  return (
    <aside className="ficha" aria-label={`Ficha da loja ${s.nome}`}>
      <div className="ficha-cab">
        <div>
          <h2>{s.nome}</h2>
          <div className="ficha-ids">Store No {s.id}{s.sem ? ` · S.E.M. ${s.sem}` : ''}</div>
          <div className="ficha-ids">{[s.provincia, s.distrito, s.bairro].filter(Boolean).join(' · ')}</div>
        </div>
        <button type="button" className="fechar" onClick={onFechar} aria-label="Fechar">✕</button>
      </div>
      <div className="estado-pill" style={{ '--c': e.cor }}>
        <span className="estado-icone">{e.icon}</span>{e.label}
        <small>{e.desc}</small>
      </div>
      <div className="ficha-resumo">
        <div><span>Canal</span><b>{s.canal || '—'}</b></div>
        <div><span>Classificação</span><b>{s.classificacao || '—'}</b></div>
        <div><span>Visitas no mês</span><b>{s.visitas.length + s.soFeedback.length}</b></div>
        <div><span>Última</span><b>{s.ultimaData ? fmtDate(s.ultimaData) : '—'}</b></div>
      </div>

      <nav className="abas abas-ficha">
        {[['visitas', 'Visitas', true], ['produtos', 'Produtos', comProdutos.length > 0], ['questionario', 'Questionário', s.questionarios.length > 0], ['dados', 'Dados', true], ['historico', 'Histórico', true]].map(([k, l, tem]) => (
          <button key={k} type="button" className={`${aba === k ? 'ativa' : ''} ${tem ? '' : 'vazia'}`} onClick={() => setAba(k)} title={tem ? '' : 'sem dados este mês'}>{l}</button>
        ))}
      </nav>

      <div className="ficha-corpo">
        {aba === 'visitas' && (
          registos.length ? registos.map((r) => (
            <div key={r.tipo + (r.v?.visit_nu ?? r.f.visit_nu)} className={`registo ${r.tipo === 'fb' ? 'registo-fb' : r.v.status === 'Audit done' ? 'registo-ok' : 'registo-nao'}`}>
              <div className="registo-cab">
                <b>{fmtDate(r.data)}</b>
                <span className="registo-tipo">{r.tipo === 'fb' ? 'Só feedback' : STATUS_PT[r.v.status]}</span>
              </div>
              <Auditor a={r.tipo === 'fb' ? r.f.auditor : r.v.auditor} onAuditor={onAuditor} />
              {r.tipo === 'fb' ? <Feedback f={r.f} /> : (r.v.feedback ?? []).map((f) => <Feedback key={f.visit_nu} f={f} />)}
              {r.tipo === 'visita' && r.v.produtos && (
                <div className="registo-prod">
                  {r.v.produtos.filter((p) => p.estado === 'on_shelf').length} de {r.v.produtos.length} produtos na prateleira
                  <button type="button" className="btn-link" onClick={() => { setVisProd(r.v.visit_nu); setAba('produtos'); }}>ver produtos</button>
                </div>
              )}
              <div className="registo-id">{r.tipo === 'fb' ? r.f.visit_nu : r.v.visit_nu}{r.tipo === 'visita' && r.v.origem !== 'survey_visit_db' ? ' · só no PAP (loja sem External Id)' : ''}</div>
            </div>
          )) : <p className="vazio">Sem visitas em {m.mesNome}. {s.referencia ? 'Loja visitada em meses anteriores — ver Histórico.' : ''}</p>
        )}

        {aba === 'produtos' && (
          prod ? (
            <>
              {comProdutos.length > 1 && (
                <select value={visProd} onChange={(ev) => setVisProd(ev.target.value)}>
                  {comProdutos.map((v) => <option key={v.visit_nu} value={v.visit_nu}>{fmtDate(v.date)} — {v.auditor.nome}</option>)}
                </select>
              )}
              <div className="prod-resumo">
                {Object.entries(PRATELEIRA).map(([k, x]) => {
                  const c = prod.produtos.filter((p) => p.estado === k).length;
                  return c ? <span key={k}><i style={{ '--c': x.cor }} />{c} {x.label.toLowerCase()}</span> : null;
                })}
              </div>
              <table className="tabela">
                <thead><tr><th>Produto</th><th>Estado</th><th className="dir">Unidade</th><th className="dir">Pack</th></tr></thead>
                <tbody>
                  {prod.produtos.map((p) => (
                    <tr key={p.sku}>
                      <td>{p.produto}<small>{p.marca}</small></td>
                      <td><span className="tag" style={{ '--c': PRATELEIRA[p.estado].cor }}>{PRATELEIRA[p.estado].label}</span></td>
                      <td className="dir">{preco(p.unit_price)}</td>
                      <td className="dir">{preco(p.pack_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : <p className="vazio">{m.fontes.pap ? 'Sem leitura de produtos este mês (loja fechada, só feedback ou por visitar).' : 'Carregue o product_availability_price para ver os produtos.'}</p>
        )}

        {aba === 'questionario' && (
          q ? (
            <>
              {s.questionarios.length > 1 && (
                <select value={visQ} onChange={(ev) => setVisQ(ev.target.value)}>
                  {s.questionarios.map((x) => <option key={x.visit_nu} value={x.visit_nu}>{fmtDate(x.date)} — {x.auditor.nome}</option>)}
                </select>
              )}
              <div className="registo-id">{fmtDate(q.date)} · {q.auditor.nome} · {q.visit_nu}</div>
              <table className="tabela">
                <tbody>{q.itens.map((it) => <tr key={it.item}><td>{it.item}</td><td><b>{it.valor || '—'}</b></td></tr>)}</tbody>
              </table>
            </>
          ) : <p className="vazio">{m.fontes.vq ? 'Sem questionário este mês.' : 'Carregue o Visibility_Quality para ver o questionário.'}</p>
        )}

        {aba === 'dados' && (
          <>
            <p className="ajuda">Fonte: {fonteTxt}</p>
            {CAMPOS_LOJA.map(([grupo, campos]) => {
              const linhas = campos.filter((c) => s.demo[c] !== undefined);
              if (!linhas.length) return null;
              return (
                <div key={grupo} className="grupo">
                  <h3>{grupo}</h3>
                  <dl>{linhas.map((c) => <div key={c}><dt>{c}</dt><dd>{s.demo[c] || '—'}</dd></div>)}</dl>
                </div>
              );
            })}
            {extra.length > 0 && (
              <div className="grupo"><h3>Outros</h3><dl>{extra.map((c) => <div key={c}><dt>{c}</dt><dd>{s.demo[c]}</dd></div>)}</dl></div>
            )}
          </>
        )}

        {aba === 'historico' && (
          <>
            <div className="grupo">
              <h3>Meses anteriores</h3>
              {m.refMeses.map((x) => {
                const st = s.referencia?.estados?.[x.chave];
                const esteve = s.referencia?.meses.includes(x.chave);
                return (
                  <div key={x.chave} className="hist-linha">
                    <span>{x.nome}</span>
                    <b>{esteve ? (STATUS_PT[st] ?? (st ? `Feedback: ${categoriaPT(st)}` : 'visitada')) : 'não visitada'}</b>
                  </div>
                );
              })}
              {s.nova && <div className="aviso">Loja nova: não estava nas lojas dos meses anteriores.</div>}
            </div>
            <div className="grupo">
              <h3>Localização</h3>
              <div className="hist-linha"><span>Coordenadas</span><b>{Number.isFinite(s.lat) ? `${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}` : '—'}</b></div>
              <div className="hist-linha"><span>Ponto GPS</span><b>{gpsTxt}</b></div>
              {s.provinciaPeloGps && <div className="aviso">O relatório não tinha a província; usada a do ponto GPS.</div>}
              {gpsDiferente && <div className="aviso">⚠ Nos dados a loja está em {s.provincia}, mas o ponto GPS cai em {s.gps.provincia}.</div>}
              {Number.isFinite(s.lat) && (
                <div className="links">
                  <a href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lon}#map=18/${s.lat}/${s.lon}`} target="_blank" rel="noreferrer">Abrir no OpenStreetMap ↗</a>
                  <a href={`https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lon}`} target="_blank" rel="noreferrer">Abrir no Google Maps ↗</a>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
