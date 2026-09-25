import { calcMedia, isRecoveryActivity, MEDIA_APROVACAO, normalizeScores, type GradeActivity } from '../../src/lib/types';
import { requireBase, type Ctx } from '../auth';
import { all, parse } from '../db';
import { composeTermActs } from './notas';

/**
 * Central de alertas: cruza frequência, sequência de faltas, tendência recente,
 * notas e pendências da turma e devolve só o que pede ação, já priorizado.
 * Tudo em 6 consultas (limite de subrequests do plano gratuito) e cálculo leve.
 */
export type Severity = 'critical' | 'warning' | 'info';
export type SignalKind = 'freq_low' | 'freq_watch' | 'streak' | 'trend' | 'grade_low' | 'no_call' | 'missing_grades';
export interface Signal {
  kind: SignalKind;
  severity: Severity;
  label: string; // selo curto
  detail: string; // o que está acontecendo e o que fazer
}
export interface StudentAlert {
  key: string; // muda quando a situação muda (para "Ciente" não esconder uma piora)
  student_id: string;
  name: string;
  class_id: string;
  class_name: string;
  guardian_name: string | null;
  guardian_phone: string | null;
  severity: Severity;
  score: number;
  pct: number | null;
  media: number | null;
  signals: Signal[];
}
export interface ClassAlert {
  key: string;
  class_id: string;
  class_name: string;
  severity: Severity;
  signal: Signal;
}

const RANK: Record<Severity, number> = { critical: 3, warning: 2, info: 1 };
const worst = (list: Severity[]): Severity => list.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'info' as Severity);
const pctFmt = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const dayMinus = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
};

