import { Logo } from '../components/Logo';
import { useQuery } from '@tanstack/react-query';
import { List, Printer, Rows3 } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ReportView } from '../components/ReportView';
import { Loading } from '../components/ui';
import { getSharedReport } from '../lib/queries';

export function SharedReportPage() {
  const { id } = useParams();
  const [compact, setCompact] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['shared', id],
    queryFn: () => getSharedReport(id!),
    enabled: !!id,
  });

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="no-print sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
        <Logo compact />
        {data ? (
          <div className="ml-auto flex gap-2">
            <button onClick={() => setCompact((c) => !c)} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-slate-100 px-3 text-sm font-bold text-slate-700 hover:bg-slate-200">
              {compact ? <Rows3 size={16} /> : <List size={16} />} {compact ? 'Detalhado' : 'Compacto'}
            </button>
            <button onClick={() => window.print()} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white hover:bg-emerald-700">
              <Printer size={16} /> Baixar PDF
            </button>
          </div>
        ) : null}
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6">
        {isLoading ? (
          <Loading label="Carregando relatório…" />
        ) : isError || !data ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <h1 className="text-lg font-black text-slate-800">Relatório não encontrado</h1>
            <p className="mt-1 text-sm text-slate-500">O link pode estar errado ou ter sido removido.</p>
          </div>
        ) : (
          <ReportView payload={data} compact={compact} />
        )}
      </div>
    </main>
  );
}
