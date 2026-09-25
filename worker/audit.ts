/**
 * Central de logs (auditoria). Um INSERT por ação — os nomes de turma/aluno/base/usuário
 * são resolvidos DENTRO do próprio INSERT (subselects), sem subrequests extras.
 * Nunca grava senhas nem conteúdo sensível: só rótulos, contagens e o alvo.
 */
import type { Ctx } from './auth';

export type LogStatus = 'ok' | 'erro' | 'negado';
export type Category = 'acesso' | 'cadastro' | 'chamada' | 'notas' | 'comunicacao' | 'equipe' | 'admin' | 'sistema';

/** Referências do alvo; o nome é buscado no banco no momento do registro. */
export interface Refs {
  classId?: string | null;
  studentId?: string | null;
  sessionId?: string | null;
  baseId?: string | null; // base alvo (ações do administrador)
  userId?: string | null; // usuário alvo (equipe)
  text?: string | null; // complemento livre ("3º tri · 28 alunos")
}

export interface LogEntry {
  action: string;
  category: Category;
  summary: string;
  status?: LogStatus;
  refs?: Refs;
  detail?: string | null;
  baseId?: string | null;
  userId?: string | null;
  email?: string | null;
  role?: string | null;
  ip?: string | null;
  device?: string | null;
}

const s = (v: unknown, max = 120) => (v == null || v === '' ? null : String(v).slice(0, max));
const n = (v: unknown) => (Array.isArray(v) ? v.length : 0);
const br = (iso: unknown) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null);
const ROLE_PT: Record<string, string> = { gestor: 'gestão', professor: 'professor(a)', secretaria: 'secretaria' };

export function insertLog(db: D1Database, e: LogEntry) {
  const r = e.refs ?? {};
  const targetBase = r.baseId ?? null;
  return db
    .prepare(
      `INSERT INTO audit_log (at, base_id, base_name, user_id, user_email, role, action, category, summary, target, status, detail, ip, device)
       SELECT ?1, ?2, (SELECT name FROM bases WHERE id = ?2), ?3, ?4, ?5, ?6, ?7, ?8,
              CASE WHEN t.n IS NULL THEN ?9 ELSE t.n || COALESCE(' · ' || ?9, '') END,
              ?10, ?11, ?12, ?13
         FROM (SELECT COALESCE(
                 (SELECT name FROM classes WHERE id = ?14),
                 (SELECT full_name FROM students WHERE id = ?15),
                 (SELECT c.name || ' · ' || substr(x.session_date, 9, 2) || '/' || substr(x.session_date, 6, 2) || '/' || substr(x.session_date, 1, 4)
                    FROM attendance_sessions x JOIN classes c ON c.id = x.class_id WHERE x.id = ?16),
                 (SELECT name FROM bases WHERE id = ?17),
                 (SELECT COALESCE(full_name, email) FROM users WHERE id = ?18)
               ) AS n) t`,
    )
    .bind(
      new Date().toISOString(),
      e.baseId ?? targetBase,
      e.userId ?? null,
      e.email ?? null,
      e.role ?? null,
      e.action,
      e.category,
      e.summary,
      s(r.text),
      e.status ?? 'ok',
      s(e.detail, 300),
      s(e.ip, 64),
      s(e.device, 60),
      r.classId ?? null,
      r.studentId ?? null,
      r.sessionId ?? null,
      targetBase,
      r.userId ?? null,
    )
    .run();
}

/** "Chrome · Windows", "Safari · iPhone"… — o suficiente para reconhecer o aparelho. */
export function deviceOf(ua: string | undefined | null): string | null {
  if (!ua) return null;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Outro';
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  return `${b} · ${os}`;
}

