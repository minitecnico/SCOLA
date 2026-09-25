import { useEffect, useState } from 'react';
import { Button } from './ui';

/**
 * Popup de sucesso global (check animado, estilo SweetAlert).
 * Chame `successToast('mensagem')` de qualquer lugar (ex.: onSuccess das mutations).
 * `<FeedbackHost/>` precisa estar montado uma vez na árvore (App).
 */

type Listener = (msg: string) => void;
let listener: Listener | null = null;

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
          stroke="#FACC15"
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

  if (msg == null) return null;

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm"
      onClick={() => setMsg(null)}
    >
      <div
        className="success-card w-full max-w-xs rounded-3xl bg-card p-8 text-center shadow-soft"
        onClick={(e) => e.stopPropagation()}
      >
        <AnimatedCheck />
        <h3 className="text-2xl font-black text-foreground">Ok!</h3>
        <p className="mt-1.5 text-sm text-muted-foreground">{msg}</p>
        <Button className="mt-6 w-full" onClick={() => setMsg(null)}>
          OK
        </Button>
      </div>
    </div>
  );
}
