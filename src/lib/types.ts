export type AttendanceStatus = 'present' | 'absent' | 'late' | 'justified';

export interface School {
  id: string;
  name: string;
  cnpj?: string | null;
  city: string | null;
  logo_url: string | null;
  director: string | null;
  address: string | null;
  phone: string | null;
  inep: string | null;
  subject?: string | null;
  active: boolean;
  created_at?: string;
}

export interface ClassRoom {
  id: string;
  school_id: string;
  name: string;
  shift: string;
  year: number | null;
  does_exams?: boolean;
  created_at?: string;
}

export interface Student {
  id: string;
  school_id: string;
  class_id: string | null;
  full_name: string;
  registration: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  active: boolean;
  created_at?: string;
}

export interface AttendanceSession {
  id: string;
  class_id: string;
  session_date: string;
  note: string | null;
  exam_mode?: boolean;
  updated_at?: string | null;
}

export interface AttendanceRecord {
  id?: string;
  session_id?: string;
  student_id: string;
  status: AttendanceStatus;
  note: string | null;
}

export interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  phone?: string | null;
  is_superadmin: boolean;
  active_org_id: string | null;
}

/* ------------------------------ Bases e papéis ------------------------------ */
// superadmin = você (administrador da plataforma). Dentro de cada base há 3 papéis.
export type AppRole = 'superadmin' | 'gestor' | 'professor' | 'secretaria';

export const ROLE_LABEL: Record<AppRole, string> = {
  superadmin: 'Administrador',
  gestor: 'Gestão / Coordenação',
  professor: 'Professor(a)',
  secretaria: 'Secretaria',
};

export const ROLE_HINT: Record<Exclude<AppRole, 'superadmin'>, string> = {
  gestor: 'Acesso total à base: cadastros, equipe, notas, revisão de planejamentos.',
  professor: 'Chamadas, notas, avaliações, planejamento e relatórios.',
  secretaria: 'Cadastros de turmas e alunos, relatórios, avisos e calendário.',
};

/** Papéis que o gestor pode atribuir na equipe. */
export const ASSIGNABLE_ROLES: AppRole[] = ['gestor', 'professor', 'secretaria'];

export interface Organization {
  id: string;
  name: string;
  active: boolean;
}

export interface Membership {
  id: string;
  user_id: string;
  org_id: string;
  role: AppRole;
}

/* ------------------------------ Avisos (Fase 2) ------------------------------ */
export type NoticeAudience = 'all' | 'role' | 'user';

export interface Notice {
  id: string;
  org_id: string;
  author_id: string;
  title: string;
  body: string;
  audience: NoticeAudience;
  target_role: AppRole | null;
  target_user: string | null;
  created_at: string;
}

export interface OrgPerson {
  user_id: string;
  full_name: string | null;
  role: AppRole;
  email: string | null;
  phone: string | null;
}

export interface NoticeAttachment {
  id: string;
  notice_id: string;
  name: string;
  path: string;
  mime: string | null;
  url?: string; // URL assinada (temporária) para baixar/pré-visualizar
}

/* ----------------------------- Calendário (Fase 4) ---------------------------- */
export type EventAudience = 'all' | 'role' | 'user';

export const EVENT_CATEGORIES: { key: string; label: string; color: string }[] = [
  { key: 'evento', label: 'Evento', color: '#2563eb' },
  { key: 'atividade', label: 'Atividade', color: '#059669' },
  { key: 'gincana', label: 'Gincana', color: '#d97706' },
  { key: 'prova', label: 'Semana de provas', color: '#dc2626' },
  { key: 'reuniao', label: 'Reunião', color: '#7c3aed' },
  { key: 'outro', label: 'Outro', color: '#475569' },
];
export const eventColor = (cat: string) => EVENT_CATEGORIES.find((c) => c.key === cat)?.color ?? '#64748b';
export const eventCatLabel = (cat: string) => EVENT_CATEGORIES.find((c) => c.key === cat)?.label ?? cat;
export const eventSoftColor = (cat: string) => {
  const map: Record<string, string> = {
    evento: '#eff6ff',
    atividade: '#ecfdf5',
    gincana: '#fffbeb',
    prova: '#fef2f2',
    reuniao: '#f5f3ff',
    outro: '#f8fafc',
  };
  return map[cat] ?? '#f8fafc';
};

