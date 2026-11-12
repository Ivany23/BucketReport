// "Assinatura" de um modelo: os números que o painel mostra, num JSON estável.
// O browser e o servidor calculam-na de forma independente com o mesmo código; têm de dar o mesmo sha256.

export function resumoParaAssinatura(m) {
  return {
    mes: m.mes,
    totais: m.totais,
    provincias: m.provincias.map((p) => [p.nome, p.visitadas, p.esperadas, p.novas, p.porEstado.auditada,
      p.porEstado.nao_auditada, p.porEstado.so_feedback, p.porEstado.por_visitar]),
    auditores: m.auditores.map((a) => [a.nome, a.nLojas, a.visitas, a.auditadas, a.naoAuditadas, a.soFeedback]),
    checks: m.checks.map((c) => [c.id, c.lojas.length]),
  };
}

/** Lista ordenada das visitas (para comparar versões: nenhuma visita pode desaparecer sem confirmação) */
export function idsVisitas(m) {
  return m.stores.flatMap((s) => s.visitas.map((v) => v.visit_nu)).sort();
}

/** sha256 hexadecimal de um texto (browser: Web Crypto; Node: crypto) */
export async function sha256Hex(texto) {
  const bytes = new TextEncoder().encode(texto);
  if (globalThis.crypto?.subtle) {
    const h = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(bytes).digest('hex');
}

export async function assinaturaDe(m) {
  return sha256Hex(JSON.stringify(resumoParaAssinatura(m)));
}
