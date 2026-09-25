/**
 * Camada única de dados do app. Cada função chama a operação de mesmo nome no
 * servidor (worker/handlers/*), que valida permissão e isola os dados por base.
 * As telas continuam importando daqui exatamente como antes.
 */
import { apiGet, rpc, upload } from './api';
import { assertUploadFile } from './fileSecurity';
import type {
  AppRole,
  AttendanceRecord,
  AttendanceSession,
  CalendarBuilderData,
  ClassRoom,
  GradeActivity,
  LessonPlan,
  Notice,
  NoticeAttachment,
  NoticeAudience,
  OrgPerson,
  PlanAttachment,
  PlanDoc,
  PlanMessage,
  PlanStatus,
  Profile,
  ReportPayload,
  School,
  Student,
  WeeklyPlanData,
} from './types';

/* ----------------------------------- Escola (= base) ----------------------------- */
export const listSchools = () => rpc<School[]>('listSchools');
export const saveSchool = (input: Partial<School> & { name: string }) => rpc<School>('saveSchool', input);

/* ----------------------------------- Turmas ------------------------------------ */
export const listClasses = () => rpc<ClassRoom[]>('listClasses');
export const saveClass = (input: Partial<ClassRoom> & { name: string }) => rpc<ClassRoom>('saveClass', input);
export const deleteClass = (id: string) => rpc<void>('deleteClass', id);
export const bulkDeleteClasses = (ids: string[]) => rpc<void>('bulkDeleteClasses', ids);

/* ----------------------------------- Alunos ------------------------------------ */
export const listStudents = () => rpc<Student[]>('listStudents');
export const listStudentsByClass = (classId: string) => rpc<Student[]>('listStudentsByClass', classId);
export const saveStudent = (input: Partial<Student> & { full_name: string }) => rpc<Student>('saveStudent', input);
export const deleteStudent = (id: string) => rpc<void>('deleteStudent', id);
export const archiveStudent = (id: string) => rpc<void>('archiveStudent', id);
export const bulkDeleteStudents = (ids: string[]) => rpc<void>('bulkDeleteStudents', ids);

export interface ImportAllResult {
  schools: number;
  classes: number;
  students: number;
  duplicates: string[];
}
/** Importação inteligente: uma planilha cria turmas e alunos conforme preenchido. */
export const bulkImportAll = (rows: Record<string, string>[]) => rpc<ImportAllResult>('bulkImportAll', rows);

export function importResultToModal(r: ImportAllResult): { created: number; note?: string; duplicates?: string[] } {
  return { created: r.students, note: r.classes ? `Também criou ${r.classes} turma(s).` : undefined, duplicates: r.duplicates };
}

/* ---------------------------------- Chamadas ----------------------------------- */
export const getSession = (classId: string, date: string) => rpc<AttendanceSession | null>('getSession', classId, date);
export const getRecords = (sessionId: string) => rpc<AttendanceRecord[]>('getRecords', sessionId);
export const saveAttendance = (classId: string, date: string, records: AttendanceRecord[], opts?: { note?: string; examMode?: boolean }) =>
  rpc<void>('saveAttendance', classId, date, records, opts);

export interface RecentSession {
  id: string;
  class_id: string;
  session_date: string;
  present: number;
  absent: number;
  total: number;
}
export const listRecentSessions = (limit = 10) => rpc<RecentSession[]>('listRecentSessions', limit);
export const deleteAttendanceSession = (id: string) => rpc<void>('deleteAttendanceSession', id);
export const restoreAttendanceSession = (id: string) => rpc<void>('restoreAttendanceSession', id);
export const purgeAttendanceSession = (id: string) => rpc<void>('purgeAttendanceSession', id);
export const listDeletedSessions = (limit = 50) => rpc<(RecentSession & { deleted_at: string | null })[]>('listDeletedSessions', limit);

export interface AttendanceAlert {
  student_id: string;
  name: string;
  class_id: string | null;
  pct: number;
  absent: number;
  total: number;
}
export const listAttendanceAlerts = (minPct = 75, year = new Date().getFullYear(), minSessions = 4) =>
  rpc<AttendanceAlert[]>('listAttendanceAlerts', minPct, year, minSessions);

