import { useState } from 'react';
import { cn } from '../lib/cn';
import { fmtNumber } from '../lib/format';
import { groupByMonth, weekdayLetter } from '../lib/schooldays';
import { MONTHS, type ReportPayload } from '../lib/types';
import { TONE, freqTone, gradeTone, situationOf, type Tone } from '../lib/tone';

const exact = { printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as const;

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** Lista de datas em chips, com limite e botão "+N" para expandir (evita estourar com muitos dias). */
function DateChips({
  dates,
  cls,
  chip,
  examSet,
  max = 8,
}: {
  dates: string[];
  cls: string;
  chip: string;
  examSet?: Set<string>;
  max?: number;
}) {
  const [open, setOpen] = useState(false);
  if (dates.length === 0) return <span className="text-slate-300">—</span>;
  const shown = open ? dates : dates.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map((d) => {
        const exam = examSet?.has(d);
        return (
          <span key={d} className={cn('rounded-lg font-bold', exam ? 'bg-orange-100 text-orange-800' : cls, chip)} title={exam ? 'Semana de provas' : undefined}>
            {d.slice(8, 10)}/{d.slice(5, 7)}{exam ? ' ⚑' : ''}
          </span>
        );
      })}
      {dates.length > max ? (
        <button onClick={() => setOpen((v) => !v)} className={cn('rounded-lg bg-slate-200 font-black text-slate-600 hover:bg-slate-300', chip)}>
          {open ? 'ver menos' : `+${dates.length - max}`}
        </button>
      ) : null}
    </div>
  );
}
function fmtDM(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} (${wd})`;
}
function situacao(media: number | null) {
  return situationOf(media).label;
}
/** Cor da situação: verde aprovado · laranja recuperação · vermelho muito abaixo. */
function situacaoCls(media: number | null): string {
  const t = situationOf(media).tone;
  return t === 'none' ? 'text-slate-400' : TONE[t].text;
}
const gradeCls = (v: number | null | undefined, max = 10) => {
  const t = gradeTone(v, max);
  return t === 'none' ? 'text-slate-400' : TONE[t].text;
};

export function ReportView({ payload, compact = false }: { payload: ReportPayload; compact?: boolean }) {
  const { school, kind, minPct = 75 } = payload;

  return (
    <div className="report-view">
      {/* Cabeçalho institucional (letterhead) */}
      <header className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card print:border-slate-300 print:shadow-none">
        <div className="h-1.5 bg-neutral-900" style={exact} />
        <div className="flex items-start gap-4 p-5">
          {school?.logo_url ? (
            <img src={school.logo_url} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-1" />
          ) : (
            <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-slate-100 text-xl font-black uppercase text-slate-400">
              {school?.name?.slice(0, 1) ?? 'E'}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {school?.name ? <p className="truncate text-sm font-black uppercase tracking-[0.08em] text-slate-800">{school.name}</p> : null}
            {school && (school.address || school.city || school.phone) ? (
              <p className="truncate text-xs text-slate-400">{[school.address, school.city, school.phone].filter(Boolean).join(' • ')}</p>
            ) : null}
            <h2 className="mt-2 text-xl font-black leading-tight text-slate-900">{payload.title}</h2>
            {payload.subject ? <p className="text-sm font-black text-slate-700">Disciplina: {payload.subject}</p> : null}
            <p className="text-sm font-medium text-slate-500">Turma {payload.className} • {payload.period}</p>
          </div>
          <div className="ml-auto hidden shrink-0 text-right sm:block">
            <p className="text-[10px] font-black uppercase tracking-wide text-slate-400">Emitido em</p>
            <p className="text-sm font-bold text-slate-700">{payload.generatedAt}</p>
          </div>
        </div>
      </header>

      {kind === 'freq' && payload.examDates?.length ? (
        <div className="mb-4 rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-800 print:bg-transparent">
          🗓 Semana de Provas — chamada com turmas misturadas em: {payload.examDates.map(fmtDM).join(', ')}
        </div>
      ) : null}

      <ReportSummary payload={payload} minPct={minPct} compact={compact} />

      {kind === 'freq' ? <FreqBody payload={payload} compact={compact} minPct={minPct} /> : <NotasBody payload={payload} compact={compact} />}

      <ReportFooter generatedAt={payload.generatedAt} />
    </div>
  );
}

/** Rodapé oficial: nota de emissão eletrônica. */
function ReportFooter({ generatedAt }: { generatedAt: string }) {
  return (
    <footer className="mt-10 break-inside-avoid">
      <div className="flex flex-col items-center gap-2 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-400 sm:flex-row sm:justify-center">
        <img src="/scola-mono-preta.svg" alt="SCOLA" className="h-4 w-auto opacity-70" />
        <p>
          Documento gerado eletronicamente por <span className="font-bold text-slate-500">SCOLA</span> — Gestão Escolar em {generatedAt}.
        </p>
      </div>
    </footer>
  );
}

type Stat = { label: string; value: React.ReactNode; tone?: Tone };
const statColor = (t?: Tone) => (t && t !== 'none' ? TONE[t].text : 'text-slate-900');
const statBox = (t?: Tone) => (t && t !== 'none' ? TONE[t].border : '');

function SummaryGrid({ stats, compact }: { stats: Stat[]; compact?: boolean }) {
  if (compact) {
    // Modo compacto: rótulo e valor na mesma linha, cartões baixinhos — economiza espaço vertical.
    return (
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 print:grid-cols-4">
        {stats.map((s, i) => (
          <div key={i} className={cn('flex items-baseline justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 print:shadow-none', statBox(s.tone))}>
            <p className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-400">{s.label}</p>
            <p className={cn('shrink-0 text-lg font-black leading-none', statColor(s.tone))}>{s.value}</p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4 print:grid-cols-4">
      {stats.map((s, i) => (
        <div key={i} className={cn('rounded-xl border border-slate-200 bg-white px-4 py-3.5 print:shadow-none', statBox(s.tone))}>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{s.label}</p>
          <p className={cn('mt-1.5 text-2xl font-black', statColor(s.tone))}>{s.value}</p>
        </div>
      ))}
    </div>
  );
}

function ReportSummary({ payload, minPct, compact }: { payload: ReportPayload; minPct: number; compact?: boolean }) {
  if (payload.kind === 'freq') {
    const rows = payload.freqRows ?? [];
    if (!rows.length) return null;
    const presMed = Math.round((rows.reduce((a, r) => a + r.pct, 0) / rows.length) * 10) / 10;
    const faltas = rows.reduce((a, r) => a + r.absent, 0);
    const presencas = rows.reduce((a, r) => a + r.present, 0);
    return (
      <SummaryGrid
        compact={compact}
        stats={[
          { label: 'Alunos', value: rows.length },
          { label: 'Presença média', value: `${presMed}%`, tone: freqTone(presMed, minPct) },
          { label: 'Total de presenças', value: presencas, tone: 'ok' },
          { label: 'Total de faltas', value: faltas, tone: faltas ? 'bad' : 'none' },
        ]}
      />
    );
  }
  const rows = payload.notasRows ?? [];
  if (!rows.length) return null;
  const t = payload.notasTerm ?? 0;
  const vals = rows.map((r) => (t >= 1 && t <= 3 ? r.terms[t - 1] : r.final)).filter((x): x is number => x != null);
  const turma = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  const aprov = vals.filter((v) => v >= 6).length;
  const pct = vals.length ? Math.round((aprov / vals.length) * 100) : 0;
  return (
    <SummaryGrid
      compact={compact}
      stats={
        t >= 1 && t <= 3
          ? [
              { label: 'Alunos', value: rows.length },
              { label: `Aprovados · ${pct}%`, value: aprov, tone: 'ok' },
              { label: 'Em recuperação', value: vals.length - aprov, tone: vals.length - aprov ? 'warn' : 'none' },
            ]
          : [
              { label: 'Alunos', value: rows.length },
              { label: 'Média da turma', value: turma != null ? fmtNumber(turma, 1) : '–', tone: gradeTone(turma) },
              { label: `Aprovados · ${pct}%`, value: aprov, tone: 'ok' },
              { label: 'Em recuperação', value: vals.length - aprov, tone: vals.length - aprov ? 'warn' : 'none' },
            ]
      }
    />
  );
}

function FreqBody({ payload, compact, minPct }: { payload: ReportPayload; compact: boolean; minPct: number }) {
  const rows = payload.freqRows ?? [];
  const dates = payload.dates ?? [];
  const examSet = new Set(payload.examDates ?? []);
  const show = payload.show ?? {};
  if (rows.length === 0) return <p className="text-center text-slate-400">Nenhum dado no período.</p>;

  // Mapa de chamada mensal (grade P/F por dia letivo) — igual ao modelo impresso.
  if (payload.layout === 'grid') {
    if (!payload.gridDates?.length) return <p className="text-center text-slate-400">Sem dias letivos no período.</p>;
    return <FreqGrid payload={payload} minPct={minPct} />;
  }

  if (dates.length === 0) return <p className="text-center text-slate-400">Nenhuma aula registrada no período.</p>;

  const chip = compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs';

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white print:border-slate-300">
      <table className="w-full text-sm">
        <thead className="border-b-2 border-slate-200 bg-slate-50 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">
          <tr>
            <th className="p-3">Aluno</th>
            {show.present ?? true ? <th className="p-3">Presenças</th> : null}
            {show.absent ?? true ? <th className="p-3">Faltas</th> : null}
            {show.pct ?? true ? <th className="p-3 text-center">Frequência</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const presentDates = dates.filter((d) => r.days?.[d] === true);
            const absentDates = dates.filter((d) => r.days?.[d] === false);
            const tone = freqTone(r.pct, minPct);
            return (
              <tr key={r.name} className="border-t border-slate-100 align-top even:bg-slate-50/50">
                <td className="p-3 font-bold text-slate-800">
                  <div className="flex items-baseline gap-2">
                    <span className="w-5 shrink-0 text-right tabular-nums text-slate-400">{i + 1}.</span>
                    <span className="min-w-0 break-words leading-snug">{r.name}</span>
                  </div>
                </td>
                {show.present ?? true ? (
                  <td className="p-3">
                    <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-green-700">{r.present} presença(s)</div>
                    <DateChips dates={presentDates} cls="border border-green-200 bg-green-50 text-green-700" chip={chip} />
                  </td>
                ) : null}
                {show.absent ?? true ? (
                  <td className="p-3">
                    <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-red-600">{r.absent} falta(s)</div>
                    <DateChips dates={absentDates} cls="border border-red-200 bg-red-50/70 text-red-700" chip={chip} examSet={examSet} max={12} />
                  </td>
                ) : null}
                {show.pct ?? true ? (
                  <td className="p-3">
                  <div className="flex flex-col items-center gap-1.5">
                    <span className={cn('text-base font-black tabular-nums', TONE[tone].text)}>{r.pct}%</span>
                    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={cn('h-full rounded-full', TONE[tone].bar)}
                        style={{ width: `${Math.min(100, Math.max(0, r.pct))}%`, ...exact }}
                      />
                    </div>
                  </div>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Mapa de chamada mensal: matriz aluno × dia letivo (P/F), um bloco por mês.
 * Só entram dias úteis (seg–sex, sem feriados) — escola não funciona fim de semana.
 * Todo aluno começa presente; vira falta só onde há falta registrada na chamada.
 * Resumo por mês: presenças, faltas, % de frequência e situação (Aprovado/Reprovado).
 */
function FreqGrid({ payload, minPct }: { payload: ReportPayload; minPct: number }) {
  const rows = payload.freqRows ?? [];
  const months = groupByMonth(payload.gridDates ?? []);
  const examSet = new Set(payload.examDates ?? []);
  const show = payload.show ?? {};

  return (
    <div className="space-y-6">
      {months.map((m) => (
        <div key={m.key} className="break-inside-avoid overflow-x-auto rounded-xl border border-slate-200 bg-white print:border-slate-300">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-slate-600">
            {MONTHS[m.month - 1]} / {m.year} — {m.days.length} dias letivos
          </div>
          <table className="w-full border-collapse text-center text-[11px] tabular-nums">
            <thead>
              {/* Letra do dia da semana */}
              <tr className="bg-slate-50 text-slate-400">
                <th className="sticky left-0 z-10 bg-slate-50 px-2 py-1 text-left shadow-[2px_0_0_0_rgba(226,232,240,1)]">&nbsp;</th>
                {m.days.map((d) => (
                  <th key={d} className="w-6 border-l border-slate-100 px-0 py-1 font-bold">{weekdayLetter(d)}</th>
                ))}
                <th className="border-l-2 border-slate-200 px-1 py-1" colSpan={4} />
              </tr>
              {/* Número do dia + cabeçalhos do resumo */}
              <tr className="border-b-2 border-slate-200 bg-slate-50 text-slate-500">
                <th className="sticky left-0 z-10 bg-slate-50 px-2 py-1 text-left text-[11px] font-black uppercase shadow-[2px_0_0_0_rgba(226,232,240,1)]">Aluno</th>
                {m.days.map((d) => (
                  <th key={d} className={cn('w-6 border-l border-slate-100 px-0 py-1 font-bold', examSet.has(d) && 'text-orange-600')} title={examSet.has(d) ? 'Semana de provas' : undefined}>
                    {d.slice(8, 10)}
                  </th>
                ))}
                {show.present ?? true ? <th className="border-l-2 border-slate-200 px-1 py-1 text-[10px] font-black uppercase">Pres.</th> : null}
                {show.absent ?? true ? <th className="px-1 py-1 text-[10px] font-black uppercase">Faltas</th> : null}
                {show.pct ?? true ? <th className="px-1 py-1 text-[10px] font-black uppercase">%</th> : null}
                {show.situation ?? true ? <th className="px-1 py-1 text-[10px] font-black uppercase">Situação</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                let faltas = 0;
                const cells = m.days.map((d) => {
                  const absent = r.days?.[d] === false; // só falta registrada conta; resto = presente
                  if (absent) faltas++;
                  return { d, absent };
                });
                const total = m.days.length;
                const present = total - faltas;
                const pct = total ? Math.round((present / total) * 1000) / 10 : 0;
                const tone = freqTone(pct, minPct);
                const reprovado = pct < minPct;
                return (
                  <tr key={r.name} className="border-t border-slate-100 bg-white even:bg-slate-50">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-inherit px-2 py-1 text-left font-bold text-slate-800 shadow-[2px_0_0_0_rgba(226,232,240,1)]">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="w-5 shrink-0 text-right tabular-nums text-slate-400">{i + 1}</span>
                        {r.name}
                      </span>
                    </td>
                    {cells.map(({ d, absent }) => (
                      <td
                        key={d}
                        className={cn(
                          'w-6 border-l border-slate-100 px-0 py-1 font-black',
                          absent ? 'bg-red-50 text-red-600' : 'text-green-600',
                        )}
                        style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}
                      >
                        {absent ? 'F' : 'P'}
                      </td>
                    ))}
                    {show.present ?? true ? <td className="border-l-2 border-slate-200 px-1 py-1 font-black text-green-700">{present}</td> : null}
                    {show.absent ?? true ? <td className={cn('px-1 py-1 font-black', faltas ? 'text-red-600' : 'text-slate-400')}>{faltas}</td> : null}
                    {show.pct ?? true ? <td className={cn('px-1 py-1 font-black', TONE[tone].text)}>{pct}%</td> : null}
                    {show.situation ?? true ? <td className={cn('px-1 py-1 text-[10px] font-black uppercase', reprovado ? 'text-red-600' : 'text-green-700')}>{reprovado ? 'Reprovado' : 'Aprovado'}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 px-1 text-[11px] text-slate-400">
        <span><span className="font-black text-green-600">P</span> Presente</span>
        <span><span className="font-black text-red-600">F</span> Falta</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-green-500" /> ≥ {minPct}%</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-orange-500" /> {minPct - 10}–{minPct - 1}%</span>
        <span><span className="inline-block h-2 w-2 rounded-full bg-red-500" /> abaixo de {minPct - 10}%</span>
        <span>Situação: frequência ≥ {minPct}% = Aprovado</span>
        <span>Só dias letivos (seg–sex, sem feriados nacionais).</span>
      </div>
    </div>
  );
}

function NotasBody({ payload, compact }: { payload: ReportPayload; compact: boolean }) {
  const rows = payload.notasRows ?? [];
  if (rows.length === 0) return <p className="text-center text-slate-400">Nenhum dado.</p>;
  const pad = compact ? 'p-1.5' : 'p-2';
  const TLABEL = ['1º tri', '2º tri', '3º tri'];
  const show = payload.show ?? {};

  // Filtro por trimestre específico: mostra só a média daquele trimestre.
  const t = payload.notasTerm ?? 0;
  if (t >= 1 && t <= 3) {
    const activities = payload.termActivities ?? [];
    const selected = payload.termSelectedActivities ?? activities.map((a) => a.id ?? a.name);
    return (
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white print:border-slate-300">
        <table className="w-full text-sm">
          <thead className="border-b-2 border-slate-200 bg-slate-50 text-left text-[11px] font-black uppercase tracking-wide text-slate-500">
            <tr>
              <th className={cn('sticky left-0 bg-slate-50', compact ? 'p-2' : 'p-3')}>Aluno</th>
              {selected.map((k) => {
                const act = activities.find((a) => (a.id ?? a.name) === k);
                return act ? <th key={k} className={cn('text-center', pad)}>{act.name}</th> : null;
              })}
              {show.situation ?? true ? <th className={cn('text-center', pad)}>Situação</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const m = r.terms[t - 1];
              return (
                <tr key={r.name} className="border-t border-slate-100">
                  <td className={cn('sticky left-0 bg-white font-bold text-slate-800', compact ? 'p-2' : 'p-3')}>
                    <div className="flex items-baseline gap-2">
                      <span className="w-6 shrink-0 text-right tabular-nums text-slate-400">{i + 1}.</span>
                      <span className="min-w-0 break-words leading-snug">{r.name}</span>
                    </div>
                  </td>
                  {selected.map((k) => {
                    const score = r.activityScores?.[k];
                    const max = activities.find((a) => (a.id ?? a.name) === k)?.max ?? 10;
                    // Verde ≥ 60% do máximo · laranja 50–59% · vermelho abaixo (ex.: 6/10, 3/5).
                    return (
                      <td key={k} className={cn('text-center', pad)}>
                        {score != null ? <span className={cn('text-base font-black', gradeCls(score, max))}>{fmtNumber(score, 1)}</span> : '–'}
                      </td>
                    );
                  })}
                  {show.situation ?? true ? <td className={cn('text-center text-xs font-bold', pad, situacaoCls(m))}>{situacao(m)}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs font-black uppercase text-slate-500">
          <tr>
            <th className={cn('sticky left-0 bg-slate-50', compact ? 'p-2' : 'p-3')}>Aluno</th>
            {TLABEL.map((t, idx) => (
              (show[`term${idx + 1}`] ?? true) ? <th key={t} className={cn('text-center', pad)}>{t}</th> : null
            ))}
            {(show.final ?? true) ? <th className={cn('text-center', pad)}>Final</th> : null}
            {(show.situation ?? true) ? <th className={cn('text-center', pad)}>Situação</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.name} className="border-t border-slate-100">
              <td className={cn('sticky left-0 bg-white font-bold text-slate-800', compact ? 'p-2' : 'p-3')}>
                <span className="mr-2 inline-block w-6 shrink-0 text-right tabular-nums text-slate-400">{i + 1}.</span>{r.name}
              </td>
              {r.terms.map((m, j) => ((show[`term${j + 1}`] ?? true) ? (
                <td key={j} className={cn('text-center', pad)}>
                  {m != null ? <span className={cn('font-bold', gradeCls(m))}>{fmtNumber(m, 1)}</span> : '–'}
                </td>
              ) : null))}
              {(show.final ?? true) ? (
                <td className={cn('text-center', pad)}>
                  {r.final != null ? <span className={cn('font-black', gradeCls(r.final))}>{fmtNumber(r.final, 1)}</span> : '–'}
                </td>
              ) : null}
              {(show.situation ?? true) ? <td className={cn('text-center text-xs font-bold', pad, situacaoCls(r.final))}>{situacao(r.final)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
