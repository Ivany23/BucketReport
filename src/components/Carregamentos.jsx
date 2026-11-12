// Histórico de carregamentos: todas as versões de cada mês, quem carregou/publicou, e voltar a uma versão anterior.
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { monthName } from '../lib/normalize.js';

const ESTADO = {
  a_receber: ['A receber', '#898781'], validado: ['Validado (não publicado)', '#eda100'], publicado: ['Publicado', '#0ca30c'],
  substituido: ['Substituído', '#6250d6'], falhado: ['Falhado', '#d03b3b'], cancelado: ['Cancelado', '#898781'],
};
const quando = (t) => (t ? new Date(t).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '—');

export default function Carregamentos({ menu }) {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState('');
  const [ocupado, setOcupado] = useState('');

  const carregar = () => api('GET', '/api/carregamentos').then((j) => setLista(j.carregamentos)).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);

  async function acao(c, tipo) {
    const msg = tipo === 'reverter'
      ? `Voltar a publicar esta versão de ${monthName(c.mes)}? A versão publicada agora passa a "substituída".`
      : tipo === 'publicar' ? `Publicar esta versão de ${monthName(c.mes)}?` : 'Cancelar este carregamento?';
    if (!window.confirm(msg)) return;
    setErro(''); setOcupado(c.id);
    try {
      if (tipo === 'cancelar') await api('POST', `/api/carregamentos/${c.id}/cancelar`);
      else await api('POST', `/api/carregamentos/${c.id}/publicar`, { confirmar: tipo === 'reverter' });
      await carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setOcupado('');
    }
  }

  return (
    <div className="pagina">
      <header className="topo topo-simples"><h1>Histórico de carregamentos</h1><div className="topo-barra">{menu}</div></header>
      <div className="assistente largo">
        {erro && <div className="erro">⚠ {erro}</div>}
        {!lista ? <div className="ocupado"><div className="spinner" />A carregar…</div> : (
          <table className="tabela tabela-hist">
            <thead><tr><th>Mês</th><th>Estado</th><th>Carregado</th><th>Publicado</th><th className="dir">Lojas visitadas</th><th className="dir">Visitas</th><th /></tr></thead>
            <tbody>
              {lista.map((c) => {
                const [txt, cor] = ESTADO[c.estado];
                const t = c.resumo?.totais;
                return [
                  <tr key={c.id} className={c.estado === 'publicado' ? 'linha-pub' : ''} onClick={() => setAberto(aberto === c.id ? '' : c.id)}>
                    <td><b>{monthName(c.mes)}</b>{c.tipo === 'referencia' && <small> · referência</small>}</td>
                    <td><span className="tag" style={{ '--c': cor }}>{txt}</span></td>
                    <td>{quando(c.criado_em)}<small>{c.criado_por_nome}</small></td>
                    <td>{quando(c.publicado_em)}<small>{c.publicado_por_nome}</small></td>
                    <td className="dir">{t ? `${t.visitadas.toLocaleString('pt-PT')} / ${t.esperadas.toLocaleString('pt-PT')}` : c.resumo?.lojas ?? '—'}</td>
                    <td className="dir">{t ? t.visitas.toLocaleString('pt-PT') : '—'}</td>
                    <td className="dir" onClick={(e) => e.stopPropagation()}>
                      {c.estado === 'validado' && <button type="button" className="btn btn-pequeno" disabled={ocupado === c.id} onClick={() => acao(c, 'publicar')}>Publicar</button>}
                      {c.estado === 'substituido' && c.dados_arquivados && <small>arquivada</small>}
                      {c.estado === 'substituido' && !c.dados_arquivados && <button type="button" className="btn btn-pequeno" disabled={ocupado === c.id} onClick={() => acao(c, 'reverter')}>Voltar a esta versão</button>}
                      {['a_receber', 'validado', 'falhado'].includes(c.estado) && <button type="button" className="btn-link" disabled={ocupado === c.id} onClick={() => acao(c, 'cancelar')}>Cancelar</button>}
                    </td>
                  </tr>,
                  aberto === c.id && (
                    <tr key={`${c.id}-d`} className="linha-detalhe"><td colSpan={7}>
                      <div><b>Ficheiros:</b> {c.ficheiros.map((f) => `${f.nome} (${f.linhas.toLocaleString('pt-PT')} linhas)`).join(' · ')}</div>
                      {c.erros?.length > 0 && <div className="txt-alerta"><b>Erros:</b> {c.erros.join(' · ')}</div>}
                      {c.resumo?.comparacao && <div><b>Comparado com a versão anterior:</b> {c.resumo.comparacao.nNovas} visitas novas, {c.resumo.comparacao.nRemovidas} removidas</div>}
                      {c.pacote_bytes && <div><b>Pacote:</b> {(c.pacote_bytes / 1024 / 1024).toFixed(2)} MB · sha256 {c.pacote_sha256.slice(0, 16)}…</div>}
                      <div><small>id {c.id}</small></div>
                    </td></tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
