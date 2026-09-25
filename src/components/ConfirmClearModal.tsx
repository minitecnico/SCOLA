import { AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { Button, Input, Modal } from './ui';

/**
 * Confirmação forte para ações destrutivas (ex.: limpar notas).
 * Exige DIGITAR uma palavra-chave (ex.: o nome da turma) para liberar o botão —
 * evita exclusão acidental.
 */
export function ConfirmClearModal({
  open,
  onClose,
  title,
  description,
  keyword,
  confirmLabel = 'Apagar definitivamente',
  busy,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  keyword: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  const [text, setText] = useState('');
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
  const match = norm(text) === norm(keyword);

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-600" />
          <p className="text-sm font-semibold text-red-800">{description}</p>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-bold text-muted-foreground">
            Para confirmar, digite <span className="font-black text-foreground">{keyword}</span>
          </span>
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={keyword} autoFocus />
        </label>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" onClick={onConfirm} disabled={!match || busy}>
            {busy ? 'Apagando…' : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