/* Central de alertas (frequência, faltas seguidas, queda recente, notas, pendências de turma). */
export type AlertSeverity = 'critical' | 'warning' | 'info';
export interface AlertSignal {
  kind: 'freq_low' | 'freq_watch' | 'streak' | 'trend' | 'grade_low' | 'no_call' | 'missing_grades';
  severity: AlertSeverity;
  label: string;
  detail: string;
}
export interface StudentAlert {
  key: string;
  student_id: string;
  name: string;
  class_id: string;
  class_name: string;
  guardian_name: string | null;
  guardian_phone: string | null;
  severity: AlertSeverity;
  score: number;
  pct: number | null;
  media: number | null;
  signals: AlertSignal[];
}
export interface ClassAlert {
  key: string;
  class_id: string;
  class_name: string;
  severity: AlertSeverity;
  signal: AlertSignal;
}
export interface SmartAlerts {
  minPct: number;
  media: number;
  students: StudentAlert[];
  classes: ClassAlert[];
}
export const smartAlerts = (minPct = 75) => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return rpc<SmartAlerts>('smartAlerts', d.getFullYear(), today, minPct);
};

export interface AttendanceReportRow {
  student_id: string;
  name: string;
  present: number;
  absent: number;
  total: number;
  pct: number;
  absentDates: string[];
  days?: Record<string, boolean>;
}
export interface AttendanceReport {
  sessions: number;
  rows: AttendanceReportRow[];
  examDates?: string[];
  dates?: string[];
}
export const reportAttendance = (classId: string, from: string, to: string) => rpc<AttendanceReport>('reportAttendance', classId, from, to);

/* ----------------------------- Notas por trimestre ----------------------------- */
export const getTermConfig = (year: number, term: number) => rpc<GradeActivity[]>('getTermConfig', year, term);
export const getSavedTermConfig = (year: number, term: number) => rpc<GradeActivity[]>('getSavedTermConfig', year, term);
export const saveTermConfig = (year: number, term: number, activities: GradeActivity[]) => rpc<void>('saveTermConfig', year, term, activities);

export interface TermGradeRow {
  student_id: string;
  scores: Record<string, number>;
  observacao?: string | null;
  updated_at?: string | null;
}
export const listTermGrades = (classId: string, year: number, term: number) => rpc<TermGradeRow[]>('listTermGrades', classId, year, term);
export const saveTermGrades = (classId: string, year: number, term: number, rows: TermGradeRow[]) =>
  rpc<void>('saveTermGrades', classId, year, term, rows);
export const bulkDeleteTermGrades = (classId: string, year: number, term: number, studentIds: string[]) =>
  rpc<void>('bulkDeleteTermGrades', classId, year, term, studentIds);

/* ------------------------- Central de Avaliações (sem média) -------------------- */
export interface EvalMark {
  done: boolean;
  score: number | null;
}
export interface EvalGradeRow {
  student_id: string;
  marks: Record<string, EvalMark>;
  updated_at?: string | null;
}
export const getEvalConfig = (classId: string, year: number, term: number) => rpc<GradeActivity[]>('getEvalConfig', classId, year, term);
export const saveEvalConfig = (classId: string, year: number, term: number, activities: GradeActivity[]) =>
  rpc<void>('saveEvalConfig', classId, year, term, activities);
export const listEvalGrades = (classId: string, year: number, term: number) => rpc<EvalGradeRow[]>('listEvalGrades', classId, year, term);
export const saveEvalGrades = (classId: string, year: number, term: number, rows: EvalGradeRow[]) =>
  rpc<void>('saveEvalGrades', classId, year, term, rows);
export const bulkDeleteEvalGrades = (classId: string, year: number, term: number, studentIds: string[]) =>
  rpc<void>('bulkDeleteEvalGrades', classId, year, term, studentIds);

export interface CreditoData {
  defs: GradeActivity[];
  byStudent: Record<string, Record<string, number>>;
}
export const getCreditoData = (classId: string, year: number, term: number) => rpc<CreditoData>('getCreditoData', classId, year, term);
export const applyCreditoToGrades = (classId: string, year: number, term: number) => rpc<number>('applyCreditoToGrades', classId, year, term);

