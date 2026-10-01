import { assertClassInBase, requireRole, type Ctx } from '../auth';
import { fail, first, now, run, uid } from '../db';
import { googleConfigured, googleFetch, revokeAndForget } from '../google';

/** Situação da integração para o usuário logado (a tela decide se mostra "Conectar Google"). */
export async function getGoogleStatus(ctx: Ctx) {
  const acc = await first<{ google_email: string; connected_at: string }>(ctx.db, 'SELECT google_email, connected_at FROM google_accounts WHERE user_id = ?', ctx.user.id);
  return { available: googleConfigured(ctx.env), connected: !!acc, email: acc?.google_email ?? null, connected_at: acc?.connected_at ?? null };
}

export async function disconnectGoogle(ctx: Ctx) {
  await revokeAndForget(ctx.env, ctx.user.id);
  return { ok: true };
}

const GOOGLE_TYPES = {
  document: { mime: 'application/vnd.google-apps.document', label: 'Documento sem título' },
  spreadsheet: { mime: 'application/vnd.google-apps.spreadsheet', label: 'Planilha sem título' },
  presentation: { mime: 'application/vnd.google-apps.presentation', label: 'Apresentação sem título' },
  form: { mime: 'application/vnd.google-apps.form', label: 'Formulário sem título' },
} as const;
export const googleLink = (kind: string, id: string) =>
  `https://docs.google.com/${kind === 'form' ? 'forms' : kind}/d/${id}/edit`;

/** Cria um Doc/Sheet/Slides no Google Drive de quem chamou e registra na central de planejamento. */
export async function createGoogleDoc(ctx: Ctx, input: {
  gkind: keyof typeof GOOGLE_TYPES; name?: string; segment: string; term?: number | null; class_id?: string | null; turma_label?: string | null;
}) {
  const base = requireRole(ctx, 'gestor', 'professor');
  const t = GOOGLE_TYPES[input.gkind];
  if (!t) fail('Tipo inválido.');
  await assertClassInBase(ctx, base, input.class_id ?? null);
  const name = String(input.name || '').trim() || t.label;
  const r = await googleFetch(ctx.env, ctx.user.id, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: t.mime }),
  });
  const { id: gid } = (await r.json()) as { id: string };
  const id = uid();
  await run(ctx.db,
    `INSERT INTO plan_docs (id, base_id, author_id, segment, term, class_id, turma_label, name, mime, kind, version, updated_at, updated_by, google_id, google_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'google', 0, ?, ?, ?, ?)`,
    id, base, ctx.user.id, String(input.segment || 'geral'), input.term ?? null, input.class_id ?? null, input.turma_label ?? null,
    name, t.mime, now(), ctx.user.id, gid, input.gkind);
  return { id, link: googleLink(input.gkind, gid) };
}
