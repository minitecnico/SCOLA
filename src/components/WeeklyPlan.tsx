import { Plus, Printer, Trash2 } from 'lucide-react';
import type { WeeklyBlock, WeeklyDay, WeeklyPlanData, WeeklyWeek } from '../lib/types';

/* ============================================================================
   Planejamento Semanal — editor estruturado + visualização imprimível.
   Modelo da professora: grade de dias × turmas, "Materiais / Anotações" e
   "Prazer de casa" por semana. Os dados ficam em JSON no planejamento.
============================================================================ */

const uid = () => Math.random().toString(36).slice(2, 9);
const clone = (d: WeeklyPlanData): WeeklyPlanData => JSON.parse(JSON.stringify(d));

export function newBlock(turma = ''): WeeklyBlock {
  return { id: uid(), turma, items: '' };
}
export function newDay(label: string, classes: string[]): WeeklyDay {
  return { id: uid(), label, date: '', lessons: '', blocks: classes.length ? classes.map((t) => newBlock(t)) : [newBlock()] };
}
export function newWeek(classes: string[]): WeeklyWeek {
  return { id: uid(), days: [newDay('Segunda-feira', classes), newDay('Quinta-feira', classes)], materials: '', homework: '' };
}
export function emptyWeeklyPlan(prefill: Partial<WeeklyPlanData> = {}): WeeklyPlanData {
  const classes = prefill.classes ?? [];
  return {
    school: prefill.school ?? '',
    teacher: prefill.teacher ?? '',
    course: prefill.course ?? '',
    subjects: prefill.subjects ?? '',
    period: prefill.period ?? '',
    classes,
    weeks: prefill.weeks?.length ? prefill.weeks : [newWeek(classes)],
  };
}

/** Texto legível do plano — vai no `content` (busca, cards, envio). */
export function weeklyPlanToText(d: WeeklyPlanData): string {
  const head = `PLANEJAMENTO SEMANAL — ${d.period || ''}\nCurso: ${d.course} · Prof.: ${d.teacher} · Disciplina(s): ${d.subjects}` +
    (d.classes.length ? `\nTurmas: ${d.classes.join(', ')}` : '');
  const weeks = d.weeks
    .map((w, i) => {
      const days = w.days
        .map((day) => {
          const blocks = day.blocks.filter((b) => b.turma || b.items).map((b) => `  [${b.turma}] ${b.items}`).join('\n');
          return `${day.label}${day.date ? ` ${day.date}` : ''}${day.lessons ? ` (${day.lessons})` : ''}:\n${blocks}`;
        })
        .join('\n');
      return `\n=== Semana ${i + 1} ===\n${days}` +
        (w.materials ? `\nMateriais/Anotações: ${w.materials}` : '') +
        (w.homework ? `\nPrazer de casa: ${w.homework}` : '');
    })
    .join('\n');
  return `${head}\n${weeks}`.trim();
}

