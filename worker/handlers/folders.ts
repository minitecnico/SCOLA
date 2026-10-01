import { assertClassInBase, requireBase, requireRole, type Ctx } from '../auth';
import { all, fail, first, inList, run, uid } from '../db';

/** Pastas da central de planejamento. Visíveis a toda a base; criar: gestão e professores. */
type FolderRow = { id: string; base_id: string; author_id: string | null; segment: string; name: string; class_id: string | null };

const isManager = (ctx: Ctx) => ctx.isAdmin || ctx.role === 'gestor' || ctx.role === 'superadmin';
const cleanName = (n: unknown) => {
  const v = String(n ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (!v) fail('Dê um nome para a pasta.');
  return v;
};

export async function folderInBase(ctx: Ctx, id: string) {
  const base = requireBase(ctx);
  const f = await first<FolderRow>(ctx.db, 'SELECT * FROM plan_folders WHERE id = ? AND base_id = ?', id, base);
  if (!f) fail('Pasta não encontrada.', 404);
  return f!;
}

export async function listPlanFolders(ctx: Ctx) {
  const base = requireBase(ctx);
  return all<FolderRow>(ctx.db, 'SELECT id, author_id, segment, name, class_id FROM plan_folders WHERE base_id = ? ORDER BY name COLLATE NOCASE', base);
}

export async function createPlanFolder(ctx: Ctx, input: { name: string; segment: string; class_id?: string | null }) {
  const base = requireRole(ctx, 'gestor', 'professor');
  await assertClassInBase(ctx, base, input.class_id ?? null);
  const name = cleanName(input.name);
  const dup = await first(ctx.db, 'SELECT 1 FROM plan_folders WHERE base_id = ? AND segment = ? AND name = ? COLLATE NOCASE', base, input.segment, name);
  if (dup) fail('Já existe uma pasta com esse nome.');
  const id = uid();
  await run(ctx.db, 'INSERT INTO plan_folders (id, base_id, author_id, segment, name, class_id) VALUES (?, ?, ?, ?, ?, ?)',
    id, base, ctx.user.id, String(input.segment), name, input.class_id ?? null);
  return { id };
}

/** Uma pasta para cada turma ativa que ainda não tem (uma só consulta de gravação). */
export async function createClassFolders(ctx: Ctx, segment: string) {
  const base = requireRole(ctx, 'gestor', 'professor');
  const res = await run(ctx.db,
    `INSERT INTO plan_folders (id, base_id, author_id, segment, name, class_id)
     SELECT lower(hex(randomblob(16))), c.base_id, ?, ?, c.name, c.id FROM classes c
      WHERE c.base_id = ? AND c.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM plan_folders f WHERE f.base_id = c.base_id AND f.segment = ? AND f.class_id = c.id)`,
    ctx.user.id, segment, base, segment);
  return { created: res.meta.changes ?? 0 };
}

export async function renamePlanFolder(ctx: Ctx, id: string, name: string) {
  requireRole(ctx, 'gestor', 'professor');
  const f = await folderInBase(ctx, id);
  if (f.author_id !== ctx.user.id && !isManager(ctx)) fail('Só quem criou a pasta ou a gestão pode renomear.', 403);
  await run(ctx.db, 'UPDATE plan_folders SET name = ? WHERE id = ?', cleanName(name), id);
}

export async function deletePlanFolder(ctx: Ctx, id: string) {
  requireRole(ctx, 'gestor', 'professor');
  const f = await folderInBase(ctx, id);
  if (f.author_id !== ctx.user.id && !isManager(ctx)) fail('Só quem criou a pasta ou a gestão pode excluir.', 403);
  // Os arquivos não são apagados: voltam para a raiz (ON DELETE SET NULL).
  await run(ctx.db, 'DELETE FROM plan_folders WHERE id = ?', id);
}

/** Move arquivos para uma pasta (null = raiz). Só os seus, ou qualquer um se for da gestão. */
export async function movePlanDocs(ctx: Ctx, ids: string[], folderId: string | null) {
  const base = requireRole(ctx, 'gestor', 'professor');
  if (!Array.isArray(ids) || !ids.length) return { moved: 0 };
  let seg: string | null = null;
  if (folderId) seg = (await folderInBase(ctx, folderId)).segment;
  const mine = isManager(ctx) ? '' : ' AND author_id = ?';
  const args: (string | null)[] = [folderId, seg, JSON.stringify(ids.slice(0, 200)), base];
  if (!isManager(ctx)) args.push(ctx.user.id);
  // Mover para pasta de outro segmento também muda o segmento do arquivo.
  const res = await run(ctx.db, `UPDATE plan_docs SET folder_id = ?, segment = COALESCE(?, segment) WHERE id IN ${inList} AND base_id = ?${mine}`, ...args);
  return { moved: res.meta.changes ?? 0 };
}
