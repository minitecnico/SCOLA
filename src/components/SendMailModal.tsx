import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink, Loader2, Mail, Paperclip, Send, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { buildMime, isEmail } from '../lib/mime';
import { listMailRecipients, sendMail, googleLink } from '../lib/queries';
import type { PlanDoc } from '../lib/types';
import { Button, Modal } from './ui';
import { successToast } from './Feedback';
import { cn } from '../lib/cn';

type G = { available: boolean; connected: boolean; email: string | null; canMail: boolean } | undefined;
const MAX_ATTACH = 17 * 1024 * 1024; // ~25 MB do Gmail depois do base64
const ROLE: Record<string, string> = { gestor: 'Gestão', secretaria: 'Secretaria', professor: 'Professor' };
const KEY = 'scola:mail-to';
const mb = (n: number) => `${(n / 1048576).toFixed(1).replace('.', ',')} MB`;

const loadLast = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

export function SendMailModal({ docs, google, onClose, onSent }: { docs: PlanDoc[]; google: G; onClose: () => void; onSent: () => void }) {
  const { user } = useAuth();
  const ready = !!google?.available && !!google.connected && !!google.canMail;
  const { data: people = [] } = useQuery({ queryKey: ['mail-recipients'], queryFn: listMailRecipients, enabled: ready });

  const [picked, setPicked] = useState<string[]>(() => loadLast());
  const [extra, setExtra] = useState('');
  const [subject, setSubject] = useState(docs.length === 1 ? docs[0].name.replace(/\.[^.]+$/, '') : `Arquivos de planejamento (${docs.length})`);
  const [text, setText] = useState(`Olá,\n\nSegue${docs.length > 1 ? 'm' : ''} em anexo.\n\nAtt.,\n${user?.user_metadata.full_name || ''}`);
  const [err, setErr] = useState('');

  const files = docs.filter((d) => d.kind !== 'google');
  const links = docs.filter((d) => d.kind === 'google' && d.google_id && d.google_kind);
  const total = files.reduce((n, d) => n + (d.size ?? 0), 0);

  const toggle = (email: string) => setPicked((p) => (p.includes(email) ? p.filter((e) => e !== email) : [...p, email]));
  const typed = extra.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

  const send = useMutation({
    mutationFn: async () => {
      const to = [...new Set([...picked, ...typed])];
      if (!to.length) throw new Error('Escolha ou digite pelo menos um destinatário.');
      const bad = to.find((e) => !isEmail(e));
      if (bad) throw new Error(`E-mail inválido: ${bad}`);
      if (total > MAX_ATTACH) throw new Error(`Anexos somam ${mb(total)}. O limite é ${mb(MAX_ATTACH)}: envie em mais de um e-mail.`);
      const blobs: { name: string; blob: Blob }[] = [];
      for (const d of files) {
        const r = await fetch(d.url!, { credentials: 'same-origin' });
        if (!r.ok) throw new Error(`Não consegui abrir "${d.name}".`);
        blobs.push({ name: d.name, blob: await r.blob() });
      }
      if (blobs.reduce((n, b) => n + b.blob.size, 0) > MAX_ATTACH) throw new Error(`Os anexos passam de ${mb(MAX_ATTACH)}. Envie em mais de um e-mail.`);
      const linkText = links.length ? `\n\nArquivos no Google:\n${links.map((d) => `${d.name}: ${googleLink(d.google_kind!, d.google_id!)}`).join('\n')}\n(Peça acesso ao autor se o link não abrir.)` : '';
      await sendMail(await buildMime({ to, subject: subject.trim() || 'Arquivos', text: text + linkText, files: blobs }));
      try {
        localStorage.setItem(KEY, JSON.stringify(picked));
      } catch {
        /* sem armazenamento: tudo bem */
      }
    },
    onSuccess: () => {
      successToast('E-mail enviado');
      onSent();
      onClose();
    },
    onError: (e) => setErr((e as Error).message),
  });

  return (
    <Modal open onClose={onClose} title="Enviar por e-mail">
      {!ready ? (
        <div className="space-y-3 text-sm">
          <p>
            {!google?.available
              ? 'A integração com o Google ainda não está configurada.'
              : !google.connected
                ? 'Para enviar, conecte sua conta do Google. O e-mail sai do seu próprio Gmail, com seu nome.'
                : 'Sua conexão não inclui o envio de e-mails. Desconecte e conecte de novo, deixando todas as caixas marcadas.'}
          </p>
          {google?.available ? (
            <a href="/api/google/connect" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-black text-white hover:bg-slate-800">
              <ExternalLink size={14} /> {google.connected ? 'Reconectar Google' : 'Conectar Google'}
            </a>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <span className="mb-1 block text-xs font-bold text-muted-foreground">Para (toque para escolher)</span>
            <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
              {people.length === 0 ? <span className="text-xs text-muted-foreground">Ninguém mais na equipe. Digite o e-mail abaixo.</span> : null}
              {people.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.email)}
                  className={cn('rounded-full border px-3 py-1.5 text-xs font-semibold transition', picked.includes(p.email) ? 'border-slate-900 bg-slate-900 text-white' : 'border-border hover:bg-muted')}
                  title={p.email}
                >
                  {p.name} <span className="opacity-60">· {ROLE[p.role] ?? p.role}</span>
                </button>
              ))}
            </div>
            <input
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="Outros e-mails (separe por vírgula)"
              className="mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-slate-900"
            />
          </div>
          <label className="block"><span className="mb-1 block text-xs font-bold text-muted-foreground">Assunto</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-slate-900" />
          </label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-muted-foreground">Mensagem</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-slate-900" />
          </label>
          <div>
            <span className="mb-1 flex items-center gap-1 text-xs font-bold text-muted-foreground"><Paperclip size={12} /> Anexos ({docs.length}){total ? ` · ${mb(total)}` : ''}</span>
            <ul className="max-h-28 space-y-0.5 overflow-y-auto rounded-lg border border-border p-2 text-xs">
              {docs.map((d) => (
                <li key={d.id} className="flex justify-between gap-2"><span className="truncate">{d.name}</span><span className="shrink-0 text-muted-foreground">{d.kind === 'google' ? 'link do Google' : d.size ? mb(d.size) : ''}</span></li>
              ))}
            </ul>
          </div>
          {err ? <p className="flex items-start gap-1 rounded-lg bg-red-50 p-2 text-xs font-bold text-red-700"><X size={13} className="mt-0.5 shrink-0" />{err}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <span className="text-[11px] text-muted-foreground"><Mail size={11} className="mr-1 inline" />Sai do seu Gmail ({google?.email})</span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose}>Cancelar</Button>
              <Button onClick={() => { setErr(''); send.mutate(); }} disabled={send.isPending}>
                {send.isPending ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Send size={14} className="mr-1.5" />}
                {send.isPending ? 'Enviando…' : 'Enviar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
