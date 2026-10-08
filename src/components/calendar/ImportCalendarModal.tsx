import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, Trash2 } from "lucide-react";
import { downloadCalendarTemplate } from "../../lib/importCalendar";
import { dedupe, normText, readCalendarFile, type ImportedEvent, type ReadMethod } from "../../lib/importCalendarBuilder";
import { DateInput } from "../DateInput";
import { Dropzone } from "../Dropzone";
import { Button, Modal } from "../ui";
import { cn } from "../../lib/cn";

const ACCEPT = "image/*,.pdf,.doc,.docx,.docm,.odt,.rtf,.pptx,.xlsx,.xls,.xlsm,.ods,.csv,.tsv,.txt,.html,.htm,.ics,.json";
const METHOD: Record<ReadMethod, string> = {
  planilha: "planilha padrão",
  leitura: "leitura do documento",
  ocr: "leitura da foto (OCR)",
  ia: "lido com IA",
};
const FALLBACK_CATS = ["Feriado", "Avaliação", "Recuperação Paralela", "Pedagógico", "Evento & Cultura", "Data comemorativa", "Marco do período", "Evento"];

type Row = ImportedEvent & { id: number; include: boolean; flag?: string };
type FileInfo = { name: string; method: ReadMethod; count: number; note?: string; error?: string };

let seq = 0;

