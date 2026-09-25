import { useQuery } from '@tanstack/react-query';
import { endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { BarChart3, Check, ChevronDown, Columns3, Download, Eye, FileDown, Printer, Send } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ReportView } from '../components/ReportView';
import { ShareModal } from '../components/ShareModal';
import { Button, DropdownMenu, EmptyState, FilterBar, FilterField, Loading, Modal, PageHeader, SegmentedField, fieldCls } from '../components/ui';
import { cn } from '../lib/cn';
import { listNationalHolidays } from '../lib/holidays';
import { downloadXlsx } from '../lib/importSheet';
import { groupByMonth, schoolDaysBetween, weekdayLetter } from '../lib/schooldays';
import { listClasses, listSchools, listStudentsByClass, reportAttendance, reportTerms, reportTermDetails } from '../lib/queries';
import { CREDITO_OVERRIDE_KEY, MONTHS, SCHOOL_YEAR_MONTHS, SUBJECT, SUBJECT_SHORT, TERM_MONTHS, collapseCreditoColumns, creditoSumFrom, isCreditoActivity, type ReportPayload } from '../lib/types';
import { DateInput } from '../components/DateInput';

type Tipo = 'freq' | 'notas';
const today = new Date();
const iso = (d: Date) => format(d, 'yyyy-MM-dd');
const fmtBR = (s: string) => s.split('-').reverse().join('/');