/* --------------------- Construtor de calendário (visual) ---------------------
 * Documento único por organização: o coordenador monta o calendário inteiro
 * (categorias com cores livres, períodos/trimestres, eventos, dias letivos,
 * observações) e ele fica disponível para todos os usuários da organização.
 * Persistido como JSONB em public.calendar_builder. */
export type CalCategory = { id: string; label: string; color: string };
export type CalBuilderEvent = {
  id: string;
  title: string;
  categoryId: string;
  start: string; // "YYYY-MM-DD"
  end?: string; // opcional (intervalo)
};
export type CalPeriod = { id: string; label: string; startMonth: number; endMonth: number }; // 0-11
export interface CalendarBuilderData {
  school: string;
  title: string;
  year: number;
  categories: CalCategory[];
  periods: CalPeriod[];
  events: CalBuilderEvent[];
  letivosByMonth: Record<number, number>;
  notes: string;
}

export interface CalendarEvent {
  id: string;
  org_id: string;
  author_id: string;
  title: string;
  description: string;
  category: string;
  event_date: string; // yyyy-mm-dd
  end_date: string | null;
  audience: EventAudience;
  target_role: AppRole | null;
  target_user: string | null;
  created_at: string;
}

export interface EventAttachment {
  id: string;
  event_id: string;
  name: string;
  path: string;
  mime: string | null;
  url?: string;
}

/* ------------------------ Planejamento do professor (Fase 3) ------------------ */
export type PlanStatus = 'rascunho' | 'enviado' | 'aprovado' | 'devolvido';

export const PLAN_STATUS: Record<PlanStatus, { label: string; cls: string }> = {
  rascunho: { label: 'Rascunho', cls: 'bg-slate-100 text-slate-600' },
  enviado: { label: 'Enviado', cls: 'bg-blue-100 text-blue-700' },
  aprovado: { label: 'Aprovado', cls: 'bg-emerald-100 text-emerald-700' },
  devolvido: { label: 'Devolvido', cls: 'bg-red-100 text-red-700' },
};

/* ---- Planejamento semanal estruturado (modelo da professora) ---- */
export interface WeeklyBlock {
  id: string;
  turma: string;   // ex.: "6º ANO"
  items: string;   // bullets/atividades (texto multilinha)
}
export interface WeeklyDay {
  id: string;
  label: string;   // ex.: "Segunda-feira"
  date: string;    // ex.: "01/06"
  lessons: string; // ex.: "2 aulas"
  blocks: WeeklyBlock[];
}
export interface WeeklyWeek {
  id: string;
  days: WeeklyDay[];
  materials: string; // "Materiais necessários / anotações"
  homework: string;  // "Prazer de casa"
}
export interface WeeklyPlanData {
  school: string;
  teacher: string;
  course: string;     // ex.: "Fund. II"
  subjects: string;   // ex.: "Inglês"
  period: string;     // ex.: "Junho / 2026"
  classes: string[];  // turmas atendidas
  weeks: WeeklyWeek[];
}

