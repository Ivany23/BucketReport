// Orquestração de um carregamento (uma versão dos relatórios de um mês):
//
//   1. criar        browser declara mês + ficheiros (relatório, linhas, nº de partes)          -> estado a_receber
//   2. partes       browser envia cada parte (<= ~1,5 MB) com sha256; repetir uma parte é seguro (idempotente)
//   3. validar      servidor confirma que chegou tudo, refaz o modelo com o MESMO código do browser, compara a
//                   assinatura (totais) com a do browser, compara com a versão publicada, gera o pacote -> validado
//   4. publicar     transacção: trava o mês, a versão anterior passa a "substituido", esta a "publicado"
//                   (a base de dados garante 1 publicado por mês); voltar a uma versão antiga = publicar essa
//
// Qualquer erro deixa o carregamento em "falhado" com a explicação, e a versão publicada não é tocada.
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buf } from './db.js';
import { ErroHttp, sha256, registar } from './auth.js';
import { REPORTS, COLUNAS, detectReport } from '../src/lib/reports.js';
import { TABELAS_API, nomeTabela, paraObjetos } from '../src/lib/envio.js';
import { buildModel } from '../src/lib/model.js';
import { makeLocator } from '../src/lib/provinces.js';
import { lojasDoMesReferencia, lojasDoMesMensal, montarReferencia, juntarAuditores, mesDosRelatorios } from '../src/lib/referencia.js';
import { resumoParaAssinatura, idsVisitas } from '../src/lib/assinatura.js';
import { monthName } from '../src/lib/normalize.js';

export const MAX_LINHAS_PARTE = 20000;
const FATIA_PACOTE = 3 * 1024 * 1024;        // resposta da Vercel <= 4,5 MB
export const VERSAO_PACOTE = 1;
export const LINHAS_POR_PAGINA = 10000;      // página da API de dados: até 10 000 linhas...
const BYTES_POR_PAGINA = 2_500_000;          // ...e até ~2,5 MB de JSON
const VERSOES_COM_DADOS = 2;                 // por mês: publicada + 2 anteriores com dados completos (reversíveis)
const TIPOS = Object.keys(REPORTS);

let geo = null;
export function geoProvincias() {
  if (!geo) {
    geo = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', 'provincias_mz.geojson'), 'utf8'));
    geo.locate = makeLocator(geo);
  }
  return geo;
}

/** Lojas esperadas de um mês = lojas dos carregamentos PUBLICADOS dos meses anteriores */
export async function referenciaPara(db, mes) {
  const r = await db.query(
    `SELECT c.mes, cl.store_id, cl.estado, cl.so_pap, cl.demo
       FROM carregamento_lojas cl JOIN carregamentos c ON c.id = cl.carregamento_id
      WHERE c.estado = 'publicado' AND c.mes < $1 ORDER BY c.mes, cl.store_id`, [mes]);
  return montarReferencia(r.rows.map((x) => ({ mes: x.mes.trim(), store_id: x.store_id, estado: x.estado, soPap: x.so_pap, demo: x.demo })));
}

export async function auditoresBase(db) {
  return (await db.query('SELECT nome, iniciais FROM auditores ORDER BY nome')).rows;
}

async function obter(db, id, paraAtualizar = false) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) throw new ErroHttp(404, 'Carregamento não encontrado');
  const c = (await db.query(`SELECT * FROM carregamentos WHERE id = $1${paraAtualizar ? ' FOR UPDATE' : ''}`, [id])).rows[0];
  if (!c) throw new ErroHttp(404, 'Carregamento não encontrado');
  c.mes = c.mes.trim();
  return c;
}

async function falhar(db, id, erros) {
  await db.query(`UPDATE carregamentos SET estado = 'falhado', erros = $2::jsonb WHERE id = $1 AND estado = 'a_receber'`,
    [id, JSON.stringify(erros)]);
  await db.query('DELETE FROM carregamento_partes WHERE carregamento_id = $1', [id]);
}

