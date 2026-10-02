import { Component, type ReactNode } from 'react';

/**
 * Se uma tela quebrar, mostra um aviso com "Recarregar" em vez de deixar tudo em branco.
 * Depois de uma atualização do SCOLA, o navegador pode pedir um arquivo antigo que já não existe:
 * nesse caso recarrega sozinho uma vez.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('Tela quebrou:', error);
    const stale = /dynamically imported module|Importing a module script failed|Failed to fetch dynamically|ChunkLoadError/i.test(String(error?.message));
    try {
      if (stale && !sessionStorage.getItem('scola-reloaded')) {
        sessionStorage.setItem('scola-reloaded', '1');
        window.location.reload();
      }
    } catch {
      /* sem sessionStorage: segue para o aviso */
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: '#fff', color: '#111', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <div style={{ width: 48, height: 48, margin: '0 auto 12px', borderRadius: 12, background: '#FACC15', display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 22 }}>!</div>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: '0 0 6px' }}>Algo deu errado nesta tela</h1>
          <p style={{ fontSize: 14, color: '#555', margin: '0 0 16px' }}>Nada do que já foi salvo se perdeu. Recarregue a página para continuar.</p>
          <button
            onClick={() => window.location.reload()}
            style={{ background: '#111', color: '#fff', border: 0, borderRadius: 10, padding: '10px 18px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
          >
            Recarregar
          </button>
          <p style={{ fontSize: 11, color: '#999', marginTop: 14, wordBreak: 'break-word' }}>{String(this.state.error.message).slice(0, 200)}</p>
        </div>
      </div>
    );
  }
}
