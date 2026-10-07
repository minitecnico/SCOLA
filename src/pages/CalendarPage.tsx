import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthProvider";
import { successToast, askConfirm } from "../components/Feedback";
import { canManageCalendar } from "../lib/permissions";
import { CALENDAR_CONFLICT, createCalendar, deleteCalendar, listCalendars, listOrgPeople, loadCalendar, saveCalendar, type CalendarSummary } from "../lib/queries";
import { Button } from "../components/ui";
import { vividCategories } from "../lib/calendarColors";
import { fmtStamp, newSeed } from "../components/calendar/calendarData";
import { CalendarBuilder } from "../components/calendar/CalendarBuilder";
/* ============================================================================
   Construtor de Calendário Escolar — React + TypeScript
   ----------------------------------------------------------------------------
   • A coordenação alimenta os dados no Editor (categorias, eventos, períodos)
     e o calendário aparece preenchido automaticamente (preview ao vivo).
   • Cores livres por categoria — o contraste do texto é calculado sozinho.
   • Visão "Ano completo" ou qualquer "Período/Trimestre" configurável.
   • Persistido no banco (D1): a coordenação salva e o calendário fica disponível
     para todos os usuários da organização (multi-tenant). Export/Import JSON e
     Imprimir/PDF continuam disponíveis.
============================================================================ */

/* ====================== Centro de calendários (lista + CRUD) ====================== */
export function CalendarPage() {
  const { role, activeOrgId, profile, user } = useAuth();
  const canManage = canManageCalendar(role);
  const userId = user?.id ?? null;
  const updaterName = profile?.full_name || profile?.email || "Usuário";
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: list = [], isLoading, isError, error } = useQuery({
    queryKey: ["calendars", activeOrgId],
    queryFn: listCalendars,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["calendars", activeOrgId] });

  if (openId) {
    return (
      <CalendarEditorLoader
        id={openId}
        role={role}
        canManage={canManage}
        userId={userId}
        updaterName={updaterName}
        onBack={() => {
          setOpenId(null);
          refresh();
        }}
      />
    );
  }

  return (
    <CalendarCenter
      list={list}
      loading={isLoading}
      isError={isError}
      error={error as Error | null}
      canManage={canManage}
      role={role}
      userId={userId}
      creatorName={updaterName}
      onOpen={setOpenId}
      onCreated={(id) => {
        refresh();
        setOpenId(id);
      }}
      onChanged={refresh}
    />
  );
}