/* --------------------------------- Relatórios ---------------------------------- */
export const createSharedReport = (payload: ReportPayload) => rpc<string>('createSharedReport', payload);
export const getSharedReport = async (id: string) =>
  (await apiGet<{ data: ReportPayload | null }>(`/api/public/reports/${encodeURIComponent(id)}`)).data;

export interface TermsReportRow {
  student_id: string;
  name: string;
  terms: (number | null)[];
  final: number | null;
}
export const reportTerms = (classId: string, year: number) => rpc<TermsReportRow[]>('reportTerms', classId, year);

export interface TermActivityRow {
  student_id: string;
  name: string;
  activities: Record<string, number | null>;
  termAvg: number | null;
}
export const reportTermDetails = (classId: string, year: number, term: number) =>
  rpc<{ activities: GradeActivity[]; rows: TermActivityRow[] }>('reportTermDetails', classId, year, term);

/* ----------------------------------- Perfil ------------------------------------ */
export const getProfile = (_userId?: string) => rpc<Profile>('getProfile');
export const updateProfile = (_userId: string, input: Partial<Profile> & { phone?: string | null }) => rpc<Profile>('updateProfile', input);
export const changePassword = (current: string, next: string) => rpc<void>('changePassword', current, next);
/** Troca a base ativa (quem participa de mais de uma, ou o administrador dando suporte). */
export const setActiveOrg = (baseId: string | null) => rpc<void>('setActiveOrg', baseId);

/* --------------------------- Equipe da base (gestor/admin) ---------------------- */
export interface OrgMember {
  user_id: string;
  role: AppRole;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  last_login_at: string | null;
  must_change_pw: number;
}
export const listOrgMembers = (baseId: string) => rpc<OrgMember[]>('listOrgMembers', baseId);
/** Cria a conta (senha provisória devolvida uma única vez) ou vincula e-mail já existente. */
export const addMember = (baseId: string, input: { email: string; full_name?: string; role: AppRole }) =>
  rpc<{ userId: string; email: string; password: string | null }>('addMember', baseId, input);
export const setMemberRole = (baseId: string, userId: string, role: AppRole) => rpc<void>('setMemberRole', baseId, userId, role);
export const removeMember = (baseId: string, userId: string) => rpc<void>('removeMember', baseId, userId);
export const resetMemberPassword = (baseId: string, userId: string) => rpc<{ password: string }>('resetMemberPassword', baseId, userId);

/* ------------------------------ Administrador (você) ---------------------------- */
export interface OrgAdmin {
  id: string;
  name: string;
  cnpj: string | null;
  city: string | null;
  plan: string;
  max_students: number | null;
  active: boolean;
  notes: string | null;
  created_at: string;
  students: number;
  classes: number;
  members: number;
  last_attendance: string | null;
  last_login: string | null;
  has_logo: boolean;
}
export interface HqStats {
  bases: number;
  bases_active: number;
  students: number;
  users: number;
  sessions_30d: number;
}
export const listOrgAdmin = () => rpc<OrgAdmin[]>('listOrgAdmin');
export const hqStats = () => rpc<HqStats>('hqStats');
export const createBase = (input: { name: string; city?: string; plan?: string; max_students?: number | null; subject?: string; manager_name: string; manager_email: string }) =>
  rpc<{ id: string; userId: string; email: string; password: string | null }>('createBase', input);
export const updateOrganization = (id: string, input: { name?: string; cnpj?: string | null; plan?: string; max_students?: number | null; notes?: string | null; city?: string | null }) =>
  rpc<void>('updateOrganization', id, input);
export const setOrgActive = (id: string, active: boolean) => rpc<void>('setOrgActive', id, active);
export const deleteOrganization = (id: string) => rpc<void>('deleteOrganization', id);

/* ----------------------------------- Avisos ------------------------------------- */
export interface NoticeInput {
  title: string;
  body: string;
  audience: NoticeAudience;
  target_role?: AppRole | null;
  target_user?: string | null;
}
export const listOrgPeople = () => rpc<OrgPerson[]>('listOrgPeople');
export const sendNotice = (input: NoticeInput) => rpc<string>('sendNotice', input);
export async function uploadNoticeAttachment(noticeId: string, file: File): Promise<void> {
  assertUploadFile(file);
  await upload('/api/files', file, { owner_type: 'notice', owner_id: noticeId });
}
export const deleteNotice = (id: string) => rpc<void>('deleteNotice', id);
export const markNoticeRead = (id: string) => rpc<void>('markNoticeRead', id);

