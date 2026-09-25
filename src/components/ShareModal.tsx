import { Check, Copy, Mail, MessageCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createSharedReport } from '../lib/queries';
import type { ReportPayload } from '../lib/types';
import { Button, Field, Input, Modal, Loading} from './ui';

export function ShareModal({ open, onClose, payload }: { open: boolean; onClose: () => void; payload: ReportPayload | null }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [phone, setPhone] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open || !payload) return;
    setBusy(true);
    setErr('');
    setLink('');
    setCopied(false);
    createSharedReport(payload)
      .then((id) => setLink(`${window.location.origin}/r/${id}`))
      .catch((e) => setErr((e as Error).message))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const msg = payload ? `${payload.title} — Turma ${payload.className} (${payload.period}).\nAbra o relatório: ${link}` : link;
  const wa = phone.trim()
    ? `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  const mail = `mailto:?subject=${encodeURIComponent(payload?.title || 'Relatório')}&body=${encodeURIComponent(msg)}`;

  async function copy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal open={open} onClose={onClose} title="Enviar relatório">
      {busy ? (
        <Loading label="Gerando link…" />
      ) : err ? (
        <p className="rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-600">{err}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Link gerado. Quem receber abre e <strong>baixa o relatório</strong> — sem precisar de conta.
          </p>

          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted p-2">
            <span className="min-w-0 flex-1 truncate px-2 text-sm text-muted-foreground">{link}</span>
            <Button variant="ghost" className="py-2" onClick={copy}>
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copiado' : 'Copiar'}
            </Button>
          </div>

          <Field label="WhatsApp (opcional — com DDD, ex.: 5571999998888)">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Deixe vazio para escolher o contato na hora" inputMode="numeric" />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <a href={wa} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 font-bold text-white hover:bg-emerald-700">
              <MessageCircle size={18} /> WhatsApp
            </a>
            <a href={mail} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 font-bold text-white hover:bg-slate-800">
              <Mail size={18} /> E-mail
            </a>
          </div>
        </div>
      )}
    </Modal>
  );
}