export interface LessonPlan {
  id: string;
  org_id: string;
  author_id: string;
  class_id: string | null;
  title: string;
  week_start: string | null;
  content: string;
  plan_data: WeeklyPlanData | null; // preenchido quando é planejamento semanal estruturado
  status: PlanStatus;
  feedback: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanAttachment {
  id: string;
  plan_id: string;
  name: string;
  path: string;
  mime: string | null;
  url?: string;
}

/** Documento da central de planejamentos (por segmento/trimestre/turma). */
export interface PlanDoc {
  id: string;
  segment: string;          // 'fund1' | 'fund2' | ...
  term: number | null;      // trimestre 1-3 (null = geral)
  class_id: string | null;  // turma (null = todas)
  turma_label: string | null;
  name: string;
  path: string;
  mime: string | null;
  author_id: string;
  created_at: string;
  url?: string;             // URL assinada
}

export interface PlanMessage {
  id: string;
  plan_id: string;
  author_id: string;
  body: string;
  created_at: string;
  authorName: string | null;
}

export type CalendarUploadSlot = 'annual' | 'term1' | 'term2' | 'term3';

export interface CalendarUpload {
  id: string;
  org_id: string;
  slot: CalendarUploadSlot;
  title: string;
  name: string;
  path: string;
  mime: string | null;
  uploaded_by: string | null;
  created_at: string;
  url?: string;
}

export type HolidayScope = 'national' | 'state' | 'city';

export interface CalendarHoliday {
  id: string;
  org_id?: string;
  title: string;
  date: string;
  scope: HolidayScope;
  state?: string | null;
  city?: string | null;
  source?: string | null;
  created_at?: string;
}

export interface Grade {
  id?: string;
  class_id: string;
  student_id: string;
  subject: string;
  year: number;
  month: number;
  score: number | null;
  note: string | null;
}

export interface ReportSchool {
  name: string | null;
  logo_url: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
}
export interface ReportFreqRow {
  name: string;
  present: number;
  absent: number;
  total: number;
  pct: number;
  absentDates: string[];
  days?: Record<string, boolean>; // por dia: true=presente, false=falta
}
export interface ReportNotasRow {
  name: string;
  terms: (number | null)[]; // média de cada trimestre (4)
  final: number | null; // média anual
  // Para relatório trimestral detalhado: notas por atividade (chave estável da atividade -> valor)
  activityScores?: Record<string, number | null>;
}
export interface ReportPayload {
  kind: 'freq' | 'notas';
  school: ReportSchool | null;
  className: string;
  title: string;
  period: string;
  generatedAt: string;
  minPct?: number;
  sessions?: number;
  freqRows?: ReportFreqRow[];
  dates?: string[]; // todas as datas de aula no período (colunas do mapa de frequência)
  gridDates?: string[]; // TODOS os dias letivos (seg–sex, sem feriados) do período — colunas do mapa de chamada
  layout?: 'list' | 'grid'; // frequência: 'list' = chips por aluno; 'grid' = mapa de chamada mensal (P/F)
  examDates?: string[]; // dias em Modo prova (semana de provas) — relatório de frequência
  subject?: string;
  notasRows?: ReportNotasRow[];
  notasTerm?: number; // 0 = todos os trimestres; 1-4 = só aquele trimestre
  // Quando `notasTerm` >= 1 estas são as atividades do trimestre (ordem estável)
  termActivities?: GradeActivity[];
  // Quais atividades mostrar no relatório (array de actKey)
  termSelectedActivities?: string[];
  // Opções de exibição: chave -> incluir no relatório (permite ao professor marcar campos)
  show?: Record<string, boolean>;
}

export const SHIFTS = ['Manhã', 'Tarde', 'Noite', 'Integral'] as const;

/** Disciplina da base ativa (configurável em Configurações → Dados da escola).
 *  `let` exportado = ligação viva: as telas sempre leem o valor atual. */
export let SUBJECT = '';
/** Forma curta da disciplina, para nome de arquivo. Ex.: "Ling. Ingl." */
export let SUBJECT_SHORT = 'Notas';

const SHORT_KNOWN: Record<string, string> = { 'língua inglesa': 'Ling. Ingl.', 'língua portuguesa': 'Ling. Port.', matemática: 'Mat.' };
export function setSubject(value: string | null | undefined) {
  SUBJECT = (value ?? '').trim();
  const known = SHORT_KNOWN[SUBJECT.toLowerCase()];
  SUBJECT_SHORT = !SUBJECT
    ? 'Notas'
    : known ?? SUBJECT.split(/\s+/).map((w) => (w.length > 4 ? `${w.slice(0, 4)}.` : w)).join(' ');
}

export const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
] as const;

/* ---- Notas por trimestre (composição de atividades) ---- */
export interface GradeActivity {
  id?: string; // identificador estável da coluna (liga Centro de Avaliações ↔ Notas sem depender do nome)
  name: string;
  max: number; // valor máximo da atividade naquele trimestre
  date?: string; // prazo / data de entrega (yyyy-mm-dd) — opcional
  credito?: boolean; // (Centro de Avaliações) atividade compõe o "crédito variável"
}

/** Chave estável da atividade nos mapas de notas: usa o id quando existe, senão o nome (legado). */
export function actKey(a: GradeActivity): string {
  return a.id ?? a.name;
}

/**
 * Compatibilidade de leitura: notas antigas foram salvas com a CHAVE = nome da
 * atividade; hoje a chave é o id. Este helper devolve os scores também acessíveis
 * pela chave atual (id), copiando do nome quando o id não existir. Só leitura —
 * não altera valores nem cálculo, apenas garante que a nota seja encontrada.
 */
export function normalizeScores(scores: Record<string, number>, activities: GradeActivity[]): Record<string, number> {
  const out: Record<string, number> = { ...scores };
  for (const a of activities) {
    const k = actKey(a);
    if (out[k] == null && scores[a.name] != null) out[k] = scores[a.name];
  }
  return out;
}

