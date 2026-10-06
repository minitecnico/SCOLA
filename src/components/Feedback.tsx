import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './ui';

/**
 * Popup de sucesso global (check animado, estilo SweetAlert).
 * Chame `successToast('mensagem')` de qualquer lugar (ex.: onSuccess das mutations).
 * `<FeedbackHost/>` precisa estar montado uma vez na árvore (App).
 * `askConfirm('…')` substitui o confirm() do navegador por um diálogo do próprio sistema.
 */

type Listener = (msg: string) => void;
let listener: Listener | null = null;

type Undo = { message: string; onUndo: () => void };
let undoListener: ((u: Undo) => void) | null = null;

/** Aviso discreto no rodapé com "Desfazer" (ex.: item movido para a lixeira). */
export function undoToast(message: string, onUndo: () => void) {
  undoListener?.({ message, onUndo });
}

function UndoHost() {
  const [u, setU] = useState<Undo | null>(null);
  useEffect(() => {
    undoListener = (next) => setU(next);
    return () => {
      undoListener = null;
    };
  }, []);
  useEffect(() => {
    if (!u) return;
    const t = setTimeout(() => setU(null), 6000);
    return () => clearTimeout(t);
  }, [u]);
  if (!u) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4 pb-[env(safe-area-inset-bottom)]">
      <div role="status" className="pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-xl bg-neutral-950 py-2.5 pl-4 pr-2 text-sm text-white shadow-lift">
        <span className="min-w-0 flex-1">{u.message}</span>
        <button
          onClick={() => {
            u.onUndo();
            setU(null);
          }}
          className="shrink-0 rounded-lg px-3 py-1.5 font-semibold text-brand transition hover:bg-white/10"
        >
          Desfazer
        </button>
      </div>
    </div>
  );
}

type ConfirmOptions = { title?: string; confirmLabel?: string; danger?: boolean };
type ConfirmRequest = { message: string; title: string; confirmLabel: string; danger: boolean; resolve: (ok: boolean) => void };
let confirmListener: ((r: ConfirmRequest) => void) | null = null;

/** Verbos que apagam/removem: o diálogo vira vermelho e o botão leva o verbo ("Excluir", "Bloquear"…). */
const DESTRUCTIVE = /^(excluir|apagar|remover|bloquear|suspender|tirar|arquivar|desconectar)\b/i;

/**
 * Pergunta antes de uma ação sem volta. Resolve `true` se a pessoa confirmar.
 *   askConfirm('Excluir a turma?').then((ok) => ok && remove.mutate(id));
 * O verbo da frase (Excluir, Remover…) define o rótulo do botão e o tom de alerta.
 */
export function askConfirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    if (!confirmListener) return resolve(window.confirm(message)); // host ainda não montou
    const verb = message.match(DESTRUCTIVE)?.[0];
    confirmListener({
      message,
      title: opts.title ?? (verb ? 'Tem certeza?' : 'Confirmar'),
      confirmLabel: opts.confirmLabel ?? (verb ? verb.charAt(0).toUpperCase() + verb.slice(1).toLowerCase() : 'Confirmar'),
      danger: opts.danger ?? !!verb,
      resolve,
    });
  });
}

function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  useEffect(() => {
    confirmListener = (r) => setReq(r);
    return () => {
      confirmListener = null;
    };
  }, []);
  const answer = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };
  return (
    <Dialog open={!!req} onClose={() => answer(false)} className="relative z-[75]">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px]" aria-hidden="true" />
      <div className="fixed inset-0 grid place-items-end justify-items-center p-0 sm:place-items-center sm:p-4">
        <DialogPanel className="w-full max-w-sm rounded-t-2xl bg-card p-5 shadow-lift sm:rounded-2xl">
          <div className="flex items-start gap-3">
            {req?.danger ? (
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-50 text-red-600">
                <AlertTriangle size={20} />
              </span>
            ) : null}
            <div className="min-w-0">
              <DialogTitle className="text-base font-bold text-foreground">{req?.title}</DialogTitle>
              <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{req?.message}</p>
            </div>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => answer(false)}>Cancelar</Button>
            <Button autoFocus onClick={() => answer(true)} className={req?.danger ? 'bg-red-600 text-white hover:bg-red-700' : undefined}>
              {req?.confirmLabel}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export function successToast(message = 'Operação realizada com sucesso') {
  listener?.(message);
}

function AnimatedCheck() {
  return (
    <div className="success-ring mx-auto mb-5 grid h-24 w-24 place-items-center rounded-full bg-emerald-50">
      <svg viewBox="0 0 52 52" className="h-16 w-16">
        <circle
          className="success-circle"
          cx="26"
          cy="26"
          r="24"
          fill="none"
          stroke="#D4D4D4"
          strokeWidth="3"
        />
        <path
          className="success-check"
          d="M15 27 l7 7 l15 -15"
          fill="none"
          stroke="#171717"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function FeedbackHost() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    listener = (m) => setMsg(m);
    return () => {
      listener = null;
    };
  }, []);

  // Fecha sozinho depois de um tempo.
  useEffect(() => {
    if (msg == null) return;
    const t = setTimeout(() => setMsg(null), 1900);
    return () => clearTimeout(t);
  }, [msg]);

  return (
    <>
      <UndoHost />
      <ConfirmHost />
      {msg != null ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm" onClick={() => setMsg(null)}>
          <div className="success-card w-full max-w-xs rounded-3xl bg-card p-8 text-center shadow-soft" onClick={(e) => e.stopPropagation()}>
            <AnimatedCheck />
            <h3 className="text-2xl font-black text-foreground">Ok!</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{msg}</p>
            <Button className="mt-6 w-full" onClick={() => setMsg(null)}>
              OK
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
