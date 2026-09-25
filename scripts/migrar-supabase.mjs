// Migra TODOS os dados do sistema antigo (Supabase) para o SCOLA no Cloudflare.
// Só LÊ do Supabase — nada é alterado lá. Os professores mantêm e-mail e senha.
//
// Uso:
//   SUPABASE_DB_URL="postgresql://postgres.xxxx:SENHA@aws-0-sa-east-1.pooler.supabase.com:5432/postgres" \
//   SUPABASE_URL="https://xxxx.supabase.co" SUPABASE_SERVICE_KEY="eyJ..." \
//   npm run migrar -- [--aplicar] [--local]
//
//  - SUPABASE_DB_URL: Supabase → Project Settings → Database → Connection string (Session pooler).
//  - SUPABASE_URL / SUPABASE_SERVICE_KEY (opcionais): para copiar também os ANEXOS (Settings → API → service_role).
//  - Sem --aplicar: só gera a pasta migracao/ para você conferir. Com --aplicar: grava no D1 (e no KV).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import pg from 'pg';

const APPLY = process.argv.includes('--aplicar');
const LOCAL = process.argv.includes('--local');
const DB_URL = process.env.SUPABASE_DB_URL;
const SB_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!DB_URL) {
  console.error('Defina SUPABASE_DB_URL (connection string do Postgres do Supabase). Veja o cabeçalho deste arquivo.');
  process.exit(1);
}

// Colunas DATE como texto 'yyyy-mm-dd' (sem conversão de fuso horário).
pg.types?.setTypeParser?.(1082, (v) => v);
const client = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
/** Lê uma tabela; se ela não existir nessa instalação, devolve []. */
async function read(sql) {
  try {
    return (await client.query(sql)).rows;
  } catch (e) {
    if (/does not exist/.test(e.message)) return [];
    throw e;
  }
}

console.log('Lendo o Supabase…');
const orgs = await read('select * from public.organizations order by created_at');
const schools = await read('select * from public.schools order by created_at');
const authUsers = await read('select id, email, encrypted_password, created_at, last_sign_in_at from auth.users');
const profiles = await read('select * from public.profiles');
const memberships = await read('select * from public.memberships');
const classes = await read('select * from public.classes');
const students = await read('select * from public.students');
const sessions = await read('select * from public.attendance_sessions');
const records = await read('select * from public.attendance_records');
const gradeTerms = await read('select * from public.grade_terms');
const termGrades = await read('select * from public.term_grades');
const evalTerms = await read('select * from public.evaluation_terms');
const evalGrades = await read('select * from public.evaluation_grades');
const sharedReports = await read('select * from public.shared_reports');
const notices = await read('select * from public.notices');
const noticeReads = await read('select * from public.notice_reads');
const noticeAtts = await read('select * from public.notice_attachments');
const calendars = await read('select * from public.calendars');
const calBuilder = await read('select * from public.calendar_builder');
const plans = await read('select * from public.lesson_plans');
const planAtts = await read('select * from public.lesson_plan_attachments');
const planMsgs = await read('select * from public.lesson_plan_messages');
const planReads = await read('select * from public.plan_reads');
const planDocs = await read('select * from public.plan_docs');
await client.end();

/* ------------------------------------ Mapeamentos ------------------------------------ */
const warnings = [];
const ROLE = { diretor: 'gestor', coordenador: 'gestor', superadmin: 'gestor', professor: 'professor', secretaria: 'secretaria', marketing: 'secretaria', cpd: 'secretaria' };
const clientOrgs = orgs.filter((o) => o.kind !== 'hq');
const baseIds = new Set(clientOrgs.map((o) => o.id));
const firstBase = clientOrgs[0]?.id ?? null;

const profileById = new Map(profiles.map((p) => [p.id, p]));
const memsByUser = new Map();
for (const m of memberships) {
  if (!baseIds.has(m.org_id)) continue;
  const l = memsByUser.get(m.user_id) ?? [];
  l.push(m);
  memsByUser.set(m.user_id, l);
}
// Sem org_id (dados antigos): usa a base do dono do registro, ou a única base existente.
const baseOfOwner = (ownerId) => memsByUser.get(ownerId)?.[0]?.org_id ?? (clientOrgs.length === 1 ? firstBase : null);
const classBase = new Map(classes.map((c) => [c.id, baseIds.has(c.org_id) ? c.org_id : baseOfOwner(c.owner_id)]));

