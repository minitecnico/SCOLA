import { assertClassInBase, requireBase, requireRole, type Ctx } from '../auth';
import { all, fail, first, now, run, uid } from '../db';

/**
 * Editor de documentos e planilhas do Planejamento (alternativa ao Google Docs/Sheets,
 * rodando no próprio SCOLA). O conteúdo editável fica no KV (c:<id>) e o arquivo
 * .docx/.xlsx atualizado em f:<id>. Uma trava "em edição por Fulano" evita que duas
 * pessoas sobrescrevam o trabalho uma da outra.
 */
export type DocKind = 'file' | 'doc' | 'sheet';
export const LOCK_MS = 2 * 60_000; // renovada a cada 30 s enquanto o editor está aberto
const VERSION_EVERY_MS = 15 * 60_000; // uma cópia no histórico a cada 15 min de edição

export type PlanDocRow = {
  id: string; base_id: string; author_id: string; segment: string; term: number | null; class_id: string | null; turma_label: string | null;
  name: string; mime: string | null; created_at: string; kind: DocKind; version: number; updated_at: string | null; updated_by: string | null;
  lock_by: string | null; lock_until: string | null; size: number | null;
  google_id: string | null; google_kind: string | null; rag_chunks: number | null;
};

const isManager = (ctx: Ctx) => ctx.isAdmin || ctx.role === 'gestor' || ctx.role === 'superadmin';

export async function docInBase(ctx: Ctx, id: string) {
  const base = requireBase(ctx);
  const d = await first<PlanDocRow>(ctx.db, 'SELECT * FROM plan_docs WHERE id = ? AND base_id = ?', id, base);
  if (!d) fail('Documento não encontrado.', 404);
  return d!;
}

/** Quem pode editar: quem criou e a gestão. Os demais leem. */
export const canEditDoc = (ctx: Ctx, d: PlanDocRow) => d.author_id === ctx.user.id || isManager(ctx);

const lockActive = (d: PlanDocRow) => !!d.lock_by && !!d.lock_until && d.lock_until > now();

