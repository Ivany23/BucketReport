import { useEffect, useState } from 'react';
import { carregarBase } from './lib/base.js';
import { api } from './lib/api.js';
import Entrar from './components/Entrar.jsx';
import Inicio from './components/Inicio.jsx';
import Assistente from './components/Assistente.jsx';
import Carregamentos from './components/Carregamentos.jsx';
import Utilizadores from './components/Utilizadores.jsx';

/** Rota actual a partir do # do endereço: #/ (início), #/carregar, #/carregamentos, #/utilizadores */
function useRota() {
  const ler = () => window.location.hash.replace(/^#/, '') || '/';
  const [rota, setRota] = useState(ler);
  useEffect(() => {
    const f = () => setRota(ler());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return rota;
}
export const ir = (r) => { window.location.hash = r; };

export default function App() {
  const [base, setBase] = useState(null);
  const [erroBase, setErroBase] = useState('');
  const [user, setUser] = useState(undefined);          // undefined = a verificar; null = sem sessão
  const rota = useRota();

  useEffect(() => {
    carregarBase().then(setBase).catch((e) => setErroBase(e.message));
    api('GET', '/api/auth/eu').then((j) => setUser(j.utilizador)).catch(() => setUser(null));
    const fim = () => setUser(null);
    window.addEventListener('sessao-terminada', fim);
    return () => window.removeEventListener('sessao-terminada', fim);
  }, []);

  async function sairDaApp() {
    await api('POST', '/api/auth/sair').catch(() => {});
    setUser(null);
    ir('/');
  }

  if (erroBase) return <div className="centro erro-grande">Erro ao iniciar a app: {erroBase}</div>;
  if (user === undefined || !base) return <div className="centro">A abrir…</div>;
  if (!user) return <Entrar onEntrou={setUser} />;

  const admin = user.papel === 'admin';
  const menu = <Menu user={user} rota={rota} onSair={sairDaApp} />;
  if (rota === '/carregar' && admin) return <Assistente base={base} menu={menu} />;
  if (rota === '/carregamentos' && admin) return <Carregamentos menu={menu} />;
  if (rota === '/utilizadores' && admin) return <Utilizadores user={user} menu={menu} />;
  return <Inicio base={base} user={user} menu={menu} />;
}

function Menu({ user, rota, onSair }) {
  const [aberto, setAberto] = useState(false);
  const admin = user.papel === 'admin';
  const item = (r, t) => (
    <a href={`#${r}`} className={rota === r ? 'ativo' : ''} onClick={() => setAberto(false)}>{t}</a>
  );
  return (
    <div className="menu">
      <button type="button" className="btn btn-pequeno" onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
        ☰ {user.nome.split(' ')[0]}
      </button>
      {aberto && (
        <div className="menu-lista" onMouseLeave={() => setAberto(false)}>
          {item('/', '🗺 Mapa')}
          {admin && item('/carregar', '⇪ Carregar dados')}
          {admin && item('/carregamentos', '🗂 Histórico de carregamentos')}
          {admin && item('/utilizadores', '👥 Utilizadores')}
          <div className="menu-sep" />
          <div className="menu-quem">{user.nome}<small>{user.email} · {admin ? 'administrador' : 'leitor'}</small></div>
          <button type="button" onClick={onSair}>Sair</button>
        </div>
      )}
    </div>
  );
}
