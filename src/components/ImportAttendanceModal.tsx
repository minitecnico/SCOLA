import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';
import { downloadAttendanceTemplate, matchStudent, normName, parseAttendanceFile, suggestStatus, type Mapped, type ParsedAttendance } from '../lib/importAttendance';
import { importAttendance, listStudents } from '../lib/queries';
import type { ClassRoom } from '../lib/types';
import { successToast } from './Feedback';
import { Button, Modal, Select } from './ui';

/**
 * Importar chamadas já feitas: envia a planilha, confere o que cada símbolo significa
 * e os alunos que não bateram pelo nome, e grava tudo de uma vez.
 */
const STATUS_OPTS: { value: Mapped; label: string }[] = [
  { value: 'present', label: 'Presente' },
  { value: 'absent', label: 'Falta' },
  { value: 'late', label: 'Atraso' },
  { value: 'justified', label: 'Falta justificada' },
  { value: 'ignore', label: 'Ignorar (sem marcação)' },
];
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

type Result = { sessions: number; created: number; updated: number; skipped: number; records: number };

export function ImportAttendanceModal({ open, onClose, classes, defaultClassId }: { open: boolean; onClose: () => void; classes: ClassRoom[]; defaultClassId: string }) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedAttendance | null>(null);
  const [fileName, setFileName] = useState('');
  const [err, setErr] = useState('');
  const [reading, setReading] = useState(false);
  const [classId, setClassId] = useState(defaultClassId);
  const [useSheetTurma, setUseSheetTurma] = useState(false);
  const [map, setMap] = useState<Record<string, Mapped>>({});
  const [who, setWho] = useState<Record<string, string>>({}); // "turma|nome" → aluno ('' = ignorar)
  const [skipExisting, setSkipExisting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const { data: allStudents = [] } = useQuery({ queryKey: ['students'], queryFn: listStudents, enabled: open });
  const active = useMemo(() => allStudents.filter((s) => s.active && s.class_id), [allStudents]);
  const byClass = (id: string) => active.filter((s) => s.class_id === id);

  // Turma da planilha → turma do sistema (pelo nome).
  const turmaMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of parsed?.turmas ?? []) {
      const n = normName(t);
      const c = classes.find((x) => normName(x.name) === n) ?? classes.find((x) => normName(x.name).includes(n) || n.includes(normName(x.name)));
      if (c) m.set(t, c.id);
    }
    return m;
  }, [parsed, classes]);

  const classOf = (turma: string | null) => (useSheetTurma && turma ? turmaMap.get(turma) ?? null : classId);
  const keyOf = (turma: string | null, name: string) => `${classOf(turma) ?? ''}|${name}`;

  // Alunos da planilha → cadastro.
  const people = useMemo(() => {
    if (!parsed) return [];
    const seen = new Map<string, { name: string; turma: string | null; classId: string | null; auto: string | null }>();
    for (const e of parsed.entries) {
      const cid = classOf(e.turma);
      const k = `${cid ?? ''}|${e.name}`;
      if (!seen.has(k)) seen.set(k, { name: e.name, turma: e.turma, classId: cid, auto: cid ? matchStudent(e.name, byClass(cid)) : null });
    }
    return [...seen.entries()].map(([k, v]) => ({ key: k, ...v }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, classId, useSheetTurma, turmaMap, active]);
  const studentFor = (k: string, auto: string | null) => (k in who ? who[k] || null : auto);
  const unmatched = people.filter((p) => !studentFor(p.key, p.auto));
  const matchedCount = people.length - unmatched.length;

  const mapped = (v: string): Mapped | undefined => map[v] ?? suggestStatus(v);
  const pending = (parsed?.values ?? []).filter((v) => !mapped(v.value));

  async function onFile(f: File | undefined) {
    if (!f) return;
    setErr('');
    setReading(true);
    setResult(null);
    try {
      const p = await parseAttendanceFile(f);
      setParsed(p);
      setFileName(f.name);
      setMap({});
      setWho({});
      setUseSheetTurma(p.turmas.length > 0 && p.turmas.every((t) => classes.some((c) => normName(c.name) === normName(t))));
    } catch (e) {
      setParsed(null);
      setErr((e as Error).message);
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const sessions = useMemo(() => {
    if (!parsed) return [];
    const byKey = new Map<string, { class_id: string; date: string; records: Map<string, string> }>();
    for (const e of parsed.entries) {
      const cid = classOf(e.turma);
      const st = mapped(e.value);
      if (!cid || !st || st === 'ignore') continue;
      const p = people.find((x) => x.key === keyOf(e.turma, e.name));
      const sid = p ? studentFor(p.key, p.auto) : null;
      if (!sid) continue;
      const k = `${cid}|${e.date}`;
      const s = byKey.get(k) ?? { class_id: cid, date: e.date, records: new Map() };
      s.records.set(sid, st);
      byKey.set(k, s);
    }
    return [...byKey.values()].map((s) => ({ class_id: s.class_id, date: s.date, records: [...s.records.entries()].map(([student_id, status]) => ({ student_id, status })) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed, map, who, people, classId, useSheetTurma]);
  const marks = sessions.reduce((a, s) => a + s.records.length, 0);

  async function run() {
    setSaving(true);
    setErr('');
    try {
      const r = await importAttendance({ sessions, skipExisting });
      setResult(r);
      qc.invalidateQueries();
      successToast(`${r.sessions} dia(s) de chamada importado(s)`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function close() {
    setParsed(null);
    setResult(null);
    setErr('');
    onClose();
  }

  const klass = classes.find((c) => c.id === classId);

  return (
    <Modal open={open} onClose={close} title="Importar chamadas já feitas" size="xl">
      {result ? (
        <div className="py-4 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-green-100 text-green-700">
            <Check size={24} />
          </span>
          <p className="mt-3 text-lg font-bold">Chamadas importadas</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.created} dia(s) novo(s) · {result.updated} dia(s) atualizado(s){result.skipped ? ` · ${result.skipped} pulado(s) (já tinham chamada)` : ''} · {result.records} marcações
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Elas já aparecem nas chamadas, nos relatórios de frequência e nos alertas.</p>
          <Button className="mt-5" onClick={close}>
            Concluir
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {/* 1. Arquivo */}
          <section>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex-1">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Turma</span>
                <Select value={useSheetTurma ? '__planilha' : classId} onChange={(e) => (e.target.value === '__planilha' ? setUseSheetTurma(true) : (setUseSheetTurma(false), setClassId(e.target.value)))}>
                  {parsed?.turmas.length ? <option value="__planilha">Usar a coluna "Turma" da planilha</option> : null}
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </label>
              <Button variant="ghost" onClick={() => void downloadAttendanceTemplate(klass?.name ?? 'turma', byClass(classId).map((s) => s.full_name))}>
                <Download size={16} /> Baixar modelo
              </Button>
            </div>
            <button
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void onFile(e.dataTransfer.files?.[0]);
              }}
              className="mt-3 flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/30 px-4 py-6 text-center transition hover:border-neutral-400 hover:bg-muted/60"
            >
              {parsed ? <FileSpreadsheet size={26} className="text-green-700" /> : <Upload size={26} className="text-muted-foreground" />}
              <span className="text-sm font-semibold">{reading ? 'Lendo a planilha…' : parsed ? fileName : 'Escolher planilha (.xlsx, .xls ou .csv)'}</span>
              <span className="max-w-xl text-xs text-muted-foreground">
                Serve o <b>mapa de chamada</b> (alunos nas linhas, datas nas colunas) ou uma <b>lista</b> com colunas Data, Aluno e Situação. Vale P/F, •, 1/0, presente/falta… você confirma a seguir.
              </span>
            </button>
            <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            {err ? <p className="mt-2 text-sm font-semibold text-red-600">{err}</p> : null}
          </section>

          {parsed ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Formato" value={parsed.format === 'mapa' ? 'Mapa' : 'Lista'} />
                <Stat label="Dias de aula" value={parsed.dates.length} hint={parsed.dates.length ? `${br(parsed.dates[0])} a ${br(parsed.dates[parsed.dates.length - 1])}` : ''} />
                <Stat label="Alunos reconhecidos" value={`${matchedCount}/${people.length}`} tone={unmatched.length ? 'warn' : 'ok'} />
                <Stat label="Marcações a importar" value={marks} />
              </div>

              {parsed.warnings.length ? (
                <details className="rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-900 ring-1 ring-inset ring-orange-200">
                  <summary className="cursor-pointer font-semibold">{parsed.warnings.length} linha(s) com data não reconhecida (ignoradas)</summary>
                  <ul className="mt-1 list-disc pl-4">
                    {parsed.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {useSheetTurma && parsed.turmas.some((t) => !turmaMap.has(t)) ? (
                <p className="flex gap-2 rounded-lg bg-orange-50 px-3 py-2 text-xs text-orange-900 ring-1 ring-inset ring-orange-200">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Turmas da planilha sem correspondente no sistema (ignoradas): {parsed.turmas.filter((t) => !turmaMap.has(t)).join(', ')}
                </p>
              ) : null}

              {/* 2. Significado dos valores */}
              <section>
                <h3 className="mb-1 text-sm font-bold">O que cada marcação significa</h3>
                <p className="mb-2 text-xs text-muted-foreground">Já sugerimos o mais comum. Confira, principalmente os destacados.</p>
                <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
                  {parsed.values.map((v) => {
                    const cur = mapped(v.value);
                    return (
                      <div key={v.value || '__vazio'} className={cn('flex items-center gap-3 px-3 py-2', !cur && 'bg-orange-50')}>
                        <span className="min-w-[4.5rem] rounded-md bg-muted px-2 py-1 text-center font-mono text-sm font-bold">{v.value || '(vazio)'}</span>
                        <span className="flex-1 text-xs text-muted-foreground">{v.count} vez(es)</span>
                        <Select value={cur ?? ''} onChange={(e) => setMap((m) => ({ ...m, [v.value]: e.target.value as Mapped }))} className="w-52 py-1.5 text-sm" aria-label={`Significado de ${v.value || 'vazio'}`}>
                          {!cur ? <option value="">Escolha…</option> : null}
                          {STATUS_OPTS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* 3. Alunos não reconhecidos */}
              {unmatched.length ? (
                <section>
                  <h3 className="mb-1 text-sm font-bold">Alunos que não encontrei pelo nome ({unmatched.length})</h3>
                  <p className="mb-2 text-xs text-muted-foreground">Escolha quem é no cadastro, ou deixe "Ignorar". Alunos novos devem ser cadastrados antes em Alunos.</p>
                  <div className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                    {unmatched.map((p) => (
                      <div key={p.key} className="flex flex-col gap-1.5 px-3 py-2 sm:flex-row sm:items-center">
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {p.name}
                          {p.turma && useSheetTurma ? <span className="text-xs text-muted-foreground"> · {p.turma}</span> : null}
                        </span>
                        <Select value={who[p.key] ?? ''} onChange={(e) => setWho((w) => ({ ...w, [p.key]: e.target.value }))} className="py-1.5 text-sm sm:w-64" disabled={!p.classId}>
                          <option value="">Ignorar</option>
                          {(p.classId ? byClass(p.classId) : []).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.full_name}
                            </option>
                          ))}
                        </Select>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* 4. Dias que já têm chamada */}
              <section className="rounded-lg border border-border p-3">
                <p className="mb-2 text-sm font-bold">Se o dia já tiver chamada no SCOLA</p>
                <div className="flex flex-col gap-1.5 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={!skipExisting} onChange={() => setSkipExisting(false)} className="accent-neutral-900" />
                    Atualizar com a planilha (só os alunos que estão nela)
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={skipExisting} onChange={() => setSkipExisting(true)} className="accent-neutral-900" />
                    Manter a do SCOLA e pular esse dia
                  </label>
                </div>
              </section>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
                {pending.length ? <p className="mr-auto text-xs font-semibold text-orange-700">Diga o que significa: {pending.map((v) => v.value || '(vazio)').join(', ')}</p> : null}
                <Button variant="ghost" onClick={close}>
                  Cancelar
                </Button>
                <Button onClick={run} disabled={saving || !!pending.length || !marks}>
                  {saving ? 'Importando…' : `Importar ${sessions.length} dia(s)`}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <p className={cn('text-lg font-extrabold tabular-nums leading-tight', tone === 'warn' && 'text-orange-700', tone === 'ok' && 'text-green-700')}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
