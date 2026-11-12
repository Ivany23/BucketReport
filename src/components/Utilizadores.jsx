// Gestão de utilizadores (só administradores): criar, mudar papel, desactivar, nova palavra-passe.
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

const VAZIO = { email: '', nome: '', papel: 'leitor', senha: '' };

export default function Utilizadores({ user, menu }) {
  const [lista, setLista] = useState(null);
  const [novo, setNovo] = useState(VAZIO);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');

  const carregar = () => api('GET', '/api/utilizadores').then((j) => setLista(j.utilizadores)).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, []);

  async function correr(fn, sucesso) {
    setErro(''); setOk('');
    try { await fn(); setOk(sucesso); await carregar(); } catch (e) { setErro(e.message); }
  }

  function criar(e) {
    e.preventDefault();
    correr(async () => { await api('POST', '/api/utilizadores', novo); setNovo(VAZIO); }, `Utilizador ${novo.email} criado.`);
  }

  function novaSenha(u) {
    const senha = window.prompt(`Nova palavra-passe para ${u.nome} (mínimo 10 caracteres):`);
    if (senha) correr(() => api('PATCH', `/api/utilizadores/${u.id}`, { senha }), `Palavra-passe de ${u.nome} alterada.`);
  }

  return (
    <div className="pagina">
      <header className="topo topo-simples"><h1>Utilizadores</h1><div className="topo-barra">{menu}</div></header>
      <div className="assistente">
        {erro && <div className="erro">⚠ {erro}</div>}
        {ok && <div className="ok-caixa">✓ {ok}</div>}
        <form className="carregar-cartao form-linha" onSubmit={criar}>
          <h2>Novo utilizador</h2>
          <label>Nome<input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} required /></label>
          <label>Email<input type="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} required /></label>
          <label>Papel
            <select value={novo.papel} onChange={(e) => setNovo({ ...novo, papel: e.target.value })}>
              <option value="leitor">Leitor (só vê o mapa)</option>
              <option value="admin">Administrador (carrega e publica)</option>
            </select>
          </label>
          <label>Palavra-passe inicial<input type="text" minLength={10} value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} required /></label>
          <button type="submit" className="btn btn-primario">Criar</button>
        </form>
        <div className="carregar-cartao">
          <h2>Utilizadores</h2>
          {!lista ? 'A carregar…' : (
            <table className="tabela">
              <thead><tr><th>Nome</th><th>Email</th><th>Papel</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {lista.map((u) => (
                  <tr key={u.id} className={u.ativo ? '' : 'inativo'}>
                    <td>{u.nome}</td><td>{u.email}</td>
                    <td>{u.papel === 'admin' ? 'Administrador' : 'Leitor'}</td>
                    <td>{u.ativo ? 'Activo' : 'Desactivado'}</td>
                    <td className="dir">
                      {u.id !== user.id && (
                        <>
                          <button type="button" className="btn-link" onClick={() => correr(() => api('PATCH', `/api/utilizadores/${u.id}`, { papel: u.papel === 'admin' ? 'leitor' : 'admin' }), 'Papel alterado.')}>
                            {u.papel === 'admin' ? 'Tornar leitor' : 'Tornar admin'}</button>{' · '}
                          <button type="button" className="btn-link" onClick={() => correr(() => api('PATCH', `/api/utilizadores/${u.id}`, { ativo: !u.ativo }), u.ativo ? 'Desactivado.' : 'Activado.')}>
                            {u.ativo ? 'Desactivar' : 'Activar'}</button>{' · '}
                        </>
                      )}
                      <button type="button" className="btn-link" onClick={() => novaSenha(u)}>Nova palavra-passe</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
