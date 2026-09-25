import { useQuery } from '@tanstack/react-query';
import { Download, FileWarning, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPlanAttachments } from '../lib/queries';
import { downloadAllAttachments, safeFileName } from '../lib/storage';

/**
 * Página de download por link curto: /baixar/:id
 * Abre, busca os anexos do planejamento e baixa automaticamente (zip se forem
 * vários). Pensada para o link enviado por WhatsApp/e-mail. Requer login do
 * destinatário (o servidor libera para membros da base).
 */
export function DownloadPlanPage() {
  const { id = '' } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['plan-download', id],
    queryFn: () => getPlanAttachments(id),
    enabled: !!id,
    retry: false,
  });
  const [status, setStatus] = useState<'idle' | 'baixando' | 'ok' | 'erro'>('idle');
  const auto = useRef(false);

  async function baixar() {
    if (!data?.files.length) return;
    setStatus('baixando');
    try {
      await downloadAllAttachments(data.files, safeFileName(data.title) || 'anexos');
      setStatus('ok');
    } catch {
      setStatus('erro');
    }
  }

  // dispara o download automaticamente assim que os anexos carregam (uma vez)
  useEffect(() => {
    if (data?.files.length && !auto.current) {
      auto.current = true;
      void baixar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const many = (data?.files.length ?? 0) > 1;

  return (
    <div className="grid min-h-screen place-items-center bg-muted p-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        {isLoading ? (
          <>
            <Loader2 className="mx-auto animate-spin text-emerald-600" size={34} />
            <p className="mt-3 text-sm font-bold text-muted-foreground">Carregando anexos…</p>
          </>
        ) : isError || !data?.files.length ? (
          <>
            <FileWarning className="mx-auto text-amber-500" size={34} />
            <h1 className="mt-3 text-lg font-black text-foreground">Anexos indisponíveis</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isError
                ? 'Você precisa estar logado na sua escola para baixar estes anexos.'
                : 'Este planejamento não tem anexos.'}
            </p>
          </>
        ) : (
          <>
            <Download className="mx-auto text-emerald-600" size={34} />
            <h1 className="mt-3 text-lg font-black text-foreground">{data.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.files.length} anexo(s){many ? ' — baixados como .zip' : ''}.
            </p>
            <button
              onClick={baixar}
              disabled={status === 'baixando'}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-black text-white transition hover:bg-emerald-700 disabled:opacity-50"
            >
              {status === 'baixando' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              {status === 'baixando' ? 'Baixando…' : status === 'ok' ? 'Baixar de novo' : 'Baixar anexos'}
            </button>
            {status === 'erro' ? <p className="mt-3 text-sm font-bold text-red-600">Falha ao baixar. Tente de novo.</p> : null}
            {status === 'ok' ? <p className="mt-3 text-sm font-bold text-emerald-700">Download iniciado ✓</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
