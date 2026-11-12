// API de dados (administrador): chaves de API, catálogo das tabelas (colunas pela ordem original) e ligação ao Power BI.
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { monthName } from '../lib/normalize.js';

const quando = (t) => (t ? new Date(t).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function Copiar({ texto, rotulo = 'Copiar' }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn btn-pequeno" onClick={() => {
      navigator.clipboard.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); });
    }}>{ok ? '✓ Copiado' : rotulo}</button>
  );
}

function Codigo({ texto }) {
  return (
    <div className="codigo">
      <div className="codigo-barra"><Copiar texto={texto} /></div>
      <pre>{texto}</pre>
    </div>
  );
}

export default function ApiDados({ menu }) {
  const [chaves, setChaves] = useState(null);
  const [catalogo, setCatalogo] = useState(null);
  const [nome, setNome] = useState('');
  const [nova, setNova] = useState(null);
  const [erro, setErro] = useState('');
  const base = `${window.location.origin}/api/v1/`;

  const carregar = () => Promise.all([
    api('GET', '/api/chaves').then((j) => setChaves(j.chaves)),
    api('GET', '/api/dados/catalogo').then((j) => setCatalogo(j)),
  ]).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);

  async function criar(e) {
    e.preventDefault();
    setErro('');
    try {
      const j = await api('POST', '/api/chaves', { nome });
      setNova(j.chave);
      setNome('');
      carregar();
    } catch (err) { setErro(err.message); }
  }

  async function revogar(k) {
    if (!window.confirm(`Revogar a chave "${k.nome}"? Quem a usa (ex.: Power BI) deixa de ter acesso imediatamente.`)) return;
    try { await api('POST', `/api/chaves/${k.id}/revogar`); carregar(); } catch (err) { setErro(err.message); }
  }

  const tabelas = catalogo?.tabelas ?? ['demographic_file', 'survey_visit_db', 'survey_feedback', 'product_availability_price', 'Visibility_Quality'];

  const mFuncao = `// 1) Power BI > Obter dados > Consulta em branco > Editor avançado. Cole isto e dê o nome: HeinekenTabela
(tabela as text, mes as text) as table =>
let
    Base = "${base}",
    Pagina = (n as number) => Json.Document(Web.Contents(Base, [
        RelativePath = "tabelas/" & tabela,
        Query = [mes = mes, pagina = Number.ToText(n)],
        ApiKeyName = "api_key"
    ])),
    Primeira = Pagina(1),
    Restantes = if Primeira[paginas] > 1 then List.Transform({2..Primeira[paginas]}, each Pagina(_)) else {},
    Linhas = List.Combine(List.Transform({Primeira} & Restantes, each _[linhas])),
    // as colunas ficam exactamente pela ordem do relatório original
    Resultado = Table.FromRows(Linhas, Primeira[colunas])
in
    Resultado`;

  const mTodosMeses = (t) => `// 2) Nova consulta em branco (ex.: ${t}) — junta TODOS os meses publicados
let
    Base = "${base}",
    Meses = Json.Document(Web.Contents(Base, [RelativePath = "meses", ApiKeyName = "api_key"]))[meses],
    // do mais recente para o mais antigo: as colunas seguem a ordem do relatório mais recente
    Recentes = List.Sort(Meses, {each _[mes], Order.Descending}),
    ComTabela = List.Select(Recentes, (m) => List.Contains(List.Transform(m[tabelas], each _[tabela]), "${t}")),
    PorMes = List.Transform(ComTabela, (m) => Table.AddColumn(HeinekenTabela("${t}", m[mes]), "mes_relatorio", each m[mes], type text)),
    Juntas = Table.Combine(PorMes),
    Resultado = Table.ReorderColumns(Juntas, {"mes_relatorio"} & List.RemoveItems(Table.ColumnNames(Juntas), {"mes_relatorio"}))
in
    Resultado`;

  const [tabSel, setTabSel] = useState('product_availability_price');

  return (
    <div className="pagina">
      <header className="topo topo-simples"><h1>API de dados</h1><div className="topo-barra">{menu}</div></header>
      <div className="assistente largo">
        {erro && <div className="erro">⚠ {erro}</div>}

        <div className="carregar-cartao">
          <h2>Chaves de API</h2>
          <p className="sub">Quem tiver uma chave pode ler <b>todas as tabelas completas</b> dos meses publicados (só leitura),
            incluindo nomes e contactos dos donos das lojas. Dê uma chave por pessoa ou relatório, e revogue-a quando já não for precisa.</p>
          <form className="form-linha" onSubmit={criar}>
            <label>Para quem / para quê<input value={nome} onChange={(e) => setNome(e.target.value)} placeholder='ex.: "Power BI — Equipa comercial"' required /></label>
            <button type="submit" className="btn btn-primario">Criar chave</button>
          </form>
          {nova && (
            <div className="aviso chave-nova">
              <b>Chave "{nova.nome}" criada. Copie-a agora — não volta a ser mostrada.</b>
              <div className="chave-linha"><code>{nova.chave}</code><Copiar texto={nova.chave} /></div>
              <button type="button" className="btn-link" onClick={() => setNova(null)}>Já copiei</button>
            </div>
          )}
          {chaves && (
            <table className="tabela">
              <thead><tr><th>Nome</th><th>Chave</th><th>Criada</th><th>Último uso</th><th className="dir">Pedidos</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {chaves.length === 0 && <tr><td colSpan={7}>Ainda não há chaves.</td></tr>}
                {chaves.map((k) => (
                  <tr key={k.id} className={k.revogada_em ? 'inativo' : ''}>
                    <td>{k.nome}<small>{k.criada_por_nome}</small></td>
                    <td><code>{k.prefixo}…</code></td>
                    <td>{quando(k.criada_em)}</td>
                    <td>{quando(k.ultimo_uso)}</td>
                    <td className="dir">{Number(k.usos).toLocaleString('pt-PT')}</td>
                    <td>{k.revogada_em ? `Revogada ${quando(k.revogada_em)}` : 'Activa'}</td>
                    <td className="dir">{!k.revogada_em && <button type="button" className="btn-link" onClick={() => revogar(k)}>Revogar</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="carregar-cartao">
          <h2>Ligar ao Power BI</h2>
          <ol className="lista-simples passos-pbi">
            <li>Crie uma chave acima e copie-a.</li>
            <li>No Power BI Desktop: <b>Obter dados → Consulta em branco → Editor avançado</b>, cole a função 1 e dê-lhe o nome <code>HeinekenTabela</code>.</li>
            <li>Crie uma consulta por tabela com o código 2 (escolha a tabela abaixo). Quando o Power BI pedir credenciais,
              escolha <b>API Web</b> e cole a chave. Funciona também na actualização agendada do serviço Power BI.</li>
            <li>Todos os valores chegam como <b>texto</b>, exactamente como nos relatórios. Defina os tipos (número, data…) no Power Query.</li>
          </ol>
          <h3>Função 1</h3>
          <Codigo texto={mFuncao} />
          <h3>Consulta 2 — todos os meses de uma tabela</h3>
          <label className="sel-mes">Tabela:&nbsp;
            <select value={tabSel} onChange={(e) => setTabSel(e.target.value)}>
              {tabelas.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <Codigo texto={mTodosMeses(tabSel)} />
          <h3>Só um mês (outras ferramentas, Excel, browser)</h3>
          <Codigo texto={`${base}tabelas/${tabSel}?mes=2026-11&pagina=1            (JSON)
${base}tabelas/${tabSel}?mes=2026-11&pagina=1&formato=csv (CSV)
${base}meses                                              (catálogo)
Chave: cabeçalho "X-API-Key: <chave>", "Authorization: Bearer <chave>" ou parâmetro &api_key=<chave>`} />
        </div>

        <div className="carregar-cartao">
          <h2>Tabelas disponíveis</h2>
          <p className="sub">Só versões publicadas. Colunas pela ordem dos relatórios originais (posição 1 = primeira coluna).
            Em Setembro o product_availability_price ainda não tinha as colunas auditor_name e customer_id.</p>
          {!catalogo ? 'A carregar…' : catalogo.meses.map((m) => (
            <div key={m.mes} className="cat-mes">
              <h3>{monthName(m.mes)} <small>publicado {quando(m.publicado_em)}</small></h3>
              {m.tabelas.map((t) => (
                <details key={t.tabela} className="cat-tabela">
                  <summary><b>{t.tabela}</b> — {t.linhas.toLocaleString('pt-PT')} linhas · {t.colunas.length} colunas · {t.paginas} página(s)</summary>
                  <ol className="colunas">{t.colunas.map((c) => <li key={c.posicao} value={c.posicao}>{c.nome}</li>)}</ol>
                </details>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
