import { assertClassInBase, requireBase, requireRole, type Ctx, type Role } from '../auth';
import { all, fail, first, inList, json, now, parse, run, stmt, uid } from '../db';

/* ------------------------------ Pessoas da base ---------------------------------- */
export async function listOrgPeople(ctx: Ctx) {
  const base = requireBase(ctx);
  return all<{ user_id: string; full_name: string | null; role: Role; email: string | null; phone: string | null }>(ctx.db,
    `SELECT u.id AS user_id, u.full_name, m.role, u.email, u.phone
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.base_id = ? ORDER BY u.full_name COLLATE NOCASE`, base);
}

/* ------------------------------------ Arquivos ----------------------------------- */
export type FileRow = { id: string; owner_id: string; name: string; mime: string | null };
export const fileUrl = (id: string) => `/api/files/${id}`;

export async function filesOf(ctx: Ctx, ownerType: 'notice' | 'plan', ownerIds: string[]) {
  const map = new Map<string, { id: string; name: string; path: string; mime: string | null; url: string }[]>();
  if (!ownerIds.length) return map;
  const rows = await all<FileRow>(ctx.db,
    `SELECT id, owner_id, name, mime FROM files WHERE owner_type = ? AND owner_id IN ${inList} ORDER BY created_at`,
    ownerType, json(ownerIds));
  for (const f of rows) {
    const l = map.get(f.owner_id) ?? [];
    l.push({ id: f.id, name: f.name, path: f.id, mime: f.mime, url: fileUrl(f.id) });
    map.set(f.owner_id, l);
  }
  return map;
}

/** Remove os anexos de um dono; o conteúdo no KV vai para a fila kv_trash (rotina diária). */
export async function purgeFiles(ctx: Ctx, ownerType: 'notice' | 'plan', ownerId: string) {
  await ctx.db.batch([
    stmt(ctx.db, 'INSERT OR IGNORE INTO kv_trash (id) SELECT id FROM files WHERE owner_type = ? AND owner_id = ?', ownerType, ownerId),
    stmt(ctx.db, 'DELETE FROM files WHERE owner_type = ? AND owner_id = ?', ownerType, ownerId),
  ]);
}

/* ------------------------------------- Avisos ------------------------------------ */
type NoticeRow = {
  id: string; base_id: string; author_id: string; title: string; body: string;
  audience: 'all' | 'role' | 'user'; target_role: string | null; target_user: string | null; created_at: string;
};

export async function sendNotice(ctx: Ctx, input: { title: string; body: string; audience: string; target_role?: string | null; target_user?: string | null }) {
  const base = requireRole(ctx, 'gestor', 'secretaria');
  const title = String(input.title || '').trim();
  if (!title) fail('Informe o título do aviso.');
  const audience = ['all', 'role', 'user'].includes(input.audience) ? input.audience : 'all';
  const id = uid();
  await run(ctx.db,
    'INSERT INTO notices (id, base_id, author_id, title, body, audience, target_role, target_user) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id, base, ctx.user.id, title, String(input.body ?? ''), audience,
    audience === 'role' ? input.target_role ?? null : null, audience === 'user' ? input.target_user ?? null : null);
  return id;
}

export async function deleteNotice(ctx: Ctx, id: string) {
  const base = requireBase(ctx);
  const n = await first<NoticeRow>(ctx.db, 'SELECT * FROM notices WHERE id = ? AND base_id = ?', id, base);
  if (!n) return;
  if (n.author_id !== ctx.user.id) requireRole(ctx, 'gestor');
  await purgeFiles(ctx, 'notice', id);
  await run(ctx.db, 'DELETE FROM notices WHERE id = ?', id);
}

export async function markNoticeRead(ctx: Ctx, id: string) {
  requireBase(ctx);
  await run(ctx.db, 'INSERT OR IGNORE INTO notice_reads (notice_id, user_id) VALUES (?, ?)', id, ctx.user.id);
}