export interface ReceivedNotice extends Notice {
  read: boolean;
  attachments: NoticeAttachment[];
  authorName: string | null;
  authorRole: AppRole | null;
}
export interface SentNotice extends Notice {
  reads: number;
  attachments: NoticeAttachment[];
}
export const listReceivedNotices = (_userId?: string) => rpc<ReceivedNotice[]>('listReceivedNotices');
export const listSentNotices = (_userId?: string) => rpc<SentNotice[]>('listSentNotices');
export const unreadNoticeCount = (_userId?: string) => rpc<number>('unreadNoticeCount');

/* --------------------------------- Calendário ----------------------------------- */
export interface UpcomingEvent {
  id: string;
  title: string;
  event_date: string;
  end_date: string | null;
  category: string;
  color: string;
}
/** Próximos eventos de todos os calendários da base (Início). */
export const listUpcomingEvents = (limit = 6) => rpc<UpcomingEvent[]>('listUpcomingEvents', limit);

export interface CalendarSummary {
  id: string;
  title: string;
  editors: string[];
  version: number;
  createdBy: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
  createdAt: string | null;
}
export interface CalendarFull extends CalendarSummary {
  data: CalendarBuilderData;
}
export const CALENDAR_CONFLICT = 'CALENDAR_CONFLICT';
export const listCalendars = () => rpc<CalendarSummary[]>('listCalendars');
export const loadCalendar = (id: string) => rpc<CalendarFull | null>('loadCalendar', id);
export const createCalendar = (args: { data: CalendarBuilderData; title: string; creatorId?: string | null; creatorName?: string | null }) =>
  rpc<string>('createCalendar', { data: args.data, title: args.title });
export const saveCalendar = (args: {
  id: string;
  data: CalendarBuilderData;
  title: string;
  editors: string[];
  expectedVersion: number;
  updaterId?: string | null;
  updaterName?: string | null;
}) =>
  rpc<{ version: number; updatedByName: string | null; updatedAt: string | null }>('saveCalendar', {
    id: args.id,
    data: args.data,
    title: args.title,
    editors: args.editors,
    expectedVersion: args.expectedVersion,
  });
export const deleteCalendar = (id: string) => rpc<void>('deleteCalendar', id);

/* ---------------------------------- Planejamento -------------------------------- */
export interface PlanInput {
  id?: string;
  title: string;
  class_id?: string | null;
  week_start?: string | null;
  content: string;
  plan_data?: WeeklyPlanData | null;
}
export interface PlanWithMeta extends LessonPlan {
  attachments: PlanAttachment[];
  authorName: string | null;
  authorEmail: string | null;
  authorPhone: string | null;
  className: string | null;
}
export const savePlan = (input: PlanInput) => rpc<string>('savePlan', input);
export const submitPlan = (id: string) => rpc<void>('submitPlan', id);
export const reviewPlan = (id: string, status: 'aprovado' | 'devolvido', feedback: string) => rpc<void>('reviewPlan', id, status, feedback);
export const deletePlan = (id: string) => rpc<void>('deletePlan', id);
export async function uploadPlanAttachment(planId: string, file: File): Promise<void> {
  assertUploadFile(file);
  await upload('/api/files', file, { owner_type: 'plan', owner_id: planId });
}
export const listMyPlans = (_userId?: string) => rpc<PlanWithMeta[]>('listMyPlans');
export const listOrgPlans = (status?: PlanStatus) => rpc<PlanWithMeta[]>('listOrgPlans', status);
export const listReviewedPlans = () => rpc<PlanWithMeta[]>('listReviewedPlans');
export const getPlanAttachments = (planId: string) => rpc<{ title: string; files: { name: string; url: string }[] }>('getPlanAttachments', planId);
export const setMemberContact = (userId: string, phone: string, email?: string) => rpc<void>('setMemberContact', userId, phone, email);

export const listPlanMessages = (planId: string) => rpc<PlanMessage[]>('listPlanMessages', planId);
export const sendPlanMessage = (planId: string, body: string) => rpc<void>('sendPlanMessage', planId, body);
export const planUnreadCounts = () => rpc<Record<string, number>>('planUnreadCounts');
export const markPlanRead = (planId: string) => rpc<void>('markPlanRead', planId);

