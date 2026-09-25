import { Download, Eye, Loader2, Paperclip } from 'lucide-react';
import { useState } from 'react';
import { downloadAllAttachments } from '../lib/storage';
import { successToast } from './Feedback';
import { Modal } from './ui';

/** Anexo genérico (avisos, calendário…). `url` é a URL assinada para baixar/abrir. */
export interface Attachment {
  id: string;
  name: string;
  path?: string;
  mime: string | null;
  url?: string;
}

function canPreview(mime: string | null | undefined) {
  return !!mime && (mime.startsWith('image/') || mime === 'application/pdf');
}

export function PreviewModal({ name, url, mime, onClose }: { name: string; url: string; mime: string | null; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={name} size="xl">
      <div className="space-y-3">
        {mime?.startsWith('image/') ? (
          <img src={url} alt={name} className="mx-auto max-h-[70vh] rounded-xl object-contain" />
        ) : mime === 'application/pdf' ? (
          <iframe src={url} title={name} className="h-[70vh] w-full rounded-xl border border-border" />
        ) : (
          <p className="text-sm text-muted-foreground">Pré-visualização não disponível para este tipo de arquivo.</p>
        )}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          download={name}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-emerald-700"
        >
          <Download size={16} /> Baixar
        </a>
      </div>
    </Modal>
  );
}

export function AttachmentChips({ attachments, zipName = 'anexos' }: { attachments: Attachment[]; zipName?: string }) {
  const [preview, setPreview] = useState<Attachment | null>(null);
  const [zipping, setZipping] = useState(false);
  if (!attachments.length) return null;

  const downloadable = attachments.filter((a) => a.url);

  async function baixarTodos() {
    if (zipping) return;
    setZipping(true);
    try {
      await downloadAllAttachments(downloadable, zipName);
      successToast(downloadable.length > 1 ? 'Anexos baixados (.zip)' : 'Arquivo baixado');
    } catch (e) {
      alert((e as Error).message || 'Não foi possível baixar os anexos.');
    } finally {
      setZipping(false);
    }
  }

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {downloadable.length >= 2 ? (
          <button
            onClick={baixarTodos}
            disabled={zipping}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-black text-white transition hover:bg-emerald-700 disabled:opacity-60"
          >
            {zipping ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {zipping ? 'Compactando…' : `Baixar todos (${downloadable.length})`}
          </button>
        ) : null}
        {attachments.map((a) => (
          <div
            key={a.id}
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1.5 text-xs font-bold text-foreground"
          >
            <Paperclip size={14} className="shrink-0 text-muted-foreground" />
            <a href={a.url} target="_blank" rel="noopener noreferrer" download={a.name} className="truncate hover:text-emerald-700">
              {a.name}
            </a>
            {canPreview(a.mime) && a.url ? (
              <button onClick={() => setPreview(a)} aria-label="Pré-visualizar" className="shrink-0 text-muted-foreground hover:text-emerald-700">
                <Eye size={15} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {preview?.url ? <PreviewModal name={preview.name} url={preview.url} mime={preview.mime} onClose={() => setPreview(null)} /> : null}
    </>
  );
}
