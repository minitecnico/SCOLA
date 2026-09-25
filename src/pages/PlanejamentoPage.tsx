import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { BookOpen, CalendarRange, Check, Eye, Mail, MessageCircle, MessageSquare, Paperclip, Pencil, Plus, Save, Send, Share2, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { AttachmentChips } from '../components/Attachments';
import { Dropzone } from '../components/Dropzone';
import { WeeklyPlanEditor, WeeklyPlanView, emptyWeeklyPlan, weeklyPlanToText } from '../components/WeeklyPlan';
import { PlanDocsCenter } from '../components/PlanDocsCenter';
import type { WeeklyPlanData } from '../lib/types';
import { successToast } from '../components/Feedback';
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, Segmented, Select, Loading} from '../components/ui';
import { cn } from '../lib/cn';
import { canReviewPlan } from '../lib/permissions';
import { safeFileName } from '../lib/storage';
import {
  deletePlan,
  listClasses,
  listMyPlans,
  listOrgPlans,
  listPlanMessages,
  listReviewedPlans,
  markPlanRead,
  planUnreadCounts,
  reviewPlan,
  savePlan,
  sendPlanMessage,
  setMemberContact,
  submitPlan,
  uploadPlanAttachment,
  type PlanInput,
  type PlanWithMeta,
} from '../lib/queries';
import { PLAN_STATUS } from '../lib/types';

// Traduz erros técnicos (ex.: módulo ainda não ativado no banco) para algo amigável.
function friendly(e: unknown): string {
  const m = (e as Error)?.message ?? '';
  if (m.includes('schema cache') || m.includes('lesson_plan') || m.includes('PGRST205')) {
    return 'O módulo de planejamento ainda está sendo ativado. Tente novamente em instantes.';
  }
  return m || 'Não foi possível completar a ação. Tente novamente.';
}

export function PlanejamentoPage() {
  return (
    <>
      <PageHeader
        title="Planejamento"
        subtitle="Anexe seus planejamentos por segmento, trimestre e turma."
      />
      <PlanDocsCenter />
    </>
  );
}

function MeusPlanos({ uid, onEdit }: { uid: string; onEdit: (p: PlanWithMeta) => void }) {
  const qc = useQueryClient();
  const [sendFor, setSendFor] = useState<PlanWithMeta | null>(null);
  const { data: plans = [], isLoading, isError, error } = useQuery({ queryKey: ['my-plans', uid], queryFn: () => listMyPlans(uid), retry: false });

  const send = useMutation({
    mutationFn: submitPlan,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-plans', uid] });
      qc.invalidateQueries({ queryKey: ['org-plans'] });
      successToast('Planejamento enviado à coordenação');
    },
  });
  const remove = useMutation({
    mutationFn: deletePlan,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-plans', uid] });
      successToast('Planejamento excluído');
    },
  });

  if (isLoading) return <Loading />;
  if (isError) return <EmptyState icon={<BookOpen size={26} />} title="Planejamento indisponível" hint={friendly(error)} />;
  if (plans.length === 0)
    return <EmptyState icon={<BookOpen size={26} />} title="Nenhum planejamento" hint="Crie seu primeiro planejamento e envie para a coordenação." />;

  return (
    <>
      <div className="space-y-3">
        {plans.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            footer={
              <div className="flex flex-wrap items-center gap-2">
                {p.status === 'rascunho' || p.status === 'devolvido' ? (
                  <Button onClick={() => send.mutate(p.id)} disabled={send.isPending}><Send size={16} /> Enviar à coordenação</Button>
                ) : null}
                <Button variant="soft" onClick={() => setSendFor(p)}><Share2 size={16} /> Enviar</Button>
                <Button variant="ghost" onClick={() => onEdit(p)}><Pencil size={16} /> Editar</Button>
                <button
                  onClick={() => confirm('Excluir este planejamento?\n\n⚠️ Ação IRREVERSÍVEL: apaga o planejamento e seus anexos do banco de dados. Não há como recuperar.') && remove.mutate(p.id)}
                  className="ml-auto grid h-10 w-10 place-items-center rounded-xl bg-red-50 text-red-600 hover:bg-red-100"
                  aria-label="Excluir"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            }
          />
        ))}
      </div>
      {sendFor ? <SendModal plan={sendFor} self onClose={() => setSendFor(null)} /> : null}
    </>
  );
}

