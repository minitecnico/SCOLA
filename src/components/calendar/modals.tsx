import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { successToast } from "../Feedback";
import { listSchools, saveSchool } from "../../lib/queries";
import { downloadCalendarTemplate } from "../../lib/importCalendar";
import { parseAnyCalendarFile, type ImportedEvent } from "../../lib/importCalendarBuilder";
import { CityPicker, type Localidade } from "../CityPicker";
import { Button, Modal } from "../ui";
import { Dropzone } from "../Dropzone";
import { cn } from "../../lib/cn";
import type { OrgPerson } from "../../lib/types";


/* ------------------- Modal de participantes (quem pode editar) --------------------- */
export function EditorsModal({
  people,
  editors,
  onChange,
  onClose,
}: {
  people: OrgPerson[];
  editors: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const set = new Set(editors);
  const toggle = (id: string) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    onChange([...n]);
  };
  // Coordenação/direção já editam por papel — destacamos para não confundir.
  const alwaysEdit = (r: string) => r === "gestor" || r === "superadmin";

  return (
    <Modal open onClose={onClose} title="Participantes — quem pode editar" size="xl">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Todos da escola <b>veem</b> este calendário. Marque abaixo quem mais pode <b>editar</b>. A gestão já editam por
          padrão. As mudanças entram ao clicar em <b>Salvar</b>.
        </p>
        {people.length === 0 ? (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm font-bold text-muted-foreground">Nenhum usuário na escola ainda.</p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
            {people.map((p) => {
              const byRole = alwaysEdit(p.role);
              const checked = byRole || set.has(p.user_id);
              return (
                <label
                  key={p.user_id}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-2 py-2 text-sm",
                    byRole ? "opacity-60" : "cursor-pointer hover:bg-muted",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={byRole}
                    onChange={() => toggle(p.user_id)}
                    className="h-4 w-4 accent-neutral-900"
                  />
                  <span className="min-w-0 flex-1 truncate font-bold text-foreground">{p.full_name || p.email || p.user_id}</span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-black uppercase text-muted-foreground">{p.role}</span>
                  {byRole ? <span className="shrink-0 text-[10px] font-bold text-muted-foreground">edita por padrão</span> : null}
                </label>
              );
            })}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button onClick={onClose}>Concluir</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------- Modal de importação inteligente --------------------- */
export function ImportSmartModal({
  year,
  onJSON,
  onApply,
  onClose,
}: {
  year: number;
  onJSON: (file: File) => void;
  onApply: (events: ImportedEvent[], mode: "add" | "replace") => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [events, setEvents] = useState<ImportedEvent[] | null>(null);
  const [fileName, setFileName] = useState("");

  async function handleFile(file?: File | null) {
    if (!file) return;
    setErr("");
    setEvents(null);
    setFileName(file.name);
    if (file.name.toLowerCase().endsWith(".json")) {
      onJSON(file); // restaura backup completo do construtor
      onClose();
      return;
    }
    setBusy(true);
    try {
      const ev = await parseAnyCalendarFile(file, year);
      if (!ev.length) {
        setErr('Nenhum evento reconhecido. Confira se o documento tem datas (ex.: 12/06/2026 ou “12 de junho”).');
      }
      setEvents(ev);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isDoc = /\.(pdf|docx)$/i.test(fileName);

  return (
    <Modal open onClose={onClose} title="Importar calendário pronto" size="xl">
      <div className="space-y-4">
        {/* Caminho recomendado: planilha-modelo (leitura 100% confiável). */}
        <div className="rounded-xl border border-border bg-muted p-3">
          <p className="text-sm font-bold text-foreground">Forma recomendada: planilha Excel</p>
          <p className="mt-0.5 text-xs font-medium text-muted-foreground">
            Baixe o modelo, preencha (Data, Título, Categoria) e suba aqui. É a leitura mais confiável.
          </p>
          <button
            type="button"
            onClick={() => downloadCalendarTemplate()}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-black text-white hover:bg-black"
          >
            Baixar planilha-modelo
          </button>
        </div>

        <Dropzone
          accept=".xlsx,.xls,.csv,.ics,.pdf,.docx,.json"
          multiple={false}
          title="Arraste o calendário aqui, ou clique para procurar"
          hint="Excel/CSV (recomendado) · PDF/Word e ICS (leitura aproximada) · backup .json — até 15 MB"
          onFiles={(l) => handleFile(l?.[0])}
        />

        <p className="text-xs text-muted-foreground">
          PDF e Word são lidos por aproximação — calendários com layout livre (dia sem mês, colunas) podem sair
          incompletos. Sempre revise antes de salvar; para garantir, use o Excel.
        </p>

        {busy ? <p className="text-sm font-bold text-muted-foreground">Lendo “{fileName}”…</p> : null}
        {err ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{err}</p> : null}

        {events && events.length > 0 ? (
          <div>
            {isDoc ? (
              <p className="mb-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs font-bold text-neutral-800">
                Leitura aproximada de PDF/Word. Confira datas e títulos no editor — alguns eventos podem faltar.
              </p>
            ) : null}
            <p className="mb-2 text-sm font-bold text-foreground">{events.length} evento(s) encontrado(s):</p>
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
              {events.slice(0, 80).map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-24 shrink-0 font-bold text-muted-foreground">
                    {e.start.slice(8, 10)}/{e.start.slice(5, 7)}
                    {e.end ? `–${e.end.slice(8, 10)}/${e.end.slice(5, 7)}` : ""}
                  </span>
                  <span className="truncate font-bold text-foreground">{e.title}</span>
                  <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-black text-muted-foreground">{e.categoryLabel}</span>
                </div>
              ))}
              {events.length > 80 ? <p className="px-1 pt-1 text-[11px] font-bold text-muted-foreground">+{events.length - 80} evento(s)…</p> : null}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={onClose}>Cancelar</Button>
              <Button variant="soft" onClick={() => onApply(events, "replace")}>Substituir eventos</Button>
              <Button onClick={() => onApply(events, "add")}>Adicionar {events.length} ao calendário</Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

/* ------------------- Modal: cidade da escola (feriados locais) --------------------- */
export function CityModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: schools } = useQuery({ queryKey: ["schools"], queryFn: listSchools });
  const school = schools?.[0] ?? null;
  const [loc, setLoc] = useState<Localidade | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (school && !loc) setLoc({ city: school.city ?? "", uf: school.uf ?? "", ibge_code: school.ibge_code ?? "" });
  }, [school, loc]);

  const save = async () => {
    if (!school || !loc?.ibge_code) return;
    setBusy(true);
    try {
      await saveSchool({ ...school, city: loc.city, uf: loc.uf, ibge_code: loc.ibge_code });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["schools"] }),
        qc.invalidateQueries({ queryKey: ["local-holidays"] }),
      ]);
      successToast("Cidade da escola salva");
      onClose();
    } catch (e) {
      alert("Não foi possível salvar: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Cidade da escola" size="lg">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Com a cidade definida, o calendário mostra também os <b>feriados do estado e do município</b> — para toda a escola.
          Você pode mudar isso depois em Configurações › Escola.
        </p>
        {loc ? <CityPicker value={loc} onChange={setLoc} /> : <p className="text-sm font-bold text-muted-foreground">Carregando…</p>}
        <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={busy || !loc?.ibge_code}>{busy ? "Salvando…" : "Salvar cidade"}</Button>
        </div>
      </div>
    </Modal>
  );
}