export function ReportsPage() {
  const [tipo, setTipo] = useState<Tipo>('freq');
  const [classId, setClassId] = useState('');
  const [from, setFrom] = useState(iso(startOfMonth(today)));
  const [to, setTo] = useState(iso(endOfMonth(today)));
  const [year, setYear] = useState(today.getFullYear());
  const [studentId, setStudentId] = useState('all');
  const [minPct, setMinPct] = useState(75);
  const [onlyBelow, setOnlyBelow] = useState(false);
  const [notaTerm, setNotaTerm] = useState(0); // 0 = todos os trimestres
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [activePreset, setActivePreset] = useState('mes');
  const [freqLayout, setFreqLayout] = useState<'list' | 'grid'>('grid');
  const [compact, setCompact] = useState(false);
  const [preview, setPreview] = useState(false);
  const [share, setShare] = useState(false);

  // Campos que o professor pode escolher para incluir no relatório
  const [showFields, setShowFields] = useState<Record<string, boolean>>(() => ({
    // notas
    term1: true,
    term2: true,
    term3: true,
    final: true,
    situation: true,
    // frequência
    present: true,
    absent: true,
    pct: true,
    absentDays: false,
  }));

  const location = useLocation();
  useEffect(() => {
    const st = location.state as { classId?: string; tipo?: Tipo } | null;
    if (st?.classId) setClassId(st.classId);
    if (st?.tipo) setTipo(st.tipo);
  }, [location.state]);

  const { data: classes = [] } = useQuery({ queryKey: ['classes'], queryFn: listClasses });
  const { data: schools = [] } = useQuery({ queryKey: ['schools'], queryFn: listSchools });
  const { data: students = [] } = useQuery({
    queryKey: ['students-by-class', classId],
    queryFn: () => listStudentsByClass(classId),
    enabled: !!classId,
  });

  const klass = classes.find((c) => c.id === classId);
  const className = klass?.name ?? '';
  const school = schools.find((s) => s.id === klass?.school_id);

  const freq = useQuery({
    queryKey: ['rep-freq', classId, from, to],
    queryFn: () => reportAttendance(classId, from, to),
    enabled: tipo === 'freq' && !!classId,
  });
  const notas = useQuery({
    queryKey: ['rep-notas', classId, year],
    queryFn: () => reportTerms(classId, year),
    enabled: tipo === 'notas' && !!classId,
  });

  const termDetails = useQuery({
    queryKey: ['rep-notas-term-details', classId, year, notaTerm],
    queryFn: () => reportTermDetails(classId, year, notaTerm),
    enabled: tipo === 'notas' && !!classId && notaTerm >= 1,
  });

  // Colunas exibidas: várias atividades de crédito viram UMA coluna "Crédito variável".
  const termDisplayActs = useMemo(() => collapseCreditoColumns(termDetails.data?.activities ?? []), [termDetails.data]);
  // Chaves das colunas do trimestre; inicializa a seleção com TODAS sempre que mudam
  // (turma/ano/trimestre). Assim "Limpar" realmente esvazia e "Todas" remarca.
  const termActKeys = useMemo(() => termDisplayActs.map((a) => a.id ?? a.name), [termDisplayActs]);
  const termActSig = termActKeys.join('|');
  useEffect(() => {
    if (termActKeys.length) setSelectedActivities(termActKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termActSig]);

  const toggleField = (k: string) => setShowFields((s) => ({ ...s, [k]: !s[k] }));

  // "Todas / Limpar" únicos: agem sobre os campos do relatório E as atividades do trimestre.
  const fieldKeys =
    tipo === 'freq'
      ? ['present', 'absent', 'pct', 'absentDays', 'situation']
      : notaTerm === 0
        ? ['term1', 'term2', 'term3', 'final', 'situation']
        : ['situation'];
  const showActivities = tipo === 'notas' && notaTerm >= 1 && !!termDetails.data;
  const selectAllFields = () => {
    setShowFields((s) => {
      const n = { ...s };
      fieldKeys.forEach((k) => (n[k] = true));
      return n;
    });
    if (showActivities) setSelectedActivities(termActKeys);
  };
  const clearAllFields = () => {
    setShowFields((s) => {
      const n = { ...s };
      fieldKeys.forEach((k) => (n[k] = false));
      return n;
    });
    if (showActivities) setSelectedActivities([]);
  };

  // Feriados nacionais dos anos do período — para tirar do mapa de chamada (dias letivos).
  const fromYear = Number(from.slice(0, 4));
  const toYear = Number(to.slice(0, 4));
  const holidaysQ = useQuery({
    queryKey: ['national-holidays', fromYear, toYear],
    queryFn: async () => {
      const years = Array.from({ length: toYear - fromYear + 1 }, (_, i) => fromYear + i);
      const lists = await Promise.all(years.map((y) => listNationalHolidays(y)));
      return new Set(lists.flat().map((h) => h.date));
    },
    enabled: tipo === 'freq' && freqLayout === 'grid' && !!classId,
  });

  // Colunas do mapa de chamada: todos os dias letivos (seg–sex, sem feriados) do período.
  const gridDates = useMemo(
    () => (freqLayout === 'grid' ? schoolDaysBetween(from, to, holidaysQ.data) : []),
    [freqLayout, from, to, holidaysQ.data],
  );

  function preset(p: string) {
    if (p === 'custom') return setActivePreset('custom');
    setActivePreset(p);
    const y = today.getFullYear();
    if (p === 'mes') {
      setFrom(iso(startOfMonth(today)));
      setTo(iso(endOfMonth(today)));
    } else if (p === 'mesPassado') {
      const d = subMonths(today, 1);
      setFrom(iso(startOfMonth(d)));
      setTo(iso(endOfMonth(d)));
    } else if (p === 'ano') {
      // ano letivo: fev a nov
      setFrom(iso(new Date(y, SCHOOL_YEAR_MONTHS[0], 1)));
      setTo(iso(endOfMonth(new Date(y, SCHOOL_YEAR_MONTHS[1], 1))));
    } else {
      const n = Number(p.slice(3)); // 1..3
      const [a, b] = TERM_MONTHS[n];
      setFrom(iso(new Date(y, a, 1)));
      setTo(iso(endOfMonth(new Date(y, b, 1))));
    }
  }

  const freqRows = useMemo(() => {
    let r = freq.data?.rows ?? [];
    if (studentId !== 'all') r = r.filter((x) => x.student_id === studentId);
    if (onlyBelow) r = r.filter((x) => x.pct < minPct);
    return r;
  }, [freq.data, studentId, onlyBelow, minPct]);

  const notasRows = useMemo(() => {
    let r = notas.data ?? [];
    if (studentId !== 'all') r = r.filter((x) => x.student_id === studentId);
    return r;
  }, [notas.data, studentId]);

  // Relatório pronto (usado na tela, na pré-visualização e no link compartilhado).
  const payload: ReportPayload | null = useMemo(() => {
    if (!classId) return null;
    const reportSchool = school
      ? { name: school.name, logo_url: school.logo_url, address: school.address, city: school.city, phone: school.phone }
      : null;
    const generatedAt = format(today, 'dd/MM/yyyy');
    if (tipo === 'freq') {
      return {
        kind: 'freq',
        school: reportSchool,
        className,
        title: 'Relatório de Frequência',
        period: `${fmtBR(from)} a ${fmtBR(to)}`,
        generatedAt,
        minPct,
        sessions: freq.data?.sessions ?? 0,
        examDates: freq.data?.examDates ?? [],
        dates: freq.data?.dates ?? [],
        gridDates,
        layout: freqLayout,
        freqRows: freqRows.map((r) => ({ name: r.name, present: r.present, absent: r.absent, total: r.total, pct: r.pct, absentDates: r.absentDates, days: r.days })),
        show: showFields,
      };
    }
    if (notaTerm >= 1) {
      const detail = termDetails.data;
      const rawActivities = detail?.activities ?? [];
      const displayActivities = collapseCreditoColumns(rawActivities);
      const creditActs = rawActivities.filter(isCreditoActivity);
      const rows = (detail?.rows ?? []).filter((r) => (studentId !== 'all' ? r.student_id === studentId : true));
      return {
        kind: 'notas',
        school: reportSchool,
        className,
        title: `Relatório parcial de notas`,
        period: `${notaTerm}º trimestre / ${year}`,
        generatedAt,
        subject: SUBJECT,
        notasRows: rows.map((r) => {
          // Injeta a soma do crédito variável na coluna virtual (0–10). Não altera a média.
          const scores = { ...r.activities } as Record<string, number | null>;
          if (creditActs.length) scores[CREDITO_OVERRIDE_KEY] = creditoSumFrom((a) => r.activities[a.id ?? a.name], creditActs);
          return { name: r.name, terms: [r.termAvg], final: r.termAvg, activityScores: scores };
        }),
        notasTerm: notaTerm,
        termActivities: displayActivities,
        termSelectedActivities: selectedActivities,
        show: showFields,
      };
    }
    return {
      kind: 'notas',
      school: reportSchool,
      className,
      title: `Relatório de Notas`,
      period: String(year),
      generatedAt,
      subject: SUBJECT,
      notasRows: notasRows.map((r) => ({ name: r.name, terms: r.terms, final: r.final })),
      notasTerm: notaTerm,
      show: showFields,
    };
  }, [classId, tipo, school, className, from, to, minPct, freq.data, freqRows, gridDates, freqLayout, year, notasRows, notaTerm, showFields, termDetails.data, selectedActivities]);

  // Nome automático (curto): Atividade - Turma - Trimestre. Ex.: "TESTE - 6º ANO - 2º tri"
  const safeFileName = (s: string) => s.replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  function reportBaseName(): string {
    const turmaShort = className.split(/\s*[-–]\s*/)[0].trim();
    if (tipo === 'freq') {
      const kind = freqLayout === 'grid' ? 'Chamada' : 'Frequência';
      return safeFileName(`${kind} - ${turmaShort} - ${fmtBR(from)} a ${fmtBR(to)}`);
    }
    if (notaTerm >= 1) {
      const acts = termDisplayActs.filter((a) => selectedActivities.includes(a.id ?? a.name)).map((a) => a.name);
      return safeFileName(`${SUBJECT_SHORT} - ${turmaShort} - ${notaTerm}º tri - ${acts.length ? acts.join(', ') : 'Notas'}`);
    }
    return safeFileName(`${SUBJECT_SHORT} - ${turmaShort} - ${year} - Notas`);
  }

  function printPdf() {
    const prev = document.title;
    document.title = reportBaseName();
    const restore = () => {
      document.title = prev;
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  }

  function exportExcel() {
    const titulo = [school?.name ?? 'Escola'];
    if (tipo === 'freq' && freqLayout === 'grid' && gridDates.length) {
      // Mapa de chamada: matriz aluno × dia letivo (P/F), um bloco por mês.
      const aoa: (string | number | null)[][] = [titulo, [`Mapa de chamada — Turma ${className} — ${fmtBR(from)} a ${fmtBR(to)}`], []];
      const incSit = !!showFields.situation;
      for (const m of groupByMonth(gridDates)) {
        aoa.push([`${MONTHS[m.month - 1]} / ${m.year}`]);
        aoa.push(['', ...m.days.map((d) => weekdayLetter(d))]);
        aoa.push(['Aluno', ...m.days.map((d) => Number(d.slice(8, 10))), 'Pres.', 'Faltas', '%', ...(incSit ? ['Situação'] : [])]);
        for (const r of freqRows) {
          let faltas = 0;
          const cells = m.days.map((d) => {
            const absent = r.days?.[d] === false;
            if (absent) faltas++;
            return absent ? 'F' : 'P';
          });
          const present = m.days.length - faltas;
          const pct = m.days.length ? Math.round((present / m.days.length) * 1000) / 10 : 0;
          aoa.push([r.name, ...cells, present, faltas, pct, ...(incSit ? [pct < minPct ? 'Reprovado' : 'Aprovado'] : [])]);
        }
        aoa.push([]);
      }
      downloadXlsx(`${reportBaseName()}.xlsx`, aoa, 'Mapa de chamada');
    } else if (tipo === 'freq') {
      const aoa: (string | number | null)[][] = [
        titulo,
        [`Frequência — Turma ${className} — ${fmtBR(from)} a ${fmtBR(to)}`],
        [],
        ['Aluno', 'Presenças', 'Faltas', 'Total', '% Presença', 'Dias de falta'],
        ...freqRows.map((r) => [r.name, r.present, r.absent, r.total, r.pct, r.absentDates.map(fmtBR).join(', ')]),
      ];
      downloadXlsx(`${reportBaseName()}.xlsx`, aoa, 'Frequência');
    } else {
      const sit = (m: number | null) => (m == null ? '—' : m >= 6 ? 'Aprovado' : 'Recuperação');
      const includeSituation = !!showFields.situation;
      const aoa: (string | number | null)[][] =
        notaTerm >= 1 && notaTerm <= 3
          ? [
              titulo,
              [`Notas${SUBJECT ? ` (${SUBJECT})` : ''} — Turma ${className} — ${notaTerm}º trimestre / ${year}`],
              [],
              ['Aluno', `${notaTerm}º tri`, ...(includeSituation ? ['Situação'] : [])],
              ...notasRows.map((r) => [r.name, r.terms[notaTerm - 1], ...(includeSituation ? [sit(r.terms[notaTerm - 1])] : [])]),
            ]
          : [
              titulo,
              [`Notas${SUBJECT ? ` (${SUBJECT})` : ''} — Turma ${className} — ${year}`],
              [],
              ['Aluno', ...(showFields.term1 ? ['1º tri'] : []), ...(showFields.term2 ? ['2º tri'] : []), ...(showFields.term3 ? ['3º tri'] : []), ...(showFields.final ? ['Final'] : []), ...(includeSituation ? ['Situação'] : [])],
              ...notasRows.map((r) => [
                r.name,
                ...(showFields.term1 ? [r.terms[0]] : []),
                ...(showFields.term2 ? [r.terms[1]] : []),
                ...(showFields.term3 ? [r.terms[2]] : []),
                ...(showFields.final ? [r.final] : []),
                ...(includeSituation ? [sit(r.final)] : []),
              ]),
            ];
      downloadXlsx(`${reportBaseName()}.xlsx`, aoa, 'Notas');
    }
  }

  const years = [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1];
  const loading = tipo === 'freq' ? freq.isLoading : notas.isLoading;

  // Colunas disponíveis para o menu "Colunas" (conforme tipo e trimestre).
  const fieldOptions: { key: string; label: string }[] =
    tipo === 'freq'
      ? [
          { key: 'present', label: 'Presenças' },
          { key: 'absent', label: 'Faltas' },
          { key: 'pct', label: '% de presença' },
          { key: 'absentDays', label: 'Dias de falta' },
          { key: 'situation', label: 'Situação' },
        ]
      : notaTerm === 0
        ? [
            { key: 'term1', label: '1º trimestre' },
            { key: 'term2', label: '2º trimestre' },
            { key: 'term3', label: '3º trimestre' },
            { key: 'final', label: 'Média final' },
            { key: 'situation', label: 'Situação' },
          ]
        : [{ key: 'situation', label: 'Situação' }];
  const activeCount = fieldOptions.filter((f) => showFields[f.key]).length + (showActivities ? selectedActivities.length : 0);
  const totalCount = fieldOptions.length + (showActivities ? termActKeys.length : 0);
  const summary = classId
    ? [className, tipo === 'freq' ? `${fmtBR(from)} a ${fmtBR(to)}` : notaTerm ? `${notaTerm}º trimestre / ${year}` : String(year)].join(' · ')
    : '';

  return (
    <div>
      <div className="no-print">
        <PageHeader title="Relatórios" subtitle="Frequência e notas prontas para imprimir, exportar ou enviar." />

        <FilterBar className="lg:grid lg:grid-cols-6 lg:items-end">
          <FilterField label="Relatório" wide className="lg:col-span-2">
            <SegmentedField<Tipo>
              value={tipo}
              onChange={setTipo}
              options={[
                { value: 'freq', label: 'Frequência' },
                { value: 'notas', label: 'Notas' },
              ]}
            />
          </FilterField>
          <FilterField label="Turma" className="lg:col-span-2">
            <select value={classId} onChange={(e) => setClassId(e.target.value)} className={fieldCls}>
              <option value="">Selecione…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Aluno" className="lg:col-span-2">
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={!classId} className={fieldCls}>
              <option value="all">Todos</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </select>
          </FilterField>

          {tipo === 'freq' ? (
            <>
              <FilterField label="Período" wide className="lg:col-span-2">
                <select value={activePreset} onChange={(e) => preset(e.target.value)} className={fieldCls}>
                  <option value="mes">Este mês</option>
                  <option value="mesPassado">Mês passado</option>
                  <option value="tri1">1º trimestre</option>
                  <option value="tri2">2º trimestre</option>
                  <option value="tri3">3º trimestre</option>
                  <option value="ano">Ano letivo</option>
                  <option value="custom">Personalizado…</option>
                </select>
              </FilterField>
              <FilterField label="De">
                <DateInput value={from} max={to} onChange={(v) => { setFrom(v); setActivePreset('custom'); }} />
              </FilterField>
              <FilterField label="Até">
                <DateInput value={to} min={from} max={iso(today)} onChange={(v) => { setTo(v); setActivePreset('custom'); }} />
              </FilterField>
              <FilterField label="Frequência mínima">
                <select value={minPct} onChange={(e) => setMinPct(Number(e.target.value))} className={fieldCls}>
                  {[60, 70, 75, 80, 90].map((p) => (
                    <option key={p} value={p}>{p}%</option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Mostrar">
                <select value={onlyBelow ? 'below' : 'all'} onChange={(e) => setOnlyBelow(e.target.value === 'below')} className={fieldCls}>
                  <option value="all">Todos os alunos</option>
                  <option value="below">Só abaixo do mínimo</option>
                </select>
              </FilterField>
            </>
          ) : (
            <>
              <FilterField label="Ano" className="lg:col-span-2">
                <select value={year} onChange={(e) => setYear(Number(e.target.value))} className={fieldCls}>
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Trimestre" wide className="lg:col-span-4">
                <SegmentedField<number>
                  value={notaTerm}
                  onChange={setNotaTerm}
                  options={[
                    { value: 0, label: 'Ano todo' },
                    { value: 1, label: '1º' },
                    { value: 2, label: '2º' },
                    { value: 3, label: '3º' },
                  ]}
                />
              </FilterField>
            </>
          )}
        </FilterBar>

        {/* Barra do relatório: formato à esquerda, ações à direita */}
        {classId ? (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <p className="mr-auto hidden min-w-0 truncate text-sm font-semibold text-foreground md:block">{summary}</p>
            {tipo === 'freq' ? (
              <div className="w-full sm:w-64">
                <SegmentedField<'list' | 'grid'>
                  value={freqLayout}
                  onChange={setFreqLayout}
                  options={[
                    { value: 'grid', label: 'Mapa' },
                    { value: 'list', label: 'Lista' },
                  ]}
                />
              </div>
            ) : null}
            <ColumnsMenu
              count={activeCount}
              total={totalCount}
              fields={fieldOptions.map((f) => ({ ...f, on: !!showFields[f.key], toggle: () => toggleField(f.key) }))}
              activities={
                showActivities
                  ? termDisplayActs.map((a) => {
                      const k = a.id ?? a.name;
                      return { key: k, label: a.name, on: selectedActivities.includes(k), toggle: () => setSelectedActivities((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k])) };
                    })
                  : []
              }
              compact={compact}
              onCompact={() => setCompact((c) => !c)}
              onAll={selectAllFields}
              onNone={clearAllFields}
            />
            <Button variant="ghost" onClick={() => setPreview(true)} disabled={!payload} className="min-h-10 py-2">
              <Eye size={16} /> <span className="hidden sm:inline">Visualizar</span>
            </Button>
            <DropdownMenu
              label="Exportar"
              variant="primary"
              icon={<Download size={16} />}
              items={[
                { label: 'PDF / Imprimir', hint: 'Abre a impressão do navegador', icon: <Printer size={16} />, onClick: printPdf },
                { label: 'Planilha Excel', hint: 'Arquivo .xlsx', icon: <FileDown size={16} />, onClick: exportExcel },
                { label: 'Enviar por link', hint: 'WhatsApp ou e-mail, sem login', icon: <Send size={16} />, onClick: () => setShare(true), hidden: !payload },
              ]}
            />
          </div>
        ) : null}
      </div>

      {/* Relatório */}
      {!classId ? (
        <EmptyState icon={<BarChart3 size={26} />} title="Escolha uma turma" hint="Selecione a turma para gerar o relatório." />
      ) : loading ? (
        <Loading label="Gerando…" />
      ) : payload ? (
        <ReportView payload={payload} compact={compact} />
      ) : null}

      {/* Pré-visualização */}
      <Modal open={preview} onClose={() => setPreview(false)} title="Pré-visualização" size="xl">
        {payload ? <ReportView payload={payload} compact={compact} /> : null}
      </Modal>

      <ShareModal open={share} onClose={() => setShare(false)} payload={payload} />
    </div>
  );
}

type Toggle = { key: string; label: string; on: boolean; toggle: () => void };

/** Menu "Colunas": escolhe o que entra no relatório (substitui a fileira de chips). */
function ColumnsMenu({
  count,
  total,
  fields,
  activities,
  compact,
  onCompact,
  onAll,
  onNone,
}: {
  count: number;
  total: number;
  fields: Toggle[];
  activities: Toggle[];
  compact: boolean;
  onCompact: () => void;
  onAll: () => void;
  onNone: () => void;
}) {
  return (
    <Popover className="relative">
      <PopoverButton className="inline-flex h-10 items-center gap-2 rounded-lg bg-card px-3.5 text-sm font-semibold ring-1 ring-inset ring-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
        <Columns3 size={16} /> <span>Colunas</span>
        <span className="rounded bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">{count}/{total}</span>
        <ChevronDown size={15} className="opacity-60" />
      </PopoverButton>
      <PopoverPanel anchor="bottom end" className="z-50 w-72 rounded-xl border border-border bg-card p-3 shadow-lift [--anchor-gap:4px]">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Campos</p>
          <div className="flex gap-3 text-xs font-semibold">
            <button onClick={onAll} className="text-foreground hover:underline">Todos</button>
            <button onClick={onNone} className="text-muted-foreground hover:underline">Nenhum</button>
          </div>
        </div>
        <div className="space-y-0.5">
          {fields.map((f) => <CheckRow key={f.key} item={f} />)}
        </div>
        {activities.length ? (
          <>
            <p className="mb-1 mt-3 border-t border-border pt-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Notas do trimestre</p>
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {activities.map((a) => <CheckRow key={a.key} item={a} />)}
            </div>
          </>
        ) : null}
        <div className="mt-3 border-t border-border pt-3">
          <CheckRow item={{ key: 'compact', label: 'Modo compacto (cabe mais por página)', on: compact, toggle: onCompact }} />
        </div>
      </PopoverPanel>
    </Popover>
  );
}

function CheckRow({ item }: { item: Toggle }) {
  return (
    <button type="button" onClick={item.toggle} aria-pressed={item.on} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted">
      <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border', item.on ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300')}>
        {item.on ? <Check size={11} strokeWidth={3} /> : null}
      </span>
      {item.label}
    </button>
  );
}

function slug(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'turma';
}