const q = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const day = (v) => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const sql = [];
const insert = (table, row) => {
  const cols = Object.keys(row);
  sql.push(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => q(row[c])).join(', ')});`);
};

/* -------------------------------------- Bases --------------------------------------- */
for (const o of clientOrgs) {
  const sch = schools.filter((s) => s.org_id === o.id);
  if (sch.length > 1) warnings.push(`Base "${o.name}" tinha ${sch.length} escolas cadastradas — agora a base é a escola (dados da primeira: "${sch[0].name}").`);
  const s = sch[0] ?? {};
  insert('bases', {
    id: o.id, name: o.name, cnpj: o.cnpj ?? null, city: s.city ?? null, address: s.address ?? null, phone: s.phone ?? null,
    director: s.director ?? null, inep: s.inep ?? null, logo_url: s.logo_url || o.logo_url || null,
    plan: o.is_demo || o.plan === 'trial' ? 'teste' : 'ativo', active: o.active !== false, created_at: o.created_at,
    subject: 'Língua Inglesa', // disciplina fixa do sistema antigo
  });
}

/* ------------------------------------- Usuários ------------------------------------- */
const userIds = new Set();
for (const u of authUsers) {
  if (!u.email) continue;
  const p = profileById.get(u.id) ?? {};
  const hasPw = typeof u.encrypted_password === 'string' && u.encrypted_password.startsWith('$2');
  if (!hasPw) warnings.push(`${u.email} não tinha senha (entrava pelo Google). Gere uma senha provisória em Equipe.`);
  insert('users', {
    id: u.id, email: u.email.toLowerCase(), password_hash: hasPw ? u.encrypted_password : '!sem-senha',
    full_name: p.full_name ?? null, phone: p.phone ?? null, avatar_url: p.avatar_url ?? null, is_admin: 0,
    must_change_pw: hasPw ? 0 : 1, active_base_id: baseIds.has(p.active_org_id) ? p.active_org_id : null,
    created_at: u.created_at, last_login_at: u.last_sign_in_at ?? null,
  });
  userIds.add(u.id);
}
for (const m of memberships) {
  if (!baseIds.has(m.org_id) || !userIds.has(m.user_id)) continue;
  insert('memberships', { id: m.id, user_id: m.user_id, base_id: m.org_id, role: ROLE[m.role] ?? 'professor', created_at: m.created_at });
}
// Antigos "superadmin"/"master" sem vínculo continuam acessando todas as bases como gestores.
for (const p of profiles) {
  if (!(p.is_superadmin || p.role === 'master') || !userIds.has(p.id) || memsByUser.has(p.id)) continue;
  for (const o of clientOrgs) insert('memberships', { id: `${p.id.slice(0, 18)}-${o.id.slice(0, 17)}`, user_id: p.id, base_id: o.id, role: 'gestor' });
  warnings.push(`${p.email ?? p.id} era administrador no sistema antigo: virou GESTOR de todas as bases. Seu acesso de administrador é criado com "npm run admin".`);
}

/* ------------------------------------ Cadastros ------------------------------------- */
const classIds = new Set();
for (const c of classes) {
  const base = classBase.get(c.id);
  if (!base) continue;
  classIds.add(c.id);
  insert('classes', { id: c.id, base_id: base, name: c.name, shift: c.shift ?? 'Manhã', year: c.year ?? null, does_exams: c.does_exams !== false, created_at: c.created_at });
}
const studentIds = new Set();
const regSeen = new Set();
for (const s of students) {
  const base = baseIds.has(s.org_id) ? s.org_id : s.class_id ? classBase.get(s.class_id) : baseOfOwner(s.owner_id);
  if (!base) continue;
  let reg = s.registration?.trim() || null;
  if (reg && regSeen.has(`${base}|${reg}`)) {
    warnings.push(`Matrícula repetida "${reg}" (${s.full_name}) — importado sem matrícula.`);
    reg = null;
  }
  if (reg) regSeen.add(`${base}|${reg}`);
  studentIds.add(s.id);
  insert('students', {
    id: s.id, base_id: base, class_id: classIds.has(s.class_id) ? s.class_id : null, full_name: s.full_name, registration: reg,
    guardian_name: s.guardian_name ?? null, guardian_phone: s.guardian_phone ?? null, active: s.active !== false, created_at: s.created_at,
  });
}

/* ------------------------------------- Chamadas ------------------------------------- */
const sessionBase = new Map();
for (const s of sessions) {
  if (!classIds.has(s.class_id)) continue;
  const base = classBase.get(s.class_id);
  sessionBase.set(s.id, base);
  insert('attendance_sessions', {
    id: s.id, base_id: base, class_id: s.class_id, session_date: day(s.session_date), note: s.note ?? null, exam_mode: !!s.exam_mode,
    deleted_at: s.deleted_at ?? null, created_at: s.created_at, updated_at: s.updated_at ?? null,
  });
}
for (const r of records) {
  if (!sessionBase.has(r.session_id) || !studentIds.has(r.student_id)) continue;
  insert('attendance_records', { session_id: r.session_id, student_id: r.student_id, base_id: sessionBase.get(r.session_id), status: r.status, note: r.note ?? null });
}

/* --------------------------------------- Notas -------------------------------------- */
for (const g of gradeTerms) {
  const base = baseIds.has(g.org_id) ? g.org_id : baseOfOwner(g.owner_id);
  if (!base) continue;
  insert('grade_terms', { base_id: base, year: g.year, term: g.term, activities: g.activities ?? [], updated_at: g.updated_at ?? null });
}
for (const g of termGrades) {
  if (!classIds.has(g.class_id) || !studentIds.has(g.student_id)) continue;
  insert('term_grades', {
    base_id: classBase.get(g.class_id), class_id: g.class_id, student_id: g.student_id, year: g.year, term: g.term,
    scores: g.scores ?? {}, observacao: g.observacao ?? null, updated_at: g.updated_at ?? null,
  });
}
for (const e of evalTerms) {
  if (!classIds.has(e.class_id)) continue;
  insert('evaluation_terms', { base_id: classBase.get(e.class_id), class_id: e.class_id, year: e.year, term: e.term, activities: e.activities ?? [], updated_at: e.updated_at ?? null });
}
for (const e of evalGrades) {
  if (!classIds.has(e.class_id) || !studentIds.has(e.student_id)) continue;
  insert('evaluation_grades', {
    base_id: classBase.get(e.class_id), class_id: e.class_id, student_id: e.student_id, year: e.year, term: e.term, marks: e.marks ?? {}, updated_at: e.updated_at ?? null,
  });
}
for (const r of sharedReports) {
  const base = baseIds.has(r.org_id) ? r.org_id : baseOfOwner(r.owner_id) ?? firstBase;
  if (base) insert('shared_reports', { id: r.id, base_id: base, payload: r.payload, created_at: r.created_at });
}

/* ------------------------------ Avisos e calendários -------------------------------- */
const noticeIds = new Set();
for (const n of notices) {
  if (!baseIds.has(n.org_id) || !userIds.has(n.author_id)) continue;
  noticeIds.add(n.id);
  insert('notices', {
    id: n.id, base_id: n.org_id, author_id: n.author_id, title: n.title, body: n.body ?? '', audience: n.audience ?? 'all',
    target_role: n.target_role ? ROLE[n.target_role] ?? null : null, target_user: userIds.has(n.target_user) ? n.target_user : null, created_at: n.created_at,
  });
}
for (const r of noticeReads) {
  if (noticeIds.has(r.notice_id) && userIds.has(r.user_id)) insert('notice_reads', { notice_id: r.notice_id, user_id: r.user_id, read_at: r.read_at ?? null });
}
const basesWithCalendar = new Set();
for (const c of calendars) {
  if (!baseIds.has(c.org_id)) continue;
  basesWithCalendar.add(c.org_id);
  insert('calendars', {
    id: c.id, base_id: c.org_id, title: c.title ?? 'Calendário', data: c.data ?? {}, editors: c.editors ?? [], version: Number(c.version) || 1,
    created_by: c.created_by ?? null, created_by_name: c.created_by_name ?? null, updated_by: c.updated_by ?? null,
    updated_by_name: c.updated_by_name ?? null, created_at: c.created_at, updated_at: c.updated_at ?? null,
  });
}
for (const c of calBuilder) {
  if (!baseIds.has(c.org_id) || basesWithCalendar.has(c.org_id)) continue;
  insert('calendars', {
    id: `cb-${c.org_id}`, base_id: c.org_id, title: c.data?.title || 'Calendário', data: c.data ?? {}, editors: [], version: Number(c.version) || 1,
    updated_by_name: c.updated_by_name ?? null, updated_at: c.updated_at ?? null,
  });
}

/* ------------------------------------ Planejamento ---------------------------------- */
const planIds = new Set();
const planBase = new Map();
for (const p of plans) {
  if (!baseIds.has(p.org_id) || !userIds.has(p.author_id)) continue;
  planIds.add(p.id);
  planBase.set(p.id, p.org_id);
  insert('lesson_plans', {
    id: p.id, base_id: p.org_id, author_id: p.author_id, class_id: classIds.has(p.class_id) ? p.class_id : null, title: p.title,
    week_start: day(p.week_start), content: p.content ?? '', plan_data: p.plan_data ?? null, status: p.status ?? 'rascunho',
    feedback: p.feedback ?? null, reviewed_by: p.reviewed_by ?? null, reviewed_at: p.reviewed_at ?? null,
    created_at: p.created_at, updated_at: p.updated_at ?? p.created_at,
  });
}
for (const m of planMsgs) {
  if (planIds.has(m.plan_id) && userIds.has(m.author_id)) {
    insert('lesson_plan_messages', { id: m.id, plan_id: m.plan_id, base_id: planBase.get(m.plan_id), author_id: m.author_id, body: m.body, created_at: m.created_at });
  }
}
for (const r of planReads) {
  if (planIds.has(r.plan_id) && userIds.has(r.user_id)) insert('plan_reads', { plan_id: r.plan_id, user_id: r.user_id, last_read_at: r.last_read_at });
}

/* --------------------------------------- Anexos ------------------------------------- */
const fileJobs = []; // { id, bucket, path, name, mime }
for (const a of noticeAtts) {
  if (!noticeIds.has(a.notice_id)) continue;
  fileJobs.push({ id: a.id, bucket: 'avisos', path: a.path, name: a.name, mime: a.mime });
  insert('files', { id: a.id, base_id: notices.find((n) => n.id === a.notice_id).org_id, owner_type: 'notice', owner_id: a.notice_id, name: a.name, mime: a.mime ?? null, created_at: a.created_at });
}
for (const a of planAtts) {
  if (!planIds.has(a.plan_id)) continue;
  fileJobs.push({ id: a.id, bucket: 'planejamentos', path: a.path, name: a.name, mime: a.mime });
  insert('files', { id: a.id, base_id: planBase.get(a.plan_id), owner_type: 'plan', owner_id: a.plan_id, name: a.name, mime: a.mime ?? null, created_at: a.created_at });
}
for (const d of planDocs) {
  if (!baseIds.has(d.org_id) || !userIds.has(d.author_id)) continue;
  fileJobs.push({ id: d.id, bucket: 'planejamentos', path: d.path, name: d.name, mime: d.mime });
  insert('plan_docs', {
    id: d.id, base_id: d.org_id, author_id: d.author_id, segment: d.segment, term: d.term ?? null, class_id: classIds.has(d.class_id) ? d.class_id : null,
    turma_label: d.turma_label ?? null, name: d.name, mime: d.mime ?? null, created_at: d.created_at,
  });
}

/* --------------------------------------- Saída -------------------------------------- */
mkdirSync('migracao', { recursive: true });
writeFileSync('migracao/dados.sql', sql.join('\n') + '\n');

const kvChunks = [];
if (fileJobs.length && SB_URL && SB_KEY) {
  console.log(`Baixando ${fileJobs.length} anexo(s) do Storage…`);
  let chunk = [];
  let size = 0;
  for (const f of fileJobs) {
    const res = await fetch(`${SB_URL}/storage/v1/object/${f.bucket}/${f.path.split('/').map(encodeURIComponent).join('/')}`, {
      headers: { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY },
    });
    if (!res.ok) {
      warnings.push(`Anexo não encontrado no Storage: ${f.name}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 20 * 1024 * 1024) {
      warnings.push(`Anexo maior que 20 MB ignorado: ${f.name}`);
      continue;
    }
    chunk.push({ key: `f:${f.id}`, value: buf.toString('base64'), base64: true, metadata: { name: f.name, mime: f.mime || 'application/octet-stream' } });
    size += buf.length;
    if (size > 40 * 1024 * 1024) {
      kvChunks.push(chunk);
      chunk = [];
      size = 0;
    }
  }
  if (chunk.length) kvChunks.push(chunk);
  kvChunks.forEach((c, i) => writeFileSync(`migracao/anexos-${i + 1}.json`, JSON.stringify(c)));
} else if (fileJobs.length) {
  warnings.push(`${fileJobs.length} anexo(s) NÃO copiados: defina SUPABASE_URL e SUPABASE_SERVICE_KEY para trazer os arquivos.`);
}