async function visibleNotices(ctx: Ctx) {
  const base = requireBase(ctx);
  if (ctx.role === 'superadmin') {
    return all<NoticeRow>(ctx.db, 'SELECT * FROM notices WHERE base_id = ? ORDER BY created_at DESC', base);
  }
  return all<NoticeRow>(ctx.db,
    `SELECT * FROM notices WHERE base_id = ?
        AND (audience = 'all' OR (audience = 'role' AND target_role = ?) OR (audience = 'user' AND target_user = ?) OR author_id = ?)
      ORDER BY created_at DESC`,
    base, ctx.role, ctx.user.id, ctx.user.id);
}

export async function listReceivedNotices(ctx: Ctx) {
  const notices = (await visibleNotices(ctx)).filter((n) => n.author_id !== ctx.user.id);
  if (!notices.length) return [];
  const ids = notices.map((n) => n.id);
  const [reads, atts, people] = await Promise.all([
    all<{ notice_id: string }>(ctx.db, `SELECT notice_id FROM notice_reads WHERE user_id = ? AND notice_id IN ${inList}`, ctx.user.id, json(ids)),
    filesOf(ctx, 'notice', ids),
    listOrgPeople(ctx),
  ]);
  const readSet = new Set(reads.map((r) => r.notice_id));
  const byId = new Map(people.map((p) => [p.user_id, p]));
  return notices.map((n) => ({
    ...n,
    read: readSet.has(n.id),
    attachments: atts.get(n.id) ?? [],
    authorName: byId.get(n.author_id)?.full_name ?? null,
    authorRole: byId.get(n.author_id)?.role ?? null,
  }));
}

export async function unreadNoticeCount(ctx: Ctx) {
  if (!ctx.baseId) return 0;
  return (await listReceivedNotices(ctx)).filter((n) => !n.read).length;
}

export async function listSentNotices(ctx: Ctx) {
  const base = requireBase(ctx);
  const notices = await all<NoticeRow>(ctx.db, 'SELECT * FROM notices WHERE base_id = ? AND author_id = ? ORDER BY created_at DESC', base, ctx.user.id);
  if (!notices.length) return [];
  const ids = notices.map((n) => n.id);
  const [reads, atts] = await Promise.all([
    all<{ notice_id: string; n: number }>(ctx.db, `SELECT notice_id, COUNT(*) AS n FROM notice_reads WHERE notice_id IN ${inList} GROUP BY notice_id`, json(ids)),
    filesOf(ctx, 'notice', ids),
  ]);
  const count = new Map(reads.map((r) => [r.notice_id, r.n]));
  return notices.map((n) => ({ ...n, reads: count.get(n.id) ?? 0, attachments: atts.get(n.id) ?? [] }));
}

/* ----------------------------------- Calendários --------------------------------- */
type CalRow = {
  id: string; title: string; editors: string; version: number; created_by: string | null; created_by_name: string | null;
  updated_by_name: string | null; updated_at: string | null; created_at: string | null; data?: string;
};
const CAL_CONFLICT = 'CALENDAR_CONFLICT';
const mapCal = (r: CalRow) => ({
  id: r.id, title: r.title, editors: parse<string[]>(r.editors, []), version: r.version,
  createdBy: r.created_by, createdByName: r.created_by_name, updatedByName: r.updated_by_name,
  updatedAt: r.updated_at, createdAt: r.created_at,
});
const SUMMARY = 'id, title, editors, version, created_by, created_by_name, updated_by_name, updated_at, created_at';

export async function listCalendars(ctx: Ctx) {
  const base = requireBase(ctx);
  return (await all<CalRow>(ctx.db, `SELECT ${SUMMARY} FROM calendars WHERE base_id = ? ORDER BY created_at`, base)).map(mapCal);
}