/* ------------------------------ Catálogo de ações ------------------------------- */
type Spec = {
  cat: Category;
  label: string | ((a: unknown[]) => string);
  refs?: (a: any[], ctx: Ctx) => Refs; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Registrar ANTES de executar (exclusões: o nome ainda existe). */
  pre?: boolean;
  result?: (r: any) => string | null; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const term = (t: unknown, y?: unknown) => `${t}º tri${y ? ` ${y}` : ''}`;

export const ACTIONS: Record<string, Spec> = {
  // Cadastros
  saveSchool: { cat: 'cadastro', label: 'Atualizou os dados da escola' },
  saveClass: { cat: 'cadastro', label: (a) => ((a[0] as { id?: string })?.id ? 'Editou turma' : 'Criou turma'), refs: (a) => ({ text: s(a[0]?.name) }) },
  deleteClass: { cat: 'cadastro', label: 'Excluiu turma', refs: (a) => ({ classId: a[0] }), pre: true },
  bulkDeleteClasses: { cat: 'cadastro', label: 'Excluiu turmas', refs: (a) => ({ text: `${n(a[0])} turma(s)` }) },
  saveStudent: { cat: 'cadastro', label: (a) => ((a[0] as { id?: string })?.id ? 'Editou aluno' : 'Cadastrou aluno'), refs: (a) => ({ text: s(a[0]?.full_name) }) },
  deleteStudent: { cat: 'cadastro', label: 'Excluiu aluno', refs: (a) => ({ studentId: a[0] }), pre: true },
  bulkDeleteStudents: { cat: 'cadastro', label: 'Excluiu alunos', refs: (a) => ({ text: `${n(a[0])} aluno(s)` }) },
  archiveStudent: { cat: 'cadastro', label: 'Arquivou aluno', refs: (a) => ({ studentId: a[0] }) },
  bulkImportAll: {
    cat: 'cadastro',
    label: 'Importou planilha de cadastros',
    refs: (a) => ({ text: `${n(a[0])} linha(s)` }),
    result: (r) => (r ? `${r.students ?? 0} aluno(s) e ${r.classes ?? 0} turma(s) criados${r.duplicates?.length ? `, ${r.duplicates.length} já existiam` : ''}` : null),
  },
  // Chamadas
  saveAttendance: {
    cat: 'chamada',
    label: 'Salvou chamada',
    refs: (a) => {
      const recs = Array.isArray(a[2]) ? (a[2] as { status?: string }[]) : [];
      const faltas = recs.filter((x) => x?.status === 'absent').length;
      return { classId: a[0], text: `${br(a[1]) ?? ''} · ${recs.length} aluno(s), ${faltas} falta(s)${a[3]?.examMode ? ' · modo prova' : ''}` };
    },
  },
  deleteAttendanceSession: { cat: 'chamada', label: 'Excluiu chamada', refs: (a) => ({ sessionId: a[0] }) },
  restoreAttendanceSession: { cat: 'chamada', label: 'Restaurou chamada da lixeira', refs: (a) => ({ sessionId: a[0] }) },
  purgeAttendanceSession: { cat: 'chamada', label: 'Apagou chamada definitivamente', refs: (a) => ({ sessionId: a[0] }), pre: true },
  // Notas
  saveTermConfig: { cat: 'notas', label: 'Alterou a composição das notas', refs: (a) => ({ text: term(a[1], a[0]) }) },
  saveTermGrades: { cat: 'notas', label: 'Lançou notas', refs: (a) => ({ classId: a[0], text: `${term(a[2], a[1])} · ${n(a[3])} aluno(s)` }) },
  bulkDeleteTermGrades: { cat: 'notas', label: 'Apagou notas', refs: (a) => ({ classId: a[0], text: `${term(a[2], a[1])} · ${n(a[3])} aluno(s)` }) },
  saveEvalConfig: { cat: 'notas', label: 'Alterou atividades avaliativas', refs: (a) => ({ classId: a[0], text: term(a[2], a[1]) }) },
  saveEvalGrades: { cat: 'notas', label: 'Lançou avaliações', refs: (a) => ({ classId: a[0], text: `${term(a[2], a[1])} · ${n(a[3])} aluno(s)` }) },
  bulkDeleteEvalGrades: { cat: 'notas', label: 'Apagou avaliações', refs: (a) => ({ classId: a[0], text: `${term(a[2], a[1])} · ${n(a[3])} aluno(s)` }) },
  applyCreditoToGrades: { cat: 'notas', label: 'Aplicou o crédito variável nas notas', refs: (a) => ({ classId: a[0], text: term(a[2], a[1]) }) },
  createSharedReport: { cat: 'notas', label: 'Gerou link público de relatório' },
  // Comunicação e planejamento
  sendNotice: { cat: 'comunicacao', label: 'Enviou aviso', refs: (a) => ({ text: s(a[0]?.title) }) },
  deleteNotice: { cat: 'comunicacao', label: 'Excluiu aviso' },
  createCalendar: { cat: 'comunicacao', label: 'Criou calendário', refs: (a) => ({ text: s(a[0]?.title) }) },
  saveCalendar: { cat: 'comunicacao', label: 'Editou calendário', refs: (a) => ({ text: s(a[0]?.title) }) },
  deleteCalendar: { cat: 'comunicacao', label: 'Excluiu calendário' },
  savePlan: { cat: 'comunicacao', label: 'Salvou planejamento', refs: (a) => ({ classId: a[0]?.class_id, text: s(a[0]?.title) }) },
  submitPlan: { cat: 'comunicacao', label: 'Enviou planejamento para revisão' },
  reviewPlan: { cat: 'comunicacao', label: (a) => (a[1] === 'aprovado' ? 'Aprovou planejamento' : 'Devolveu planejamento') },
  deletePlan: { cat: 'comunicacao', label: 'Excluiu planejamento' },
  sendPlanMessage: { cat: 'comunicacao', label: 'Comentou em planejamento' },
  updatePlanDoc: { cat: 'comunicacao', label: 'Editou documento de planejamento', refs: (a) => ({ text: s(a[1]?.name) }) },
  deletePlanDoc: { cat: 'comunicacao', label: 'Excluiu documento de planejamento' },
  // Conta e equipe
  updateProfile: { cat: 'acesso', label: 'Atualizou o próprio perfil' },
  changePassword: { cat: 'acesso', label: 'Trocou a senha' },
  setActiveOrg: { cat: 'admin', label: (a) => (a[0] ? 'Entrou em modo suporte' : 'Saiu do modo suporte'), refs: (a) => ({ baseId: a[0] ?? null }) },
  addMember: { cat: 'equipe', label: 'Adicionou membro à equipe', refs: (a) => ({ baseId: a[0], text: `${s(a[1]?.email) ?? ''} (${ROLE_PT[a[1]?.role] ?? a[1]?.role ?? ''})` }) },
  setMemberRole: { cat: 'equipe', label: 'Alterou o papel de membro', refs: (a) => ({ baseId: a[0], userId: a[1], text: ROLE_PT[a[2]] ?? s(a[2]) }) },
  removeMember: { cat: 'equipe', label: 'Removeu membro da equipe', refs: (a) => ({ baseId: a[0], userId: a[1] }), pre: true },
  resetMemberPassword: { cat: 'equipe', label: 'Redefiniu a senha de membro', refs: (a) => ({ baseId: a[0], userId: a[1] }) },
  setMemberContact: { cat: 'equipe', label: 'Atualizou contato de membro', refs: (a) => ({ userId: a[0] }) },
  // Administração da plataforma
  createBase: { cat: 'admin', label: 'Criou base', refs: (a) => ({ text: s(a[0]?.name) }) },
  updateOrganization: { cat: 'admin', label: 'Editou base', refs: (a) => ({ baseId: a[0] }) },
  setOrgActive: { cat: 'admin', label: (a) => (a[1] ? 'Reativou base' : 'Suspendeu base'), refs: (a) => ({ baseId: a[0] }) },
  deleteOrganization: { cat: 'admin', label: 'Excluiu base', refs: (a) => ({ baseId: a[0] }), pre: true },
};

export const labelOf = (spec: Spec, args: unknown[]) => (typeof spec.label === 'function' ? spec.label(args) : spec.label);

/** Ações de leitura que não entram no log (a não ser que deem erro/acesso negado). */
export const isSilent = (name: string) => !ACTIONS[name];
