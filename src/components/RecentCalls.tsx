import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { format, parseISO } from 'date-fns';

import { ptBR } from 'date-fns/locale';

import { BarChart3, ChevronDown, ClipboardCheck, GraduationCap, MoreHorizontal, RotateCcw, Trash2 } from 'lucide-react';

import { useMemo, useState } from 'react';

import { Link, useNavigate } from 'react-router-dom';

import { cn } from '../lib/cn';

import { deleteAttendanceSession, listDeletedSessions, listRecentSessions, purgeAttendanceSession, restoreAttendanceSession, type RecentSession } from '../lib/queries';
import type { Tone } from '../lib/tone';

import { successToast, undoToast } from './Feedback';

import { Button, Card, DropdownMenu, Loading, Modal, SectionTitle } from './ui';

import { useClasses } from '../lib/hooks';


/** Tom do cartão pela taxa de faltas: até 10% verde · até 25% laranja · acima vermelho (classes literais para o Tailwind). */
const CARD_TONE: Record<Exclude<Tone, 'none'>, { accent: string; icon: string; bar: string; pill: string }> = {
  ok: { accent: 'border-l-green-500', icon: 'bg-green-50 text-green-700', bar: 'bg-green-500', pill: 'bg-green-50 text-green-700' },
  warn: { accent: 'border-l-orange-500', icon: 'bg-orange-50 text-orange-700', bar: 'bg-orange-500', pill: 'bg-orange-50 text-orange-700' },
  bad: { accent: 'border-l-red-500', icon: 'bg-red-50 text-red-700', bar: 'bg-red-500', pill: 'bg-red-50 text-red-700' },
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Chamadas recentes agrupadas por turma: abre a chamada, manda para a lixeira ou analisa a turma. */
export function RecentCalls() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: classes = [] } = useClasses();
  const { data: recent = [] } = useQuery({ queryKey: ['recent-sessions'], queryFn: () => listRecentSessions(60) });
  const [open, setOpen] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? 'Turma';

  const delSession = useMutation({
    mutationFn: (s: RecentSession) => deleteAttendanceSession(s.id),
    onSuccess: (_r, s) => {
      qc.invalidateQueries({ queryKey: ['recent-sessions'] });
      undoToast(`Chamada de ${format(parseISO(s.session_date), 'dd/MM')} movida para a lixeira.`, () =>
        restoreAttendanceSession(s.id).then(() => qc.invalidateQueries({ queryKey: ['recent-sessions'] })),
      );
    },
  });

  const groups = useMemo(() => {
    const map = new Map<string, RecentSession[]>();
    recent.forEach((s) => map.set(s.class_id, [...(map.get(s.class_id) ?? []), s]));
    return [...map.entries()];
  }, [recent]);

  return (
    <>
      <SectionTitle
        className="mb-3"
        action={
          <button onClick={() => setTrashOpen(true)} className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground">
            <Trash2 size={14} /> Lixeira
          </button>
        }
      >
        Chamadas recentes por turma
      </SectionTitle>
      {groups.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">Nenhuma chamada registrada ainda.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map(([classId, sessions]) => {
            const isOpen = open === classId;
            const faltas = sessions.reduce((a, s) => a + s.absent, 0);
            const presentes = sessions.reduce((a, s) => a + s.present, 0);
            const total = presentes + faltas;
            const rate = total > 0 ? faltas / total : 0;
            const presPct = total > 0 ? Math.round((presentes / total) * 100) : 100;
            const lastDate = sessions[0]?.session_date;
            const tone = CARD_TONE[rate <= 0.1 ? 'ok' : rate <= 0.25 ? 'warn' : 'bad'];
            return (
              <Card key={classId} className={cn('overflow-hidden border-l-4 p-0 transition', tone.accent, isOpen && 'sm:col-span-2 xl:col-span-3')}>
                <button onClick={() => setOpen(isOpen ? null : classId)} className="flex w-full items-center gap-3 p-4 text-left">
                  <div className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl', tone.icon)}>
                    <GraduationCap size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-black text-foreground">{className(classId)}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {sessions.length} chamada(s)
                      {lastDate ? <> · últ. {format(parseISO(lastDate), "d 'de' MMM", { locale: ptBR })}</> : null}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${presPct}%` }} />
                      </div>
                      <span className="shrink-0 text-[11px] font-bold tabular-nums text-muted-foreground">{presPct}% pres.</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    <span className={cn('rounded-full px-2.5 py-1 text-xs font-black tabular-nums', tone.pill)}>{faltas}</span>
                    <ChevronDown size={18} className={cn('text-muted-foreground transition', isOpen && 'rotate-180')} />
                  </div>
                </button>

                {isOpen ? (
                  <div className="divide-y divide-border border-t border-border">
                    {sessions.map((s) => {
                      const openIt = () => navigate('/chamadas', { state: { classId, date: s.session_date } });
                      return (
                        <div key={s.id} className="group flex items-center gap-2 pr-2 transition hover:bg-muted/50">
                          <button onClick={openIt} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 py-3 pl-4 text-left" title="Abrir chamada">
                            <span className="min-w-0 flex-1 text-sm font-bold text-foreground">
                              {cap(format(parseISO(s.session_date), "EEE, d 'de' MMM", { locale: ptBR }))}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-bold tabular-nums text-green-700">{s.present} pres.</span>
                              <span className={cn('rounded-full px-2.5 py-1 text-xs font-bold tabular-nums', s.absent ? 'bg-red-50 text-red-700' : 'bg-muted text-muted-foreground')}>
                                {s.absent} falt.
                              </span>
                            </span>
                          </button>
                          <div className="transition sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100">
                            <DropdownMenu
                              label="Ações da chamada"
                              variant="plain"
                              iconOnly
                              icon={<MoreHorizontal size={16} />}
                              items={[
                                { label: 'Abrir chamada', hint: 'Ver ou corrigir presenças.', icon: <ClipboardCheck size={15} />, onClick: openIt },
                                { label: 'Mover para a lixeira', hint: 'Dá para restaurar depois.', icon: <Trash2 size={15} />, danger: true, onClick: () => delSession.mutate(s) },
                              ]}
                            />
                          </div>
                        </div>
                      );
                    })}
                    <Link
                      to="/relatorios"
                      state={{ classId }}
                      className="flex items-center gap-2 px-4 py-3 text-sm font-bold text-emerald-700 hover:bg-emerald-50"
                    >
                      <BarChart3 size={16} /> Analisar esta turma →
                    </Link>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {trashOpen ? <TrashModal classNameOf={className} onClose={() => setTrashOpen(false)} /> : null}
    </>
  );
}

/** Lixeira de chamadas: restaurar ou excluir definitivamente. */
function TrashModal({ classNameOf, onClose }: { classNameOf: (id: string) => string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: items = [], isLoading } = useQuery({ queryKey: ['deleted-sessions'], queryFn: () => listDeletedSessions(), retry: false });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['deleted-sessions'] });
    qc.invalidateQueries({ queryKey: ['recent-sessions'] });
  };
  const restore = useMutation({ mutationFn: restoreAttendanceSession, onSuccess: () => { refresh(); successToast('Chamada restaurada'); } });
  const purge = useMutation({ mutationFn: purgeAttendanceSession, onSuccess: () => { refresh(); successToast('Chamada excluída definitivamente'); } });

  return (
    <Modal open onClose={onClose} title="Lixeira de chamadas">
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Chamadas excluídas. Restaure com um clique ou exclua de vez.</p>
        {isLoading ? (
          <Loading />
        ) : items.length === 0 ? (
          <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">A lixeira está vazia.</p>
        ) : (
          <div className="space-y-2">
            {items.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-foreground">{classNameOf(s.class_id)}</p>
                  <p className="text-xs font-bold text-muted-foreground">
                    {format(parseISO(s.session_date), "dd/MM/yyyy", { locale: ptBR })} · {s.present} pres. · {s.absent} falt.
                  </p>
                </div>
                <Button variant="soft" onClick={() => restore.mutate(s.id)} disabled={restore.isPending}>
                  <RotateCcw size={16} /> Restaurar
                </Button>
                <button
                  onClick={() => confirm('Excluir DEFINITIVAMENTE esta chamada? Não dá pra recuperar depois.') && purge.mutate(s.id)}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-600 hover:bg-red-100"
                  aria-label="Excluir definitivamente"
                  title="Excluir definitivamente"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