/**
 * Sanitiza a digitação de uma nota: aceita vírgula OU ponto (ex.: 8,07 / 8.07),
 * mantém um único separador, até 2 casas decimais, e limita ao máximo da coluna.
 * Devolve string (para controlar o input) — não força valor enquanto se digita.
 */
export function sanitizeGrade(raw: string, max: number): string {
  let v = raw.replace(',', '.').replace(/[^0-9.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) {
    const intPart = v.slice(0, dot);
    const decPart = v.slice(dot + 1).replace(/\./g, '').slice(0, 2); // remove pontos extras, máx 2 casas
    v = `${intPart}.${decPart}`;
  }
  if (max > 0 && v !== '' && v !== '.' && Number(v) > max) v = String(max);
  return v;
}

export const RECOVERY_ACTIVITY_NAME = 'RECUPERAÇÃO';
export const RECOVERY_ACTIVITY: GradeActivity = { name: RECOVERY_ACTIVITY_NAME, max: 10 };

/** Atividades que compõem o crédito variável (somam 10 = 1 nota). */
export const CREDITO_ACTIVITIES: GradeActivity[] = [
  { name: 'PROJETO', max: 5, credito: true },
  { name: 'PESQUISA E APRESENTAÇÃO', max: 2, credito: true },
  { name: 'VISTOS', max: 2, credito: true },
  { name: 'SIMULADO', max: 1, credito: true },
];

/** Composição padrão (coordenação/professor ajusta por trimestre).
 * TESTE e E-CERM são notas cheias (10). As do crédito variável somam 10 = 1 nota. */
export const DEFAULT_ACTIVITIES: GradeActivity[] = [
  { name: 'TESTE', max: 10 },
  { name: 'E-CERM', max: 10 },
  ...CREDITO_ACTIVITIES,
  RECOVERY_ACTIVITY,
];

/** Chave reservada: valor digitado manualmente do Crédito variável (substitui a soma das atividades). */
export const CREDITO_OVERRIDE_KEY = '__credito__';

export function isRecoveryActivity(name: string): boolean {
  return name.trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase() === 'RECUPERACAO';
}

export function withRecoveryActivity(activities: GradeActivity[]): GradeActivity[] {
  const next = activities.some((activity) => isRecoveryActivity(activity.name)) ? activities : [...activities, RECOVERY_ACTIVITY];
  return orderGradeActivities(next);
}

/* ------------------------- Crédito variável (só EXIBIÇÃO) -----------------------
 * Por regra, PROJETO/PESQUISA/VISTOS/SIMULADO (e demais notas < 10) compõem UMA
 * única nota: o "Crédito variável" (vale 10). O cálculo já faz isso em calcMedia.
 * Estes helpers só COLAPSAM a exibição: em relatórios/seleção mostramos 1 coluna
 * "Crédito variável" no lugar da lista de atividades. NÃO alteram nenhum cálculo. */
export const CREDITO_COLUMN_NAME = 'Crédito variável';

/** Atividade que compõe o crédito variável: marcada `credito` ou nota < 10 (exceto recuperação). */
export function isCreditoActivity(a: GradeActivity): boolean {
  return !isRecoveryActivity(a.name) && (a.credito === true || a.max < 10);
}

/** Coluna virtual única do crédito variável (chave = CREDITO_OVERRIDE_KEY, vale 0–10). */
export function creditoColumn(): GradeActivity {
  return { id: CREDITO_OVERRIDE_KEY, name: CREDITO_COLUMN_NAME, max: 10, credito: true };
}

/** Colapsa as atividades de crédito numa única coluna "Crédito variável".
 *  Mantém as notas principais (>= 10) e a recuperação por último. Só exibição. */
export function collapseCreditoColumns(activities: GradeActivity[]): GradeActivity[] {
  const mains = activities.filter((a) => !isCreditoActivity(a) && !isRecoveryActivity(a.name));
  const recovery = activities.find((a) => isRecoveryActivity(a.name));
  const out = [...mains];
  if (activities.some(isCreditoActivity)) out.push(creditoColumn());
  if (recovery) out.push(recovery);
  return out;
}

/** Soma (0–10) do crédito variável de um aluno, a partir das notas por atividade. */
export function creditoSumFrom(
  getScore: (a: GradeActivity) => number | string | null | undefined,
  activities: GradeActivity[],
): number | null {
  const credits = activities.filter(isCreditoActivity);
  if (!credits.length) return null;
  let has = false;
  let sum = 0;
  for (const a of credits) {
    const v = getScore(a);
    if (v != null && String(v) !== '' && Number.isFinite(Number(v))) {
      sum += Number(v) || 0;
      has = true;
    }
  }
  return has ? Math.min(sum, 10) : null;
}

/** Ordem canônica das colunas: TESTE, E-CERM, depois crédito variável, RECUPERAÇÃO por último. */
function activityRank(a: GradeActivity): number {
  const n = a.name.trim().toUpperCase();
  if (isRecoveryActivity(a.name)) return 90;
  if (n === 'TESTE') return 0;
  if (n === 'E-CERM' || n === 'ECERM') return 1;
  if (a.credito) return 50; // crédito variável fica no meio, preservando a ordem entre si
  return 40;
}
export function orderGradeActivities(activities: GradeActivity[]): GradeActivity[] {
  // sort estável: mantém a ordem original dentro do mesmo rank
  return activities
    .map((a, i) => ({ a, i }))
    .sort((x, y) => activityRank(x.a) - activityRank(y.a) || x.i - y.i)
    .map((x) => x.a);
}

// Ano letivo: fevereiro a novembro, dividido em 3 trimestres.
export const TERMS = [1, 2, 3] as const;
export const TERM_LABEL: Record<number, string> = { 1: '1º trimestre', 2: '2º trimestre', 3: '3º trimestre' };
// Faixa de meses (0 = janeiro) de cada trimestre, para filtros de frequência.
export const TERM_MONTHS: Record<number, [number, number]> = { 1: [1, 4], 2: [5, 7], 3: [8, 10] };
// Ano letivo completo: fev (1) a nov (10).
export const SCHOOL_YEAR_MONTHS: [number, number] = [1, 10];
export const MEDIA_APROVACAO = 6;
export const MEDIA_DIVISOR = 3; // média = soma das notas / 3

/**
 * Monta as "notas" (buckets) a partir da composição:
 *  - atividades de valor cheio (max >= 10) contam como UMA nota cada (ex.: TESTE, E-CERM);
 *  - as menores (max < 10) SOMAM e viram UMA única nota (ex.: SIMULADO+PROJETO+CRÉDITO = 10).
 * Sem a composição, cada atividade lançada conta como uma nota (fallback).
 */
function gradeBuckets(scores: Record<string, number>, activities?: GradeActivity[]): number[] {
  if (activities && activities.length) {
    const mains: number[] = [];
    const small: number[] = [];
    for (const a of activities) {
      if (isRecoveryActivity(a.name)) continue;
      const v = Number(scores[actKey(a)]) || 0;
      if (a.max < 10) small.push(v);
      else mains.push(v);
    }
    const buckets = [...mains];
    // Crédito variável: valor digitado manualmente substitui a soma das atividades.
    const override = scores[CREDITO_OVERRIDE_KEY];
    if (override != null && String(override) !== '' && Number.isFinite(Number(override))) {
      buckets.push(Number(override));
    } else if (small.length) {
      buckets.push(small.reduce((x, y) => x + y, 0));
    }
    if (buckets.length) return buckets;
  }
  return Object.entries(scores)
    .filter(([name, value]) => !isRecoveryActivity(name) && Number.isFinite(Number(value)))
    .map(([, value]) => Number(value) || 0);
}

/**
 * Média final = soma das notas ÷ 3.
 * Recuperação: se a média ficar abaixo de 6, a nota de recuperação SUBSTITUI a MENOR
 * das notas (desde que seja maior que ela, ou seja, que melhore a média).
 */
export function calcMedia(scores: Record<string, number>, activities?: GradeActivity[]): number {
  const buckets = gradeBuckets(scores, activities);
  if (!buckets.length) return 0;

  const sum = buckets.reduce((a, b) => a + b, 0);
  const baseMedia = sum / MEDIA_DIVISOR;

  const recovery = Object.entries(scores).find(([name]) => isRecoveryActivity(name))?.[1];
  if (recovery != null && Number.isFinite(Number(recovery)) && baseMedia < MEDIA_APROVACAO) {
    const rec = Number(recovery) || 0;
    const lowestIndex = buckets.indexOf(Math.min(...buckets));
    if (lowestIndex >= 0 && rec > buckets[lowestIndex]) {
      const adjustedSum = sum - buckets[lowestIndex] + rec;
      return Math.round((adjustedSum / MEDIA_DIVISOR) * 10) / 10;
    }
  }
  return Math.round(baseMedia * 10) / 10;
}

export const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: 'Presente',
  absent: 'Ausente',
  late: 'Atrasado',
  justified: 'Justificado',
};
