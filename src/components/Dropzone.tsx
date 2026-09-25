import { UploadCloud } from 'lucide-react';
import { DragEvent, useRef, useState } from 'react';
import { cn } from '../lib/cn';

/** Área de upload que aceita CLICAR para procurar E arrastar-e-soltar. */
export function Dropzone({
  onFiles,
  accept,
  multiple = true,
  title = 'Clique ou arraste os arquivos aqui',
  hint,
  compact = false,
}: {
  onFiles: (files: FileList | null) => void;
  accept?: string;
  multiple?: boolean;
  title?: string;
  hint?: string;
  /** Versão slim de uma linha — minimalista, para áreas densas (kanban etc.). */
  compact?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function prevent(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    prevent(e);
    setOver(false);
    if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}
      onDragOver={(e) => {
        prevent(e);
        setOver(true);
      }}
      onDragEnter={(e) => {
        prevent(e);
        setOver(true);
      }}
      onDragLeave={(e) => {
        prevent(e);
        if (e.currentTarget === e.target) setOver(false);
      }}
      onDrop={handleDrop}
      className={cn(
        'cursor-pointer rounded-xl border-dashed transition',
        compact
          ? cn(
              'flex items-center justify-center gap-2 border px-3 py-2.5 text-xs font-bold',
              over ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-border bg-card text-muted-foreground hover:border-slate-400 hover:bg-muted',
            )
          : cn(
              'flex flex-col items-center justify-center gap-2 border-2 px-4 py-7 text-center',
              over ? 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200' : 'border-border bg-card hover:bg-muted',
            ),
      )}
    >
      {compact ? (
        <>
          <UploadCloud size={15} className={cn('shrink-0 transition', over ? 'text-emerald-600' : 'text-muted-foreground')} />
          <span className="truncate">{title}</span>
        </>
      ) : (
        <>
          <UploadCloud size={24} className={cn('transition', over ? 'text-emerald-600' : 'text-muted-foreground')} />
          <p className="text-sm font-bold text-muted-foreground">{title}</p>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              ref.current?.click();
            }}
            className="mt-2 rounded-lg bg-slate-950 px-4 py-2 text-xs font-black text-white shadow-sm"
          >
            Procurar arquivo
          </button>
        </>
      )}
      <input
        ref={ref}
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