function CalendarCenter({
  list,
  loading,
  isError,
  error,
  canManage,
  role,
  userId,
  creatorName,
  onOpen,
  onCreated,
  onChanged,
}: {
  list: CalendarSummary[];
  loading: boolean;
  isError: boolean;
  error: Error | null;
  canManage: boolean;
  role: string | null;
  userId: string | null;
  creatorName: string;
  onOpen: (id: string) => void;
  onCreated: (id: string) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const canDelete = (c: CalendarSummary) => role === "superadmin" || role === "gestor" || c.createdBy === userId;

  const create = async () => {
    setBusy(true);
    try {
      const id = await createCalendar({ data: newSeed("Novo calendário"), title: "Novo calendário", creatorId: userId, creatorName });
      successToast("Calendário criado");
      onCreated(id);
    } catch (e) {
      alert("Não foi possível criar: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (c: CalendarSummary) => {
    if (!(await askConfirm(`Excluir o calendário “${c.title}”?\n\nEssa ação não pode ser desfeita e remove o calendário para todos da escola.`))) return;
    try {
      await deleteCalendar(c.id);
      successToast("Calendário excluído");
      onChanged();
    } catch (e) {
      alert("Não foi possível excluir: " + (e as Error).message);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-1">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-neutral-500">Centro de calendários</p>
          <h1 className="text-2xl font-black text-foreground">Calendários da escola</h1>
          <p className="mt-1 max-w-2xl text-sm font-medium text-muted-foreground">
            Crie quantos calendários precisar (anual, por trimestre, por turno…). Todos da escola visualizam; a edição é de quem cria
            mais a coordenação, e você pode liberar para outros usuários como participantes.
          </p>
        </div>
        {canManage ? (
          <Button onClick={create} disabled={busy}>{busy ? "Criando…" : "+ Novo calendário"}</Button>
        ) : null}
      </div>

      {isError ? (
        <p className="mb-4 rounded-xl bg-neutral-100 p-3 text-sm font-bold text-neutral-800">
          Não foi possível carregar. {error?.message}
        </p>
      ) : null}

      {loading ? (
        <div className="grid place-items-center p-16 text-sm font-bold text-muted-foreground">Carregando…</div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
          <p className="text-sm font-bold text-muted-foreground">Nenhum calendário ainda.</p>
          {canManage ? <p className="mt-1 text-xs text-muted-foreground">Clique em “+ Novo calendário” para começar.</p> : null}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {list.map((c) => (
            <article key={c.id} className="flex flex-col rounded-2xl border border-border bg-card p-4 shadow-sm transition hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <h2 className="min-w-0 flex-1 truncate text-base font-black text-foreground">{c.title || "Sem título"}</h2>
                {c.editors.length > 0 ? (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-black text-muted-foreground">
                    {c.editors.length} participante(s)
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs font-bold text-muted-foreground">
                {c.createdByName ? `Criado por ${c.createdByName}` : "Criador desconhecido"}
              </p>
              <p className="text-xs text-muted-foreground">{fmtStamp(c.updatedAt, c.updatedByName) ?? "Sem edições ainda"}</p>
              <div className="mt-3 flex gap-2 border-t border-border pt-3">
                <Button variant="soft" className="flex-1" onClick={() => onOpen(c.id)}>Abrir</Button>
                {canDelete(c) ? (
                  <button
                    onClick={() => remove(c)}
                    className="rounded-xl bg-red-50 px-3 text-sm font-bold text-red-600 transition hover:bg-red-100"
                    aria-label="Excluir calendário"
                  >
                    Excluir
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

/* ====================== Carrega 1 calendário e abre o construtor ====================== */
function CalendarEditorLoader({
  id,
  role,
  canManage,
  userId,
  updaterName,
  onBack,
}: {
  id: string;
  role: string | null;
  canManage: boolean;
  userId: string | null;
  updaterName: string;
  onBack: () => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const { data: people = [] } = useQuery({ queryKey: ["org-people"], queryFn: listOrgPeople, enabled: canManage });
  const { data: rec, isLoading } = useQuery({ queryKey: ["calendar", id, reloadKey], queryFn: () => loadCalendar(id) });

  if (isLoading) return <div className="grid place-items-center p-16 text-sm font-bold text-muted-foreground">Carregando calendário…</div>;
  if (!rec) {
    return (
      <div className="grid place-items-center gap-3 p-16 text-center">
        <p className="text-sm font-bold text-muted-foreground">Calendário não encontrado (pode ter sido excluído).</p>
        <Button variant="soft" onClick={onBack}>← Voltar aos calendários</Button>
      </div>
    );
  }

  const canEdit = canManage || rec.createdBy === userId || (!!userId && rec.editors.includes(userId));
  const canDelete = role === "superadmin" || role === "gestor" || rec.createdBy === userId;
  const canManageEditors = canManage || rec.createdBy === userId;
  const canSetCity = role === "gestor" || role === "secretaria" || role === "superadmin";
  const hasData = rec.data && Object.keys(rec.data).length > 0;

  return (
    <CalendarBuilder
      key={`${id}:${reloadKey}`}
      initialData={hasData ? { ...rec.data, categories: vividCategories(rec.data.categories ?? []) } : newSeed(rec.title || "Calendário")}
      initialVersion={rec.version}
      initialStamp={fmtStamp(rec.updatedAt, rec.updatedByName)}
      creatorName={rec.createdByName}
      canManage={canEdit}
      canDelete={canDelete}
      canManageEditors={canManageEditors}
      canSetCity={canSetCity}
      people={people}
      initialEditors={rec.editors}
      onBack={onBack}
      onDelete={async () => {
        if (!(await askConfirm(`Excluir o calendário “${rec.title}”?\n\nEssa ação não pode ser desfeita.`))) return;
        try {
          await deleteCalendar(id);
          successToast("Calendário excluído");
          onBack();
        } catch (e) {
          alert("Não foi possível excluir: " + (e as Error).message);
        }
      }}
      save={async ({ data, editors, expectedVersion }) => {
        try {
          const meta = await saveCalendar({ id, data, title: data.title, editors, expectedVersion, updaterId: userId, updaterName });
          successToast("Calendário salvo para toda a equipe");
          return { version: meta.version, stamp: fmtStamp(meta.updatedAt, meta.updatedByName) };
        } catch (e) {
          if ((e as Error).message === CALENDAR_CONFLICT) {
            alert(
              "Outra pessoa salvou este calendário enquanto você editava.\n\n" +
                "Para não sobrescrever o trabalho dela, suas alterações não salvas serão descartadas e a versão atual será recarregada.",
            );
            setReloadKey((k) => k + 1);
            return "conflict";
          }
          throw e;
        }
      }}
    />
  );
}

