import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { useAuth } from "../../auth/AuthProvider";
import { askConfirm, successToast } from "../Feedback";
import { deleteSchoolHoliday, listLocalHolidays, listSchoolHolidays, saveSchoolHoliday } from "../../lib/queries";
import { holidayKindLabel } from "../../lib/holidays";
import { DateInput, isoToBr } from "../DateInput";
import { Button, Field, Input, Modal } from "../ui";
import { LOCAL_HOLIDAY_COLOR } from "../../lib/calendarColors";
import type { SchoolHoliday } from "../../lib/types";

/** Atalhos: datas que muitas escolas tratam como feriado/recesso e a fonte aberta quase nunca traz. */
const QUICK = [
  { title: "Dia do Professor", md: "10-15" },
  { title: "Dia do Servidor Público", md: "10-28" },
  { title: "Aniversário da cidade", md: "" },
  { title: "Padroeiro(a) da cidade", md: "" },
];

const monthDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Feriados municipais da escola: o que a fonte aberta não tem (ou veio sem nome) a coordenação cadastra aqui. */
export function LocalHolidaysModal({ year, onClose, onChangeCity }: { year: number; onClose: () => void; onChangeCity: () => void }) {
  const qc = useQueryClient();
  const { activeOrgId } = useAuth();
  const { data: mine = [] } = useQuery({ queryKey: ["school-holidays", activeOrgId], queryFn: listSchoolHolidays });
  const { data: local } = useQuery({ queryKey: ["local-holidays", activeOrgId, year], queryFn: () => listLocalHolidays(year), staleTime: 60 * 60_000 });
  const [editId, setEditId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [yearly, setYearly] = useState(true);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["school-holidays"] }), qc.invalidateQueries({ queryKey: ["local-holidays"] })]);
  const reset = () => {
    setEditId(null);
    setTitle("");
    setDate("");
    setYearly(true);
  };
  const save = useMutation({
    mutationFn: (v: { id?: string; date: string; title: string; yearly: boolean }) => saveSchoolHoliday(v),
    onSuccess: async () => {
      await refresh();
      successToast("Feriado salvo");
      reset();
    },
    onError: (e) => alert((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSchoolHoliday(id),
    onSuccess: async () => {
      await refresh();
      successToast("Feriado removido");
    },
    onError: (e) => alert((e as Error).message),
  });

  const submit = () => save.mutate({ id: editId ?? undefined, date, title, yearly });
  const edit = (h: SchoolHoliday) => {
    setEditId(h.id);
    setTitle(h.title);
    setDate(h.date);
    setYearly(h.yearly);
  };
  const quick = (q: (typeof QUICK)[number]) => {
    if (q.md) save.mutate({ date: `${year}-${q.md}`, title: q.title, yearly: true });
    else {
      setEditId(null);
      setTitle(q.title);
      setDate("");
      setYearly(true);
    }
  };
  const nameIt = (iso: string) => {
    setEditId(null);
    setTitle("");
    setDate(iso);
    setYearly(true);
  };

  const registered = new Set(mine.map((h) => `${h.date.slice(5)}|${h.title.toLowerCase()}`));
  const quickLeft = QUICK.filter((q) => !q.md || !registered.has(`${q.md}|${q.title.toLowerCase()}`));
  const fromSource = (local?.holidays ?? []).filter((h) => !h.custom);
  const canSave = !!title.trim() && !!date && !save.isPending;

  return (
    <Modal open onClose={onClose} title="Feriados municipais" size="lg">
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Cadastre os feriados e recessos da sua cidade que não aparecem sozinhos. Eles passam a valer para <b>toda a escola</b>: aparecem no
          calendário e saem da conta de dias letivos e do mapa de chamada.
        </p>

        {quickLeft.length ? (
          <div>
            <p className="mb-1.5 text-xs font-semibold text-neutral-700">Atalhos</p>
            <div className="flex flex-wrap gap-1.5">
              {quickLeft.map((q) => (
                <button
                  key={q.title}
                  type="button"
                  disabled={save.isPending}
                  onClick={() => quick(q)}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-50"
                >
                  + {q.title}
                  {q.md ? ` (${q.md.slice(3)}/${q.md.slice(0, 2)})` : ""}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="space-y-3 rounded-xl border border-border bg-muted p-3">
          <p className="text-sm font-bold text-foreground">{editId ? "Editar feriado" : "Novo feriado"}</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
            <Field label="Nome">
              <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Dia do Professor" />
            </Field>
            <Field label="Data">
              <DateInput value={date} onChange={setDate} />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} className="h-4 w-4 accent-neutral-900" />
            Repetir todo ano nesta data
          </label>
          <div className="flex justify-end gap-2">
            {editId || title || date ? <Button variant="ghost" onClick={reset}>Limpar</Button> : null}
            <Button onClick={submit} disabled={!canSave}>{save.isPending ? "Salvando…" : editId ? "Salvar alterações" : "Adicionar feriado"}</Button>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-neutral-700">Cadastrados pela escola ({mine.length})</p>
          {mine.length ? (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {mine.map((h) => (
                <li key={h.id} className="flex items-center gap-2 px-3 py-2">
                  <span className="grid h-9 w-14 shrink-0 place-items-center rounded-lg text-xs font-black text-white" style={{ background: LOCAL_HOLIDAY_COLOR }}>
                    {monthDay(h.date)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-foreground">{h.title}</span>
                    <span className="block text-xs text-muted-foreground">{h.yearly ? "Todo ano" : `Só em ${h.date.slice(0, 4)}`}</span>
                  </span>
                  <button onClick={() => edit(h)} className="grid h-8 w-8 place-items-center rounded-md text-neutral-700 hover:bg-neutral-100" aria-label={`Editar ${h.title}`}><Pencil size={15} /></button>
                  <button
                    onClick={() => askConfirm(`Remover “${h.title}”?`).then((ok) => ok && remove.mutate(h.id))}
                    className="grid h-8 w-8 place-items-center rounded-md text-red-600 hover:bg-red-50"
                    aria-label={`Remover ${h.title}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs font-medium text-muted-foreground">Nenhum feriado cadastrado ainda.</p>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold text-neutral-700">
            {local?.city ? `Já vêm de dados abertos para ${local.city.replace(/\s*[-–/,]\s*[A-Za-z]{2}$/, "")} em ${year}` : `Dados abertos em ${year}`}
          </p>
          {local?.status === "sem-cidade" ? (
            <p className="text-xs text-muted-foreground">
              Sem cidade definida, só aparecem os feriados cadastrados acima.{" "}
              <button className="cb-link" onClick={onChangeCity}>Definir a cidade da escola</button>
            </p>
          ) : fromSource.length ? (
            <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-xl border border-border">
              {fromSource.map((h) => (
                <li key={h.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                  <span className="w-12 shrink-0 font-black text-foreground">{monthDay(h.date)}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
                    {h.generic ? "Feriado municipal (sem nome na fonte)" : h.title}
                    <span className="ml-1.5 font-medium text-muted-foreground">{holidayKindLabel(h).split(" · ")[0]}</span>
                  </span>
                  {h.generic ? (
                    <button className="cb-link shrink-0" onClick={() => nameIt(h.date)} title={`Dar nome ao feriado de ${isoToBr(h.date)}`}>Dar nome</button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">A fonte aberta não tem nada para a sua cidade neste ano — por isso o cadastro acima.</p>
          )}
        </div>

        <div className="flex justify-end border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </Modal>
  );
}
