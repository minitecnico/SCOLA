/**
 * Impressão de documentos (boletins, relatórios de notas) SEM abrir aba nova:
 * o documento é montado nesta página, isolado num Shadow DOM (o estilo dele não
 * vaza para o app e vice-versa), e só ele aparece na impressão.
 * Funciona em qualquer navegador — inclusive celular e navegadores embutidos,
 * que costumam bloquear ou deixar em branco as janelas abertas por script.
 * "Baixar PDF" = escolher "Salvar como PDF" na caixa de impressão.
 */
const DOC_CSS = `
  :host { display: block; font-family: -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #0f172a; background: #fff; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #64748b; font-size: 12px; margin: 0 0 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: center; }
  th { background: #f1f5f9; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; color: #475569; }
  td.name, th.name { text-align: left; }
  /* Cores de significado: verde = ok, laranja = atenção, vermelho = abaixo */
  .zero { color: #dc2626; font-weight: 700; }
  .fail { color: #dc2626; font-weight: 700; }
  .warn { color: #ea580c; font-weight: 700; }
  .ok { color: #15803d; font-weight: 700; }
  .foot { margin-top: 16px; font-size: 11px; color: #94a3b8; }
  .brand { margin-top: 20px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 10px; color: #94a3b8; }
  .brand img { height: 12px; }
`;

function mount(host: HTMLElement, bodyHtml: string) {
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${DOC_CSS}</style>${bodyHtml}
<div class="brand"><img src="${window.location.origin}/scola-mono-preta.svg" alt="SCOLA" /><span>Documento gerado por SCOLA</span></div>`;
}

function printNow(title: string, bodyHtml: string) {
  document.getElementById('scola-print')?.remove();
  document.getElementById('scola-print-style')?.remove();
  const style = document.createElement('style');
  style.id = 'scola-print-style';
  style.textContent = `
    #scola-print { display: none; }
    @media print {
      @page { margin: 14mm; }
      html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; height: auto !important; overflow: visible !important; }
      body > *:not(#scola-print) { display: none !important; }
      #scola-print { display: block !important; }
    }`;
  const host = document.createElement('div');
  host.id = 'scola-print';
  mount(host, bodyHtml);
  document.head.appendChild(style);
  document.body.appendChild(host);

  const prevTitle = document.title;
  document.title = title; // vira o nome sugerido do PDF
  const cleanup = () => {
    document.title = prevTitle;
    host.remove();
    style.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 120); // tempo para carregar o logo
}

/** Pré-visualização por cima da tela, com Imprimir e Fechar. */
function openPreview(title: string, bodyHtml: string) {
  document.getElementById('scola-preview')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'scola-preview';
  overlay.className = 'fixed inset-0 z-[90] flex flex-col bg-neutral-950/70 backdrop-blur-sm';
  overlay.innerHTML = `
    <div class="flex items-center gap-2 bg-neutral-950 px-4 py-3 text-white">
      <p class="min-w-0 flex-1 truncate text-sm font-semibold"></p>
      <button data-act="print" class="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-neutral-950 hover:brightness-95">Imprimir / PDF</button>
      <button data-act="close" class="inline-flex h-10 items-center rounded-lg bg-white/10 px-4 text-sm font-semibold hover:bg-white/15">Fechar</button>
    </div>
    <div class="flex-1 overflow-auto p-3 sm:p-6"><div data-paper class="mx-auto max-w-4xl rounded-lg bg-white p-4 shadow-lift sm:p-8"></div></div>`;
  overlay.querySelector('p')!.textContent = title;
  mount(overlay.querySelector('[data-paper]') as HTMLElement, bodyHtml);
  const close = () => {
    overlay.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  overlay.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
    if (act === 'close') close();
    if (act === 'print') printNow(title, bodyHtml);
  });
  window.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}

export function printDocument(title: string, bodyHtml: string, opts?: { autoPrint?: boolean }): void {
  if (opts?.autoPrint === false) openPreview(title, bodyHtml);
  else printNow(title, bodyHtml);
}

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