/** Botão de excluir reaproveitado nas visões da coordenação/admin. */
function DeletePlanButton({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const remove = useMutation({ mutationFn: () => deletePlan(id), onSuccess: () => { onDeleted(); successToast('Planejamento excluído'); } });
  return (
    <button
      onClick={() => confirm('Excluir este planejamento?\n\n⚠️ Ação IRREVERSÍVEL: apaga o planejamento e seus anexos do banco de dados. Não há como recuperar.') && remove.mutate()}
      disabled={remove.isPending}
      className="ml-auto grid h-10 w-10 place-items-center rounded-xl bg-red-50 text-red-600 hover:bg-red-100 disabled:opacity-60"
      aria-label="Excluir"
      title="Excluir"
    >
      <Trash2 size={16} />
    </button>
  );
}

function Pendentes({ onEdit }: { onEdit: (p: PlanWithMeta) => void }) {
  const qc = useQueryClient();
  const { data: plans = [], isLoading, isError, error } = useQuery({ queryKey: ['org-plans', 'enviado'], queryFn: () => listOrgPlans('enviado'), retry: false });
  const [feedbackFor, setFeedbackFor] = useState<PlanWithMeta | null>(null);

  const approve = useMutation({
    mutationFn: (id: string) => reviewPlan(id, 'aprovado', ''),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-plans', 'enviado'] });
      qc.invalidateQueries({ queryKey: ['org-plans', 'revisados'] });
      successToast('Planejamento aprovado');
    },
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['org-plans'] });

  if (isLoading) return <Loading />;
  if (isError) return <EmptyState icon={<BookOpen size={26} />} title="Planejamento indisponível" hint={friendly(error)} />;
  if (plans.length === 0)
    return <EmptyState icon={<Check size={26} />} title="Nada para revisar" hint="Planejamentos enviados pelos professores aparecem aqui." />;

  return (
    <>
      <div className="space-y-3">
        {plans.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            showAuthor
            footer={
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => approve.mutate(p.id)} disabled={approve.isPending}><Check size={16} /> Aprovar</Button>
                <Button variant="danger" onClick={() => setFeedbackFor(p)}><Undo2 size={16} /> Devolver</Button>
                <Button variant="ghost" onClick={() => onEdit(p)}><Pencil size={16} /> Editar</Button>
                <DeletePlanButton id={p.id} onDeleted={invalidate} />
              </div>
            }
          />
        ))}
      </div>
      {feedbackFor ? <DevolverModal plan={feedbackFor} onClose={() => setFeedbackFor(null)} /> : null}
    </>
  );
}

function Revisados({ onEdit }: { onEdit: (p: PlanWithMeta) => void }) {
  const qc = useQueryClient();
  const { data: plans = [], isLoading, isError, error } = useQuery({ queryKey: ['org-plans', 'revisados'], queryFn: listReviewedPlans, retry: false });
  const [sendFor, setSendFor] = useState<PlanWithMeta | null>(null);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['org-plans'] });

  if (isLoading) return <Loading />;
  if (isError) return <EmptyState icon={<BookOpen size={26} />} title="Planejamento indisponível" hint={friendly(error)} />;
  if (plans.length === 0)
    return <EmptyState icon={<Check size={26} />} title="Nenhum revisado ainda" hint="Aprovados e devolvidos ficam aqui para consulta e reenvio." />;

  return (
    <>
      <div className="space-y-3">
        {plans.map((p) => (
          <PlanCard
            key={p.id}
            plan={p}
            showAuthor
            footer={
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="soft" onClick={() => setSendFor(p)}><Share2 size={16} /> Enviar</Button>
                <Button variant="ghost" onClick={() => onEdit(p)}><Pencil size={16} /> Editar</Button>
                <DeletePlanButton id={p.id} onDeleted={invalidate} />
              </div>
            }
          />
        ))}
      </div>
      {sendFor ? <SendModal plan={sendFor} onClose={() => setSendFor(null)} /> : null}
    </>
  );
}

