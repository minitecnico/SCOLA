/**
 * Abre uma janela só com o conteúdo informado e dispara a impressão.
 * Serve tanto para "Imprimir" quanto para "Baixar PDF" (o próprio navegador
 * oferece 'Salvar como PDF' na caixa de impressão). Estilo embutido para não
 * depender do CSS do app.
 */
export function printDocument(title: string, bodyHtml: string, opts?: { autoPrint?: boolean }): void {
  const autoPrint = opts?.autoPrint !== false; // padrão: imprime; passe false só para pré-visualizar
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) {
    alert('Permita pop-ups para imprimir/baixar.');
    return;
  }
  win.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #0f172a; margin: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #64748b; font-size: 12px; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: center; }
  th { background: #f1f5f9; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; color: #475569; }
  td.name, th.name { text-align: left; }
  .zero { color: #dc2626; font-weight: 700; }
  .fail { color: #dc2626; font-weight: 700; }
  .ok { color: #0f172a; font-weight: 700; }
  .foot { margin-top: 16px; font-size: 11px; color: #94a3b8; }
  @media print { body { margin: 0; } @page { margin: 14mm; } }
</style></head><body>${bodyHtml}
${autoPrint ? '<script>window.onload=function(){window.print();}</script>' : ''}
</body></html>`);
  win.document.close();
}

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
