import { assertClassInBase, assertClassOpen, requireBase, requireRole, ROSTER_SQL, type Ctx } from '../auth';
import { all, bools, fail, first, inList, json, run, stmt, uid } from '../db';

/* A base É a escola: o frontend continua enxergando uma "escola" (id = base.id)
   para cabeçalhos de relatório, boletim etc. — sem cadastro duplicado. */
type BaseRow = {
  id: string; name: string; cnpj: string | null; city: string | null; logo_url: string | null; director: string | null;
  address: string | null; phone: string | null; inep: string | null; subject: string | null; active: number; created_at: string;
  max_students: number | null;
};

const mapClass = (r: Record<string, unknown>) => ({ ...bools(r, 'does_exams'), school_id: r.base_id });
const mapStudent = (r: Record<string, unknown>) => ({ ...bools(r, 'active'), school_id: r.base_id });

const CADASTRO = ['gestor', 'secretaria'] as const;

/* ------------------------------------ Escola -------------------------------------- */
export async function listSchools(ctx: Ctx) {
  const base = requireBase(ctx);
  const b = await first<BaseRow>(ctx.db, 'SELECT * FROM bases WHERE id = ?', base);
  if (!b) return [];
  return [{ id: b.id, name: b.name, cnpj: b.cnpj, city: b.city, logo_url: b.logo_url, director: b.director, address: b.address, phone: b.phone, inep: b.inep, subject: b.subject, active: !!b.active, created_at: b.created_at }];
}

const clean = (v: unknown) => (v == null ? null : String(v).trim() || null);

export async function saveSchool(ctx: Ctx, input: Record<string, string | null>) {
  const base = requireRole(ctx, ...CADASTRO);
  const name = String(input.name || '').trim();
  if (!name) fail('Informe o nome da escola.');
  await run(
    ctx.db,
    'UPDATE bases SET name = ?, cnpj = ?, city = ?, logo_url = ?, director = ?, address = ?, phone = ?, inep = ?, subject = ? WHERE id = ?',
    name, clean(input.cnpj), clean(input.city), input.logo_url ?? null, clean(input.director), clean(input.address), clean(input.phone), clean(input.inep),
    clean(input.subject), base,
  );
  return (await listSchools(ctx))[0];
}

/* ------------------------------------ Turmas -------------------------------------- */
/** Turmas do dia a dia. `includeArchived` = também as de anos encerrados (relatórios, histórico). */
export async function listClasses(ctx: Ctx, includeArchived?: boolean) {
  const base = requireBase(ctx);
  const rows = await all(ctx.db,
    `SELECT * FROM classes WHERE base_id = ?${includeArchived === true ? '' : ' AND archived_at IS NULL'}
      ORDER BY archived_at IS NOT NULL, year DESC, name COLLATE NOCASE`, base);
  return rows.map(mapClass);
}

export async function saveClass(ctx: Ctx, input: { id?: string; name: string; shift?: string; year?: number | null; does_exams?: boolean }) {
  const base = requireRole(ctx, ...CADASTRO);
  const name = String(input.name || '').trim();
  if (!name) fail('Informe o nome da turma.');
  const id = input.id || uid();
  if (input.id) {
    await run(ctx.db, 'UPDATE classes SET name = ?, shift = ?, year = ?, does_exams = ? WHERE id = ? AND base_id = ?',
      name, input.shift ?? 'Manhã', input.year ?? null, input.does_exams ?? true, id, base);
  } else {
    await run(ctx.db, 'INSERT INTO classes (id, base_id, name, shift, year, does_exams) VALUES (?, ?, ?, ?, ?, ?)',
      id, base, name, input.shift ?? 'Manhã', input.year ?? null, input.does_exams ?? true);
  }
  return mapClass((await first(ctx.db, 'SELECT * FROM classes WHERE id = ?', id))!);
}

export async function deleteClass(ctx: Ctx, id: string) {
  return bulkDeleteClasses(ctx, [id]);
}

export async function bulkDeleteClasses(ctx: Ctx, ids: string[]) {
  const base = requireRole(ctx, ...CADASTRO);
  await run(ctx.db, `DELETE FROM classes WHERE base_id = ? AND id IN ${inList}`, base, json(ids));
}