// ---------------------------------------------------------------- 1. criar
export async function criar(db, user, { mes, tipo = 'mensal', ficheiros }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes))) throw new ErroHttp(400, 'Mês inválido (AAAA-MM)');
  if (!['mensal', 'referencia'].includes(tipo)) throw new ErroHttp(400, 'Tipo inválido');
  if (!Array.isArray(ficheiros) || !ficheiros.length) throw new ErroHttp(400, 'Sem ficheiros');
  const vistos = new Set();
  const lista = ficheiros.map((f) => {
    if (!TIPOS.includes(f.tipo)) throw new ErroHttp(400, `Relatório desconhecido: ${f.tipo}`);
    if (vistos.has(f.tipo)) throw new ErroHttp(400, `Relatório repetido: ${f.tipo}`);
    vistos.add(f.tipo);
    if (!Number.isInteger(f.linhas) || f.linhas < 0 || !Number.isInteger(f.partes) || f.partes < 1 || f.partes > 500) {
      throw new ErroHttp(400, `Linhas / partes inválidas em ${f.tipo}`);
    }
    const col = f.colunas;
    if (!Array.isArray(col) || !col.length || col.length > 400 || col.some((c) => typeof c !== 'string' || !c.trim())
        || new Set(col).size !== col.length) {
      throw new ErroHttp(400, `Colunas inválidas em ${REPORTS[f.tipo].nome}`);
    }
    if (TABELAS_API.includes(f.tipo)) {
      // as colunas declaradas têm de ser as de um ficheiro deste relatório (a mesma regra que reconheceu o ficheiro)
      if (detectReport(col, '') !== f.tipo) throw new ErroHttp(400, `As colunas enviadas não são de um ${REPORTS[f.tipo].nome}`);
    } else if (JSON.stringify(col) !== JSON.stringify(COLUNAS[f.tipo])) {
      throw new ErroHttp(400, `Colunas inesperadas em ${REPORTS[f.tipo].nome}`);
    }
    return { tipo: f.tipo, nome: String(f.nome ?? f.tipo).slice(0, 2000), colunas: col, linhas: f.linhas, partes: f.partes };
  });
  for (const t of ['demographic', 'visitDb']) if (!vistos.has(t)) throw new ErroHttp(400, `Falta o relatório obrigatório ${REPORTS[t].nome}`);
  // limpeza: rascunhos e validações nunca publicadas com mais de 1 dia
  await db.query(`DELETE FROM carregamentos WHERE estado IN ('a_receber', 'falhado', 'cancelado', 'validado') AND criado_em < now() - interval '1 day'`);
  const c = (await db.query(
    `INSERT INTO carregamentos (mes, tipo, criado_por, ficheiros) VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
    [mes, tipo, user?.id ?? null, JSON.stringify(lista)])).rows[0];
  await registar(db, user?.id ?? null, 'criar_carregamento', { id: c.id, mes, tipo, ficheiros: lista });
  return { id: c.id };
}

// ---------------------------------------------------------------- 2. partes
export async function receberParte(db, user, id, { relatorio, parte, total_partes: total, linhas, sha256: hash, dados }) {
  const c = await obter(db, id);
  if (c.estado !== 'a_receber') throw new ErroHttp(409, `O carregamento já não está a receber dados (estado: ${c.estado})`);
  const f = c.ficheiros.find((x) => x.tipo === relatorio);
  if (!f) throw new ErroHttp(400, `Relatório não declarado neste carregamento: ${relatorio}`);
  if (total !== f.partes || !Number.isInteger(parte) || parte < 0 || parte >= total) throw new ErroHttp(400, `Parte inválida ${parte}/${total} (${relatorio})`);
  if (!Array.isArray(dados) || dados.length !== linhas) throw new ErroHttp(400, `Nº de linhas não confere (${relatorio} parte ${parte})`);
  if (linhas > MAX_LINHAS_PARTE) throw new ErroHttp(400, 'Parte demasiado grande');
  const nc = f.colunas.length;
  for (const l of dados) {
    if (!Array.isArray(l) || l.length !== nc || l.some((v) => typeof v !== 'string')) {
      throw new ErroHttp(400, `Linha com formato errado em ${REPORTS[relatorio].nome} (parte ${parte}): esperadas ${nc} colunas de texto`);
    }
  }
  const texto = JSON.stringify(dados);
  if (sha256(texto) !== hash) throw new ErroHttp(400, `Parte corrompida no envio (${relatorio} parte ${parte}): sha256 diferente`);
  const ins = await db.query(
    `INSERT INTO carregamento_partes (carregamento_id, relatorio, parte, total_partes, linhas, sha256, dados_gz)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING parte`,
    [id, relatorio, parte, total, linhas, hash, gzipSync(texto)]);
  if (!ins.rows.length) {
    const ex = (await db.query('SELECT sha256 FROM carregamento_partes WHERE carregamento_id = $1 AND relatorio = $2 AND parte = $3', [id, relatorio, parte])).rows[0];
    if (ex?.sha256 !== hash) throw new ErroHttp(409, `A parte ${parte} de ${relatorio} já foi recebida com conteúdo diferente`);
  }
  return { ok: true, repetida: !ins.rows.length };
}

async function juntarPartes(db, c) {
  const rows = (await db.query(
    'SELECT relatorio, parte, total_partes, linhas, sha256, dados_gz FROM carregamento_partes WHERE carregamento_id = $1 ORDER BY relatorio, parte', [c.id])).rows;
  const erros = [];
  const rep = {};
  const tabelas = {};
  for (const f of c.ficheiros) {
    const ps = rows.filter((r) => r.relatorio === f.tipo);
    const faltam = [];
    for (let i = 0; i < f.partes; i++) if (!ps.some((p) => p.parte === i)) faltam.push(i);
    if (faltam.length) { erros.push(`${REPORTS[f.tipo].nome}: faltam as partes ${faltam.join(', ')}`); continue; }
    const linhas = [];
    for (const p of ps) {
      const texto = gunzipSync(buf(p.dados_gz)).toString('utf8');
      if (sha256(texto) !== p.sha256) { erros.push(`${REPORTS[f.tipo].nome}: parte ${p.parte} danificada na base de dados`); continue; }
      const d = JSON.parse(texto);
      if (d.length !== p.linhas) erros.push(`${REPORTS[f.tipo].nome}: parte ${p.parte} com nº de linhas errado`);
      for (const x of d) linhas.push(x);
    }
    if (linhas.length !== f.linhas) erros.push(`${REPORTS[f.tipo].nome}: chegaram ${linhas.length} linhas, esperadas ${f.linhas}`);
    rep[f.tipo] = paraObjetos(f.colunas, linhas);
    if (TABELAS_API.includes(f.tipo)) tabelas[f.tipo] = { colunas: f.colunas, linhas };
  }
  return { rep, tabelas, erros };
}

/** Páginas da API de dados: o corpo JSON de cada resposta, já comprimido */
function paginarTabela(tipo, mes, { colunas, linhas }) {
  const relatorio = nomeTabela(tipo);
  // páginas de até 10 000 linhas E até ~2,5 MB sem compressão (a Vercel aceita respostas até 4,5 MB,
  // e um cliente que não aceite gzip recebe a página sem compressão)
  const fatias = [];
  let atual = [], tam = 0;
  for (const l of linhas) {
    const t = JSON.stringify(l).length + 1;
    if (atual.length && (atual.length >= LINHAS_POR_PAGINA || tam + t > BYTES_POR_PAGINA)) { fatias.push(atual); atual = []; tam = 0; }
    atual.push(l); tam += t;
  }
  fatias.push(atual);
  const paginas = fatias.length;
  const out = fatias.map((fatia, i) => {
    const corpo = { tabela: relatorio, mes, pagina: i + 1, paginas, linhas_total: linhas.length, linhas_pagina: fatia.length, colunas, linhas: fatia };
    return { pagina: i + 1, linhas: fatia.length, gz: gzipSync(JSON.stringify(corpo), { level: 9 }) };
  });
  return { relatorio, colunas, total: linhas.length, paginas, out };
}

/** Linhas para o pacote do painel: só as colunas que o painel usa (o resto fica na API de dados) */
function paraPacote(rep) {
  const o = {};
  for (const [k, rows] of Object.entries(rep)) {
    const cols = COLUNAS[k];
    o[k] = cols ? rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? '']))) : rows;
  }
  return o;
}

/** Processa os relatórios de um mês (sem base de dados): modelo, lojas, resumo e pacote */
export function processar({ rep, mes, tipo, referencia, auditores }) {
  const g = geoProvincias();
  const mesDados = mesDosRelatorios(rep.visitDb);
  if (mesDados !== mes) throw new ErroHttp(422, `Os relatórios são de ${monthName(mesDados)}, mas o carregamento foi criado para ${monthName(mes)}`);
  if (tipo === 'referencia') {
    const lojas = lojasDoMesReferencia(rep, mes);
    return { lojas, resumo: { mes, mesNome: monthName(mes), tipo, lojas: lojas.length }, pacote: null, assinatura: null, visitas: [] };
  }
  const auds = juntarAuditores(auditores, rep.beatroute);
  const m = buildModel(rep, referencia, g.locate, auds);
  const lojas = lojasDoMesMensal(m);
  const resumo = {
    mes, mesNome: m.mesNome, tipo,
    totais: m.totais,
    provincias: m.provincias.map((p) => ({ nome: p.nome, visitadas: p.visitadas, esperadas: p.esperadas, novas: p.novas })),
    checks: m.checks.map((c) => ({ id: c.id, titulo: c.titulo, n: c.lojas.length, info: Boolean(c.info) })),
    avisos: m.avisos,
    referencia: referencia.meses,
    auditoresNovos: auds.filter((a) => !auditores.some((b) => b.nome === a.nome)),
  };
  const pacote = { versao: VERSAO_PACOTE, mes, rep: paraPacote(rep), referencia, auditores: auds };
  return { lojas, resumo, pacote, assinatura: JSON.stringify(resumoParaAssinatura(m)), visitas: idsVisitas(m) };
}

// ---------------------------------------------------------------- 3. validar
export async function validar(db, user, id, { assinatura } = {}) {
  const c = await obter(db, id);
  if (c.estado !== 'a_receber') throw new ErroHttp(409, `Não é possível validar: estado ${c.estado}`);
  const { rep, tabelas, erros } = await juntarPartes(db, c);
  if (erros.length) {
    await falhar(db, id, erros);
    throw new ErroHttp(422, 'Os dados não chegaram completos', { erros });
  }
  let r;
  const referencia = await referenciaPara(db, c.mes);
  try {
    r = processar({ rep, mes: c.mes, tipo: c.tipo, referencia, auditores: await auditoresBase(db) });
  } catch (e) {
    await falhar(db, id, [e.message]);
    throw new ErroHttp(422, `Os relatórios têm um erro: ${e.message}`, { erros: [e.message] });
  }
  const assinaturaServidor = r.assinatura ? sha256(r.assinatura) : null;
  if (c.tipo === 'mensal' && assinatura !== assinaturaServidor) {
    const msg = 'O servidor não chegou aos mesmos números que o browser (os dados de referência podem ter mudado entretanto). Carregue de novo.';
    await falhar(db, id, [msg]);
    throw new ErroHttp(409, msg, { erros: [msg] });
  }
  // comparação com a versão publicada do mesmo mês
  const pub = (await db.query(`SELECT id, publicado_em, resumo FROM carregamentos WHERE mes = $1 AND estado = 'publicado'`, [c.mes])).rows[0];
  if (pub) {
    const antes = new Set(pub.resumo?.visitas ?? []);
    const agora = new Set(r.visitas);
    const removidas = [...antes].filter((v) => !agora.has(v));
    r.resumo.comparacao = {
      publicadoId: pub.id, publicadoEm: pub.publicado_em, totaisAntes: pub.resumo?.totais ?? null,
      nRemovidas: removidas.length, removidas: removidas.slice(0, 200), nNovas: [...agora].filter((v) => !antes.has(v)).length,
    };
  } else {
    r.resumo.comparacao = { publicadoId: null, nRemovidas: 0, removidas: [], nNovas: r.visitas.length };
  }
  r.resumo.visitas = r.visitas;
  // pacote do painel: JSON comprimido, em fatias
  let gz = null, fatias = [];
  if (r.pacote) {
    r.pacote.carregamento = id;
    gz = gzipSync(JSON.stringify(r.pacote), { level: 9 });
    for (let i = 0; i < gz.length; i += FATIA_PACOTE) fatias.push(gz.subarray(i, i + FATIA_PACOTE));
  }
  await db.transacao(async (t) => {
    const up = await t.query(
      `UPDATE carregamentos SET estado = 'validado', validado_em = now(), resumo = $2::jsonb, assinatura = $3, erros = '[]'::jsonb,
              pacote_sha256 = $4, pacote_bytes = $5, pacote_partes = $6
        WHERE id = $1 AND estado = 'a_receber' RETURNING id`,
      [id, JSON.stringify(r.resumo), assinaturaServidor, gz ? sha256(gz) : null, gz ? gz.length : null, fatias.length]);
    if (!up.rows.length) throw new ErroHttp(409, 'O carregamento mudou de estado durante a validação');
    for (let i = 0; i < fatias.length; i++) {
      await t.query('INSERT INTO carregamento_pacote (carregamento_id, parte, dados) VALUES ($1, $2, $3)', [id, i, fatias[i]]);
    }
    for (const [tipo, tab] of Object.entries(tabelas)) {
      const pg = paginarTabela(tipo, c.mes, tab);
      await t.query('INSERT INTO carregamento_tabelas (carregamento_id, relatorio, colunas, linhas, paginas) VALUES ($1, $2, $3::jsonb, $4, $5)',
        [id, pg.relatorio, JSON.stringify(pg.colunas), pg.total, pg.paginas]);
      for (const p of pg.out) {
        await t.query('INSERT INTO carregamento_tabela_paginas (carregamento_id, relatorio, pagina, linhas, dados_gz) VALUES ($1, $2, $3, $4, $5)',
          [id, pg.relatorio, p.pagina, p.linhas, p.gz]);
      }
    }
    for (let i = 0; i < r.lojas.length; i += 1000) {
      const lote = r.lojas.slice(i, i + 1000).map((l) => ({ s: l.store_id, e: l.estado ?? '', p: Boolean(l.soPap), d: l.demo }));
      await t.query(
        `INSERT INTO carregamento_lojas (carregamento_id, store_id, estado, so_pap, demo)
         SELECT $1, x.s, x.e, x.p, x.d FROM jsonb_to_recordset($2::jsonb) AS x(s text, e text, p boolean, d jsonb)`,
        [id, JSON.stringify(lote)]);
    }
    await t.query('DELETE FROM carregamento_partes WHERE carregamento_id = $1', [id]);
  });
  await registar(db, user?.id ?? null, 'validar_carregamento', { id, mes: c.mes, totais: r.resumo.totais ?? null });
  return semVisitas(r.resumo);
}

const semVisitas = (resumo) => {
  if (!resumo) return resumo;
  const { visitas, ...resto } = resumo;
  return resto;
};

// ---------------------------------------------------------------- 4. publicar
export async function publicar(db, user, id, { confirmar = false } = {}) {
  const res = await db.transacao(async (t) => {
    const c = await obter(t, id, true);
    if (!['validado', 'substituido'].includes(c.estado)) throw new ErroHttp(409, `Só se publica um carregamento validado (estado: ${c.estado})`);
    await t.query('INSERT INTO meses (mes) VALUES ($1) ON CONFLICT (mes) DO NOTHING', [c.mes]);
    const mesRow = (await t.query('SELECT carregamento_publicado FROM meses WHERE mes = $1 FOR UPDATE', [c.mes])).rows[0];
    const atual = mesRow.carregamento_publicado;
    if (c.estado === 'substituido' && c.dados_arquivados) {
      throw new ErroHttp(409, 'Esta versão está arquivada (os dados completos já foram apagados); não é possível voltar a ela.');
    }
    if (c.estado === 'substituido' && !confirmar) {
      throw new ErroHttp(409, 'Voltar a uma versão anterior: confirme a operação', { precisaConfirmar: 'reverter' });
    }
    if (c.estado === 'validado') {
      const comp = c.resumo?.comparacao ?? {};
      if ((comp.publicadoId ?? null) !== (atual ?? null)) {
        throw new ErroHttp(409, 'Outra versão deste mês foi publicada depois desta validação. Carregue de novo para comparar com ela.');
      }
      if (comp.nRemovidas > 0 && !confirmar) {
        throw new ErroHttp(409, `${comp.nRemovidas} visitas da versão publicada deixam de existir. Confirme para publicar.`,
          { precisaConfirmar: 'remocoes', removidas: comp.removidas });
      }
    }
    if (atual) await t.query(`UPDATE carregamentos SET estado = 'substituido' WHERE id = $1 AND estado = 'publicado'`, [atual]);
    await t.query(`UPDATE carregamentos SET estado = 'publicado', publicado_em = now(), publicado_por = $2 WHERE id = $1`, [id, user?.id ?? null]);
    await t.query('UPDATE meses SET carregamento_publicado = $2 WHERE mes = $1', [c.mes, id]);
    for (const a of c.resumo?.auditoresNovos ?? []) {
      await t.query(`INSERT INTO auditores (nome, iniciais) VALUES ($1, $2) ON CONFLICT (nome) DO NOTHING`, [a.nome, a.iniciais]);
    }
    // espaço na base: só a publicada + as VERSOES_COM_DADOS substituídas mais recentes guardam os dados completos
    const velhas = (await t.query(
      `SELECT id FROM carregamentos WHERE mes = $1 AND estado = 'substituido' AND NOT dados_arquivados
        ORDER BY publicado_em DESC OFFSET $2`, [c.mes, VERSOES_COM_DADOS])).rows.map((r) => r.id);
    for (const v of velhas) await apagarDados(t, v, true);
    // outras versões validadas deste mês ficaram obsoletas (foram comparadas com outra versão publicada): canceladas
    const obsoletas = (await t.query(
      `UPDATE carregamentos SET estado = 'cancelado' WHERE mes = $1 AND estado = 'validado' AND id <> $2 RETURNING id`, [c.mes, id])).rows.map((r) => r.id);
    for (const v of obsoletas) await apagarDados(t, v, false);
    return { mes: c.mes, anterior: atual, arquivadas: velhas.length, canceladas: obsoletas.length };
  });
  await registar(db, user?.id ?? null, 'publicar_carregamento', { id, ...res });
  return { ok: true, ...res };
}

// ---------------------------------------------------------------- cancelar / consultar
export async function cancelar(db, user, id) {
  const c = await obter(db, id);
  if (!['a_receber', 'validado', 'falhado'].includes(c.estado)) throw new ErroHttp(409, `Não é possível cancelar (estado: ${c.estado})`);
  await db.transacao(async (t) => {
    await t.query(`UPDATE carregamentos SET estado = 'cancelado' WHERE id = $1`, [id]);
    await apagarDados(t, id, false);
  });
  await registar(db, user?.id ?? null, 'cancelar_carregamento', { id });
  return { ok: true };
}

/** Apaga os dados pesados de um carregamento (partes, pacote, lojas, tabelas). arquivar = marca-o como arquivado. */
async function apagarDados(t, id, arquivar) {
  await t.query('DELETE FROM carregamento_partes WHERE carregamento_id = $1', [id]);
  await t.query('DELETE FROM carregamento_pacote WHERE carregamento_id = $1', [id]);
  await t.query('DELETE FROM carregamento_lojas WHERE carregamento_id = $1', [id]);
  await t.query('DELETE FROM carregamento_tabelas WHERE carregamento_id = $1', [id]);   // as páginas vão em cascata
  if (arquivar) await t.query('UPDATE carregamentos SET dados_arquivados = true WHERE id = $1', [id]);
}

// ---------------------------------------------------------------- API de dados (chave de API)
/** Meses publicados com as tabelas disponíveis e as colunas pela ordem original */
export async function catalogoDados(db) {
  const r = await db.query(
    `SELECT c.id, c.mes, c.tipo, c.publicado_em, t.relatorio, t.colunas, t.linhas, t.paginas
       FROM carregamentos c JOIN carregamento_tabelas t ON t.carregamento_id = c.id
      WHERE c.estado = 'publicado' ORDER BY c.mes, t.relatorio`);
  const meses = new Map();
  for (const x of r.rows) {
    const mes = x.mes.trim();
    if (!meses.has(mes)) meses.set(mes, { mes, nome: monthName(mes), versao: x.id, publicado_em: x.publicado_em, tabelas: [] });
    meses.get(mes).tabelas.push({
      tabela: x.relatorio, linhas: x.linhas, paginas: x.paginas,
      colunas: x.colunas.map((nome, i) => ({ posicao: i + 1, nome })),
    });
  }
  return [...meses.values()];
}

/** Uma página (corpo JSON comprimido) de uma tabela do mês publicado */
export async function paginaTabela(db, tabela, mes, pagina) {
  if (!Object.values(REPORTS).some((r) => r.nome === tabela) || !TABELAS_API.some((t) => nomeTabela(t) === tabela)) {
    throw new ErroHttp(404, `Tabela inexistente: ${tabela}. Tabelas: ${TABELAS_API.map(nomeTabela).join(', ')}`);
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(mes))) throw new ErroHttp(400, 'Indique o mês: mes=AAAA-MM (ex.: mes=2026-11)');
  const p = pagina === null || pagina === undefined || pagina === '' ? 1 : Number(pagina);
  if (!Number.isInteger(p) || p < 1) throw new ErroHttp(400, 'pagina tem de ser um número inteiro >= 1');
  const t = (await db.query(
    `SELECT c.id, c.publicado_em, t.paginas FROM carregamentos c JOIN carregamento_tabelas t ON t.carregamento_id = c.id
      WHERE c.mes = $1 AND c.estado = 'publicado' AND t.relatorio = $2`, [mes, tabela])).rows[0];
  if (!t) throw new ErroHttp(404, `Sem dados publicados de ${tabela} para ${mes}`);
  if (p > t.paginas) throw new ErroHttp(404, `A tabela tem ${t.paginas} página(s)`);
  const r = (await db.query('SELECT dados_gz FROM carregamento_tabela_paginas WHERE carregamento_id = $1 AND relatorio = $2 AND pagina = $3',
    [t.id, tabela, p])).rows[0];
  return { gz: buf(r.dados_gz), versao: t.id, paginas: t.paginas, publicado_em: t.publicado_em };
}

const CAMPOS_LISTA = `c.id, c.mes, c.tipo, c.estado, c.criado_em, c.validado_em, c.publicado_em, c.ficheiros, c.erros, c.dados_arquivados,
  c.pacote_bytes, c.pacote_partes, c.pacote_sha256, c.resumo - 'visitas' AS resumo,
  uc.nome AS criado_por_nome, up.nome AS publicado_por_nome`;

export async function listar(db) {
  const r = await db.query(`SELECT ${CAMPOS_LISTA} FROM carregamentos c
    LEFT JOIN utilizadores uc ON uc.id = c.criado_por LEFT JOIN utilizadores up ON up.id = c.publicado_por
    ORDER BY c.criado_em DESC LIMIT 200`);
  return r.rows.map((x) => ({ ...x, mes: x.mes.trim() }));
}

export async function detalhe(db, id) {
  await obter(db, id);
  const r = await db.query(`SELECT ${CAMPOS_LISTA} FROM carregamentos c
    LEFT JOIN utilizadores uc ON uc.id = c.criado_por LEFT JOIN utilizadores up ON up.id = c.publicado_por WHERE c.id = $1`, [id]);
  return { ...r.rows[0], mes: r.rows[0].mes.trim() };
}

/** Meses publicados (para o ecrã inicial) */
export async function mesesPublicados(db) {
  const r = await db.query(`SELECT c.id, c.mes, c.tipo, c.publicado_em, c.pacote_partes, c.pacote_bytes, c.pacote_sha256,
      c.resumo -> 'totais' AS totais, c.resumo ->> 'mesNome' AS "mesNome"
    FROM carregamentos c WHERE c.estado = 'publicado' ORDER BY c.mes DESC`);
  return r.rows.map((x) => ({ ...x, mes: x.mes.trim() }));
}

/** Uma fatia do pacote. Leitor: só versões publicadas; admin: também validadas / substituídas (pré-visualizar). */
export async function pacoteParte(db, user, id, parte) {
  const c = await obter(db, id);
  const permitido = c.estado === 'publicado' || (user.papel === 'admin' && ['validado', 'substituido'].includes(c.estado));
  if (!permitido) throw new ErroHttp(404, 'Pacote não disponível');
  const p = Number(parte);
  if (!Number.isInteger(p) || p < 0 || p >= (c.pacote_partes ?? 0)) throw new ErroHttp(404, 'Parte inexistente');
  const r = (await db.query('SELECT dados FROM carregamento_pacote WHERE carregamento_id = $1 AND parte = $2', [id, p])).rows[0];
  if (!r) throw new ErroHttp(404, 'Parte inexistente');
  return { bytes: buf(r.dados), partes: c.pacote_partes, sha256: c.pacote_sha256 };
}