/** Importar calendário pronto: qualquer arquivo ou foto → eventos revisáveis → calendário no padrão do sistema. */
export function ImportSmartModal({
  year,
  categories,
  existing,
  aiReady,
  onJSON,
  onApply,
  onClose,
}: {
  year: number;
  categories: string[];
  existing: { start: string; title: string }[];
  aiReady: boolean;
  onJSON: (file: File) => void;
  onApply: (events: ImportedEvent[], mode: "add" | "replace") => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [infos, setInfos] = useState<FileInfo[]>([]);
  const [busy, setBusy] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  const existingKeys = useMemo(() => new Set(existing.map((e) => `${e.start}|${normText(e.title)}`)), [existing]);
  const flagFor = useCallback(
    (e: ImportedEvent): string | undefined => {
      if (existingKeys.has(`${e.start}|${normText(e.title)}`)) return "já está no calendário";
      const inYear = +e.start.slice(0, 4) === year || (e.end && +e.end.slice(0, 4) === year);
      return inYear ? undefined : `fora de ${year}`;
    },
    [existingKeys, year],
  );

  /** Lê os arquivos, junta tudo e marca o que parece repetido ou de outro ano. */
  const load = useCallback(
    async (list: File[], forceAi = false) => {
      const json = list.length === 1 && /\.json$/i.test(list[0].name);
      if (json) {
        onJSON(list[0]); // restaura backup completo do construtor
        onClose();
        return;
      }
      setBusy("Lendo…");
      const found: ImportedEvent[] = [];
      const done: FileInfo[] = [];
      for (const file of list) {
        try {
          const r = await readCalendarFile(file, { year, ai: aiReady, forceAi, progress: (m) => alive.current && setBusy(`${file.name}: ${m}`) });
          found.push(...r.events);
          done.push({ name: file.name, method: r.method, count: r.events.length, note: r.note });
        } catch (e) {
          done.push({ name: file.name, method: "leitura", count: 0, error: (e as Error).message });
        }
      }
      if (!alive.current) return;
      const unique = dedupe(found).sort((a, b) => a.start.localeCompare(b.start));
      setRows(unique.map((e) => { const flag = flagFor(e); return { ...e, id: ++seq, include: !flag, flag }; }));
      setInfos(done);
      setFiles(list);
      setBusy("");
    },
    [aiReady, flagFor, onClose, onJSON, year],
  );

  // Ctrl+V cola um print ou arquivo copiado.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = [...(e.clipboardData?.items ?? [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter((f): f is File => !!f);
      if (!pasted.length) return;
      e.preventDefault();
      load(pasted.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `print-${i + 1}.${f.type.split("/")[1] || "png"}`, { type: f.type }))));
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [load]);

  const update = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const chosen = rows.filter((r) => r.include && r.title.trim() && r.start);
  const catOptions = useMemo(() => {
    const all = [...categories, ...FALLBACK_CATS, ...rows.map((r) => r.categoryLabel)].filter(Boolean);
    return all.filter((c, i) => all.findIndex((x) => x.toLowerCase() === c.toLowerCase()) === i);
  }, [categories, rows]);
  const hasDoc = infos.some((i) => i.method !== "planilha");
  const final = (): ImportedEvent[] =>
    dedupe(chosen.map((r) => ({ title: r.title.trim(), categoryLabel: r.categoryLabel, start: r.start, end: r.end && r.end > r.start ? r.end : undefined })));

  return (
    <Modal open onClose={onClose} title="Importar calendário pronto" size="xl">
      <div className="space-y-4">
        <Dropzone
          accept={ACCEPT}
          multiple
          title="Arraste o calendário aqui, ou clique para procurar"
          hint="Foto ou print · PDF · Word · Excel · PowerPoint · texto · ICS — pode enviar vários de uma vez (até 25 MB cada). Ctrl+V cola um print."
          onFiles={(l) => l?.length && load([...l])}
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>
            Leitura mais exata: <button type="button" className="cb-link" onClick={() => downloadCalendarTemplate()}>baixar a planilha-modelo</button>.
          </span>
          <span>{aiReady ? "A IA do sistema reforça fotos, PDFs escaneados e calendários desenhados." : "Fotos e PDFs escaneados são lidos por OCR no aparelho (a IA do sistema não está ligada)."}</span>
        </div>

        {busy ? (
          <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm font-bold text-foreground" role="status">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-400 border-t-neutral-900" /> {busy}
          </p>
        ) : null}

        {infos.map((i) => (
          <p key={i.name} className={cn("rounded-lg px-3 py-2 text-xs font-bold", i.error ? "bg-red-50 text-red-600" : "bg-muted text-foreground")}>
            {i.name} — {i.error ? i.error : `${i.count} evento(s) · ${METHOD[i.method]}`}
            {i.note ? <span className="font-medium text-muted-foreground"> · {i.note}</span> : null}
          </p>
        ))}
        {!busy && infos.length > 0 && rows.length === 0 && !infos.some((i) => i.error) ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600">
            Nenhum evento reconhecido. Confira se o arquivo tem datas (ex.: 12/06/2026, “12 de junho” ou o mês como título e o dia embaixo).
            {!aiReady ? " Para calendários desenhados, peça ao administrador para ligar a IA." : ""}
          </p>
        ) : null}

        {rows.length > 0 ? (
          <div>
            {hasDoc ? (
              <p className="mb-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs font-bold text-neutral-800">
                Este arquivo não é uma planilha-modelo: confira datas, títulos e categorias antes de adicionar — alguns eventos podem faltar.
              </p>
            ) : null}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-bold text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-neutral-900"
                  checked={chosen.length === rows.length}
                  onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, include: e.target.checked })))}
                />
                {chosen.length} de {rows.length} evento(s) selecionado(s)
              </label>
              {aiReady && files.length ? (
                <button type="button" onClick={() => load(files, true)} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-bold text-foreground hover:bg-muted disabled:opacity-50">
                  <Sparkles size={13} /> Reler com IA
                </button>
              ) : null}
            </div>
            <ul className="max-h-[22rem] space-y-1.5 overflow-y-auto rounded-xl border border-border p-2">
              {rows.map((r) => (
                <li key={r.id} className={cn("rounded-lg border border-border p-2", !r.include && "opacity-55")}>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" className="h-4 w-4 shrink-0 accent-neutral-900" checked={r.include} onChange={(e) => update(r.id, { include: e.target.checked })} aria-label="Incluir evento" />
                    <input
                      value={r.title}
                      maxLength={120}
                      onChange={(e) => update(r.id, { title: e.target.value })}
                      className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-bold text-foreground outline-none hover:border-border focus:border-neutral-900"
                      aria-label="Título do evento"
                    />
                    <button type="button" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-red-600 hover:bg-red-50" aria-label="Remover evento">
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5 pl-6 sm:grid-cols-[9rem_9rem_1fr]">
                    <DateInput value={r.start} onChange={(v) => update(r.id, { start: v || r.start, flag: undefined })} className="h-9" aria-label="Data" />
                    <DateInput value={r.end ?? ""} onChange={(v) => update(r.id, { end: v || undefined })} placeholder="até (opcional)" className="h-9" aria-label="Data final" />
                    <select
                      value={r.categoryLabel}
                      onChange={(e) => update(r.id, { categoryLabel: e.target.value })}
                      className="col-span-2 h-9 rounded-lg border border-input bg-card px-2 text-sm outline-none focus:border-neutral-900 sm:col-span-1"
                      aria-label="Categoria"
                    >
                      {catOptions.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  {r.flag ? <p className="mt-1 pl-6 text-[11px] font-bold text-muted-foreground">⚠ {r.flag}{r.include ? "" : " — desmarcado"}</p> : null}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
              <Button variant="ghost" onClick={onClose}>Cancelar</Button>
              <Button variant="soft" disabled={!chosen.length} onClick={() => onApply(final(), "replace")}>Substituir os eventos</Button>
              <Button disabled={!chosen.length} onClick={() => onApply(final(), "add")}>Adicionar {chosen.length} ao calendário</Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
