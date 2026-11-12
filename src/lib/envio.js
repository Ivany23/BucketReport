// Divisão dos relatórios em partes pequenas para o envio (a Vercel aceita pedidos até 4,5 MB).

export const BYTES_PARTE = 1_200_000;   // ~1,2 MB de JSON por pedido (margem larga)
export const MAX_LINHAS = 20000;

/** Divide as linhas em partes de ~1,2 MB (JSON), mantendo a ordem. Devolve sempre pelo menos 1 parte. */
export function dividirEmPartes(rows, bytes = BYTES_PARTE) {
  const partes = [];
  let atual = [], tam = 2;
  for (const r of rows) {
    const t = JSON.stringify(r).length + 1;
    if (atual.length && (tam + t > bytes || atual.length >= MAX_LINHAS)) {
      partes.push(atual);
      atual = []; tam = 2;
    }
    atual.push(r); tam += t;
  }
  partes.push(atual);
  return partes;
}