console.log(`
Resumo:
  bases ............ ${clientOrgs.length}
  usuários ......... ${userIds.size}
  turmas ........... ${classIds.size}
  alunos ........... ${studentIds.size}
  chamadas ......... ${sessionBase.size}
  notas (trimestre)  ${termGrades.length}
  avisos ........... ${noticeIds.size}
  planejamentos .... ${planIds.size}
  anexos ........... ${kvChunks.reduce((a, c) => a + c.length, 0)} de ${fileJobs.length}
  comandos SQL ..... ${sql.length}  → migracao/dados.sql`);
if (warnings.length) console.log('\nAtenção:\n' + [...new Set(warnings)].map((w) => '  • ' + w).join('\n'));

if (APPLY) {
  const where = LOCAL ? '--local' : '--remote';
  console.log(`\nGravando no D1 (${LOCAL ? 'local' : 'produção'})…`);
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'scola', where, '--file', 'migracao/dados.sql', '--yes'], { stdio: 'inherit' });
  kvChunks.forEach((_, i) => {
    execFileSync('npx', ['wrangler', 'kv', 'bulk', 'put', `migracao/anexos-${i + 1}.json`, '--binding', 'FILES', where], { stdio: 'inherit' });
  });
  console.log('\n✔ Migração concluída. Os professores entram com o mesmo e-mail e senha de antes.');
} else {
  console.log('\nNada foi gravado ainda. Confira o resumo e rode de novo com --aplicar.');
}