/* ------------------------------------ Alunos -------------------------------------- */
export async function listStudents(ctx: Ctx) {
  const base = requireBase(ctx);
  const rows = await all(ctx.db, 'SELECT * FROM students WHERE base_id = ? ORDER BY full_name COLLATE NOCASE', base);
  return rows.map(mapStudent);
}

export async function listStudentsByClass(ctx: Ctx, classId: string) {
  const base = requireBase(ctx);
  const rows = await all(ctx.db, ROSTER_SQL.replace('SELECT id, full_name FROM', 'SELECT * FROM'), base, classId);
  return rows.map(mapStudent);
}

async function assertStudentLimit(ctx: Ctx, base: string, adding: number) {
  const b = await first<{ max_students: number | null }>(ctx.db, 'SELECT max_students FROM bases WHERE id = ?', base);
  if (!b?.max_students) return;
  const n = await first<{ n: number }>(ctx.db, 'SELECT COUNT(*) AS n FROM students WHERE base_id = ? AND active = 1', base);
  if ((n?.n ?? 0) + adding > b.max_students) {
    fail(`Limite do plano atingido (${b.max_students} alunos ativos). Fale com o suporte para ampliar.`);
  }
}

export async function saveStudent(ctx: Ctx, input: {
  id?: string; full_name: string; class_id?: string | null; registration?: string | null;
  guardian_name?: string | null; guardian_phone?: string | null; active?: boolean;
}) {
  const base = requireRole(ctx, ...CADASTRO);
  const name = String(input.full_name || '').trim();
  if (!name) fail('Informe o nome do aluno.');
  const reg = (input.registration || '').trim() || null;
  const classId = input.class_id || null;
  // Não põe aluno em turma de ano encerrado (mas deixa editar quem já está nela, ex.: aluno que saiu).
  const cur = input.id ? await first<{ class_id: string | null }>(ctx.db, 'SELECT class_id FROM students WHERE id = ? AND base_id = ?', input.id, base) : null;
  if (cur && cur.class_id === classId) await assertClassInBase(ctx, base, classId);
  else await assertClassOpen(ctx, base, classId);

  if (reg) {
    const dup = await first(ctx.db, 'SELECT id FROM students WHERE base_id = ? AND registration = ? AND id <> ?', base, reg, input.id ?? '');
    if (dup) fail('Já existe um aluno com essa matrícula nesta escola.');
  }
  if (classId) {
    const dup = await first(ctx.db, 'SELECT id FROM students WHERE class_id = ? AND lower(full_name) = lower(?) AND id <> ?', classId, name, input.id ?? '');
    if (dup) fail('Já existe um aluno com esse nome nesta turma.');
  }

  const id = input.id || uid();
  if (input.id) {
    await run(ctx.db,
      'UPDATE students SET full_name = ?, class_id = ?, registration = ?, guardian_name = ?, guardian_phone = ?, active = ? WHERE id = ? AND base_id = ?',
      name, classId, reg, input.guardian_name ?? null, input.guardian_phone ?? null, input.active ?? true, id, base);
  } else {
    await assertStudentLimit(ctx, base, 1);
    await run(ctx.db,
      'INSERT INTO students (id, base_id, class_id, full_name, registration, guardian_name, guardian_phone, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, base, classId, name, reg, input.guardian_name ?? null, input.guardian_phone ?? null, input.active ?? true);
  }
  return mapStudent((await first(ctx.db, 'SELECT * FROM students WHERE id = ?', id))!);
}

export async function deleteStudent(ctx: Ctx, id: string) {
  return bulkDeleteStudents(ctx, [id]);
}

export async function bulkDeleteStudents(ctx: Ctx, ids: string[]) {
  const base = requireRole(ctx, ...CADASTRO);
  await run(ctx.db, `DELETE FROM students WHERE base_id = ? AND id IN ${inList}`, base, json(ids));
}

/** Arquiva: inativa o aluno e remove frequência/notas dele (como no sistema anterior). */
export async function archiveStudent(ctx: Ctx, id: string) {
  const base = requireRole(ctx, ...CADASTRO);
  await ctx.db.batch([
    stmt(ctx.db, 'UPDATE students SET active = 0 WHERE id = ? AND base_id = ?', id, base),
    stmt(ctx.db, 'DELETE FROM attendance_records WHERE student_id = ? AND base_id = ?', id, base),
    stmt(ctx.db, 'DELETE FROM term_grades WHERE student_id = ? AND base_id = ?', id, base),
    stmt(ctx.db, 'DELETE FROM evaluation_grades WHERE student_id = ? AND base_id = ?', id, base),
  ]);
}

/** Importação por planilha: cria turmas e alunos conforme preenchido (colunas: class, shift, year, student, registration, guardian, phone). */
export async function bulkImportAll(ctx: Ctx, rows: Record<string, string>[]) {
  const base = requireRole(ctx, ...CADASTRO);
  if (!Array.isArray(rows)) fail('Planilha inválida.');
  if (rows.length > 5000) fail('Importe no máximo 5000 linhas por vez.');

  const classes = await all<{ id: string; name: string }>(ctx.db, 'SELECT id, name FROM classes WHERE base_id = ?', base);
  const students = await all<{ class_id: string | null; full_name: string; registration: string | null }>(
    ctx.db, 'SELECT class_id, full_name, registration FROM students WHERE base_id = ?', base);

  const classMap = new Map(classes.map((c) => [c.name.toLowerCase().trim(), c.id]));
  const regSet = new Set(students.filter((s) => s.registration).map((s) => (s.registration || '').trim()));
  const nameSet = new Set(students.filter((s) => s.class_id).map((s) => `${s.class_id}|${s.full_name.toLowerCase().trim()}`));

  const newClasses: { id: string; name: string; shift: string; year: number | null }[] = [];
  const newStudents: Record<string, string | null>[] = [];
  const duplicates: string[] = [];

  for (const r of rows) {
    const className = String(r.class || '').trim();
    let classId: string | undefined;
    if (className) {
      const key = className.toLowerCase();
      classId = classMap.get(key);
      if (!classId) {
        classId = uid();
        classMap.set(key, classId);
        newClasses.push({ id: classId, name: className, shift: String(r.shift || '').trim() || 'Manhã', year: r.year ? Number(r.year) || null : null });
      }
    }
    const studentName = String(r.student || '').trim();
    if (!studentName) continue;
    const reg = String(r.registration || '').trim();
    const nameKey = `${classId || ''}|${studentName.toLowerCase()}`;
    if (reg && regSet.has(reg)) {
      duplicates.push(`${studentName} (matrícula ${reg} já cadastrada)`);
      continue;
    }
    if (classId && nameSet.has(nameKey)) {
      duplicates.push(`${studentName} (já cadastrado nessa turma)`);
      continue;
    }
    if (reg) regSet.add(reg);
    if (classId) nameSet.add(nameKey);
    newStudents.push({
      id: uid(), class_id: classId ?? null, full_name: studentName, registration: reg || null,
      guardian_name: String(r.guardian || '').trim() || null, guardian_phone: String(r.phone || '').trim() || null,
    });
  }

  if (newStudents.length) await assertStudentLimit(ctx, base, newStudents.length);

  const batch: D1PreparedStatement[] = [];
  if (newClasses.length) {
    batch.push(stmt(ctx.db,
      `INSERT INTO classes (id, base_id, name, shift, year)
       SELECT json_extract(value,'$.id'), ?, json_extract(value,'$.name'), json_extract(value,'$.shift'), json_extract(value,'$.year') FROM json_each(?)`,
      base, json(newClasses)));
  }
  if (newStudents.length) {
    batch.push(stmt(ctx.db,
      `INSERT INTO students (id, base_id, class_id, full_name, registration, guardian_name, guardian_phone)
       SELECT json_extract(value,'$.id'), ?, json_extract(value,'$.class_id'), json_extract(value,'$.full_name'),
              json_extract(value,'$.registration'), json_extract(value,'$.guardian_name'), json_extract(value,'$.guardian_phone')
         FROM json_each(?)`,
      base, json(newStudents)));
  }
  if (batch.length) await ctx.db.batch(batch);
  return { schools: 0, classes: newClasses.length, students: newStudents.length, duplicates };
}

/* ----------------------------------- Painel --------------------------------------- */
export async function dashboardCounts(ctx: Ctx) {
  const base = requireBase(ctx);
  const r = await first<{ classes: number; students: number }>(ctx.db,
    `SELECT (SELECT COUNT(*) FROM classes WHERE base_id = ?1) AS classes,
            (SELECT COUNT(*) FROM students WHERE base_id = ?1 AND active = 1) AS students`, base);
  return { schools: 1, classes: r?.classes ?? 0, students: r?.students ?? 0 };
}
