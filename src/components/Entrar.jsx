import { useState } from 'react';
import { api } from '../lib/api.js';

export default function Entrar({ onEntrou }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [aEntrar, setAEntrar] = useState(false);

  async function submeter(e) {
    e.preventDefault();
    setErro('');
    setAEntrar(true);
    try {
      const j = await api('POST', '/api/auth/entrar', { email, senha });
      onEntrou(j.utilizador);
    } catch (err) {
      setErro(err.message);
    } finally {
      setAEntrar(false);
    }
  }

  return (
    <div className="carregar">
      <form className="carregar-cartao entrar" onSubmit={submeter}>
        <h1>Mapa de lojas</h1>
        <p className="sub">Entre com o seu email e palavra-passe.</p>
        <label>Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>Palavra-passe
          <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </label>
        {erro && <div className="erro">⚠ {erro}</div>}
        <button type="submit" className="btn btn-primario largo" disabled={aEntrar}>{aEntrar ? 'A entrar…' : 'Entrar'}</button>
        <p className="nota">Sem conta? Peça ao administrador.</p>
      </form>
    </div>
  );
}
