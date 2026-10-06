import { Loader2, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { fmtDayTime } from '../lib/format';
import type { SupportMessage } from '../lib/suporte';

export const when = (iso: string) => {
  const d = new Date(iso);
  const same = d.toDateString() === new Date().toDateString();
  return same ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : fmtDayTime(iso);
};

/** Mensagens em balões + caixa de resposta (Enter envia, Shift+Enter quebra linha). */
export function SupportChat({
  messages, mine, onSend, sending, disabledHint, quick, extra,
}: {
  messages: SupportMessage[];
  /** Mensagem escrita por "mim" (lado direito). */
  mine: (m: SupportMessage) => boolean;
  onSend: (body: string) => Promise<unknown> | void;
  sending?: boolean;
  disabledHint?: string;
  quick?: string[];
  extra?: React.ReactNode;
}) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setText('');
    try {
      await onSend(body);
    } catch {
      setText(body);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => (
          <div key={m.id} className={cn('flex', mine(m) ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[85%] rounded-2xl px-3.5 py-2 text-sm', mine(m) ? 'rounded-br-md bg-neutral-900 text-white' : 'rounded-bl-md bg-muted text-foreground')}>
              <p className="whitespace-pre-wrap break-words">{m.body}</p>
              <p className={cn('mt-1 text-[10px]', mine(m) ? 'text-neutral-400' : 'text-muted-foreground')}>
                {m.from_admin ? 'Suporte SCOLA' : m.author_name || 'Escola'} · {when(m.created_at)}
              </p>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="border-t border-border p-3">
        {extra}
        {quick?.length ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <button key={q} onClick={() => setText((t) => (t ? `${t}\n${q}` : q))} className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
                {q.length > 38 ? `${q.slice(0, 38)}…` : q}
              </button>
            ))}
          </div>
        ) : null}
        {disabledHint ? <p className="mb-2 text-xs text-muted-foreground">{disabledHint}</p> : null}
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            rows={2}
            maxLength={4000}
            placeholder="Escreva sua mensagem…"
            className="min-h-[2.75rem] flex-1 resize-none rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/20"
          />
          <button onClick={() => void send()} disabled={!text.trim() || sending} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-neutral-900 text-white transition hover:bg-black disabled:opacity-40" aria-label="Enviar">
            {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
          </button>
        </div>
      </div>
    </div>
  );
}
