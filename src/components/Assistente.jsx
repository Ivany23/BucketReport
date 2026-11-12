// Assistente de carregamento: 1 ficheiros -> 2 verificar (no browser) -> 3 enviar e validar (servidor) -> 4 publicar -> 5 feito.
// Cada passo só avança se o anterior ficou certo; nada muda no que os leitores vêem até ao "Publicar".
import { useEffect, useState } from 'react';
import Carregar from './Carregar.jsx';
import Painel from './Painel.jsx';
import { api, comRepeticao, sha256Hex } from '../lib/api.js';
import { REPORTS } from '../lib/reports.js';
import { prepararEnvio } from '../lib/envio.js';
import { buildModel } from '../lib/model.js';
import { mesDosRelatorios, juntarAuditores } from '../lib/referencia.js';
import { assinaturaDe } from '../lib/assinatura.js';
import { monthName } from '../lib/normalize.js';
import { ESTADOS, ORDEM_ESTADOS } from '../lib/labels.js';

const PASSOS = ['Ficheiros', 'Verificar', 'Enviar', 'Publicar', 'Feito'];
const n = (x) => (x ?? 0).toLocaleString('pt-PT');

function Delta({ antes, agora }) {
  if (antes === undefined || antes === null) return null;
  const d = agora - antes;
  if (!d) return <small className="delta">=</small>;
  return <small className={`delta ${d > 0 ? 'mais' : 'menos'}`}>{d > 0 ? '+' : ''}{n(d)}</small>;
}