export async function smartAlerts(ctx: Ctx, year: number, today: string, minPct = 75, minSessions = 4) {
  const base = requireBase(ctx);
  const y = Number(year) || new Date().getFullYear();
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(today)) ? String(today) : new Date().toISOString().slice(0, 10);
  const min = Math.min(100, Math.max(1, Number(minPct) || 75));
  const recentFrom = dayMinus(day, 30);

  const [classes, students, att, sessions, grades, gradeTerms, evalTerms] = await Promise.all([
    all<{ id: string; name: string }>(ctx.db, 'SELECT id, name FROM classes WHERE base_id = ?', base),
    all<{ id: string; full_name: string; class_id: string; guardian_name: string | null; guardian_phone: string | null }>(ctx.db,
      `SELECT id, full_name, class_id, guardian_name, guardian_phone FROM students
        WHERE base_id = ? AND active = 1 AND class_id IS NOT NULL`, base),
    // Por aluno: presença no ano, janela dos últimos 30 dias e faltas seguidas desde a última presença.
    all<{ student_id: string; present: number; total: number; recent_total: number; recent_present: number; streak: number; justified: number }>(ctx.db,
      `WITH rec AS (
         SELECT r.student_id, s.session_date AS d, r.status,
                CASE WHEN r.status IN ('present','late') THEN 1 ELSE 0 END AS p
           FROM attendance_records r
           JOIN attendance_sessions s ON s.id = r.session_id AND s.deleted_at IS NULL
          WHERE r.base_id = ? AND substr(s.session_date, 1, 4) = ? AND s.session_date <= ?
       ), agg AS (
         SELECT student_id, SUM(p) AS present, COUNT(*) AS total,
                SUM(CASE WHEN status = 'justified' THEN 1 ELSE 0 END) AS justified,
                SUM(CASE WHEN d >= ? THEN 1 ELSE 0 END) AS recent_total,
                SUM(CASE WHEN d >= ? THEN p ELSE 0 END) AS recent_present,
                COALESCE(MAX(CASE WHEN p = 1 THEN d END), '') AS last_present
           FROM rec GROUP BY student_id
       ), tail AS (
         SELECT rec.student_id, COUNT(*) AS streak
           FROM rec JOIN agg ON agg.student_id = rec.student_id
          WHERE rec.status = 'absent' AND rec.d > agg.last_present
          GROUP BY rec.student_id
       )
       SELECT agg.student_id, agg.present, agg.total, agg.justified, agg.recent_total, agg.recent_present,
              COALESCE(tail.streak, 0) AS streak
         FROM agg LEFT JOIN tail ON tail.student_id = agg.student_id`,
      base, String(y), day, recentFrom, recentFrom),
    // Datas de chamada dos últimos 30 dias, por turma (para achar turmas esquecidas).
    all<{ class_id: string; session_date: string }>(ctx.db,
      `SELECT class_id, session_date FROM attendance_sessions
        WHERE base_id = ? AND deleted_at IS NULL AND session_date BETWEEN ? AND ?`,
      base, recentFrom, day),
    all<{ class_id: string; student_id: string; term: number; scores: string }>(ctx.db,
      'SELECT class_id, student_id, term, scores FROM term_grades WHERE base_id = ? AND year = ?', base, y),
    all<{ term: number; activities: string }>(ctx.db, 'SELECT term, activities FROM grade_terms WHERE base_id = ? AND year = ?', base, y),
    all<{ class_id: string; term: number; activities: string }>(ctx.db,
      'SELECT class_id, term, activities FROM evaluation_terms WHERE base_id = ? AND year = ?', base, y),
  ]);

  const className = new Map(classes.map((c) => [c.id, c.name]));
  const studentsByClass = new Map<string, number>();
  for (const s of students) studentsByClass.set(s.class_id, (studentsByClass.get(s.class_id) ?? 0) + 1);
  const attBy = new Map(att.map((a) => [a.student_id, a]));

  /* ----------------------------- Notas: trimestre atual ----------------------------- */
  // Trimestre atual da turma = o último com notas lançadas.
  const currentTerm = new Map<string, number>();
  for (const g of grades) currentTerm.set(g.class_id, Math.max(currentTerm.get(g.class_id) ?? 0, g.term));
  const actsCache = new Map<string, GradeActivity[]>();
  const actsFor = (classId: string, term: number) => {
    const k = `${classId}:${term}`;
    if (!actsCache.has(k)) {
      actsCache.set(k, composeTermActs(
        gradeTerms.find((t) => t.term === term)?.activities,
        evalTerms.find((t) => t.class_id === classId && t.term === term)?.activities,
      ));
    }
    return actsCache.get(k)!;
  };
  const gradeBy = new Map<string, { media: number; term: number; hasRecovery: boolean }>();
  const gradedCount = new Map<string, number>();
  for (const g of grades) {
    if (g.term !== currentTerm.get(g.class_id)) continue;
    const acts = actsFor(g.class_id, g.term);
    const raw = parse<Record<string, number>>(g.scores, {});
    const scores = normalizeScores(raw, acts);
    const filled = Object.entries(scores).filter(([k, v]) => !isRecoveryActivity(k) && v != null && Number.isFinite(Number(v)));
    if (!filled.length) continue;
    gradedCount.set(g.class_id, (gradedCount.get(g.class_id) ?? 0) + 1);
    const hasRecovery = Object.entries(scores).some(([k, v]) => isRecoveryActivity(k) && v != null && Number.isFinite(Number(v)));
    gradeBy.set(g.student_id, { media: calcMedia(scores, acts), term: g.term, hasRecovery });
  }

  /* ------------------------------------ Alunos ------------------------------------ */
  const studentAlerts: StudentAlert[] = [];
  for (const s of students) {
    const signals: Signal[] = [];
    const a = attBy.get(s.id);
    let pct: number | null = null;

    if (a && a.total >= minSessions) {
      pct = Math.round((a.present / a.total) * 1000) / 10;
      const need = Math.ceil(((min / 100) * a.total - a.present) / (1 - min / 100));
      const canMiss = Math.floor(a.present / (min / 100) - a.total);
      if (pct < min) {
        signals.push({
          kind: 'freq_low',
          severity: pct < min - 10 ? 'critical' : 'warning',
          label: `Frequência ${pctFmt(pct)}`,
          detail: `${plural(a.total - a.present, 'falta', 'faltas')} em ${a.total} aulas. Precisa de ${plural(need, 'presença seguida', 'presenças seguidas')} para voltar a ${min}%.`,
        });
      } else if (canMiss <= 2) {
        signals.push({
          kind: 'freq_watch',
          severity: 'info',
          label: `No limite · ${pctFmt(pct)}`,
          detail: canMiss <= 0 ? `A próxima falta deixa abaixo de ${min}%.` : `Pode faltar só mais ${plural(canMiss, 'aula', 'aulas')} antes de ficar abaixo de ${min}%.`,
        });
      }
      if (a.recent_total >= 4) {
        const recent = Math.round((a.recent_present / a.recent_total) * 1000) / 10;
        if (recent < min && recent <= pct - 15) {
          signals.push({
            kind: 'trend',
            severity: 'warning',
            label: 'Queda recente',
            detail: `${pctFmt(recent)} de presença nos últimos 30 dias (no ano: ${pctFmt(pct)}).`,
          });
        }
      }
    }
    if (a && a.streak >= 3) {
      signals.push({
        kind: 'streak',
        severity: a.streak >= 5 ? 'critical' : 'warning',
        label: `${a.streak} faltas seguidas`,
        detail: a.streak >= 5 ? 'Risco de abandono. Fale com a família.' : 'Faltou nas últimas aulas sem justificativa.',
      });
    }

    const g = gradeBy.get(s.id);
    if (g && g.media < MEDIA_APROVACAO) {
      signals.push({
        kind: 'grade_low',
        severity: 'warning',
        label: `Média ${g.media.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} no ${g.term}º tri`,
        detail: g.hasRecovery ? 'Abaixo da média mesmo com a recuperação.' : 'Abaixo da média. Recuperação ainda não lançada.',
      });
    }

    if (!signals.length) continue;
    let severity = worst(signals.map((x) => x.severity));
    // Falta + nota baixa juntas = risco real de reprovação.
    const lowFreq = signals.some((x) => x.kind === 'freq_low' || x.kind === 'streak');
    if (lowFreq && signals.some((x) => x.kind === 'grade_low')) severity = 'critical';
    const score = RANK[severity] * 1000 + signals.length * 100 + (pct != null ? Math.max(0, 100 - pct) : 0) + (a?.streak ?? 0) * 5;
    studentAlerts.push({
      key: `${s.id}:${signals.map((x) => `${x.kind}.${x.severity}${x.kind === 'streak' ? `.${a?.streak}` : ''}`).join(',')}`,
      student_id: s.id,
      name: s.full_name,
      class_id: s.class_id,
      class_name: className.get(s.class_id) ?? 'Turma',
      guardian_name: s.guardian_name,
      guardian_phone: s.guardian_phone,
      severity,
      score,
      pct,
      media: g?.media ?? null,
      signals,
    });
  }
  studentAlerts.sort((x, y) => y.score - x.score || x.name.localeCompare(y.name, 'pt-BR'));

  /* ------------------------------------ Turmas ------------------------------------ */
  const classAlerts: ClassAlert[] = [];
  // Chamada esquecida: dias em que a escola fez chamada em outras turmas, mas não nesta.
  const baseDays = [...new Set(sessions.map((x) => x.session_date))];
  const lastByClass = new Map<string, string>();
  for (const x of sessions) if ((lastByClass.get(x.class_id) ?? '') < x.session_date) lastByClass.set(x.class_id, x.session_date);
  for (const c of classes) {
    if (!studentsByClass.get(c.id)) continue;
    const last = lastByClass.get(c.id);
    if (!last) continue; // turma sem chamada nos últimos 30 dias: provavelmente fora de período
    const missed = baseDays.filter((d) => d > last).length;
    if (missed >= 2) {
      classAlerts.push({
        key: `call:${c.id}:${last}`,
        class_id: c.id,
        class_name: c.name,
        severity: missed >= 5 ? 'critical' : 'warning',
        signal: {
          kind: 'no_call',
          severity: missed >= 5 ? 'critical' : 'warning',
          label: 'Chamada atrasada',
          detail: `Última chamada em ${last.split('-').reverse().join('/')}. Outras turmas já fizeram ${plural(missed, 'chamada', 'chamadas')} depois disso.`,
        },
      });
    }
  }
  // Notas incompletas no trimestre atual.
  for (const [classId, term] of currentTerm) {
    const total = studentsByClass.get(classId) ?? 0;
    const done = gradedCount.get(classId) ?? 0;
    const missing = total - done;
    if (done > 0 && missing > 0) {
      classAlerts.push({
        key: `grades:${classId}:${term}:${missing}`,
        class_id: classId,
        class_name: className.get(classId) ?? 'Turma',
        severity: 'info',
        signal: {
          kind: 'missing_grades',
          severity: 'info',
          label: `Notas incompletas · ${term}º tri`,
          detail: `${plural(missing, 'aluno ainda sem nota', 'alunos ainda sem nota')} (${done} de ${total} lançados).`,
        },
      });
    }
  }
  classAlerts.sort((x, y) => RANK[y.severity] - RANK[x.severity] || x.class_name.localeCompare(y.class_name, 'pt-BR'));

  return { minPct: min, media: MEDIA_APROVACAO, students: studentAlerts, classes: classAlerts };
}
