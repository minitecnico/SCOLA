import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Check, ClipboardList, Eye, FileDown, FileText, GraduationCap, List, Lock, Pencil, Plus, Printer, Rows3, Save, Send, Sliders, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Button, Card, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Segmented, Select, Loading} from '../components/ui';
import { successToast } from '../components/Feedback';
import { ConfirmClearModal } from '../components/ConfirmClearModal';
import { ShareModal } from '../components/ShareModal';
import { canManageOrg } from '../lib/permissions';
import { cn } from '../lib/cn';
import { printDocument, escapeHtml } from '../lib/print';
import { downloadXlsx } from '../lib/importSheet';
import { fmtNumber } from '../lib/format';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { usePersistentState } from '../lib/usePersistentState';
import {
  bulkDeleteTermGrades,
  getCreditoData,
  getTermConfig,
  getSavedTermConfig,
  listClasses,
  listSchools,
  listStudentsByClass,
  listTermGrades,
  reportTerms,
  saveTermConfig,
  saveTermGrades,
  type TermsReportRow,
} from '../lib/queries';
import { CREDITO_OVERRIDE_KEY, DEFAULT_ACTIVITIES, MEDIA_APROVACAO, RECOVERY_ACTIVITY_NAME, SUBJECT, SUBJECT_SHORT, TERMS, TERM_LABEL, actKey, calcMedia, collapseCreditoColumns, creditoSumFrom, isRecoveryActivity, orderGradeActivities, sanitizeGrade, type GradeActivity, type ReportPayload, type School } from '../lib/types';

/** Cabeçalho profissional para impressão (logo, escola, contato) — usado no boletim e no relatório.
 *  compact: versão reduzida p/ empilhar 3 boletins por folha. subject: matéria (aparece no cabeçalho). */
function schoolHeaderHtml(school: School | undefined, label: string, compact = false, subject?: string): string {
  const name = school?.name ?? 'Escola';
  const contato = [school?.address, school?.city, school?.phone].filter(Boolean).map((x) => escapeHtml(String(x))).join(' • ');
  const ls = compact ? 38 : 60; // tamanho do logo
  const logo = school?.logo_url
    ? `<img src="${escapeHtml(school.logo_url)}" alt="" style="height:${ls}px;width:${ls}px;object-fit:contain;border:1px solid #e2e8f0;border-radius:8px;padding:2px;background:#fff;" />`
    : `<div style="height:${ls}px;width:${ls}px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:#f1f5f9;font-size:${compact ? 16 : 24}px;font-weight:800;color:#94a3b8;">${escapeHtml(name.slice(0, 1))}</div>`;
  return `<div style="display:flex; align-items:center; gap:${compact ? 10 : 14}px; border-bottom:2px solid #0f172a; padding-bottom:${compact ? 7 : 12}px; margin-bottom:${compact ? 9 : 14}px;">
    ${logo}
    <div style="flex:1; min-width:0;">
      <div style="font-size:${compact ? 15 : 18}px; font-weight:800; line-height:1.1;">${escapeHtml(name)}</div>
      <div style="font-size:${compact ? 11 : 13}px; font-weight:700; letter-spacing:.08em; color:#475569;">${escapeHtml(label)}</div>
      ${subject ? `<div style="font-size:${compact ? 11 : 12}px; font-weight:800; color:#334155; margin-top:1px;">Disciplina: ${escapeHtml(subject)}</div>` : ''}
      ${contato ? `<div style="font-size:10px; color:#94a3b8; margin-top:2px;">${contato}</div>` : ''}
    </div>
    <div style="text-align:right; font-size:10px; color:#94a3b8;">Gerado em<br/>${new Date().toLocaleDateString('pt-BR')}</div>
  </div>`;
}