/** Só dígitos; garante DDI 55 (Brasil) quando o número não tem código de país. */
function normalizePhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55')) return d;
  return d.length <= 11 ? `55${d}` : d;
}

/** Envio por WhatsApp ou e-mail. `self` = o professor compartilhando o próprio planejamento. */
function SendModal({ plan, onClose, self = false }: { plan: PlanWithMeta; onClose: () => void; self?: boolean }) {
  const qc = useQueryClient();
  const [channel, setChannel] = useState<'whatsapp' | 'email'>('whatsapp');
  const [phone, setPhone] = useState(self ? '' : plan.authorPhone ?? '');
  const [email, setEmail] = useState(self ? '' : plan.authorEmail ?? '');
  const statusLabel = PLAN_STATUS[plan.status].label.toLowerCase();
  const defaultMsg = self
    ? `Olá! Segue o planejamento "${plan.title}".` +
      (plan.className ? `\n\nTurma: ${plan.className}` : '') +
      (plan.content ? `\n\n${plan.content}` : '')
    : `Olá${plan.authorName ? `, ${plan.authorName}` : ''}! Seu planejamento "${plan.title}" foi ${statusLabel}.` +
      (plan.feedback ? `\n\nRetorno da coordenação:\n${plan.feedback}` : '') +
      (plan.className ? `\n\nTurma: ${plan.className}` : '');
  const [message, setMessage] = useState(defaultMsg);

  const saveContact = useMutation({
    mutationFn: () => setMemberContact(plan.author_id, phone, email),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-plans'] });
      successToast('Contato salvo');
    },
  });

  const subject = `Planejamento "${plan.title}" — ${PLAN_STATUS[plan.status].label}`;
  // wa.me/mailto não carregam arquivos. Mandamos um LINK curto e bonito que baixa os anexos
  // (zip se forem vários) — /baixar/:id no próprio app.
  const downloadUrl = plan.attachments.length ? `${window.location.origin}/baixar/${plan.id}` : '';
  const bodyClean = message + (downloadUrl ? `\n\n📎 Baixar anexos: ${downloadUrl}` : '');

  function fire() {
    if (channel === 'whatsapp') {
      const num = normalizePhone(phone);
      if (!num) return;
      window.open(`https://wa.me/${num}?text=${encodeURIComponent(bodyClean)}`, '_blank', 'noopener');
    } else {
      window.open(`mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyClean)}`, '_blank', 'noopener');
    }
    successToast('Abrindo para envio…');
    onClose();
  }

  const canFire = channel === 'whatsapp' ? !!normalizePhone(phone) : /\S+@\S+\.\S+/.test(email);

  return (
    <Modal open onClose={onClose} title={self ? 'Enviar planejamento' : 'Enviar retorno ao professor'}>
      <div className="space-y-4">
        {plan.attachments.length > 0 ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
            📎 {plan.attachments.length} anexo(s): a mensagem leva um link curto que baixa {plan.attachments.length > 1 ? 'tudo em .zip' : 'o arquivo'} ao abrir.
          </p>
        ) : null}

        <div className="inline-flex rounded-xl bg-muted p-1">
          <button
            onClick={() => setChannel('whatsapp')}
            className={cn('flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold transition', channel === 'whatsapp' ? 'bg-card text-emerald-700 shadow-sm' : 'text-muted-foreground')}
          >
            <MessageCircle size={16} /> WhatsApp
          </button>
          <button
            onClick={() => setChannel('email')}
            className={cn('flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-bold transition', channel === 'email' ? 'bg-card text-blue-700 shadow-sm' : 'text-muted-foreground')}
          >
            <Mail size={16} /> E-mail
          </button>
        </div>

        {channel === 'whatsapp' ? (
          <Field label={self ? 'WhatsApp do destinatário (com DDD)' : 'WhatsApp do professor (com DDD)'}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Ex.: (11) 99999-9999" inputMode="tel" />
          </Field>
        ) : (
          <Field label={self ? 'E-mail do destinatário' : 'E-mail do professor'}>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={self ? 'coordenacao@escola.com' : 'professor@escola.com'} type="email" />
          </Field>
        )}

        <Field label="Mensagem">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
          {!self ? (
            <Button variant="ghost" onClick={() => saveContact.mutate()} disabled={saveContact.isPending || (!phone.trim() && !email.trim())}>
              <Save size={16} /> {saveContact.isPending ? 'Salvando…' : 'Salvar contato'}
            </Button>
          ) : null}
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button onClick={fire} disabled={!canFire}>
              {channel === 'whatsapp' ? <MessageCircle size={16} /> : <Mail size={16} />} Disparar
            </Button>
          </div>
        </div>
        {!self ? (
          <p className="text-xs text-muted-foreground">
            "Salvar contato" guarda o WhatsApp/e-mail no perfil do professor — da próxima vez já vem preenchido, é só disparar.
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function PlanCard({ plan: p, footer, showAuthor }: { plan: PlanWithMeta; footer?: React.ReactNode; showAuthor?: boolean }) {
  const st = PLAN_STATUS[p.status];
  const [chatOpen, setChatOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  // Query compartilhada (mesma key) — o React Query dedup: 1 fetch p/ todos os cards.
  const { data: unreadMap = {} } = useQuery({ queryKey: ['plan-unread'], queryFn: planUnreadCounts, refetchInterval: 15000, retry: false });
  const unread = unreadMap[p.id] ?? 0;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-black uppercase', st.cls)}>{st.label}</span>
            <p className="font-black text-foreground">{p.title}</p>
          </div>
          <p className="mt-0.5 text-xs font-bold text-muted-foreground">
            {showAuthor && p.authorName ? `${p.authorName} · ` : ''}
            {p.className ? `${p.className} · ` : ''}
            {p.week_start ? `Semana de ${format(parseISO(p.week_start), 'dd/MM/yyyy')}` : 'Sem data'}
          </p>
        </div>
        <button
          onClick={() => setChatOpen(true)}
          className={cn(
            'relative flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition',
            unread > 0 ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-muted text-muted-foreground hover:bg-emerald-50 hover:text-emerald-700',
          )}
          title={unread > 0 ? `${unread} mensagem(ns) nova(s)` : 'Abrir conversa'}
        >
          <MessageSquare size={15} /> Conversa
          {unread > 0 ? (
            <span className="grid min-w-5 place-items-center rounded-full bg-card px-1.5 text-[11px] font-black leading-5 text-emerald-700">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </button>
      </div>
      {p.plan_data ? (
        <button
          onClick={() => setViewOpen(true)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700 hover:bg-emerald-100"
        >
          <Eye size={14} /> Ver planejamento semanal
        </button>
      ) : p.content ? (
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{p.content}</p>
      ) : null}
      <AttachmentChips attachments={p.attachments} zipName={safeFileName(p.title) || 'planejamento'} />
      {p.feedback ? (
        <div className={cn('mt-3 rounded-xl border p-3 text-sm', p.status === 'aprovado' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800')}>
          <p className="text-[11px] font-black uppercase tracking-wide opacity-70">Retorno da coordenação</p>
          <p className="mt-0.5 whitespace-pre-wrap font-semibold">{p.feedback}</p>
        </div>
      ) : null}
      {footer ? <div className="mt-3 border-t border-border pt-3">{footer}</div> : null}
      {chatOpen ? <ChatModal plan={p} onClose={() => setChatOpen(false)} /> : null}
      {viewOpen && p.plan_data ? (
        <Modal open onClose={() => setViewOpen(false)} title={p.title || 'Planejamento semanal'} size="xl">
          <WeeklyPlanView data={p.plan_data} />
        </Modal>
      ) : null}
    </Card>
  );
}

/** Chat interno por planejamento — coordenação ⇄ professor, com auto-atualização. */
function ChatModal({ plan, onClose }: { plan: PlanWithMeta; onClose: () => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const uid = user!.id;
  const [body, setBody] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const key = ['plan-messages', plan.id];

  const { data: messages = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: () => listPlanMessages(plan.id),
    refetchInterval: 8000, // quase em tempo real, sem peso de websocket
    retry: false,
  });

  const send = useMutation({
    mutationFn: () => sendPlanMessage(plan.id, body),
    onSuccess: () => {
      setBody('');
      qc.invalidateQueries({ queryKey: key });
    },
  });

  // Ao abrir/receber mensagens, marca como lido e zera o badge de não lidas.
  useEffect(() => {
    if (!messages.length) return;
    markPlanRead(plan.id)
      .then(() => qc.invalidateQueries({ queryKey: ['plan-unread'] }))
      .catch(() => {});
  }, [plan.id, messages.length, qc]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  function submit() {
    if (body.trim() && !send.isPending) send.mutate();
  }

  return (
    <Modal open onClose={onClose} title={`Conversa — ${plan.title}`}>
      <div className="flex h-[60vh] flex-col">
        <div className="-mx-1 flex-1 space-y-2 overflow-y-auto px-1">
          {isLoading ? (
            <Loading />
          ) : messages.length === 0 ? (
            <div className="grid h-full place-items-center text-center">
              <div>
                <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground">
                  <MessageSquare size={22} />
                </div>
                <p className="text-sm font-bold text-muted-foreground">Nenhuma mensagem ainda</p>
                <p className="mt-1 text-xs text-muted-foreground">Tire dúvidas ou peça ajustes diretamente aqui.</p>
              </div>
            </div>
          ) : (
            messages.map((m) => {
              const mine = m.author_id === uid;
              return (
                <div key={m.id} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
                      mine ? 'rounded-br-md bg-emerald-600 text-white' : 'rounded-bl-md bg-muted text-foreground',
                    )}
                  >
                    {!mine ? <p className="mb-0.5 text-[11px] font-black opacity-70">{m.authorName ?? 'Usuário'}</p> : null}
                    <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  </div>
                  <span className="mt-0.5 px-1 text-[10px] font-bold text-muted-foreground">
                    {format(parseISO(m.created_at), "dd/MM 'às' HH:mm", { locale: ptBR })}
                  </span>
                </div>
              );
            })
          )}
          <div ref={endRef} />
        </div>

        <div className="mt-3 flex items-end gap-2 border-t border-border pt-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            autoFocus
            placeholder="Escreva uma mensagem…  (Enter envia, Shift+Enter quebra linha)"
            className="max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-border bg-card px-4 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />
          <Button onClick={submit} disabled={!body.trim() || send.isPending} className="shrink-0">
            <Send size={16} /> Enviar
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function DevolverModal({ plan, onClose }: { plan: PlanWithMeta; onClose: () => void }) {
  const qc = useQueryClient();
  const [feedback, setFeedback] = useState('');
  const ret = useMutation({
    mutationFn: () => reviewPlan(plan.id, 'devolvido', feedback.trim()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-plans', 'enviado'] });
      onClose();
      successToast('Planejamento devolvido ao professor');
    },
  });
  return (
    <Modal open onClose={onClose} title="Devolver planejamento">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Explique o que precisa ser ajustado. O professor verá esse retorno.</p>
        <Field label="Feedback">
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={4}
            autoFocus
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            placeholder="Ex.: incluir os objetivos de aprendizagem da BNCC…"
          />
        </Field>
        <div className="mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="danger" onClick={() => ret.mutate()} disabled={!feedback.trim() || ret.isPending}>
            <Undo2 size={16} /> {ret.isPending ? 'Devolvendo…' : 'Devolver'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function ComposeModal({ plan, onClose }: { plan: PlanWithMeta | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { user, profile } = useAuth();
  const { data: classes = [] } = useQuery({ queryKey: ['classes'], queryFn: listClasses });
  const classOptions = classes.map((c) => c.name);
  const [mode, setMode] = useState<'texto' | 'semanal'>(plan?.plan_data ? 'semanal' : 'texto');
  const [title, setTitle] = useState(plan?.title ?? '');
  const [classId, setClassId] = useState(plan?.class_id ?? '');
  const [week, setWeek] = useState(plan?.week_start ?? '');
  const [content, setContent] = useState(plan?.content ?? '');
  const [weekly, setWeekly] = useState<WeeklyPlanData>(() => plan?.plan_data ?? emptyWeeklyPlan({ teacher: profile?.full_name ?? '' }));
  const [files, setFiles] = useState<File[]>([]);

  const addFiles = (l: FileList | null) => l && l.length && setFiles((p) => [...p, ...Array.from(l)]);

  const effectiveTitle = title.trim() || (mode === 'semanal' ? `Planejamento semanal${weekly.period ? ` — ${weekly.period}` : ''}` : '');

  async function persist(andSend: boolean) {
    const isWeekly = mode === 'semanal';
    const input: PlanInput = {
      id: plan?.id,
      title: effectiveTitle,
      class_id: classId || null,
      week_start: week || null,
      content: isWeekly ? weeklyPlanToText(weekly) : content.trim(),
      plan_data: isWeekly ? weekly : undefined, // texto não toca a coluna (seguro sem migração)
    };
    const id = await savePlan(input);
    for (const f of files) await uploadPlanAttachment(id, f);
    if (andSend) await submitPlan(id);
    return id;
  }

  const saveDraft = useMutation({
    mutationFn: () => persist(false),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-plans', user?.id] });
      onClose();
      successToast('Rascunho salvo');
    },
  });
  const saveSend = useMutation({
    mutationFn: () => persist(true),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-plans', user?.id] });
      qc.invalidateQueries({ queryKey: ['org-plans'] });
      onClose();
      successToast('Planejamento enviado à coordenação');
    },
  });

  const valid = effectiveTitle.length > 0;
  const busy = saveDraft.isPending || saveSend.isPending;

  return (
    <Modal open onClose={onClose} title={plan ? 'Editar planejamento' : 'Novo planejamento'} size="xl">
      <div className="space-y-4">
        <Segmented<'texto' | 'semanal'>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'texto', label: 'Texto livre' },
            { value: 'semanal', label: 'Planejamento semanal' },
          ]}
        />

        <Field label={mode === 'semanal' ? 'Título (opcional — gerado pelo período)' : 'Título'}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={mode === 'semanal' ? 'Ex.: Planejamento semanal — Junho/2026' : 'Ex.: Plano semanal — Língua Inglesa'} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Turma (opcional)">
            <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">—</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Semana (opcional)">
            <Input type="date" value={week} onChange={(e) => setWeek(e.target.value)} />
          </Field>
        </div>
        {mode === 'semanal' ? (
          <div className="rounded-xl border border-border bg-muted/60 p-3">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-emerald-700">
              <CalendarRange size={14} /> Modelo semanal — preencha por dia e turma
            </p>
            <WeeklyPlanEditor data={weekly} onChange={setWeekly} classOptions={classOptions} />
          </div>
        ) : (
          <Field label="Conteúdo / objetivos / atividades">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              placeholder="Objetivos de aprendizagem (BNCC), conteúdos, metodologia, recursos, avaliação…"
            />
          </Field>
        )}

        <Field label="Anexos (plano em PDF/DOCX, materiais…)">
          <Dropzone
            hint="PDF, Word, Excel, PowerPoint, imagens, ZIP… (até 50 MB)"
            onFiles={addFiles}
          />
          {files.length > 0 ? (
            <div className="mt-2 space-y-1.5">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs font-bold text-foreground">
                  <Paperclip size={14} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))} aria-label="Remover" className="text-muted-foreground hover:text-red-600">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </Field>

        {plan?.attachments?.length ? (
          <div>
            <p className="mb-1 text-xs font-bold text-muted-foreground">Anexos atuais</p>
            <AttachmentChips attachments={plan.attachments} />
          </div>
        ) : null}

        {saveDraft.isError || saveSend.isError ? (
          <p className="text-sm font-semibold text-red-600">{friendly(saveDraft.error || saveSend.error)}</p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="soft" onClick={() => saveDraft.mutate()} disabled={!valid || busy}>Salvar rascunho</Button>
          <Button onClick={() => saveSend.mutate()} disabled={!valid || busy}>
            <Send size={16} /> {busy ? 'Salvando…' : 'Salvar e enviar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
