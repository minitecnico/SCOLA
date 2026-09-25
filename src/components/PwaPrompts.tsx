import { Download, RefreshCw, Share, SquarePlus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * App instalável (PWA):
 *  - Atualização: quando sai versão nova, pergunta antes de recarregar
 *    (nunca interrompe uma chamada ou lançamento de notas no meio).
 *  - Instalação: no Android/Chrome oferece "Instalar" (prompt nativo);
 *    no iPhone/iPad ensina o caminho Compartilhar → Adicionar à Tela de Início.
 */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

const DISMISS_KEY = 'scola:pwa:instalar-dispensado';
const DISMISS_DAYS = 14;

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = () => window.matchMedia?.('(pointer: coarse)').matches || window.innerWidth < 1024;

function dismissedRecently() {
  try {
    const t = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - t < DISMISS_DAYS * 86400_000;
  } catch {
    return false;
  }
}

/* Evento de instalação guardado fora do React: o menu do usuário também usa. */
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // mostramos o nosso convite, no momento certo
    deferred = e as InstallEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  const canPrompt = !!deferred && !isStandalone();
  const ios = isIos() && !isStandalone();
  async function install() {
    if (!deferred) return false;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    deferred = null;
    listeners.forEach((l) => l());
    return choice.outcome === 'accepted';
  }
  return { canPrompt, ios, install };
}

export function PwaPrompts() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // Confere se há versão nova a cada hora (app aberto o dia todo na escola).
      if (reg) setInterval(() => void reg.update(), 60 * 60 * 1000);
    },
  });
  const { canPrompt, ios, install } = useInstall();
  const [hidden, setHidden] = useState(dismissedRecently);
  const [iosHelp, setIosHelp] = useState(false);

  function dismiss() {
    setHidden(true);
    setIosHelp(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* sem armazenamento: some só nesta visita */
    }
  }

  const showInstall = !hidden && !needRefresh && isMobile() && (canPrompt || ios);

  return (
    <>
      {needRefresh ? (
        <Sheet>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-neutral-950">
            <RefreshCw size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Nova versão do SCOLA</p>
            <p className="text-xs text-white/70">Salve o que estiver fazendo e toque em Atualizar.</p>
          </div>
          <button onClick={() => setNeedRefresh(false)} className="h-9 rounded-lg px-3 text-sm font-semibold text-white/80 hover:bg-white/10">
            Depois
          </button>
          <button onClick={() => void updateServiceWorker(true)} className="h-9 rounded-lg bg-brand px-3.5 text-sm font-semibold text-neutral-950 hover:brightness-95">
            Atualizar
          </button>
        </Sheet>
      ) : null}

      {showInstall ? (
        <Sheet>
          <span className="shrink-0 rounded-xl bg-white p-1.5">
            <img src="/icon-192.png" alt="" className="h-9 w-9 rounded-lg" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Instale o SCOLA no celular</p>
            <p className="text-xs text-white/70">Abre direto da tela inicial, em tela cheia, como um aplicativo.</p>
          </div>
          <button onClick={dismiss} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/70 hover:bg-white/10" aria-label="Agora não">
            <X size={17} />
          </button>
          <button
            onClick={async () => {
              if (canPrompt) {
                if (await install()) setHidden(true);
              } else setIosHelp(true);
            }}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-semibold text-neutral-950 hover:brightness-95"
          >
            <Download size={15} /> Instalar
          </button>
        </Sheet>
      ) : null}

      {iosHelp ? <IosInstallHelp onClose={dismiss} /> : null}
    </>
  );
}

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div role="status" className="pointer-events-auto flex w-full max-w-lg items-center gap-3 rounded-2xl bg-neutral-950 p-3 text-white shadow-lift">
        {children}
      </div>
    </div>
  );
}

/** iPhone/iPad não tem botão de instalar: explica o caminho em 2 passos. */
export function IosInstallHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card p-5 text-foreground shadow-lift" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-3">
          <img src="/icon-192.png" alt="" className="h-11 w-11 rounded-xl" />
          <div>
            <p className="font-bold">Instalar no iPhone</p>
            <p className="text-xs text-muted-foreground">Leva 10 segundos. Use o Safari.</p>
          </div>
        </div>
        <ol className="space-y-3 text-sm">
          <li className="flex items-center gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neutral-950 text-xs font-bold text-brand">1</span>
            <span>
              Toque em <b>Compartilhar</b> <Share size={15} className="inline -translate-y-0.5" /> na barra do Safari.
            </span>
          </li>
          <li className="flex items-center gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-neutral-950 text-xs font-bold text-brand">2</span>
            <span>
              Escolha <b>Adicionar à Tela de Início</b> <SquarePlus size={15} className="inline -translate-y-0.5" /> e confirme.
            </span>
          </li>
        </ol>
        <button onClick={onClose} className="mt-5 h-11 w-full rounded-lg bg-neutral-950 text-sm font-semibold text-white">
          Entendi
        </button>
      </div>
    </div>
  );
}