/** yyyy-mm-dd → dd/mm (curto, para prazos no cabeçalho). */
function fmtDM(d: string): string {
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

export function NotasPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { activeOrgId, ctxLoading, role } = useAuth();
  const canClear = canManageOrg(role); // só coordenação/direção limpa notas
  const now = new Date();
  const [classId, setClassId] = usePersistentState('scola:notas:classId', '');
  const [term, setTerm] = usePersistentState('scola:notas:term', 1);
  const [year, setYear] = usePersistentState('scola:notas:year', now.getFullYear());
  const [q, setQ] = useState('');
  const [scores, setScores] = useState<Record<string, Record<string, string>>>({});
  const [obs, setObs] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [editingGrades, setEditingGrades] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [boletimOpen, setBoletimOpen] = useState(false);
  const [boletimEscolarOpen, setBoletimEscolarOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const online = useOnlineStatus();
  const orgReady = !ctxLoading && !!activeOrgId;

  const { data: classes = [] } = useQuery({ queryKey: ['classes', activeOrgId], queryFn: listClasses, enabled: orgReady });
  useEffect(() => {
    if (!orgReady) return;
    if (!classes.length) return;
    if (!classId || !classes.some((c) => c.id === classId)) setClassId(classes[0].id);
  }, [classes, classId, orgReady]);

  const { data: activities = [] } = useQuery({
    queryKey: ['term-config', activeOrgId, year, term],
    queryFn: () => getTermConfig(year, term),
    enabled: orgReady,
  });
  const orderedActivities = useMemo(() => orderGradeActivities(activities), [activities]);

  const { data: students = [], isLoading } = useQuery({
    queryKey: ['students-by-class', activeOrgId, classId],
    queryFn: () => listStudentsByClass(classId),
    enabled: orgReady && !!classId,
  });

  const {
    data: termGrades = [],
    isLoading: gradesLoading,
    isError: gradesIsError,
    error: gradesError,
  } = useQuery({
    queryKey: ['term-grades', activeOrgId, classId, year, term],
    queryFn: () => listTermGrades(classId, year, term),
    enabled: orgReady && !!classId,
  });

  const { data: creditData = { defs: [], byStudent: {} } } = useQuery({
    queryKey: ['credito-data', activeOrgId, classId, year, term],
    queryFn: () => getCreditoData(classId, year, term),
    enabled: orgReady && !!classId,
  });
  // Colunas finais = atividades da turma + atividades de crédito variável (vindas
  // do Central de Avaliações, ligadas por ID estável). A média já agrupa as <10.
  const columns = useMemo(
    () => orderGradeActivities([...orderedActivities, ...creditData.defs]),
    [orderedActivities, creditData.defs],
  );
  const creditIdSet = useMemo(() => new Set(creditData.defs.map((d) => d.id as string)), [creditData.defs]);
  const hasCreditData = creditData.defs.length > 0;

  // Em Notas só aparecem 3 notas (peso 10 cada): as principais (TESTE, E-CERM…),
  // UMA coluna "Crédito variável" (soma do que vem da Central, vale 10) e a média.
  // A recuperação aparece DEPOIS da média.
  const recoveryCol = useMemo(() => columns.find((a) => isRecoveryActivity(a.name)) ?? null, [columns]);
  const mainCols = useMemo(
    () => columns.filter((a) => !creditIdSet.has(actKey(a)) && !isRecoveryActivity(a.name)),
    [columns, creditIdSet],
  );
  const primaryCols = useMemo(() => mainCols.slice(0, Math.min(3, mainCols.length)), [mainCols]);
  const primaryKeys = useMemo(() => primaryCols.map(actKey), [primaryCols]);

  const studentsSig = students.map((s) => s.id).join(',');
  const gradesSig = termGrades.map((g) => `${g.student_id}:${JSON.stringify(g.scores)}:${g.updated_at ?? ''}`).join('|');
  const creditSig = `${[...creditIdSet].join(',')}|${JSON.stringify(creditData.byStudent)}`;
  const hasSavedGrades = termGrades.length > 0;
  const maxByKey = useMemo(() => new Map(columns.map((a) => [actKey(a), a.max] as const)), [columns]);
  const creditoCols = useMemo(() => columns.filter((a) => creditIdSet.has(actKey(a))), [columns, creditIdSet]);
  const creditoSum = (id: string) => {
    const total = creditoCols.reduce((acc, a) => acc + (Number(scores[id]?.[actKey(a)]) || 0), 0);
    return Math.min(total, 10);
  };
  const fmtNum = (n: number) => (n % 1 === 0 ? String(n) : n.toFixed(1)).replace('.', ',');

  function resetScoresFromSaved() {
    const map: Record<string, Record<string, string>> = {};
    const obsMap: Record<string, string> = {};
    students.forEach((s) => {
      const g = termGrades.find((x) => x.student_id === s.id);
      const row: Record<string, string> = {};
      columns.forEach((a) => {
        // Compatibilidade: notas antigas foram salvas pela CHAVE = nome da atividade.
        // Hoje a chave é o id; então busca por id e, se não achar, cai para o nome.
        const v = g?.scores?.[actKey(a)] ?? g?.scores?.[a.name];
        row[actKey(a)] = v != null ? String(v) : '';
      });
      // Colunas de crédito variável (do Central de Avaliações, por id): nota de lá quando existir.
      const cv = creditData.byStudent[s.id];
      if (cv) {
        creditIdSet.forEach((id) => {
          if (cv[id] != null) {
            const max = maxByKey.get(id) ?? 0;
            row[id] = String(max > 0 ? Math.min(cv[id], max) : cv[id]);
          }
        });
      }
      // Crédito variável digitado manualmente (sobrescreve a soma da Central), se houver.
      const ov = g?.scores?.[CREDITO_OVERRIDE_KEY];
      row[CREDITO_OVERRIDE_KEY] = ov != null ? String(ov) : '';
      map[s.id] = row;
      obsMap[s.id] = g?.observacao ?? '';
    });
    setScores(map);
    setObs(obsMap);
    setSaved(false);
    setEditingGrades(termGrades.length === 0);
  }

  // Preenche inputs com as notas salvas.
  useEffect(() => {
    if (!orgReady || isLoading || gradesLoading) return;
    resetScoresFromSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgReady, isLoading, gradesLoading, studentsSig, gradesSig, creditSig, columns.map(actKey).join(',')]);

  function hasAllPrimaryNotes(id: string): boolean {
    const row = scores[id] || {};
    return primaryKeys.every((k) => row[k] !== '' && row[k] != null);
  }

  function mediaOf(id: string): number | null {
    if (!hasAllPrimaryNotes(id)) return null;
    const row = scores[id];
    if (!row) return null;
    const nums: Record<string, number> = {};
    let has = false;
    columns.forEach((a) => {
      const k = actKey(a);
      if (row[k] !== '' && row[k] != null) {
        nums[k] = Number(row[k]);
        if (!isRecoveryActivity(a.name)) has = true;
      }
    });
    // crédito variável digitado manualmente entra na média (substitui a soma da Central)
    if (row[CREDITO_OVERRIDE_KEY] !== '' && row[CREDITO_OVERRIDE_KEY] != null) {
      nums[CREDITO_OVERRIDE_KEY] = Number(row[CREDITO_OVERRIDE_KEY]);
      has = true;
    }
    return has ? calcMedia(nums, columns) : null;
  }

  function setScore(id: string, act: string, raw: string, max: number) {
    if (!editingGrades) return;
    const v = sanitizeGrade(raw, max);
    setScores((p) => ({ ...p, [id]: { ...p[id], [act]: v } }));
    setSaved(false);
  }

  // Focus/navigation helpers: move focus to next input in the row/column
  function focusNext(studentId: string, actKeyStr: string, dir: 'right' | 'left' | 'down' | 'up') {
    try {
      const selector = `input[data-student="${studentId}"]`;
      const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(selector)).filter((el) => !el.disabled);
      const idx = inputs.findIndex((el) => el.dataset.act === actKeyStr);
      if (idx === -1) return;
      let next: HTMLInputElement | undefined;
      if (dir === 'right') next = inputs[idx + 1];
      else if (dir === 'left') next = inputs[idx - 1];
      else if (dir === 'down') {
        // next row: find input with same act in the next student row
        const all = Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-act="${actKeyStr}"]`)).filter((el) => !el.disabled);
        const curIndex = all.findIndex((el) => el.dataset.student === studentId);
        if (curIndex !== -1) next = all[curIndex + 1];
      } else if (dir === 'up') {
        const all = Array.from(document.querySelectorAll<HTMLInputElement>(`input[data-act="${actKeyStr}"]`)).filter((el) => !el.disabled);
        const curIndex = all.findIndex((el) => el.dataset.student === studentId);
        if (curIndex !== -1) next = all[curIndex - 1];
      }
      if (next) next.focus();
    } catch {}
  }

  const list = useMemo(() => students.filter((s) => s.full_name.toLowerCase().includes(q.toLowerCase())), [students, q]);

  const save = useMutation({
    mutationFn: () => {
      const rows = students
        .map((s) => {
          const row = scores[s.id] || {};
          const obj: Record<string, number> = {};
          columns.forEach((a) => {
            const k = actKey(a);
            if (row[k] !== '' && row[k] != null) obj[k] = Number(row[k]);
          });
          if (row[CREDITO_OVERRIDE_KEY] !== '' && row[CREDITO_OVERRIDE_KEY] != null) obj[CREDITO_OVERRIDE_KEY] = Number(row[CREDITO_OVERRIDE_KEY]);
          return { student_id: s.id, scores: obj, observacao: (obs[s.id] ?? '').trim() || null };
        })
        .filter((r) => Object.keys(r.scores).length > 0 || r.observacao);
      return saveTermGrades(classId, year, term, rows);
    },
    onSuccess: () => {
      setSaved(true);
      setEditingGrades(false);
      qc.invalidateQueries({ queryKey: ['term-grades', activeOrgId, classId, year, term] });
      successToast('Notas salvas com sucesso');
    },
  });

  function handleSave() {
    if (!online) {
      alert('Sem conexão com a internet. Conecte-se para salvar as notas — assim nada se perde.');
      return;
    }
    save.mutate();
  }

  // Limpa (apaga do banco) as notas da turma no trimestre/ano selecionados.
  const clearGrades = useMutation({
    mutationFn: () => bulkDeleteTermGrades(classId, year, term, students.map((s) => s.id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['term-grades', activeOrgId, classId, year, term] });
      setClearOpen(false);
      successToast('Notas do trimestre apagadas');
    },
    onError: (e) => alert('Não foi possível limpar: ' + (e as Error).message),
  });
  const turmaNome = classes.find((c) => c.id === classId)?.name ?? 'turma';

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  if (!orgReady) {
    return (
      <>
        <PageHeader title="Notas" subtitle="Carregando…" />
        <Loading label="Preparando os dados da escola…" />
      </>
    );
  }

  if (classes.length === 0) {
    return (
      <>
        <PageHeader title="Notas" subtitle="Notas por trimestre" />
        <EmptyState icon={<Award size={26} />} title="Nenhuma turma" hint="Cadastre turma e alunos para lançar notas." />
      </>
    );
  }

  return (
    <div className="pb-28">
      <PageHeader
        title="Notas"
        subtitle={`${TERM_LABEL[term]} • ${year} • média ${MEDIA_APROVACAO} (recuperação substitui a menor nota quando melhora a média)`}
        action={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
            <Button onClick={() => setBoletimEscolarOpen(true)} className="w-full sm:w-auto">
              <GraduationCap size={18} /> Boletins escolares
            </Button>
            <Button variant="soft" onClick={() => setBoletimOpen(true)} className="w-full sm:w-auto">
              <FileText size={18} /> Relatório do trimestre
            </Button>
            <Button variant="ghost" onClick={() => setConfigOpen(true)} className="w-full sm:w-auto">
              <Sliders size={18} /> Composição de notas
            </Button>
            <Button variant="ghost" onClick={() => navigate('/avaliacoes')} className="w-full sm:w-auto">
              <ClipboardList size={18} /> Central de Avaliações
            </Button>
            {canClear && hasSavedGrades ? (
              <Button variant="ghost" onClick={() => setClearOpen(true)} className="col-span-2 w-full text-red-600 sm:col-span-1 sm:w-auto">
                <Trash2 size={18} /> Limpar notas
              </Button>
            ) : null}
          </div>
        }
      />

      {/* Filtro rápido por trimestre */}
      <Segmented<number>
        className="mb-4"
        value={term}
        onChange={setTerm}
        options={TERMS.map((t) => ({ value: t, label: TERM_LABEL[t] }))}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Select value={classId} onChange={(e) => setClassId(e.target.value)}>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
        <Select value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </Select>
      </div>

      {columns.length === 0 ? (
        <EmptyState
          icon={<Sliders size={26} />}
          title="Configure a composição deste trimestre"
          hint="Defina as atividades e quanto cada uma vale neste trimestre antes de lançar as notas."
          action={<Button onClick={() => setConfigOpen(true)}><Sliders size={18} /> Composição de notas</Button>}
        />
      ) : (
        <>
          <SearchInput value={q} onChange={setQ} placeholder="Buscar aluno…" className="mb-3" />

          {isLoading ? (
            <Loading />
          ) : gradesIsError ? (
            <EmptyState
              icon={<Award size={26} />}
              title="Não foi possível carregar as notas"
              hint={(gradesError as Error).message}
            />
          ) : gradesLoading ? (
            <Loading label="Carregando notas salvas…" />
          ) : students.length === 0 ? (
            <EmptyState icon={<Award size={26} />} title="Turma sem alunos" hint="Cadastre alunos nesta turma para lançar notas." />
          ) : (
            <>
              {hasSavedGrades && !editingGrades ? (
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground">
                  <Lock size={16} className="text-muted-foreground" />
                  Notas bloqueadas para evitar alterações acidentais. Clique em Editar notas para reabrir.
                </div>
              ) : null}

              {/* Resumo da turma */}
              {(() => {
                const medias = list.map((s) => mediaOf(s.id)).filter((x): x is number => x != null);
                const turma = medias.length ? Math.round((medias.reduce((a, b) => a + b, 0) / medias.length) * 10) / 10 : null;
                const aprov = medias.filter((m) => m >= MEDIA_APROVACAO).length;
                const rec = medias.length - aprov;
                const pct = medias.length ? Math.round((aprov / medias.length) * 100) : 0;
                return (
                  <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-2xl border border-border bg-card p-3 text-center">
                      <p className="text-2xl font-black text-foreground">{list.length}</p>
                      <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Alunos</p>
                    </div>
                    <div className="rounded-2xl border border-border bg-card p-3 text-center">
                      <p className={cn('text-2xl font-black', turma == null ? 'text-muted-foreground' : turma >= MEDIA_APROVACAO ? 'text-foreground' : 'text-red-600')}>
                        {turma != null ? fmtNumber(turma, 1) : '–'}
                      </p>
                      <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Média da turma</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-center">
                      <p className="text-2xl font-black text-emerald-700">{aprov}</p>
                      <p className="text-[11px] font-black uppercase tracking-wide text-emerald-700/70">Aprovados · {pct}%</p>
                    </div>
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-center">
                      <p className="text-2xl font-black text-red-600">{rec}</p>
                      <p className="text-[11px] font-black uppercase tracking-wide text-red-600/70">Em recuperação</p>
                    </div>
                  </div>
                );
              })()}

              <Card className="max-h-[70vh] overflow-auto p-0">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-20 bg-muted text-left text-[11px] font-black uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="sticky left-0 top-0 z-30 w-[160px] min-w-[160px] max-w-[160px] bg-muted px-3 py-3 text-left shadow-[2px_0_0_0_rgba(226,232,240,1)]">Aluno</th>
                    {mainCols.map((a) => (
                      <th key={actKey(a)} className="min-w-[92px] px-2 py-3 text-center align-bottom">
                        <span className="block leading-tight text-muted-foreground">{a.name}</span>
                        <span className="mt-1 inline-block rounded bg-muted/70 px-1.5 py-0.5 text-[9px] font-black text-muted-foreground">0–{a.max}</span>
                        {a.date ? <span className="mt-0.5 block text-[9px] font-black text-emerald-600">entrega {fmtDM(a.date)}</span> : null}
                      </th>
                    ))}
                    {creditoCols.length > 0 ? (
                      <th className="min-w-[104px] bg-amber-50 px-2 py-3 text-center align-bottom text-amber-700">
                        <span className="block leading-tight">Crédito variável</span>
                        <span className="mt-1 inline-block rounded bg-amber-200/60 px-1.5 py-0.5 text-[9px] font-black text-amber-700">0–10</span>
                        <span className="mt-0.5 block text-[9px] font-black normal-case text-amber-600">Central · editável</span>
                      </th>
                    ) : null}
                    <th className="px-3 py-3 text-center">Média</th>
                    {recoveryCol ? (
                      <th className="min-w-[92px] px-2 py-3 text-center align-bottom">
                        <span className="block leading-tight text-muted-foreground">{recoveryCol.name}</span>
                        <span className="mt-1 inline-block rounded bg-muted/70 px-1.5 py-0.5 text-[9px] font-black text-muted-foreground">0–{recoveryCol.max}</span>
                        <span className="mt-0.5 block text-[9px] font-black text-amber-600">substitui menor</span>
                      </th>
                    ) : null}
                    <th className="px-3 py-3 text-center">Resultado</th>
                    <th className="min-w-[160px] px-3 py-3 text-center">Observações</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s, i) => {
                    const m = mediaOf(s.id);
                    const ok = m != null && m >= MEDIA_APROVACAO;
                    return (
                      <tr key={s.id} className="border-t border-border bg-card transition even:bg-muted hover:bg-emerald-50">
                        <td className="sticky left-0 z-10 w-[160px] min-w-[160px] max-w-[160px] bg-inherit px-3 py-2.5 align-middle shadow-[2px_0_0_0_rgba(241,245,249,1)]">
                          <div className="flex items-center gap-2.5">
                            <span className="w-6 shrink-0 text-right text-xs font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                            <span className="min-w-0 break-words text-[13px] font-bold leading-snug text-foreground">{s.full_name}</span>
                          </div>
                        </td>
                        {mainCols.map((a) => {
                          const k = actKey(a);
                          const val = scores[s.id]?.[k] ?? '';
                          const numberVal = Number(val);
                          const filled = val !== '' && Number.isFinite(numberVal);
                          // ≥ 60% do máximo = passa (verde); abaixo = vermelho. Ex.: 6/10, 3/5, 1,2/2.
                          const lowNote = filled && numberVal < (a.max || 10) * 0.6;
                          const okNote = filled && !lowNote;
                          return (
                            <td key={k} className="px-1.5 py-1.5 text-center">
                              <input
                                inputMode="decimal"
                                value={val.replace('.', ',')}
                                onChange={(e) => setScore(s.id, k, e.target.value, a.max)}
                                disabled={!editingGrades}
                                placeholder="–"
                                className={cn(
                                  'h-10 w-14 rounded-lg border text-center font-bold tabular-nums outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed',
                                  lowNote ? 'border-red-200 bg-red-50 text-red-600' : okNote ? 'border-border bg-card text-foreground' : 'border-border bg-card text-muted-foreground',
                                  !editingGrades && 'bg-transparent disabled:bg-transparent',
                                )}
                              />
                            </td>
                          );
                        })}
                        {creditoCols.length > 0 ? (
                          (() => {
                            const manual = scores[s.id]?.[CREDITO_OVERRIDE_KEY] ?? '';
                            const autoStr = creditoSum(s.id) ? fmtNum(creditoSum(s.id)) : '';
                            const shown = manual !== '' ? manual : autoStr;
                            const isManual = manual !== '';
                            return (
                              <td className="bg-amber-50/40 px-1.5 py-1.5 text-center" title="Vem da Central de Avaliações — você pode digitar para sobrescrever">
                                <input
                                  inputMode="decimal"
                                  value={String(shown).replace('.', ',')}
                                  onChange={(e) => setScore(s.id, CREDITO_OVERRIDE_KEY, e.target.value, 10)}
                                  disabled={!editingGrades}
                                  placeholder="–"
                                  className={cn(
                                    'h-10 w-14 rounded-lg border text-center font-bold tabular-nums outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed',
                                    isManual ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700',
                                    !editingGrades && 'bg-transparent disabled:bg-transparent',
                                  )}
                                />
                              </td>
                            );
                          })()
                        ) : null}
                        <td className="px-3 py-3 text-center">
                          {m != null ? (
                            <span className={cn('inline-block min-w-[44px] rounded-lg px-2 py-1 text-base font-black tabular-nums', ok ? 'text-foreground' : 'bg-red-50 text-red-600')}>
                              {fmtNumber(m, 1)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">–</span>
                          )}
                        </td>
                        {recoveryCol ? (
                          (() => {
                            const k = actKey(recoveryCol);
                            const val = scores[s.id]?.[k] ?? '';
                            const canEditRecovery = editingGrades && hasAllPrimaryNotes(s.id);
                            return (
                              <td className="px-1.5 py-1.5 text-center">
                                <input
                                  inputMode="decimal"
                                  value={val.replace('.', ',')}
                                  onChange={(e) => setScore(s.id, k, e.target.value, recoveryCol.max)}
                                  disabled={!canEditRecovery}
                                  placeholder={canEditRecovery ? '–' : 'Preencha 3 notas'}
                                  className={cn(
                                    'h-10 w-28 rounded-lg border text-center font-bold tabular-nums outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed',
                                    val !== '' ? 'border-border bg-card text-foreground' : 'border-border bg-card text-muted-foreground',
                                    !canEditRecovery && 'bg-slate-100 text-muted-foreground',
                                  )}
                                />
                              </td>
                            );
                          })()
                        ) : null}
                        <td className="px-3 py-3 text-center">
                          {m == null ? (
                            <span className="text-muted-foreground">–</span>
                          ) : ok ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black uppercase text-emerald-700">Aprovado</span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-[11px] font-black uppercase text-red-700">Recuperação</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={obs[s.id] ?? ''}
                            onChange={(e) => {
                              if (!editingGrades) return;
                              setObs((p) => ({ ...p, [s.id]: e.target.value }));
                              setSaved(false);
                            }}
                            disabled={!editingGrades}
                            placeholder={editingGrades ? 'Anotação…' : '–'}
                            className={cn(
                              'h-10 w-full min-w-[150px] rounded-lg border px-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100',
                              editingGrades ? 'border-border bg-card text-foreground' : 'border-transparent bg-transparent text-muted-foreground',
                            )}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </Card>

              <p className="mt-3 text-xs text-muted-foreground">
                São 3 notas principais (peso 10): {mainCols.map((a) => a.name).join(', ')}{creditoCols.length ? ' e Crédito variável' : ''}. A média e a recuperação só aparecem depois que as 3 notas principais estiverem preenchidas. A recuperação substitui a menor nota apenas se melhorar a média.
              </p>
              {creditoCols.length > 0 ? (
                <p className="mt-1 text-xs font-semibold text-amber-600">
                  O Crédito variável é a soma de {creditData.defs.map((d) => d.name).join(', ')} (lançadas no Central de Avaliações) e vale 10 = 1 nota. Preenchido automaticamente.
                </p>
              ) : null}
            </>
          )}
        </>
      )}

      {students.length > 0 && columns.length > 0 ? (
        <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 p-3 backdrop-blur lg:pl-72">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-1 sm:gap-3">
            <div className="hidden min-w-0 flex-1 sm:block">
              <p className="truncate text-sm font-bold text-foreground">
                {saved ? '✓ Notas salvas e bloqueadas' : editingGrades ? 'Edição aberta' : `${TERM_LABEL[term]} • ${year}`}
              </p>
              <p className="truncate text-xs text-muted-foreground">{editingGrades ? 'Lance as notas e salve para bloquear.' : 'Toque em editar para alterar.'}</p>
            </div>
            {editingGrades ? (
              <>
                {hasSavedGrades ? (
                  <button
                    onClick={resetScoresFromSaved}
                    disabled={save.isPending}
                    className="inline-flex min-h-12 items-center justify-center rounded-xl border border-border px-4 text-sm font-black text-muted-foreground transition hover:bg-muted disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                ) : null}
                <button
                  onClick={handleSave}
                  disabled={save.isPending}
                  className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-base font-black text-white transition hover:bg-emerald-700 disabled:opacity-60 sm:flex-none sm:px-8"
                >
                  <Save size={20} />
                  <span className="sm:hidden">{save.isPending ? 'Salvando…' : 'Salvar'}</span>
                  <span className="hidden sm:inline">{save.isPending ? 'Salvando…' : 'Salvar e bloquear'}</span>
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setEditingGrades(true);
                  setSaved(false);
                }}
                className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-base font-black text-white transition hover:bg-slate-800 sm:flex-none sm:px-8"
              >
                <Pencil size={20} />
                Editar notas
              </button>
            )}
          </div>
          {save.isError ? <p className="mx-auto mt-2 max-w-5xl px-1 text-sm font-semibold text-red-600">{(save.error as Error).message}</p> : null}
        </footer>
      ) : null}

      <ComposicaoModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        term={term}
        year={year}
        initial={activities}
        onSaved={() => qc.invalidateQueries({ queryKey: ['term-config', activeOrgId, year, term] })}
      />

      <BoletimModal
        open={boletimOpen}
        onClose={() => setBoletimOpen(false)}
        className={classes.find((c) => c.id === classId)?.name ?? 'Turma'}
        schoolId={classes.find((c) => c.id === classId)?.school_id ?? ''}
        term={term}
        year={year}
        activities={columns}
        rows={list.map((s) => ({
          name: s.full_name,
          scores: Object.fromEntries(columns.map((a) => [a.name, scores[s.id]?.[actKey(a)] ?? ''])),
          media: mediaOf(s.id),
          obs: obs[s.id] ?? '',
        }))}
      />

      <BoletimEscolarModal
        open={boletimEscolarOpen}
        onClose={() => setBoletimEscolarOpen(false)}
        classId={classId}
        schoolId={classes.find((c) => c.id === classId)?.school_id ?? ''}
        className={classes.find((c) => c.id === classId)?.name ?? 'Turma'}
        year={year}
      />

      <ConfirmClearModal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Limpar notas da turma"
        description={`Isso apaga TODAS as notas de ${turmaNome} no ${TERM_LABEL[term]} / ${year} do banco de dados. Ação irreversível.`}
        keyword="APAGAR"
        confirmLabel="Apagar notas"
        busy={clearGrades.isPending}
        onConfirm={() => clearGrades.mutate()}
      />
    </div>
  );
}

type BoletimRow = { name: string; scores: Record<string, string>; media: number | null; obs: string };

/** Gerador de boletins escolares: um boletim por aluno, com os 3 trimestres,
 *  média final e situação — um por página, pronto para imprimir/baixar. */
function BoletimEscolarModal({
  open,
  onClose,
  classId,
  schoolId,
  className,
  year,
}: {
  open: boolean;
  onClose: () => void;
  classId: string;
  schoolId: string;
  className: string;
  year: number;
}) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['boletim-anual', classId, year],
    queryFn: () => reportTerms(classId, year),
    enabled: open && !!classId,
    retry: false,
  });
  const { data: schools = [] } = useQuery({ queryKey: ['schools'], queryFn: listSchools, enabled: open });
  const school = schools.find((s) => s.id === schoolId);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open) setSelected(new Set(rows.map((r) => r.student_id)));
  }, [open, rows]);

  const allOn = rows.length > 0 && selected.size === rows.length;
  function toggle(id: string) {
    setSelected((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function sit(m: number | null): { txt: string; cls: string } {
    if (m == null) return { txt: '—', cls: '' };
    return m >= MEDIA_APROVACAO ? { txt: 'Aprovado', cls: 'ok' } : { txt: 'Recuperação', cls: 'fail' };
  }

  function boletimHtml(r: TermsReportRow, i: number, total: number): string {
    const linhas = TERMS.map((t) => {
      const m = r.terms[t - 1] ?? null;
      const s = sit(m);
      return `<tr><td class="name">${escapeHtml(TERM_LABEL[t])}</td><td>${m == null ? '—' : `<span class="${m >= MEDIA_APROVACAO ? 'ok' : 'fail'}">${fmtNumber(m, 1)}</span>`}</td><td><span class="${s.cls}">${s.txt}</span></td></tr>`;
    }).join('');
    // Resultado final é APROVADO/REPROVADO (a nota de recuperação já está embutida na média).
    const sf = r.final == null ? { txt: '—', cls: '' } : r.final >= MEDIA_APROVACAO ? { txt: 'Aprovado', cls: 'ok' } : { txt: 'Reprovado', cls: 'fail' };
    // 3 boletins por folha: cada um indivisível (break-inside: avoid) e quebra
    // de página forçada a cada 3 (após índices 2, 5, 8…). Layout compacto
    // (header reduzido, fontes/margens menores) p/ os três caberem no A4.
    const isLast = i === total - 1;
    const pageBreak = i % 3 === 2 && !isLast;
    return `<section style="break-inside: avoid; ${pageBreak ? 'page-break-after: always;' : ''} max-width: 720px; margin: 0 auto; padding: 8px 0 10px; ${isLast || pageBreak ? '' : 'border-bottom: 1px dashed #cbd5e1;'}">
      ${schoolHeaderHtml(school, `BOLETIM ESCOLAR — ${year}`, true, SUBJECT)}
      <p style="font-size:12px; margin:0 0 8px;"><strong>Aluno(a):</strong> ${escapeHtml(r.name)} &nbsp;·&nbsp; <strong>Turma:</strong> ${escapeHtml(className)}</p>
      <table><thead><tr><th class="name">Período</th><th>Média</th><th>Situação</th></tr></thead>
      <tbody>${linhas}
        <tr style="background:#f1f5f9; font-weight:800;"><td class="name">Média final</td><td>${r.final == null ? '—' : `<span class="${r.final >= MEDIA_APROVACAO ? 'ok' : 'fail'}">${fmtNumber(r.final, 1)}</span>`}</td><td><span class="${sf.cls}">${sf.txt}</span></td></tr>
      </tbody></table>
      <p style="font-size:11px; margin:8px 0;"><strong>Resultado final:</strong> <span class="${sf.cls}">${sf.txt}</span> &nbsp; (média de aprovação: ${fmtNumber(MEDIA_APROVACAO, 1)} · recuperação já considerada na média)</p>
      <div style="display:flex; gap:40px; margin-top:12px; font-size:11px; color:#475569;">
        <div style="flex:1; border-top:1px solid #94a3b8; padding-top:5px; text-align:center;">Coordenação</div>
        <div style="flex:1; border-top:1px solid #94a3b8; padding-top:5px; text-align:center;">Responsável</div>
      </div>
    </section>`;
  }

  function gerar() {
    const sel = rows.filter((r) => selected.has(r.student_id));
    if (!sel.length) return;
    const body = sel.map((r, i) => boletimHtml(r, i, sel.length)).join('');
    printDocument(`${SUBJECT_SHORT} - Boletim - ${className.split(/\s*[-–]\s*/)[0].trim()} - ${year}`.replace(/[\/\\:*?"<>|]+/g, '-'), body);
  }

  return (
    <Modal open={open} onClose={onClose} title="Boletins escolares" size="xl">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Gera um boletim por aluno ({className} · {year}) com os 3 trimestres, média final e situação — três por página (economiza papel), pronto para imprimir ou salvar em PDF.
        </p>

        {isLoading ? (
          <Loading label="Carregando notas do ano…" />
        ) : rows.length === 0 ? (
          <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">Nenhuma nota lançada nesta turma em {year}.</p>
        ) : (
          <>
            <label className="flex items-center gap-2 rounded-xl border border-border bg-muted px-3 py-2.5 text-sm font-bold text-foreground">
              <input type="checkbox" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.student_id)))} className="h-5 w-5 rounded border-border text-emerald-600 focus:ring-emerald-500" />
              Selecionar todos ({rows.length})
            </label>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
              {rows.map((r) => (
                <label key={r.student_id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" checked={selected.has(r.student_id)} onChange={() => toggle(r.student_id)} className="h-4 w-4 rounded border-border text-emerald-600 focus:ring-emerald-500" />
                  <span className="flex-1 font-bold text-foreground">{r.name}</span>
                  <span className={cn('text-xs font-black', r.final == null ? 'text-muted-foreground' : r.final >= MEDIA_APROVACAO ? 'text-foreground' : 'text-red-600')}>
                    {r.final == null ? '–' : fmtNumber(r.final, 1)}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
              <Button variant="ghost" onClick={onClose}>Fechar</Button>
              <Button onClick={gerar} disabled={selected.size === 0}>
                <Printer size={16} /> Gerar {selected.size} boletim(ns)
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Para PDF: na caixa de impressão escolha "Salvar como PDF".</p>
          </>
        )}
      </div>
    </Modal>
  );
}

function BoletimModal({
  open,
  onClose,
  className,
  schoolId,
  term,
  year,
  activities,
  rows,
}: {
  open: boolean;
  onClose: () => void;
  className: string;
  schoolId: string;
  term: number;
  year: number;
  activities: GradeActivity[];
  rows: BoletimRow[];
}) {
  const [compact, setCompact] = useState(false);
  // Colunas exibidas: as várias atividades de crédito viram UMA coluna "Crédito variável".
  const displayCols = collapseCreditoColumns(activities);
  const creditActs = activities.filter((a) => !isRecoveryActivity(a.name) && (a.credito === true || a.max < 10));
  // Campos escolhidos pelo professor (mesma lógica dos Relatórios): quais colunas saem no relatório.
  const [selectedActs, setSelectedActs] = useState<Set<string>>(new Set());
  const [showMedia, setShowMedia] = useState(true);
  const [showSituation, setShowSituation] = useState(true);
  const [showObs, setShowObs] = useState(true);
  useEffect(() => {
    if (open) setSelectedActs(new Set(displayCols.map((a) => a.name)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activities]);
  const toggleAct = (name: string) =>
    setSelectedActs((p) => {
      const n = new Set(p);
      n.has(name) ? n.delete(name) : n.add(name);
      return n;
    });
  // "Todas / Limpar" únicos: agem sobre colunas de notas E campos gerais ao mesmo tempo.
  const selectAll = () => {
    setSelectedActs(new Set(displayCols.map((a) => a.name)));
    setShowMedia(true);
    setShowSituation(true);
    setShowObs(true);
  };
  const clearAll = () => {
    setSelectedActs(new Set());
    setShowMedia(false);
    setShowSituation(false);
    setShowObs(false);
  };
  const { data: schools = [] } = useQuery({ queryKey: ['schools'], queryFn: listSchools, enabled: open });
  const school = schools.find((s) => s.id === schoolId);
  const titulo = `Relatório — ${className}`;
  const sub = `${TERM_LABEL[term]} • ${year} • aprovação a partir de ${fmtNumber(MEDIA_APROVACAO, 1)}`;
  // Nome automático (curto): Disciplina - Turma - Trimestre - Atividade.
  // Ex.: "Ling. Ingl. - 6º ANO - 2º tri - TESTE"
  const safeFileName = (s: string) => s.replace(/[\/\\:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  const turmaShort = className.split(/\s*[-–]\s*/)[0].trim();
  const reportFileName = (() => {
    const acts = displayCols.filter((a) => selectedActs.has(a.name)).map((a) => a.name);
    const atividade = acts.length ? acts.join(', ') : 'Notas';
    return safeFileName(`${SUBJECT_SHORT} - ${turmaShort} - ${term}º tri - ${atividade}`);
  })();

  function situacao(m: number | null): 'Aprovado' | 'Recuperação' | '–' {
    if (m == null) return '–';
    return m >= MEDIA_APROVACAO ? 'Aprovado' : 'Recuperação';
  }

  function buildHtml(isCompact = compact): string {
    const activeActs = displayCols.filter((a) => selectedActs.has(a.name));
    const cols = ['#', 'Aluno', ...activeActs.map((a) => `${a.name} (0–${a.max})`), ...(showMedia ? ['Média'] : []), ...(showSituation ? ['Situação'] : []), ...(showObs ? ['Observações'] : [])];
    const head = `<tr>${cols.map((c, i) => `<th class="${i === 1 ? 'name' : ''}">${escapeHtml(c)}</th>`).join('')}</tr>`;
    const body = rows
      .map((r, i) => {
        const m = r.media;
        const mediaCell = m == null ? '–' : `<span class="${m >= MEDIA_APROVACAO ? 'ok' : 'fail'}">${fmtNumber(m, 1)}</span>`;
        const sit = situacao(m);
        const sitCell = sit === '–' ? '–' : `<span class="${sit === 'Aprovado' ? 'ok' : 'fail'}">${sit}</span>`;
        const acts = activeActs
          .map((a) => {
            // Coluna "Crédito variável" = soma das atividades de crédito (0–10). Demais = nota da atividade.
            const raw = a.id === CREDITO_OVERRIDE_KEY ? creditoSumFrom((ca) => r.scores[ca.name], creditActs) : r.scores[a.name];
            const v = raw == null ? '' : String(raw);
            if (v === '') return '<td>–</td>';
            // ≥ 60% do máximo = verde; abaixo = vermelho (mesma régua da média/nota 6 de 10).
            const ok = Number(v) >= (a.max || 10) * 0.6;
            return `<td class="${ok ? 'ok' : 'fail'}">${escapeHtml(v.replace('.', ','))}</td>`;
          })
          .join('');
        return `<tr><td>${i + 1}</td><td class="name">${escapeHtml(r.name)}</td>${acts}${showMedia ? `<td>${mediaCell}</td>` : ''}${showSituation ? `<td>${sitCell}</td>` : ''}${showObs ? `<td class="name">${escapeHtml(r.obs)}</td>` : ''}</tr>`;
      })
      .join('');
    // Modo compacto: fontes/margens menores p/ caber mais alunos por folha.
    const compactStyle = isCompact ? '<style>th,td{padding:2px 5px !important;font-size:9px !important}</style>' : '';
    return `${compactStyle}${schoolHeaderHtml(school, `RELATÓRIO DE NOTAS — ${TERM_LABEL[term]} / ${year}`, isCompact, SUBJECT)}
      <p style="font-size:${isCompact ? 11 : 13}px; margin:0 0 ${isCompact ? 8 : 12}px;"><strong>Turma:</strong> ${escapeHtml(className)} &nbsp;·&nbsp; ${rows.length} aluno(s)</p>
      <table><thead>${head}</thead><tbody>${body}</tbody></table>
      <p class="foot">${escapeHtml(sub)}</p>`;
  }

  // Exporta a mesma seleção de colunas/campos para Excel (mesma lógica do relatório).
  function exportExcel(): void {
    const activeActs = displayCols.filter((a) => selectedActs.has(a.name));
    const header = ['#', 'Aluno', ...activeActs.map((a) => a.name), ...(showMedia ? ['Média'] : []), ...(showSituation ? ['Situação'] : []), ...(showObs ? ['Observações'] : [])];
    const body = rows.map((r, i) => {
      const acts = activeActs.map((a) => {
        const raw = a.id === CREDITO_OVERRIDE_KEY ? creditoSumFrom((ca) => r.scores[ca.name], creditActs) : (r.scores[a.name] === '' || r.scores[a.name] == null ? null : Number(r.scores[a.name]));
        return raw == null ? '—' : raw;
      });
      return [
        i + 1,
        r.name,
        ...acts,
        ...(showMedia ? [r.media == null ? '—' : r.media] : []),
        ...(showSituation ? [situacao(r.media)] : []),
        ...(showObs ? [r.obs] : []),
      ];
    });
    const aoa: (string | number | null)[][] = [[school?.name ?? 'Escola'], [`Notas — Turma ${className} — ${TERM_LABEL[term]} / ${year}`], [], header, ...body];
    downloadXlsx(`${reportFileName}.xlsx`, aoa, 'Notas');
  }

  const [share, setShare] = useState(false);
  // Payload p/ o link compartilhável (mesmo formato dos Relatórios → abre via ReportView).
  function buildSharePayload(): ReportPayload | null {
    if (!rows.length) return null;
    const notasRows = rows.map((r) => {
      const activityScores: Record<string, number | null> = {};
      for (const a of displayCols) {
        const k = a.id ?? a.name;
        if (a.id === CREDITO_OVERRIDE_KEY) activityScores[k] = creditoSumFrom((ca) => r.scores[ca.name], creditActs);
        else {
          const v = r.scores[a.name];
          activityScores[k] = v === '' || v == null ? null : Number(v);
        }
      }
      const terms: (number | null)[] = [null, null, null];
      terms[term - 1] = r.media;
      return { name: r.name, terms, final: r.media, activityScores };
    });
    return {
      kind: 'notas',
      school: school ? { name: school.name, logo_url: school.logo_url, address: school.address, city: school.city, phone: school.phone } : null,
      className,
      title: `Relatório parcial de notas`,
      period: `${term}º trimestre / ${year}`,
      generatedAt: new Date().toLocaleDateString('pt-BR'),
      subject: SUBJECT,
      notasRows,
      notasTerm: term,
      termActivities: displayCols,
      termSelectedActivities: displayCols.filter((a) => selectedActs.has(a.name)).map((a) => a.id ?? a.name),
      show: { situation: showSituation },
    };
  }

  const nothingSelected = selectedActs.size === 0 && !showMedia && !showSituation && !showObs;

  return (
    <>
    <Modal open={open} onClose={onClose} title="Boletim / Relatório" size="xl">
      <div className="space-y-5">
        {/* Turma */}
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-foreground">{className}</p>
          <p className="text-xs text-muted-foreground">{TERM_LABEL[term]} • {year} • {rows.length} aluno(s)</p>
        </div>

        <div className="space-y-4 rounded-2xl border border-border bg-muted/30 p-4">
            {/* Cabeçalho geral: Todas/Limpar únicos p/ colunas + campos gerais */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-wide text-muted-foreground">Campos do relatório</p>
                <p className="text-[11px] font-semibold text-muted-foreground">{selectedActs.size} de {displayCols.length} coluna(s) selecionada(s)</p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={selectAll}
                  className="rounded-lg bg-card px-2.5 py-1 text-xs font-bold text-muted-foreground shadow-sm transition hover:text-foreground"
                >
                  Todas
                </button>
                <button
                  onClick={clearAll}
                  className="rounded-lg bg-card px-2.5 py-1 text-xs font-bold text-muted-foreground shadow-sm transition hover:text-foreground"
                >
                  Limpar
                </button>
              </div>
            </div>

            {/* Colunas de notas */}
            <div>
              <p className="mb-2.5 text-xs font-black uppercase tracking-wide text-muted-foreground">Colunas de notas</p>
              <div className="flex flex-wrap gap-2">
                {displayCols.map((a) => {
                  const on = selectedActs.has(a.name);
                  return (
                    <button
                      key={a.name}
                      onClick={() => toggleAct(a.name)}
                      aria-pressed={on}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-bold transition',
                        on
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                          : 'border-border bg-card text-muted-foreground hover:border-emerald-300 hover:text-foreground',
                      )}
                    >
                      <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-full border', on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-border')}>
                        {on ? <Check size={11} strokeWidth={3} /> : null}
                      </span>
                      {a.name}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Campos gerais */}
            <div className="border-t border-border pt-3">
              <p className="mb-2.5 text-xs font-black uppercase tracking-wide text-muted-foreground">Campos gerais</p>
              <div className="flex flex-wrap gap-2">
                {([
                  ['Média', showMedia, () => setShowMedia((v) => !v)],
                  ['Situação', showSituation, () => setShowSituation((v) => !v)],
                  ['Observações', showObs, () => setShowObs((v) => !v)],
                ] as const).map(([label, on, toggle]) => (
                  <button
                    key={label}
                    onClick={toggle}
                    aria-pressed={on}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-bold transition',
                      on
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-border bg-card text-muted-foreground hover:border-emerald-300 hover:text-foreground',
                    )}
                  >
                    <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded-full border', on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-border')}>
                      {on ? <Check size={11} strokeWidth={3} /> : null}
                    </span>
                    {label}
                  </button>
                ))}
              </div>
            </div>
        </div>

        {rows.length === 0 ? (
          <p className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">Sem alunos para gerar o boletim.</p>
        ) : (
          <>
            {/* Barra de ações — mesma lógica dos Relatórios (Compacto, Visualizar, Enviar, PDF + Excel) */}
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border bg-card p-2 shadow-soft sm:flex sm:flex-wrap sm:items-center">
              <Button variant="ghost" onClick={() => setCompact((c) => !c)} className="w-full sm:w-auto" title="Alternar layout do relatório">
                {compact ? <Rows3 size={18} /> : <List size={18} />} {compact ? 'Detalhado' : 'Compacto'}
              </Button>
              <Button variant="ghost" onClick={() => printDocument(reportFileName, buildHtml(), { autoPrint: false })} disabled={nothingSelected} className="w-full sm:w-auto">
                <Eye size={18} /> Visualizar
              </Button>
              <Button variant="ghost" onClick={() => setShare(true)} disabled={nothingSelected} className="w-full sm:w-auto">
                <Send size={18} /> Enviar
              </Button>
              <Button variant="ghost" onClick={() => printDocument(reportFileName, buildHtml())} disabled={nothingSelected} className="w-full sm:w-auto">
                <Printer size={18} /> PDF
              </Button>
              <Button onClick={exportExcel} disabled={nothingSelected} className="col-span-2 w-full sm:ml-auto sm:w-auto">
                <FileDown size={18} /> Excel
              </Button>
            </div>
            {nothingSelected ? (
              <p className="text-xs font-semibold text-amber-600">Selecione ao menos uma coluna ou campo para gerar o relatório.</p>
            ) : (
              <p className="text-xs text-muted-foreground">Visualizar abre a prévia; em PDF, escolha "Salvar como PDF" na impressão.</p>
            )}
          </>
        )}
      </div>
    </Modal>
    <ShareModal open={share} onClose={() => setShare(false)} payload={share ? buildSharePayload() : null} />
    </>
  );
}

function ComposicaoModal({
  open,
  onClose,
  term,
  year,
  initial,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  term: number;
  year: number;
  initial: GradeActivity[];
  onSaved: () => void;
}) {
  const [items, setItems] = useState<GradeActivity[]>([]);
  const cloneEnabled = term > 1;

  useEffect(() => {
    if (open) setItems(orderGradeActivities(initial.length ? initial.map((a) => ({ ...a })) : DEFAULT_ACTIVITIES.map((a) => ({ ...a }))));
  }, [open, initial]);

  const clone = useMutation({
    mutationFn: async (sourceTerm?: number) => {
      const sourceTerms = sourceTerm ? [sourceTerm] : Array.from({ length: term - 1 }, (_, i) => term - 1 - i);
      for (const candidate of sourceTerms) {
        const previous = await getSavedTermConfig(year, candidate);
        if (previous.length) return { sourceTerm: candidate, previous };
      }
      throw new Error(sourceTerm ? `${TERM_LABEL[sourceTerm]} ainda não tem composição salva.` : 'Nenhuma composição salva em trimestre anterior.');
    },
    onSuccess: ({ sourceTerm, previous }) => {
      setItems(orderGradeActivities(previous.map((a) => ({ ...a }))));
      successToast(`Composição clonada do ${TERM_LABEL[sourceTerm]}`);
    },
  });

  const save = useMutation({
    mutationFn: () =>
      saveTermConfig(
        year,
        term,
        orderGradeActivities(items.filter((a) => a.name.trim()).map((a) => ({ id: a.id, name: a.name.trim(), max: Number(a.max) || 0, date: a.date }))),
      ),
    onSuccess: () => {
      onSaved();
      onClose();
      successToast('Composição salva com sucesso');
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={`Composição — ${TERM_LABEL[term]} / ${year}`}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Defina as atividades e quanto cada uma vale neste trimestre. A nota {RECOVERY_ACTIVITY_NAME} é coringa: substitui a menor nota do aluno somente quando for maior.
        </p>

        <div className="grid gap-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm sm:grid-cols-3">
          <div>
            <p className="font-black text-emerald-900">Atividades</p>
            <p className="mt-1 text-xs font-semibold text-emerald-700">
              Cada rótulo vira uma coluna de nota. O campo valor define o máximo permitido naquela atividade.
            </p>
          </div>
          <div>
            <p className="font-black text-emerald-900">Média</p>
            <p className="mt-1 text-xs font-semibold text-emerald-700">
              O sistema soma as notas válidas e divide por 3, mantendo a regra atual da escola.
            </p>
          </div>
          <div>
            <p className="font-black text-emerald-900">{RECOVERY_ACTIVITY_NAME}</p>
            <p className="mt-1 text-xs font-semibold text-emerald-700">
              Não soma como nota extra. Ela troca a menor nota somente se a recuperação for maior.
            </p>
          </div>
          <p className="rounded-lg bg-card/80 p-2 text-xs font-bold text-muted-foreground sm:col-span-3">
            Exemplo: notas 8, 6 e 5 com recuperação 7 viram 8, 6 e 7. Se a recuperação for 4, nada muda.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-muted p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-black text-foreground">Reaproveitar composição</p>
              <p className="text-xs font-semibold text-muted-foreground">
                Clone o descritivo e os valores do trimestre anterior salvo para evitar redigitar tudo.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {cloneEnabled ? (
                Array.from({ length: term - 1 }, (_, i) => i + 1).map((sourceTerm) => (
                  <Button key={sourceTerm} variant="soft" onClick={() => clone.mutate(sourceTerm)} disabled={clone.isPending}>
                    {clone.isPending ? 'Clonando…' : `Clonar ${TERM_LABEL[sourceTerm]}`}
                  </Button>
                ))
              ) : (
                <Button variant="soft" disabled>Sem trimestre anterior</Button>
              )}
            </div>
          </div>
          {clone.isError ? <p className="mt-2 text-xs font-semibold text-red-600">{(clone.error as Error).message}</p> : null}
        </div>

        <div className="space-y-3">
          {items.map((a, i) => (
            <div key={i} className="rounded-xl border border-border bg-muted p-2.5">
              <div className="flex items-center gap-2">
                <Input
                  value={a.name}
                  onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  placeholder="Nome da atividade"
                  className="flex-1"
                  disabled={isRecoveryActivity(a.name)}
                />
                <Input
                  value={String(a.max)}
                  onChange={(e) =>
                    setItems((p) => p.map((x, j) => (j === i ? { ...x, max: Number(e.target.value.replace(/[^0-9.]/g, '')) || 0 } : x)))
                  }
                  inputMode="decimal"
                  className="w-20 text-center"
                  placeholder="Valor"
                />
                <button
                  onClick={() => setItems((p) => p.filter((_, j) => j !== i))}
                  disabled={isRecoveryActivity(a.name)}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600 hover:bg-red-100"
                  aria-label="Remover"
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {!isRecoveryActivity(a.name) ? (
                <label className="mt-2 flex items-center gap-2 px-1 text-xs font-bold text-muted-foreground">
                  Prazo / entrega
                  <Input
                    type="date"
                    value={a.date ?? ''}
                    onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, date: e.target.value || undefined } : x)))}
                    className="h-9 w-auto py-1"
                  />
                </label>
              ) : null}
            </div>
          ))}
        </div>

        <Button variant="ghost" onClick={() => setItems((p) => [...p, { name: '', max: 0 }])}>
          <Plus size={18} /> Adicionar atividade
        </Button>

        {save.isError ? <p className="text-sm font-semibold text-red-600">{(save.error as Error).message}</p> : null}
        <div className="mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Salvando…' : 'Salvar composição'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