export const listPlanDocs = () => rpc<PlanDoc[]>('listPlanDocs');
export async function uploadPlanDoc(args: { segment: string; term: number | null; classId: string | null; turmaLabel: string | null; file: File }) {
  assertUploadFile(args.file);
  await upload('/api/plandocs', args.file, { segment: args.segment, term: args.term, class_id: args.classId, turma_label: args.turmaLabel });
}
export const updatePlanDoc = (id: string, patch: { name?: string; segment?: string; term?: number | null; class_id?: string | null; turma_label?: string | null }) =>
  rpc<void>('updatePlanDoc', id, patch);
export const deletePlanDoc = (doc: { id: string; path: string }) => rpc<void>('deletePlanDoc', { id: doc.id });

/* ----------------------------------- Início ------------------------------------- */
export const dashboardCounts = () => rpc<{ schools: number; classes: number; students: number }>('dashboardCounts');

/* ------------------------------ Central de logs (admin) ------------------------------ */
export type LogStatus = 'ok' | 'erro' | 'negado';
export interface LogRow {
  id: number;
  at: string;
  base_id: string | null;
  base_name: string | null;
  user_email: string | null;
  role: string | null;
  action: string;
  category: string;
  summary: string;
  target: string | null;
  status: LogStatus;
  detail: string | null;
  ip: string | null;
  device: string | null;
}
export interface LogFilters {
  period?: '24h' | '7d' | '30d' | '90d' | 'all';
  baseId?: string | null;
  category?: string | null;
  status?: LogStatus | 'problemas' | null;
  q?: string | null;
  before?: number | null;
}
export const listLogs = (f: LogFilters, limit = 60) => rpc<{ rows: LogRow[]; next: number | null }>('listLogs', f, limit);
export interface LogOverview {
  logins24h: number;
  failed24h: number;
  errors24h: number;
  denied24h: number;
  actions24h: number;
  users7d: number;
  suspicious: { user_email: string; n: number; ips: string | null; last: string; exists_user: boolean }[];
  bases: { id: string; name: string; active: boolean; last: string | null; actions7d: number }[];
}
export const logOverview = () => rpc<LogOverview>('logOverview');

/* ------------------------- Provas (gabarito e correção pela câmera) ------------------------- */
export interface Exam {
  id: string;
  class_id: string;
  class_name?: string;
  code: string;
  title: string;
  exam_date: string | null;
  questions: number;
  choices: number;
  answer_key: string[];
  points: number;
  created_at: string;
  updated_at: string | null;
}
export interface ExamListItem extends Exam {
  class_name: string;
  students: number;
  corrected: number;
  average: number | null;
}
export interface ExamDetail {
  exam: Exam & { class_name: string };
  students: { id: string; name: string; short: string }[];
  answers: { student_id: string; answers: string[]; source: string; updated_at: string }[];
}
export type ExamInput = {
  id?: string;
  class_id: string;
  title: string;
  exam_date?: string | null;
  questions: number;
  choices: number;
  points: number;
  answer_key?: string[];
};
export const listExams = () => rpc<ExamListItem[]>('listExams');
export const getExam = (id: string) => rpc<ExamDetail>('getExam', id);
export const getExamByCode = (code: string) => rpc<ExamDetail>('getExamByCode', code);
export const saveExam = (input: ExamInput) => rpc<ExamDetail>('saveExam', input);
export const deleteExam = (id: string) => rpc<void>('deleteExam', id);
export const saveExamAnswer = (examId: string, studentId: string, answers: string[], source: 'camera' | 'manual') =>
  rpc<{ correct: number; total: number; score: number }>('saveExamAnswer', examId, studentId, answers, source);
export const deleteExamAnswer = (examId: string, studentId: string) => rpc<void>('deleteExamAnswer', examId, studentId);
export const examGradeTargets = (examId: string, year: number, term: number) =>
  rpc<{ key: string; name: string; max: number; filled: number }[]>('examGradeTargets', examId, year, term);
export const sendExamToGrades = (examId: string, year: number, term: number, key: string) =>
  rpc<{ sent: number; column: string; max: number }>('sendExamToGrades', examId, year, term, key);