export async function createEditableDoc(ctx: Ctx, input: {
  kind: 'doc' | 'sheet'; name?: string; segment: string; term?: number | null; class_id?: string | null; turma_label?: string | null;
}) {
  const base = requireRole(ctx, 'gestor', 'professor');
  if (input.kind !== 'doc' && input.kind !== 'sheet') fail('Tipo inválido.');
  await assertClassInBase(ctx, base, input.class_id ?? null);
  const ext = input.kind === 'doc' ? '.docx' : '.xlsx';
  const raw = String(input.name || '').trim() || (input.kind === 'doc' ? 'Documento sem título' : 'Planilha sem título');
  const name = raw.toLowerCase().endsWith(ext) ? raw : raw + ext;
  const mime = input.kind === 'doc'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const id = uid();
  await run(ctx.db,
    `INSERT INTO plan_docs (id, base_id, author_id, segment, term, class_id, turma_label, name, mime, kind, version, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    id, base, ctx.user.id, String(input.segment || 'geral'), input.term ?? null, input.class_id ?? null, input.turma_label ?? null,
    name, mime, input.kind, now(), ctx.user.id);
  return { id };
}

export async function getPlanDocMeta(ctx: Ctx, id: string) {
  const d = await docInBase(ctx, id);
  const names = await all<{ id: string; full_name: string | null; email: string }>(ctx.db,
    'SELECT id, full_name, email FROM users WHERE id IN (?, ?, ?)', d.author_id, d.updated_by ?? '', d.lock_by ?? '');
  const nameOf = (uidv: string | null) => {
    const u = names.find((n) => n.id === uidv);
    return u ? u.full_name || u.email : null;
  };
  return {
    ...d,
    url: `/api/files/${d.id}`,
    author_name: nameOf(d.author_id),
    updated_by_name: nameOf(d.updated_by),
    lock: lockActive(d) && d.lock_by !== ctx.user.id ? { by: d.lock_by, name: nameOf(d.lock_by), until: d.lock_until } : null,
    can_edit: canEditDoc(ctx, d),
  };
}

/** Pega (ou renova) a trava de edição. `force`: a gestão pode assumir uma trava esquecida. */
export async function lockPlanDoc(ctx: Ctx, id: string, force = false) {
  const d = await docInBase(ctx, id);
  if (!canEditDoc(ctx, d)) fail('Você pode ver, mas não editar este documento.', 403);
  if (lockActive(d) && d.lock_by !== ctx.user.id && !(force && isManager(ctx))) {
    const u = await first<{ full_name: string | null; email: string }>(ctx.db, 'SELECT full_name, email FROM users WHERE id = ?', d.lock_by);
    return { ok: false, by: u?.full_name || u?.email || 'outra pessoa', until: d.lock_until, version: d.version };
  }
  const until = new Date(Date.now() + LOCK_MS).toISOString();
  await run(ctx.db, 'UPDATE plan_docs SET lock_by = ?, lock_until = ? WHERE id = ?', ctx.user.id, until, id);
  return { ok: true, by: null, until, version: d.version };
}

export async function unlockPlanDoc(ctx: Ctx, id: string) {
  const d = await docInBase(ctx, id);
  if (d.lock_by === ctx.user.id) await run(ctx.db, 'UPDATE plan_docs SET lock_by = NULL, lock_until = NULL WHERE id = ?', id);
}

export async function listPlanDocVersions(ctx: Ctx, id: string) {
  await docInBase(ctx, id);
  return all<{ id: string; created_at: string; author_name: string | null }>(ctx.db,
    `SELECT v.id, v.created_at, COALESCE(u.full_name, u.email) AS author_name
       FROM plan_doc_versions v LEFT JOIN users u ON u.id = v.author_id
      WHERE v.doc_id = ? ORDER BY v.created_at DESC LIMIT 50`, id);
}

/**
 * Salvamento (chamado pela rota HTTP, que recebe o conteúdo e o arquivo exportado).
 * Proteção: precisa ter a trava (ou ela estar livre) e partir da versão atual.
 */
export async function saveEditableContent(ctx: Ctx, env: { FILES: KVNamespace }, id: string, input: {
  content: string; file: ArrayBuffer | null; baseVersion: number; kind: 'doc' | 'sheet'; name?: string | null;
}) {
  const d = await docInBase(ctx, id);
  if (!canEditDoc(ctx, d)) fail('Você pode ver, mas não editar este documento.', 403);
  if (lockActive(d) && d.lock_by !== ctx.user.id) fail('Outra pessoa está editando este documento agora.', 409);
  if (d.kind !== 'file' && input.baseVersion !== d.version) fail('Este documento foi alterado em outra janela. Recarregue para ver a versão mais nova.', 409);
  if (input.content.length > 20 * 1024 * 1024) fail('Documento grande demais (máximo 20 MB, incluindo imagens).');

  // Histórico: guarda o conteúdo anterior se a última cópia tiver mais de 15 min.
  if (d.kind !== 'file' && d.version > 0) {
    const last = await first<{ created_at: string }>(ctx.db, 'SELECT created_at FROM plan_doc_versions WHERE doc_id = ? ORDER BY created_at DESC LIMIT 1', id);
    if (!last || Date.now() - Date.parse(last.created_at) > VERSION_EVERY_MS) {
      const prev = await env.FILES.get(`c:${id}`, 'text');
      if (prev) {
        const vid = uid();
        await env.FILES.put(`v:${vid}`, prev);
        await run(ctx.db, 'INSERT INTO plan_doc_versions (id, doc_id, base_id, author_id) VALUES (?, ?, ?, ?)', vid, id, d.base_id, d.updated_by ?? d.author_id);
      }
    }
  }

  await env.FILES.put(`c:${id}`, input.content);
  const ext = input.kind === 'doc' ? '.docx' : '.xlsx';
  const mime = input.kind === 'doc'
    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const baseName = String(input.name || d.name).trim().replace(/\.(docx?|xlsx?|csv|ods|odt)$/i, '') || d.name;
  const name = baseName + ext;
  if (input.file) await env.FILES.put(`f:${id}`, input.file, { metadata: { name: encodeURIComponent(name), mime } });
  const version = d.version + 1;
  const ts = now();
  const until = new Date(Date.now() + LOCK_MS).toISOString();
  await run(ctx.db,
    `UPDATE plan_docs SET kind = ?, name = ?, mime = ?, version = ?, updated_at = ?, updated_by = ?, size = COALESCE(?, size),
            lock_by = ?, lock_until = ? WHERE id = ?`,
    input.kind, name, mime, version, ts, ctx.user.id, input.file ? input.file.byteLength : null, ctx.user.id, until, id);
  return { version, updated_at: ts, name };
}