/* ------------------------------- Editor --------------------------------- */
export function WeeklyPlanEditor({
  data,
  onChange,
  classOptions,
}: {
  data: WeeklyPlanData;
  onChange: (d: WeeklyPlanData) => void;
  classOptions: string[];
}) {
  const patch = (mut: (d: WeeklyPlanData) => void) => {
    const next = clone(data);
    mut(next);
    onChange(next);
  };
  const inp = 'w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';
  const area = `${inp} resize-y leading-relaxed`;
  const lbl = 'mb-1 block text-xs font-bold text-muted-foreground';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label><span className={lbl}>Escola</span><input className={inp} value={data.school} onChange={(e) => patch((d) => (d.school = e.target.value))} /></label>
        <label><span className={lbl}>Professor(a)</span><input className={inp} value={data.teacher} onChange={(e) => patch((d) => (d.teacher = e.target.value))} /></label>
        <label><span className={lbl}>Curso</span><input className={inp} value={data.course} onChange={(e) => patch((d) => (d.course = e.target.value))} placeholder="Ex.: Fund. II" /></label>
        <label><span className={lbl}>Disciplina(s)</span><input className={inp} value={data.subjects} onChange={(e) => patch((d) => (d.subjects = e.target.value))} placeholder="Ex.: Inglês" /></label>
        <label><span className={lbl}>Período</span><input className={inp} value={data.period} onChange={(e) => patch((d) => (d.period = e.target.value))} placeholder="Ex.: Junho / 2026" /></label>
        <label><span className={lbl}>Turmas (separadas por vírgula)</span>
          <input
            className={inp}
            value={data.classes.join(', ')}
            onChange={(e) => patch((d) => (d.classes = e.target.value.split(',').map((s) => s.trim()).filter(Boolean)))}
            placeholder="Ex.: 6º ANO, 7º ANO, 8º ANO"
          />
        </label>
      </div>

      <datalist id="wp-turmas">
        {[...new Set([...data.classes, ...classOptions])].map((t) => <option key={t} value={t} />)}
      </datalist>

      {data.weeks.map((w, wi) => (
        <section key={w.id} className="rounded-xl border border-border bg-muted p-3">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-black text-foreground">Semana {wi + 1}</h4>
            <button
              onClick={() => patch((d) => (d.weeks = d.weeks.filter((x) => x.id !== w.id)))}
              className="rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-600 hover:bg-red-100"
            >
              <Trash2 size={13} className="inline" /> Semana
            </button>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            {w.days.map((day) => (
              <div key={day.id} className="rounded-lg border border-border bg-card p-3">
                <div className="mb-2 grid grid-cols-[1fr_auto] gap-2">
                  <input className={inp} value={day.label} onChange={(e) => patch((d) => setDay(d, w.id, day.id, (x) => (x.label = e.target.value)))} placeholder="Dia (ex.: Segunda-feira)" />
                  <button
                    onClick={() => patch((d) => setWeek(d, w.id, (x) => (x.days = x.days.filter((y) => y.id !== day.id))))}
                    className="rounded-lg bg-muted px-2 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                    aria-label="Remover dia"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <input className={inp} value={day.date} onChange={(e) => patch((d) => setDay(d, w.id, day.id, (x) => (x.date = e.target.value)))} placeholder="Data (ex.: 01/06)" />
                  <input className={inp} value={day.lessons} onChange={(e) => patch((d) => setDay(d, w.id, day.id, (x) => (x.lessons = e.target.value)))} placeholder="Ex.: 2 aulas" />
                </div>

                {day.blocks.map((b) => (
                  <div key={b.id} className="mb-2 rounded-lg border border-border bg-muted p-2">
                    <div className="mb-1 flex items-center gap-2">
                      <input
                        list="wp-turmas"
                        className={`${inp} h-8 py-1 font-bold`}
                        value={b.turma}
                        onChange={(e) => patch((d) => setBlock(d, w.id, day.id, b.id, (x) => (x.turma = e.target.value)))}
                        placeholder="Turma (ex.: 6º ANO)"
                      />
                      <button
                        onClick={() => patch((d) => setDay(d, w.id, day.id, (x) => (x.blocks = x.blocks.filter((y) => y.id !== b.id))))}
                        className="shrink-0 rounded-lg bg-muted px-2 py-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"
                        aria-label="Remover turma"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <textarea
                      className={area}
                      rows={3}
                      value={b.items}
                      onChange={(e) => patch((d) => setBlock(d, w.id, day.id, b.id, (x) => (x.items = e.target.value)))}
                      placeholder="Atividades, visto/correção, homework… (uma por linha)"
                    />
                  </div>
                ))}
                <button
                  onClick={() => patch((d) => setDay(d, w.id, day.id, (x) => x.blocks.push(newBlock())))}
                  className="text-xs font-bold text-emerald-700 hover:text-emerald-800"
                >
                  + Turma
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={() => patch((d) => setWeek(d, w.id, (x) => x.days.push(newDay('Dia', d.classes))))}
            className="mt-2 text-xs font-bold text-emerald-700 hover:text-emerald-800"
          >
            + Dia
          </button>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label><span className={lbl}>Materiais necessários / anotações</span>
              <textarea className={area} rows={2} value={w.materials} onChange={(e) => patch((d) => setWeek(d, w.id, (x) => (x.materials = e.target.value)))} />
            </label>
            <label><span className={lbl}>Prazer de casa</span>
              <textarea className={area} rows={2} value={w.homework} onChange={(e) => patch((d) => setWeek(d, w.id, (x) => (x.homework = e.target.value)))} />
            </label>
          </div>
        </section>
      ))}

      <button
        onClick={() => patch((d) => d.weeks.push(newWeek(d.classes)))}
        className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-emerald-400 px-4 py-2 text-sm font-bold text-emerald-700 hover:bg-emerald-50"
      >
        <Plus size={16} /> Adicionar semana
      </button>
    </div>
  );
}

// helpers imutáveis de localização
function setWeek(d: WeeklyPlanData, weekId: string, mut: (w: WeeklyWeek) => void) {
  const w = d.weeks.find((x) => x.id === weekId);
  if (w) mut(w);
}
function setDay(d: WeeklyPlanData, weekId: string, dayId: string, mut: (day: WeeklyDay) => void) {
  setWeek(d, weekId, (w) => {
    const day = w.days.find((x) => x.id === dayId);
    if (day) mut(day);
  });
}
function setBlock(d: WeeklyPlanData, weekId: string, dayId: string, blockId: string, mut: (b: WeeklyBlock) => void) {
  setDay(d, weekId, dayId, (day) => {
    const b = day.blocks.find((x) => x.id === blockId);
    if (b) mut(b);
  });
}

/* --------------------------- Visualização (imprimível) --------------------------- */
export function WeeklyPlanView({ data }: { data: WeeklyPlanData }) {
  return (
    <div className="wp-sheet">
      <style>{WP_PRINT_CSS}</style>
      <div className="mb-3 flex items-center justify-between gap-3 wp-noprint">
        <p className="text-xs font-bold text-muted-foreground">Pré-visualização — imprima ou salve em PDF.</p>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-black text-white hover:bg-slate-800">
          <Printer size={14} /> Imprimir / PDF
        </button>
      </div>

      <div className="wp-paper rounded-xl border border-border p-4 text-[13px] text-foreground">
        <h2 className="text-center text-base font-black uppercase tracking-wide">Planejamento Semanal{data.period ? ` — ${data.period}` : ''}</h2>
        <p className="mt-1 text-center text-xs font-bold text-muted-foreground">
          Curso: {data.course || '—'} · Prof.(ª): {data.teacher || '—'} · Disciplina(s): {data.subjects || '—'}
          {data.school ? ` · ${data.school}` : ''}
        </p>

        {data.weeks.map((w, wi) => (
          <div key={w.id} className="mt-4 overflow-hidden rounded-lg border border-border wp-week">
            <div className="bg-muted px-3 py-1 text-xs font-black text-muted-foreground">Semana {wi + 1}</div>
            <div className="grid" style={{ gridTemplateColumns: `repeat(${w.days.length}, 1fr) 1fr` }}>
              {w.days.map((day) => (
                <div key={day.id} className="border-t border-border px-3 py-2 wp-cell">
                  <div className="font-black text-rose-600">{day.label}{day.date ? ` — ${day.date}` : ''}{day.lessons ? ` (${day.lessons})` : ''}</div>
                  {day.blocks.filter((b) => b.turma || b.items).map((b) => (
                    <div key={b.id} className="mt-1.5">
                      {b.turma ? <div className="font-black text-foreground">{`>>> ${b.turma} <<<`}</div> : null}
                      <div className="whitespace-pre-wrap text-foreground">{b.items}</div>
                    </div>
                  ))}
                </div>
              ))}
              <div className="border-t border-l border-border bg-amber-50/40 px-3 py-2 wp-cell">
                <div className="text-[11px] font-black uppercase text-muted-foreground">Materiais / anotações</div>
                <div className="mt-1 whitespace-pre-wrap text-foreground">{w.materials || '—'}</div>
              </div>
            </div>
            {w.homework ? (
              <div className="border-t border-border bg-fuchsia-50/40 px-3 py-2">
                <span className="text-[11px] font-black uppercase text-muted-foreground">Prazer de casa: </span>
                <span className="whitespace-pre-wrap font-bold text-foreground">{w.homework}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

const WP_PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .wp-sheet, .wp-sheet * { visibility: visible !important; }
  .wp-sheet { position: absolute; inset: 0; padding: 0 !important; }
  .wp-noprint { display: none !important; }
  .wp-paper { border: none !important; }
  .wp-week { break-inside: avoid; }
  @page { size: A4 portrait; margin: 8mm; }
}
`;
