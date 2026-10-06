import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, LifeBuoy, MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { successToast } from '../components/Feedback';
import { SupportChat, when } from '../components/SupportChat';
import { PanePlaceholder, ThreadHeader, ThreadRow, ThreadSplit } from '../components/ThreadSplit';
import { Button, EmptyState, Field, Input, Loading, Modal, PageHeader } from '../components/ui';
import { suporte } from '../lib/suporte';

/** Suporte (escola): conversas com a equipe do SCOLA. */
export function SuportePage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { data: threads = [], isLoading } = useQuery({ queryKey: ['support-threads'], queryFn: suporte.list, refetchInterval: 60_000 });
  const { data: open } = useQuery({ queryKey: ['support-thread', sel], queryFn: () => suporte.get(sel!), enabled: !!sel, refetchInterval: 60_000 });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['support-threads'] });
    qc.invalidateQueries({ queryKey: ['support-thread'] });
    qc.invalidateQueries({ queryKey: ['support-unread'] });
  };
  const reply = useMutation({ mutationFn: (body: string) => suporte.reply(sel!, body), onSuccess: refresh });
  const resolve = useMutation({ mutationFn: () => suporte.resolve(sel!), onSuccess: () => { refresh(); successToast('Conversa encerrada'); } });

  return (
    <>
      <PageHeader title="Suporte" subtitle="Fale com a equipe do SCOLA: dúvidas, problemas e sugestões." action={<Button onClick={() => setCreating(true)}><MessageSquarePlus size={16} /> Nova conversa</Button>} />
      {isLoading ? <Loading /> : threads.length === 0 ? (
        <EmptyState icon={<LifeBuoy size={24} />} title="Nenhuma conversa ainda" hint="Precisa de ajuda ou quer sugerir algo? Abra uma conversa e a equipe responde por aqui." action={<Button onClick={() => setCreating(true)}><MessageSquarePlus size={16} /> Nova conversa</Button>} />
      ) : (
        <ThreadSplit
          className="h-[calc(100dvh-15rem)] min-h-[28rem] md:grid-cols-[20rem_1fr]"
          hasSelection={!!sel}
          list={threads.map((t) => (
            <ThreadRow key={t.id} active={sel === t.id} onClick={() => setSel(t.id)}>
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-sm font-semibold">{t.subject}</p>
                {t.unread_user ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-600" /> : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">{t.last_from === 'suporte' ? 'Suporte: ' : 'Você: '}{t.last_preview}</p>
              <p className="mt-1 text-[10px] text-muted-foreground"><b className="font-mono">{t.protocol}</b> · {t.status === 'resolvida' ? 'Resolvida' : t.last_from === 'escola' ? 'Aguardando o suporte' : 'Respondida'} · {when(t.updated_at)}</p>
            </ThreadRow>
          ))}
          pane={
            !sel || !open ? (
              <PanePlaceholder selected={!!sel} hint="Escolha uma conversa para ver as mensagens." />
            ) : (
              <>
                <div className="border-b border-border px-3 py-2.5">
                  <ThreadHeader
                    subject={open.thread.subject}
                    protocol={open.thread.protocol}
                    onBack={() => setSel(null)}
                    action={
                      open.thread.status === 'aberta' ? (
                        <Button variant="ghost" className="min-h-9 px-3 py-1.5" onClick={() => resolve.mutate()}><CheckCircle2 size={15} /> Já resolvi</Button>
                      ) : (
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">Resolvida</span>
                      )
                    }
                  />
                </div>
                <SupportChat messages={open.messages} mine={(m) => m.author_id === user?.id} onSend={(b) => reply.mutateAsync(b)} sending={reply.isPending}
                  disabledHint={open.thread.status === 'resolvida' ? 'Esta conversa foi resolvida. Se responder, ela será reaberta.' : undefined} />
              </>
            )
          }
        />
      )}
      {creating ? <NewThread onClose={() => setCreating(false)} onDone={(id, protocol) => { setCreating(false); setSel(id); refresh(); successToast(`Conversa aberta. Protocolo ${protocol}`); }} /> : null}
    </>
  );
}

function NewThread({ onClose, onDone }: { onClose: () => void; onDone: (id: string, protocol: string) => void }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const create = useMutation({ mutationFn: suporte.create, onSuccess: (r) => onDone(r.id, r.protocol), onError: (e) => setError((e as Error).message) });
  return (
    <Modal open onClose={onClose} title="Nova conversa com o suporte">
      <form onSubmit={(e) => { e.preventDefault(); setError(''); create.mutate({ subject, body }); }} className="space-y-3">
        <Field label="Assunto"><Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} required autoFocus placeholder="Ex.: Não consigo lançar as notas" /></Field>
        <Field label="Mensagem">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} maxLength={4000} required placeholder="Conte o que aconteceu, em qual tela e o que você esperava ver." className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/20" />
        </Field>
        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={create.isPending}>{create.isPending ? 'Enviando…' : 'Enviar'}</Button>
      </form>
    </Modal>
  );
}
