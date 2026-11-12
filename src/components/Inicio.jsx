import { useEffect, useRef, useState } from 'react';
import { api, baixarPacote } from '../lib/api.js';
import { buildModel } from '../lib/model.js';
import Painel from './Painel.jsx';

const quando = (t) => (t ? new Date(t).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');

/** Ecrã inicial: painel do último mês publicado (ou do mês escolhido) */
export default function Inicio({ base, user, menu }) {
  const [meses, setMeses] = useState(null);
  const [sel, setSel] = useState('');
  const [modelo, setModelo] = useState(null);
  const [prog, setProg] = useState(null);
  const [erro, setErro] = useState('');
  const [tentativa, setTentativa] = useState(0);
  const cache = useRef(new Map());

  useEffect(() => {
    setErro('');
    api('GET', '/api/meses')
      .then((j) => {
        const mensais = j.meses.filter((x) => x.tipo === 'mensal');
        setMeses(mensais);
        setSel((s) => (mensais.some((x) => x.id === s) ? s : mensais[0]?.id ?? ''));
      })
      .catch((e) => setErro(e.message));
  }, [tentativa]);

  useEffect(() => {
    if (!sel) return undefined;
    let vivo = true;
    setErro('');
    if (cache.current.has(sel)) { setModelo(cache.current.get(sel)); return undefined; }
    setModelo(null);
    setProg({ feito: 0, total: 1 });
    baixarPacote(sel, (feito, total) => vivo && setProg({ feito, total }))
      .then((p) => {
        const m = buildModel(p.rep, p.referencia, base.locate, p.auditores);
        cache.current.set(sel, m);
        if (vivo) { setModelo(m); setProg(null); }
      })
      .catch((e) => vivo && (setErro(e.message), setProg(null)));
    return () => { vivo = false; };
  }, [sel, base, tentativa]);

  const atual = meses?.find((x) => x.id === sel);
  const cabecalhoSimples = (conteudo) => (
    <div className="pagina">
      <header className="topo topo-simples"><h1>Mapa de lojas</h1><div className="topo-barra">{menu}</div></header>
      <div className="centro">{conteudo}</div>
    </div>
  );

  if (erro) {
    return cabecalhoSimples(
      <div className="estado-vazio">
        <b>Não foi possível abrir os dados</b><p>{erro}</p>
        <button type="button" className="btn" onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</button>
      </div>,
    );
  }
  if (meses && !meses.length) {
    return cabecalhoSimples(
      <div className="estado-vazio">
        <b>Ainda não há dados publicados</b>
        {user.papel === 'admin'
          ? <><p>Carregue os relatórios do mês para começar.</p><a className="btn btn-primario" href="#/carregar">⇪ Carregar dados</a></>
          : <p>Assim que o administrador publicar os relatórios do mês, aparecem aqui.</p>}
      </div>,
    );
  }
  if (!modelo) {
    return cabecalhoSimples(
      <div className="estado-vazio">
        <div className="spinner" aria-hidden />
        <b>A abrir {atual?.mesNome ?? 'os dados'}…</b>
        {prog && prog.total > 1 && <p>{prog.feito} de {prog.total}</p>}
      </div>,
    );
  }

  const barra = (
    <>
      <label className="sel-mes">
        <span className="sr">Mês</span>
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          {meses.map((x) => <option key={x.id} value={x.id}>{x.mesNome}</option>)}
        </select>
      </label>
      <span className="publicado" title="Versão publicada que está a ver">publicado {quando(atual?.publicado_em)}</span>
      {menu}
    </>
  );
  return <Painel base={base} m={modelo} barra={barra} />;
}