export async function loadCalendar(ctx: Ctx, id: string) {
  const base = requireBase(ctx);
  const r = await first<CalRow>(ctx.db, `SELECT ${SUMMARY}, data FROM calendars WHERE id = ? AND base_id = ?`, id, base);
  return r ? { ...mapCal(r), data: parse(r.data, {}) } : null;
}

export async function createCalendar(ctx: Ctx, args: { data: unknown; title: string }) {
  const base = requireRole(ctx, 'gestor');
  const id = uid();
  const name = ctx.user.full_name || ctx.user.email;
  await run(ctx.db,
    `INSERT INTO calendars (id, base_id, title, data, version, created_by, created_by_name, updated_by, updated_by_name, updated_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    id, base, String(args.title || 'Calendário'), json(args.data ?? {}), ctx.user.id, name, ctx.user.id, name, now());
  return id;
}

export async function saveCalendar(ctx: Ctx, args: { id: string; data: unknown; title: string; editors: string[]; expectedVersion: number }) {
  const base = requireBase(ctx);
  const cur = await first<CalRow>(ctx.db, `SELECT ${SUMMARY} FROM calendars WHERE id = ? AND base_id = ?`, args.id, base);
  if (!cur) fail('Calendário não encontrado.', 404);
  const isManager = ctx.role === 'superadmin' || ctx.role === 'gestor';
  const canEdit = isManager || cur!.created_by === ctx.user.id || parse<string[]>(cur!.editors, []).includes(ctx.user.id);
  if (!canEdit) fail('Sem permissão para editar este calendário.', 403);
  // Só gestor ou criador alteram a lista de editores.
  const editors = isManager || cur!.created_by === ctx.user.id ? args.editors ?? [] : parse<string[]>(cur!.editors, []);
  const ts = now();
  const name = ctx.user.full_name || ctx.user.email;
  const res = await run(ctx.db,
    `UPDATE calendars SET data = ?, title = ?, editors = ?, version = version + 1, updated_by = ?, updated_by_name = ?, updated_at = ?
      WHERE id = ? AND base_id = ? AND version = ?`,
    json(args.data ?? {}), String(args.title || cur!.title), json(editors), ctx.user.id, name, ts, args.id, base, args.expectedVersion);
  if (!res.meta.changes) fail(CAL_CONFLICT, 409);
  return { version: args.expectedVersion + 1, updatedByName: name, updatedAt: ts };
}

export async function deleteCalendar(ctx: Ctx, id: string) {
  const base = requireBase(ctx);
  const cur = await first<CalRow>(ctx.db, `SELECT ${SUMMARY} FROM calendars WHERE id = ? AND base_id = ?`, id, base);
  if (!cur) return;
  if (cur.created_by !== ctx.user.id) requireRole(ctx, 'gestor');
  await run(ctx.db, 'DELETE FROM calendars WHERE id = ?', id);
}

/** Próximos eventos (a partir de hoje) de todos os calendários da base — usado no Início. */
export async function listUpcomingEvents(ctx: Ctx, limit = 6) {
  const base = requireBase(ctx);
  const rows = await all<{ id: string; data: string }>(ctx.db, 'SELECT id, data FROM calendars WHERE base_id = ?', base);
  const today = new Date().toISOString().slice(0, 10);
  type Ev = { id: string; title: string; categoryId: string; start: string; end?: string };
  type Cat = { id: string; label: string; color: string };
  const out: { id: string; title: string; event_date: string; end_date: string | null; category: string; color: string }[] = [];
  for (const r of rows) {
    const d = parse<{ events?: Ev[]; categories?: Cat[] }>(r.data, {});
    const cats = new Map((d.categories ?? []).map((c) => [c.id, c]));
    for (const e of d.events ?? []) {
      if (!e?.start || (e.end || e.start) < today) continue;
      const c = cats.get(e.categoryId);
      out.push({ id: `${r.id}:${e.id}`, title: e.title, event_date: e.start, end_date: e.end ?? null, category: c?.label ?? 'Evento', color: c?.color ?? '#171717' });
    }
  }
  return out.sort((a, b) => a.event_date.localeCompare(b.event_date)).slice(0, limit);
}

/* ---------------------------------- Planejamento --------------------------------- */
type PlanRow = {
  id: string; base_id: string; author_id: string; class_id: string | null; title: string; week_start: string | null;
  content: string; plan_data: string | null; status: string; feedback: string | null; reviewed_by: string | null;
  reviewed_at: string | null; created_at: string; updated_at: string;
};
const PLAN_REVIEW: Role[] = ['gestor'];
const isReviewer = (ctx: Ctx) => ctx.role === 'superadmin' || PLAN_REVIEW.includes(ctx.role as Role);

async function getPlan(ctx: Ctx, id: string) {
  const base = requireBase(ctx);
  const p = await first<PlanRow>(ctx.db, 'SELECT * FROM lesson_plans WHERE id = ? AND base_id = ?', id, base);
  if (!p) fail('Planejamento não encontrado.', 404);
  if (p!.author_id !== ctx.user.id && !isReviewer(ctx)) fail('Sem acesso a este planejamento.', 403);
  return p!;
}

async function enrichPlans(ctx: Ctx, plans: PlanRow[]) {
  if (!plans.length) return [];
  const [atts, people, classes] = await Promise.all([
    filesOf(ctx, 'plan', plans.map((p) => p.id)),
    listOrgPeople(ctx),
    all<{ id: string; name: string }>(ctx.db, 'SELECT id, name FROM classes WHERE base_id = ?', ctx.baseId),
  ]);
  const personById = new Map(people.map((p) => [p.user_id, p]));
  const classById = new Map(classes.map((c) => [c.id, c.name]));
  return plans.map((p) => {
    const a = personById.get(p.author_id);
    return {
      ...p,
      plan_data: parse(p.plan_data, null),
      attachments: atts.get(p.id) ?? [],
      authorName: a?.full_name ?? null,
      authorEmail: a?.email ?? null,
      authorPhone: a?.phone ?? null,
      className: p.class_id ? classById.get(p.class_id) ?? null : null,
    };
  });
}

export async function savePlan(ctx: Ctx, input: { id?: string; title: string; class_id?: string | null; week_start?: string | null; content: string; plan_data?: unknown }) {
  const base = requireRole(ctx, 'gestor', 'professor');
  const title = String(input.title || '').trim();
  if (!title) fail('Informe o título do planejamento.');
  await assertClassInBase(ctx, base, input.class_id);
  const ts = now();
  if (input.id) {
    const p = await getPlan(ctx, input.id);
    if (p.author_id !== ctx.user.id) fail('Só o autor edita o planejamento.', 403);
    await run(ctx.db,
      `UPDATE lesson_plans SET title = ?, class_id = ?, week_start = ?, content = ?, updated_at = ?
         ${input.plan_data !== undefined ? ', plan_data = ?' : ''} WHERE id = ?`,
      ...([title, input.class_id || null, input.week_start || null, String(input.content ?? ''), ts,
        ...(input.plan_data !== undefined ? [json(input.plan_data)] : []), input.id] as (string | null)[]));
    return input.id;
  }
  const id = uid();
  await run(ctx.db,
    `INSERT INTO lesson_plans (id, base_id, author_id, class_id, title, week_start, content, plan_data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, base, ctx.user.id, input.class_id || null, title, input.week_start || null, String(input.content ?? ''),
    input.plan_data !== undefined ? json(input.plan_data) : null, ts);
  return id;
}

export async function submitPlan(ctx: Ctx, id: string) {
  const p = await getPlan(ctx, id);
  if (p.author_id !== ctx.user.id) fail('Só o autor envia o planejamento.', 403);
  await run(ctx.db, "UPDATE lesson_plans SET status = 'enviado', updated_at = ? WHERE id = ?", now(), id);
}

export async function reviewPlan(ctx: Ctx, id: string, status: 'aprovado' | 'devolvido', feedback: string) {
  if (!isReviewer(ctx)) fail('Apenas a coordenação revisa planejamentos.', 403);
  if (status !== 'aprovado' && status !== 'devolvido') fail('Status inválido.');
  await getPlan(ctx, id);
  const ts = now();
  await run(ctx.db, 'UPDATE lesson_plans SET status = ?, feedback = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?',
    status, feedback || null, ctx.user.id, ts, ts, id);
}

export async function deletePlan(ctx: Ctx, id: string) {
  const p = await getPlan(ctx, id);
  if (p.author_id !== ctx.user.id && !isReviewer(ctx)) fail('Sem permissão.', 403);
  await purgeFiles(ctx, 'plan', id);
  await run(ctx.db, 'DELETE FROM lesson_plans WHERE id = ?', id);
}

export async function listMyPlans(ctx: Ctx) {
  const base = requireBase(ctx);
  return enrichPlans(ctx, await all<PlanRow>(ctx.db, 'SELECT * FROM lesson_plans WHERE base_id = ? AND author_id = ? ORDER BY updated_at DESC', base, ctx.user.id));
}

export async function listOrgPlans(ctx: Ctx, status?: string) {
  const base = requireBase(ctx);
  if (!isReviewer(ctx)) return listMyPlans(ctx);
  const rows = status
    ? await all<PlanRow>(ctx.db, 'SELECT * FROM lesson_plans WHERE base_id = ? AND status = ? ORDER BY updated_at DESC', base, status)
    : await all<PlanRow>(ctx.db, 'SELECT * FROM lesson_plans WHERE base_id = ? ORDER BY updated_at DESC', base);
  return enrichPlans(ctx, rows);
}

export async function listReviewedPlans(ctx: Ctx) {
  const base = requireBase(ctx);
  if (!isReviewer(ctx)) return [];
  return enrichPlans(ctx, await all<PlanRow>(ctx.db,
    "SELECT * FROM lesson_plans WHERE base_id = ? AND status IN ('aprovado','devolvido') ORDER BY reviewed_at DESC", base));
}

export async function getPlanAttachments(ctx: Ctx, planId: string) {
  const p = await getPlan(ctx, planId);
  const atts = await filesOf(ctx, 'plan', [planId]);
  return { title: p.title, files: (atts.get(planId) ?? []).map((f) => ({ name: f.name, url: f.url })) };
}

/** Contato do professor (WhatsApp/e-mail) para a coordenação disparar mensagens. */
export async function setMemberContact(ctx: Ctx, userId: string, phone: string, _email?: string) {
  const base = requireBase(ctx);
  if (userId !== ctx.user.id) requireRole(ctx, 'gestor');
  const m = await first(ctx.db, 'SELECT id FROM memberships WHERE user_id = ? AND base_id = ?', userId, base);
  if (!m && userId !== ctx.user.id) fail('Pessoa não pertence a esta base.', 404);
  await run(ctx.db, 'UPDATE users SET phone = ? WHERE id = ?', phone || null, userId);
}

export async function listPlanMessages(ctx: Ctx, planId: string) {
  await getPlan(ctx, planId);
  return all(ctx.db,
    `SELECT m.id, m.plan_id, m.author_id, m.body, m.created_at, u.full_name AS authorName
       FROM lesson_plan_messages m LEFT JOIN users u ON u.id = m.author_id
      WHERE m.plan_id = ? ORDER BY m.created_at`, planId);
}

export async function sendPlanMessage(ctx: Ctx, planId: string, body: string) {
  const p = await getPlan(ctx, planId);
  const text = String(body || '').trim();
  if (!text) fail('Mensagem vazia.');
  const ts = now();
  await ctx.db.batch([
    stmt(ctx.db, 'INSERT INTO lesson_plan_messages (id, plan_id, base_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      uid(), planId, p.base_id, ctx.user.id, text.slice(0, 5000), ts),
    stmt(ctx.db, `INSERT INTO plan_reads (plan_id, user_id, last_read_at) VALUES (?, ?, ?)
                  ON CONFLICT (plan_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`, planId, ctx.user.id, ts),
  ]);
}

/** Mensagens não lidas por planejamento visível: { [planId]: n }. */
export async function planUnreadCounts(ctx: Ctx) {
  if (!ctx.baseId) return {};
  const reviewer = isReviewer(ctx);
  const rows = await all<{ plan_id: string; n: number }>(ctx.db,
    `SELECT m.plan_id, COUNT(*) AS n
       FROM lesson_plan_messages m
       JOIN lesson_plans p ON p.id = m.plan_id
       LEFT JOIN plan_reads r ON r.plan_id = m.plan_id AND r.user_id = ?1
      WHERE p.base_id = ?2 AND m.author_id <> ?1
        AND (?3 = 1 OR p.author_id = ?1)
        AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
      GROUP BY m.plan_id`,
    ctx.user.id, ctx.baseId, reviewer ? 1 : 0);
  return Object.fromEntries(rows.map((r) => [r.plan_id, r.n]));
}

export async function markPlanRead(ctx: Ctx, planId: string) {
  await getPlan(ctx, planId);
  await run(ctx.db, `INSERT INTO plan_reads (plan_id, user_id, last_read_at) VALUES (?, ?, ?)
                     ON CONFLICT (plan_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at`, planId, ctx.user.id, now());
}

/* ------------------------ Central de documentos de planejamento ------------------ */
export async function listPlanDocs(ctx: Ctx) {
  const base = requireBase(ctx);
  const rows = await all<Record<string, unknown> & { id: string }>(ctx.db,
    'SELECT id, segment, term, class_id, turma_label, name, mime, author_id, created_at FROM plan_docs WHERE base_id = ? ORDER BY created_at DESC', base);
  return rows.map((r) => ({ ...r, path: r.id, url: fileUrl(r.id) }));
}

export async function updatePlanDoc(ctx: Ctx, id: string, patch: { name?: string; segment?: string; term?: number | null; class_id?: string | null; turma_label?: string | null }) {
  const base = requireRole(ctx, 'gestor', 'professor');
  const cur = await first<{ author_id: string; name: string; segment: string; term: number | null; class_id: string | null; turma_label: string | null }>(
    ctx.db, 'SELECT * FROM plan_docs WHERE id = ? AND base_id = ?', id, base);
  if (!cur) fail('Documento não encontrado.', 404);
  if (cur!.author_id !== ctx.user.id) requireRole(ctx, 'gestor');
  const n = { ...cur!, ...patch };
  await assertClassInBase(ctx, base, n.class_id);
  await run(ctx.db, 'UPDATE plan_docs SET name = ?, segment = ?, term = ?, class_id = ?, turma_label = ? WHERE id = ?',
    n.name, n.segment, n.term ?? null, n.class_id ?? null, n.turma_label ?? null, id);
}

export async function deletePlanDoc(ctx: Ctx, doc: { id: string }) {
  const base = requireRole(ctx, 'gestor', 'professor');
  const cur = await first<{ author_id: string }>(ctx.db, 'SELECT author_id FROM plan_docs WHERE id = ? AND base_id = ?', doc.id, base);
  if (!cur) return;
  if (cur.author_id !== ctx.user.id) requireRole(ctx, 'gestor');
  await ctx.db.batch([
    stmt(ctx.db, 'INSERT OR IGNORE INTO kv_trash (id) VALUES (?)', doc.id),
    stmt(ctx.db, 'DELETE FROM plan_docs WHERE id = ?', doc.id),
  ]);
}
