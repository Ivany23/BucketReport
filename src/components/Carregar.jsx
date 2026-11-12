import { useRef, useState } from 'react';
import { REPORTS, readReportFile } from '../lib/reports.js';

const ORDEM = Object.keys(REPORTS);

/** Ficheiros de um "arrastar e largar", incluindo os que estão dentro de pastas (e subpastas) */
async function ficheirosDoDrop(dt) {
  const entries = [...(dt.items ?? [])].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  const out = [];
  async function visitar(e) {
    if (e.isFile) out.push(await new Promise((res, rej) => e.file(res, rej)));
    else if (e.isDirectory) {
      const reader = e.createReader();
      let lote;
      do {
        lote = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const x of lote) await visitar(x);
      } while (lote.length);
    }
  }
  for (const e of entries) await visitar(e);
  return out;
}

export default function Carregar({ onPronto }) {
  const [slots, setSlots] = useState({});          // tipo -> { name, rows }
  const [ignorados, setIgnorados] = useState([]);  // { name, motivo }
  const [aLer, setALer] = useState(0);
  const [erro, setErro] = useState('');
  const [arrastar, setArrastar] = useState(false);
  const inFiles = useRef(null);
  const inPasta = useRef(null);

  async function receber(fileList) {
    const files = [...fileList].filter((f) => /\.(csv|xlsx|xls)$/i.test(f.name));
    const outros = [...fileList].filter((f) => !/\.(csv|xlsx|xls)$/i.test(f.name));
    setErro('');
    setALer((n) => n + files.length);
    const novosIgn = outros.filter((f) => !f.name.startsWith('.')).map((f) => ({ name: f.name, motivo: 'não é CSV nem XLSX' }));
    const lidos = [];
    for (const f of files) {
      try {
        lidos.push(await readReportFile(f));
      } catch (e) {
        novosIgn.push({ name: f.name, motivo: `erro ao ler: ${e.message}` });
      } finally {
        setALer((n) => n - 1);
      }
    }
    setSlots((prev) => {
      const next = { ...prev };
      for (const r of lidos) {
        if (r.erro) novosIgn.push({ name: r.name, motivo: r.erro });
        else if (r.tipo === 'feedbackCleaned') novosIgn.push({ name: r.name, motivo: 'cópia do survey_feedback (categoria em PT) — não é preciso' });
        else if (!r.rows.length) novosIgn.push({ name: r.name, motivo: 'ficheiro sem linhas' });
        else if (REPORTS[r.tipo].varios) {
          // vários ficheiros brutos: junta (o mesmo ficheiro escolhido duas vezes só conta uma)
          const atual = next[r.tipo] ?? { name: '', nomes: [], rows: [] };
          if (!atual.nomes.includes(r.name)) {
            const nomes = [...atual.nomes, r.name];
            next[r.tipo] = { name: `${nomes.length} ficheiro(s)`, nomes, rows: [...atual.rows, ...r.rows] };
          }
        } else if (next[r.tipo] && next[r.tipo].name !== r.name) {
          novosIgn.push({ name: r.name, motivo: `${REPORTS[r.tipo].nome} já carregado (${next[r.tipo].name})` });
        } else next[r.tipo] = { name: r.name, rows: r.rows };
      }
      return next;
    });
    setIgnorados((prev) => [...prev, ...novosIgn]);
  }

  function abrir() {
    try {
      const rep = Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, v.rows]));
      const nomes = Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, v.nomes ? v.nomes.join(', ') : v.name]));
      onPronto(rep, nomes);
    } catch (e) {
      setErro(e.message);
    }
  }

  function limpar() {
    setSlots({});
    setIgnorados([]);
    setErro('');
  }

  const prontos = ORDEM.filter((k) => REPORTS[k].obrigatorio).every((k) => slots[k]);
  return (
    <div className="carregar-passo">
      <div className="carregar-cartao">
        <h2>1. Escolher os relatórios do mês</h2>
        <p className="sub">
          CSV ou XLSX — pode largar a pasta inteira (ex.: FReport30). A app reconhece cada relatório sozinha
          e ignora cópias e ficheiros que não são precisos.
        </p>

        <div
          className={`zona ${arrastar ? 'zona-ativa' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setArrastar(true); }}
          onDragLeave={() => setArrastar(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastar(false);
            ficheirosDoDrop(e.dataTransfer).then(receber).catch((err) => setErro(`não foi possível ler os ficheiros: ${err.message}`));
          }}
        >
          <div className="zona-icone" aria-hidden>⇪</div>
          <div><b>Arraste para aqui</b> os ficheiros dos relatórios</div>
          <div className="zona-botoes">
            <button type="button" className="btn" onClick={() => inFiles.current.click()}>Escolher ficheiros</button>
            <button type="button" className="btn" onClick={() => inPasta.current.click()}>Escolher pasta</button>
          </div>
          <input ref={inFiles} type="file" multiple accept=".csv,.xlsx,.xls" hidden
            onChange={(e) => { receber(e.target.files); e.target.value = ''; }} />
          <input ref={inPasta} type="file" webkitdirectory="" directory="" multiple hidden
            onChange={(e) => { receber(e.target.files); e.target.value = ''; }} />
        </div>

        <ul className="slots">
          {ORDEM.map((k) => {
            const s = slots[k];
            const r = REPORTS[k];
            return (
              <li key={k} className={s ? 'ok' : r.obrigatorio ? 'falta' : 'opcional'}>
                <span className="slot-icone" aria-hidden>{s ? '✓' : r.obrigatorio ? '•' : '○'}</span>
                <div className="slot-texto">
                  <div className="slot-nome">
                    {r.nome} <span className="slot-tag">{r.obrigatorio ? 'obrigatório' : 'opcional'}</span>
                  </div>
                  <div className="slot-papel">
                    {s ? `${s.name} — ${s.rows.length.toLocaleString('pt-PT')} linhas` : r.papel}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        {ignorados.length > 0 && (
          <div className="ignorados">
            <b>Ficheiros não usados</b>
            <ul>{ignorados.map((x, i) => <li key={i}>{x.name}: {x.motivo}</li>)}</ul>
          </div>
        )}
        {erro && <div className="erro">⚠ {erro}</div>}

        <div className="carregar-acoes">
          <button type="button" className="btn btn-link" onClick={limpar} disabled={!Object.keys(slots).length && !ignorados.length}>Limpar</button>
          <button type="button" className="btn btn-primario" onClick={abrir} disabled={!prontos || aLer > 0}>
            {aLer > 0 ? `A ler ${aLer} ficheiro(s)…` : 'Verificar →'}
          </button>
        </div>
        <p className="nota">Nada é enviado ainda: no passo seguinte vê o resultado antes de enviar.</p>
      </div>
    </div>
  );
}
