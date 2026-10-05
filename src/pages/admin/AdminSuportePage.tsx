import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Inbox, LogIn, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { SupportChat, when } from '../../components/SupportChat';
import { Button, EmptyState, Loading, PageHeader, SearchInput, Segmented } from '../../components/ui';
import { cn } from '../../lib/cn';
import { suporte, type SupportFilter } from '../../lib/suporte';
import { ROLE_LABEL, type AppRole } from '../../lib/types';

const QUICK = [
  'Olá! Obrigado pelo contato. Já estou verificando e retorno em breve.',
  'Poderia me enviar um print da tela com o problema?',
  'Já corrigi aqui. Pode testar de novo e me avisar se continuar?',
  'Se precisar de mais alguma coisa, é só responder por aqui.',
];

/** Atendimento (administrador): caixa de entrada com as conversas de todas as escolas. */
export function AdminSuportePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, switchOrg } = useAuth();
  const [params] = useSearchParams();
  const f0 = params.get('f');
  const [filter, setFilter] = useState<SupportFilter>(f0 === 'respondidas' || f0 === 'resolvidas' || f0 === 'todas' ? f0 : 'atender');
  useEffect(() => {
    setFilter(f0 === 'respondidas' || f0 === 'resolvidas' || f0 === 'todas' ? f0 : 'atender');
    setSel(null);
  }, [f0]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ['support-admin', filter, q], queryFn: () => suporte.admin.list({ filter, q }), refetchInterval: 60_000 });
  const { data: open } = useQuery({ queryKey: ['support-admin-thread', sel], queryFn: () => suporte.admin.get(sel!), enabled: !!sel, refetchInterval: 60_000 });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['support-admin'] });
    qc.invalidateQueries({ queryKey: ['support-admin-thread'] });
    qc.invalidateQueries({ queryKey: ['support-admin-unread'] });
  };
  const reply = useMutation({ mutationFn: ({ body, resolve }: { body: string; resolve?: boolean }) => suporte.admin.reply(sel!, body, resolve), onSuccess: refresh });
  const status = useMutation({ mutationFn: (s: 'aberta' | 'resolvida') => suporte.admin.setStatus(sel!, s), onSuccess: refresh });
  const [resolveToo, setResolveToo] = useState(false);
  const c = data?.counts;
  const t = open?.thread;

  return (
    <>
      <PageHeader title="Atendimento" subtitle="Conversas de todas as escolas com o suporte do SCOLA." back={false} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented
          value={filter}
          onChange={(v) => { setFilter(v); setSel(null); }}
          options={[
            { value: 'atender', label: `Para responder${c?.atender ? ` (${c.atender})` : ''}` },
            { value: 'respondidas', label: `Respondidas${c?.respondidas ? ` (${c.respondidas})` : ''}` },
            { value: 'resolvidas', label: 'Resolvidas' },
            { value: 'todas', label: 'Todas' },
          ]}
        />
        <SearchInput value={q} onChange={setQ} placeholder="Buscar protocolo, escola, pessoa ou assunto…" className="min-w-[14rem] flex-1" />
      </div>

      {isLoading ? <Loading /> : !data?.threads.length && !sel ? (
        <EmptyState icon={<Inbox size={24} />} title={filter === 'atender' ? 'Nada para responder' : 'Nenhuma conversa'} hint="Quando uma escola abrir uma conversa pelo menu Suporte, ela aparece aqui." />
      ) : (
        <div className="grid h-[calc(100dvh-17rem)] min-h-[30rem] overflow-hidden rounded-xl border border-border bg-card md:grid-cols-[22rem_1fr]">
          <ul className={cn('divide-y divide-border overflow-y-auto', sel && 'hidden md:block')}>
            {data?.threads.map((th) => (
              <li key={th.id}>
                <button onClick={() => setSel(th.id)} className={cn('w-full px-4 py-3 text-left hover:bg-muted/60', sel === th.id && 'bg-muted')}>
                  <div className="flex items-center gap-2">
                    {th.unread_admin ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-600" /> : null}
                    <p className={cn('min-w-0 flex-1 truncate text-sm', th.unread_admin ? 'font-bold' : 'font-semibold')}>{th.subject}</p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{when(th.updated_at)}</span>
                  </div>
                  <p className="truncate text-xs font-semibold text-neutral-700"><span className="font-mono">{th.protocol}</span> · {th.base_name} · {th.user_name || th.user_email}</p>
                  <p className="truncate text-xs text-muted-foreground">{th.last_from === 'suporte' ? 'Você: ' : ''}{th.last_preview}</p>
                </button>
              </li>
            ))}
          </ul>
          <div className={cn('flex min-h-0 flex-col border-border md:border-l', !sel && 'hidden md:flex')}>
            {!sel || !t ? (
              <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">{sel ? <Loading /> : 'Escolha uma conversa.'}</div>
            ) : (
              <>
                <div className="border-b border-border px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSel(null)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted md:hidden" aria-label="Voltar"><ArrowLeft size={18} /></button>
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{t.subject}</p><p className="font-mono text-[11px] text-muted-foreground">Protocolo {t.protocol}</p></div>
                    {t.status === 'aberta' ? (
                      <Button variant="ghost" className="min-h-9 px-3 py-1.5" onClick={() => status.mutate('resolvida')}><CheckCircle2 size={15} /> Resolver</Button>
                    ) : (
                      <Button variant="ghost" className="min-h-9 px-3 py-1.5" onClick={() => status.mutate('aberta')}><RotateCcw size={15} /> Reabrir</Button>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span><b className="text-foreground">{t.base_name}</b>{t.base_city ? ` · ${t.base_city}` : ''}</span>
                    <span>{t.user_name || t.user_email}{t.user_role ? ` (${ROLE_LABEL[t.user_role as AppRole] ?? t.user_role})` : ''}</span>
                    <span>{t.students} alunos · plano {t.base_plan === 'teste' ? 'teste' : 'ativo'}{t.base_active ? '' : ' · suspensa'}</span>
                    {t.user_phone ? <span>{t.user_phone}</span> : null}
                    <button onClick={async () => { await switchOrg(t.base_id); navigate('/'); }} className="inline-flex items-center gap-1 font-semibold text-foreground underline-offset-2 hover:underline"><LogIn size={12} /> Acessar escola</button>
                  </div>
                </div>
                <SupportChat
                  messages={open!.messages}
                  mine={(m) => !!m.from_admin || m.author_id === user?.id}
                  onSend={(body) => reply.mutateAsync({ body, resolve: resolveToo })}
                  sending={reply.isPending}
                  quick={QUICK}
                  extra={<label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={resolveToo} onChange={(e) => setResolveToo(e.target.checked)} /> Marcar como resolvida ao responder</label>}
                />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