export default function Assistente({ base, menu }) {
  const [passo, setPasso] = useState(0);
  const [dados, setDados] = useState(null);       // { prep, nomes, mes, m, assinatura, publicado }
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [envio, setEnvio] = useState(null);       // { feito, total }
  const [carr, setCarr] = useState(null);         // { id, resumo }
  const [confirmar, setConfirmar] = useState(false);
  const [preVer, setPreVer] = useState(false);

  // aviso ao fechar a página a meio do envio
  useEffect(() => {
    if (passo !== 2) return undefined;
    const f = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, [passo]);

  async function verificar(entradas, nomes) {
    setErro(''); setOcupado('A verificar os relatórios…');
    try {
      // o mesmo formato que vai para o servidor: o modelo local é feito exactamente com os dados enviados
      const env = prepararEnvio(entradas, nomes);
      const prep = env.objetos;
      const mes = mesDosRelatorios(prep.visitDb);
      const [ref, meses] = await Promise.all([api('GET', `/api/referencia?mes=${mes}`), api('GET', '/api/meses')]);
      const m = buildModel(prep, ref.referencia, base.locate, juntarAuditores(ref.auditores, prep.beatroute));
      const assinatura = await assinaturaDe(m);
      const publicado = meses.meses.find((x) => x.mes === mes && x.tipo === 'mensal') ?? null;
      setDados({ env, prep, nomes, mes, m, assinatura, publicado });
      setPasso(1);
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado('');
    }
  }

  async function enviar() {
    setErro(''); setConfirmar(false);
    const { env, mes, assinatura } = dados;
    try {
      setOcupado('A preparar o envio…');
      const { partes } = env;
      const total = Object.values(partes).reduce((a, p) => a + p.length, 0);
      const c = await api('POST', '/api/carregamentos', { mes, tipo: 'mensal', ficheiros: env.ficheiros });
      setPasso(2);
      let feito = 0;
      setEnvio({ feito, total });
      for (const [k, ps] of Object.entries(partes)) {
        for (let i = 0; i < ps.length; i++) {
          setOcupado(`A enviar ${REPORTS[k].nome} (${i + 1}/${ps.length})…`);
          const texto = JSON.stringify(ps[i]);
          const hash = await sha256Hex(texto);
          await comRepeticao(() => api('PUT', `/api/carregamentos/${c.id}/partes`,
            { relatorio: k, parte: i, total_partes: ps.length, linhas: ps[i].length, sha256: hash, dados: ps[i] }));
          setEnvio({ feito: ++feito, total });
        }
      }
      setOcupado('O servidor está a validar (refaz todas as contas)…');
      const v = await api('POST', `/api/carregamentos/${c.id}/validar`, { assinatura });
      setCarr({ id: c.id, resumo: v.resumo });
      setPasso(3);
    } catch (e) {
      setErro(e.message + (e.corpo?.erros?.length ? ` — ${e.corpo.erros.join('; ')}` : ''));
      setPasso(1);
    } finally {
      setOcupado(''); setEnvio(null);
    }
  }

  async function publicar() {
    setErro(''); setOcupado('A publicar…');
    try {
      await api('POST', `/api/carregamentos/${carr.id}/publicar`, { confirmar });
      setPasso(4);
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado('');
    }
  }

  async function cancelar() {
    if (carr) await api('POST', `/api/carregamentos/${carr.id}/cancelar`).catch(() => {});
    setCarr(null); setDados(null); setErro(''); setPasso(0);
  }

  if (preVer && dados) {
    return <Painel base={base} m={dados.m}
      aviso={<>Pré-visualização de {monthName(dados.mes)} — ainda NÃO publicada. <button type="button" className="btn-link" onClick={() => setPreVer(false)}>← Voltar ao assistente</button></>}
      barra={menu} />;
  }

  const m = dados?.m;
  const antes = dados?.publicado?.totais;
  const comp = carr?.resumo?.comparacao;
  return (
    <div className="pagina">
      <header className="topo topo-simples">
        <h1>Carregar dados</h1>
        <div className="topo-barra">{menu}</div>
      </header>
      <div className="assistente">
        <ol className="passos">
          {PASSOS.map((p, i) => <li key={p} className={i === passo ? 'atual' : i < passo ? 'feito' : ''}><span>{i < passo ? '✓' : i + 1}</span>{p}</li>)}
        </ol>
        {erro && <div className="erro">⚠ {erro}</div>}
        {ocupado && <div className="ocupado"><div className="spinner" aria-hidden />{ocupado}</div>}

        {passo === 0 && !ocupado && <Carregar onPronto={verificar} />}

        {passo === 1 && m && (
          <div className="carregar-cartao">
            <h2>2. Verificar — {m.mesNome}</h2>
            <p className="sub">Contas feitas no seu computador. {dados.publicado
              ? <>Já existe uma versão publicada deste mês ({new Date(dados.publicado.publicado_em).toLocaleString('pt-PT')}); a nova vai substituí-la depois de confirmar.</>
              : 'Ainda não há nenhuma versão deste mês publicada.'}</p>
            <div className="tabela-resumo">
              <div><span>Lojas visitadas</span><b>{n(m.totais.visitadas)} / {n(m.totais.esperadas)}</b><Delta antes={antes?.visitadas} agora={m.totais.visitadas} /></div>
              {ORDEM_ESTADOS.map((k) => (
                <div key={k}><span><i className="ponto" style={{ '--c': ESTADOS[k].cor }} /> {ESTADOS[k].label}</span><b>{n(m.totais.porEstado[k])}</b><Delta antes={antes?.porEstado?.[k]} agora={m.totais.porEstado[k]} /></div>
              ))}
              <div><span>Visitas</span><b>{n(m.totais.visitas)}</b><Delta antes={antes?.visitas} agora={m.totais.visitas} /></div>
              <div><span>Auditores</span><b>{n(m.totais.auditores)}</b><Delta antes={antes?.auditores} agora={m.totais.auditores} /></div>
            </div>
            <h3>Ficheiros</h3>
            <ul className="lista-simples">
              {Object.entries(dados.prep).map(([k, rows]) => <li key={k}><b>{REPORTS[k].nome}</b>: {n(rows.length)} linhas <small>({dados.nomes[k]})</small></li>)}
            </ul>
            <h3>Verificação</h3>
            <ul className="lista-simples">
              {m.avisos.map((a, i) => <li key={i} className="txt-alerta">⚠ {a}</li>)}
              {m.checks.filter((c) => c.lojas.length).map((c) => <li key={c.id} className={c.info ? '' : 'txt-alerta'}>{c.info ? 'ℹ' : '!'} {c.titulo}: <b>{n(c.lojas.length)}</b></li>)}
              {!dados.prep.qa && <li>ℹ Sem o QA_WD30.xlsx: o auditor das visitas fechadas vem das iniciais.</li>}
            </ul>
            <div className="carregar-acoes">
              <button type="button" className="btn btn-link" onClick={() => { setDados(null); setPasso(0); }}>← Escolher outros ficheiros</button>
              <div className="acoes-dir">
                <button type="button" className="btn" onClick={() => setPreVer(true)}>Ver no mapa</button>
                <button type="button" className="btn btn-primario" onClick={enviar} disabled={Boolean(ocupado)}>Enviar e validar →</button>
              </div>
            </div>
          </div>
        )}

        {passo === 2 && envio && (
          <div className="carregar-cartao">
            <h2>3. A enviar</h2>
            <div className="barra grande"><div style={{ width: `${(envio.feito / envio.total) * 100}%`, background: '#2a78d6' }} /></div>
            <p className="sub">{envio.feito} de {envio.total} partes. Não feche esta página. Se a ligação falhar, cada parte é repetida automaticamente.</p>
          </div>
        )}

        {passo === 3 && carr && (
          <div className="carregar-cartao">
            <h2>4. Publicar — {carr.resumo.mesNome}</h2>
            <div className="ok-caixa">✓ O servidor recebeu tudo, refez todas as contas e chegou aos mesmos números que o seu computador.</div>
            {comp?.publicadoId ? (
              <>
                <p className="sub">Comparação com a versão publicada agora:</p>
                <div className="tabela-resumo">
                  <div><span>Visitas novas</span><b>{n(comp.nNovas)}</b></div>
                  <div><span>Visitas que desaparecem</span><b className={comp.nRemovidas ? 'txt-alerta' : ''}>{n(comp.nRemovidas)}</b></div>
                  <div><span>Lojas visitadas</span><b>{n(carr.resumo.totais.visitadas)}</b><Delta antes={comp.totaisAntes?.visitadas} agora={carr.resumo.totais.visitadas} /></div>
                </div>
                {comp.nRemovidas > 0 && (
                  <div className="aviso">
                    <b>{n(comp.nRemovidas)} visitas da versão publicada deixam de existir nesta.</b> Isto acontece quando
                    a nova versão tem menos dados (ex.: ficheiro errado). Confirme só se for intencional.
                    <details><summary>Ver visitas</summary><code>{comp.removidas.join(', ')}</code></details>
                    <label className="confirmar"><input type="checkbox" checked={confirmar} onChange={(e) => setConfirmar(e.target.checked)} /> Confirmo, publicar mesmo assim</label>
                  </div>
                )}
              </>
            ) : <p className="sub">É a primeira versão deste mês.</p>}
            <div className="carregar-acoes">
              <button type="button" className="btn btn-link" onClick={cancelar}>Cancelar este carregamento</button>
              <button type="button" className="btn btn-primario" onClick={publicar}
                disabled={Boolean(ocupado) || (comp?.nRemovidas > 0 && !confirmar)}>Publicar para todos →</button>
            </div>
          </div>
        )}

        {passo === 4 && (
          <div className="carregar-cartao centro-texto">
            <div className="feito-icone">✓</div>
            <h2>Publicado</h2>
            <p className="sub">{carr?.resumo?.mesNome} já está disponível para todos. A versão anterior ficou guardada no histórico.</p>
            <a className="btn btn-primario" href="#/">Abrir o mapa</a>
          </div>
        )}
      </div>
    </div>
  );
}
