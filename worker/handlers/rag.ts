import { requireBase, requireRole, type Ctx } from '../auth';
import { all, fail, inList, now, parse, run, stmt } from '../db';
import { docInBase } from './editor';
import { aiConfig, aiLabel, embedTexts, generate } from '../ai';

/**
 * Assistente (RAG) sobre os documentos do Planejamento. Tudo no Cloudflare (plano gratuito):
 * o navegador extrai o texto e quebra em trechos (o Worker tem só 10 ms de CPU); aqui só embutimos
 * (modelo configurável por chave), guardamos no Vectorize e, na pergunta, buscamos os trechos e pedimos a resposta.
 */
const MAX_CHUNKS = 300;
const MAX_CHUNK_CHARS = 1500;
const dailyLimit = (ctx: Ctx) => Number(ctx.env.AI_DAILY_LIMIT) || 60; // limita o gasto da chave

const embed = (ctx: Ctx, texts: string[]) => embedTexts(ctx.env, texts);

/** Documentos que precisam ser (re)indexados e o andamento geral. */
export async function ragStatus(ctx: Ctx) {
  const base = requireBase(ctx);
  const rows = await all<{ id: string; name: string; kind: string; google_kind: string | null; stale: number; rag_chunks: number | null }>(ctx.db,
    `SELECT id, name, kind, google_kind, rag_chunks,
            CASE WHEN rag_at IS NULL OR rag_at < COALESCE(updated_at, created_at) THEN 1 ELSE 0 END AS stale
       FROM plan_docs WHERE base_id = ? AND NOT (kind = 'google' AND COALESCE(google_kind, '') NOT IN ('document', 'spreadsheet', 'presentation'))`, base);
  return {
    total: rows.length,
    ready: rows.filter((r) => !r.stale && (r.rag_chunks ?? 0) > 0).length,
    pending: rows.filter((r) => r.stale).map((r) => ({ id: r.id, name: r.name, kind: r.kind, google_kind: r.google_kind })),
  };
}

/** Guarda os trechos de um documento (substitui os anteriores). chunks vazio = documento sem texto aproveitável. */
export async function ragIndexDoc(ctx: Ctx, docId: string, chunks: string[]) {
  requireRole(ctx, 'gestor', 'professor');
  const d = await docInBase(ctx, docId);
  const list = (Array.isArray(chunks) ? chunks : []).map((c) => String(c).trim().slice(0, MAX_CHUNK_CHARS)).filter((c) => c.length > 20).slice(0, MAX_CHUNKS);
  const old = d.rag_chunks ?? 0;
  for (let i = 0; i < old; i += 1000) {
    await ctx.env.VECTORIZE.deleteByIds(Array.from({ length: Math.min(1000, old - i) }, (_, k) => `${d.id}:${i + k}`));
  }
  if (list.length) {
    const vectors = await embed(ctx, list.map((c) => `${d.name}\n${c}`));
    await ctx.env.VECTORIZE.upsert(vectors.map((values, i) => ({
      id: `${d.id}:${i}`, values, metadata: { base_id: d.base_id, doc_id: d.id, kind: 'doc', vis: 'all', title: d.name, text: c0(list[i]) },
    })));
  }
  await run(ctx.db, 'UPDATE plan_docs SET rag_chunks = ?, rag_at = ? WHERE id = ?', list.length, now(), d.id);
  return { chunks: list.length };
}
const c0 = (s: string) => s.slice(0, 3000);

/** Remove os vetores de um documento (usado ao excluir o arquivo). */
export async function ragForget(ctx: Ctx, docId: string, chunks: number | null) {
  for (let i = 0; i < (chunks ?? 0); i += 1000) {
    await ctx.env.VECTORIZE.deleteByIds(Array.from({ length: Math.min(1000, (chunks ?? 0) - i) }, (_, k) => `${docId}:${i + k}`)).catch((e) => console.error('rag forget', e));
  }
}

/* ------------------- Avisos, calendários, planejamentos e provas ------------------- */
type Item = { id: string; kind: string; title: string; text: string; vis: string; owner: string };
const KIND_LABEL: Record<string, string> = { doc: 'Documento', notice: 'Aviso', calendar: 'Calendário', plan: 'Planejamento', exam: 'Prova' };
const SYNC_BATCH = 10;

const stripHtml = (h: string) => h.replace(/<\/(p|div|li|h\d|tr)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const strings = (v: unknown, out: string[] = [], depth = 0): string[] => {
  if (depth > 6) return out;
  if (typeof v === 'string') { if (v.trim().length > 1) out.push(v.trim()); }
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out, depth + 1));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out, depth + 1));
  return out;
};
const dateBr = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');

async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Trechos de ~900 caracteres (mesma ideia do navegador, para o que nasce no servidor). */
function chunk(text: string, size = 900, overlap = 120): string[] {
  const parts = text.split(/\n+/).flatMap((p) => (p.length > size ? p.match(new RegExp(`.{1,${size}}`, 'gs')) ?? [] : [p]));
  const out: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && cur.length + p.length + 1 > size) { out.push(cur); cur = cur.slice(-overlap) + ' ' + p; }
    else cur = cur ? `${cur}\n${p}` : p;
  }
  if (cur.trim().length > 20) out.push(cur);
  return out.slice(0, 60);
}

async function collectItems(ctx: Ctx, base: string): Promise<Item[]> {
  const [notices, cals, plans, msgs, exams, classes] = await Promise.all([
    all<{ id: string; author_id: string; title: string; body: string; audience: string; target_role: string | null; target_user: string | null; created_at: string }>(ctx.db,
      'SELECT id, author_id, title, body, audience, target_role, target_user, created_at FROM notices WHERE base_id = ?', base),
    all<{ id: string; title: string; data: string; created_by: string | null }>(ctx.db, 'SELECT id, title, data, created_by FROM calendars WHERE base_id = ?', base),
    all<{ id: string; author_id: string; class_id: string | null; title: string; week_start: string | null; content: string; plan_data: string | null; status: string; feedback: string | null }>(ctx.db,
      'SELECT id, author_id, class_id, title, week_start, content, plan_data, status, feedback FROM lesson_plans WHERE base_id = ?', base),
    all<{ plan_id: string; body: string; created_at: string }>(ctx.db, 'SELECT plan_id, body, created_at FROM lesson_plan_messages WHERE base_id = ? ORDER BY created_at', base),
    all<{ id: string; author_id: string | null; class_id: string; title: string; exam_date: string | null; questions: number }>(ctx.db,
      'SELECT id, author_id, class_id, title, exam_date, questions FROM exams WHERE base_id = ?', base),
    all<{ id: string; name: string }>(ctx.db, 'SELECT id, name FROM classes WHERE base_id = ?', base),
  ]);
  const cls = new Map(classes.map((c) => [c.id, c.name]));
  const items: Item[] = [];

  for (const n of notices) {
    const vis = n.audience === 'role' && n.target_role ? `role:${n.target_role}` : n.audience === 'user' && n.target_user ? `user:${n.target_user}` : 'all';
    items.push({ id: `notice:${n.id}`, kind: 'notice', title: n.title, vis, owner: n.author_id, text: `Aviso "${n.title}" (${dateBr(n.created_at)})\n${stripHtml(n.body)}` });
  }
  for (const c of cals) {
    const d = parse<{ events?: { title: string; categoryId: string; start: string; end?: string }[]; categories?: { id: string; label: string }[] }>(c.data, {});
    const cats = new Map((d.categories ?? []).map((x) => [x.id, x.label]));
    const lines = (d.events ?? []).filter((e) => e?.start && e.title).sort((a, b) => a.start.localeCompare(b.start))
      .map((e) => `${dateBr(e.start)}${e.end && e.end !== e.start ? ' a ' + dateBr(e.end) : ''}: ${e.title} (${cats.get(e.categoryId) ?? 'Evento'})`);
    if (lines.length) items.push({ id: `calendar:${c.id}`, kind: 'calendar', title: c.title, vis: 'all', owner: c.created_by ?? '', text: `Calendário "${c.title}"\n${lines.join('\n')}` });
  }
  const byPlan = new Map<string, string[]>();
  for (const m of msgs) (byPlan.get(m.plan_id) ?? byPlan.set(m.plan_id, []).get(m.plan_id)!).push(`Comentário (${dateBr(m.created_at)}): ${m.body}`);
  for (const p of plans) {
    const extra = strings(parse(p.plan_data, null)).join('\n');
    const text = [`Planejamento "${p.title}"${p.class_id && cls.get(p.class_id) ? ' — turma ' + cls.get(p.class_id) : ''}${p.week_start ? ' — semana de ' + dateBr(p.week_start) : ''} (${p.status})`,
      stripHtml(p.content || ''), extra, p.feedback ? `Retorno da gestão: ${p.feedback}` : '', ...(byPlan.get(p.id) ?? [])].filter(Boolean).join('\n');
    // Só autor e gestão veem os planejamentos individuais.
    items.push({ id: `plan:${p.id}`, kind: 'plan', title: p.title, vis: 'role:gestor', owner: p.author_id, text });
  }
  for (const e of exams) {
    items.push({ id: `exam:${e.id}`, kind: 'exam', title: e.title, vis: 'role:gestor', owner: e.author_id ?? '',
      text: `Prova "${e.title}" — turma ${cls.get(e.class_id) ?? '?'}${e.exam_date ? ' — ' + dateBr(e.exam_date) : ''} — ${e.questions} questões` });
  }
  return items;
}

/** Atualiza o índice com avisos, calendários, planejamentos e provas. Chame em laço até remaining = 0. */
export async function ragSync(ctx: Ctx) {
  const base = requireBase(ctx);
  const items = await collectItems(ctx, base);
  const known = new Map((await all<{ id: string; hash: string; chunks: number }>(ctx.db, 'SELECT id, hash, chunks FROM rag_items WHERE base_id = ?', base)).map((r) => [r.id, r]));
  const hashed = await Promise.all(items.map(async (it) => ({ it, hash: await sha(`${it.vis}|${it.owner}|${it.title}|${it.text}`) })));
  const stale = hashed.filter(({ it, hash }) => known.get(it.id)?.hash !== hash);
  const alive = new Set(items.map((i) => i.id));
  const orphans = [...known.keys()].filter((id) => !alive.has(id));

  const todo = stale.slice(0, SYNC_BATCH);
  const gone = orphans.slice(0, Math.max(0, SYNC_BATCH - todo.length));
  const delIds: string[] = [];
  for (const { it } of todo) for (let i = 0; i < (known.get(it.id)?.chunks ?? 0); i++) delIds.push(`${it.id}:${i}`);
  for (const id of gone) for (let i = 0; i < (known.get(id)?.chunks ?? 0); i++) delIds.push(`${id}:${i}`);
  for (let i = 0; i < delIds.length; i += 1000) await ctx.env.VECTORIZE.deleteByIds(delIds.slice(i, i + 1000));

  const pieces = todo.map(({ it }) => ({ it, parts: chunk(it.text) }));
  const flat = pieces.flatMap((p) => p.parts.map((t, i) => ({ it: p.it, t, i })));
  if (flat.length) {
    const vecs = await embed(ctx, flat.map((f) => `${KIND_LABEL[f.it.kind]}: ${f.it.title}\n${f.t}`));
    for (let i = 0; i < flat.length; i += 500) {
      await ctx.env.VECTORIZE.upsert(flat.slice(i, i + 500).map((f, k) => ({
        id: `${f.it.id}:${f.i}`, values: vecs[i + k],
        metadata: { base_id: base, kind: f.it.kind, ref: f.it.id, vis: f.it.vis, owner: f.it.owner || 'none', title: f.it.title.slice(0, 120), text: c0(f.t) },
      })));
    }
  }
  const writes = [
    ...pieces.map(({ it, parts }, i) => stmt(ctx.db,
      `INSERT INTO rag_items (id, base_id, hash, chunks, indexed_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET hash = excluded.hash, chunks = excluded.chunks, indexed_at = excluded.indexed_at`,
      it.id, base, todo[i].hash, parts.length, now())),
    ...gone.map((id) => stmt(ctx.db, 'DELETE FROM rag_items WHERE id = ?', id)),
  ];
  if (writes.length) await ctx.db.batch(writes);
  return { remaining: stale.length - todo.length + orphans.length - gone.length };
}

/** Pergunta ao assistente: documentos e demais conteúdos que a pessoa pode ver (ou só alguns documentos: docIds). */
export async function ragAsk(ctx: Ctx, question: string, docIds?: string[]) {
  const base = requireBase(ctx);
  const q = String(question || '').trim().slice(0, 600);
  if (q.length < 3) fail('Escreva a pergunta.');

  // Limite diário por pessoa (protege o gasto da chave).
  const key = `rag:${ctx.user.id}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await ctx.env.FILES.get(key)) || 0);
  if (used >= dailyLimit(ctx)) fail(`Você usou as ${dailyLimit(ctx)} perguntas de hoje. Volte amanhã.`, 429);
  await ctx.env.FILES.put(key, String(used + 1), { expirationTtl: 86400 });

  const [qv] = await embed(ctx, [q]);
  // Busca na escola toda e filtra a visibilidade aqui: é de todos, do seu papel, de você, ou foi você quem criou.
  const role = ctx.role === 'superadmin' || ctx.isAdmin ? 'gestor' : ctx.role;
  const allowed = new Set(['all', `role:${role}`, `user:${ctx.user.id}`]);
  const filter: VectorizeVectorMetadataFilter = { base_id: base };
  if (docIds?.length) filter.doc_id = { $in: docIds.slice(0, 50) };
  const found = await ctx.env.VECTORIZE.query(qv, { topK: 20, returnMetadata: 'all', filter });
  const hits = found.matches
    .filter((m) => typeof m.metadata?.text === 'string' && m.score > 0.3)
    .filter((m) => allowed.has(String(m.metadata!.vis ?? 'all')) || m.metadata!.owner === ctx.user.id)
    .slice(0, 8);
  if (!hits.length) return { answer: 'Não encontrei nada sobre isso. Tente outras palavras ou confira se o conteúdo já foi preparado.', sources: [] };

  const docRefs = [...new Set(hits.filter((h) => (h.metadata!.kind ?? 'doc') === 'doc').map((h) => String(h.metadata!.doc_id)))];
  const docs = docRefs.length ? await all<{ id: string; name: string }>(ctx.db, `SELECT id, name FROM plan_docs WHERE base_id = ? AND id IN ${inList}`, base, JSON.stringify(docRefs)) : [];
  const nameOf = new Map(docs.map((d) => [d.id, d.name]));
  const label = (h: (typeof hits)[number]) => {
    const kind = String(h.metadata!.kind ?? 'doc');
    return { kind, name: kind === 'doc' ? nameOf.get(String(h.metadata!.doc_id)) ?? String(h.metadata!.title ?? 'documento') : String(h.metadata!.title ?? '') };
  };
  const context = hits.map((h, i) => { const l = label(h); return `[${i + 1}] (${KIND_LABEL[l.kind] ?? l.kind}: ${l.name})\n${h.metadata!.text}`; }).join('\n\n');

  const answer = (await generate(ctx.env, [
    { role: 'system', content: `Você é o assistente do SCOLA, sistema de gestão escolar. Hoje é ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}. Responda em português do Brasil, de forma objetiva, usando SOMENTE os trechos fornecidos (documentos, avisos, calendário, planejamentos, provas). Se a resposta não estiver nos trechos, diga que não encontrou. Cite a origem com [número] ao fim das frases. Nunca invente.` },
    { role: 'user', content: `Trechos:\n\n${context}\n\nPergunta: ${q}` },
  ])) || 'Não consegui montar a resposta. Tente reformular.';

  const cited = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]) - 1).filter((i) => hits[i]);
  const order = cited.length ? [...new Set(cited)] : hits.map((_, i) => i);
  const seen = new Set<string>();
  const sources = order.flatMap((i) => {
    const h = hits[i];
    const l = label(h);
    const id = String(h.metadata!.doc_id ?? h.metadata!.ref);
    if (seen.has(id) || !l.name) return [];
    seen.add(id);
    return [{ doc_id: id, kind: l.kind, name: l.name, snippet: String(h.metadata!.text).slice(0, 220) }];
  });
  return { answer, sources };
}

/** Qual motor está ativo (todos veem o nome; só o administrador pode testar a chave). */
export async function assistantInfo(ctx: Ctx) {
  const c = aiConfig(ctx.env);
  return { label: aiLabel(ctx.env), provider: c.provider, chatReady: c.chatReady, embedReady: c.embedReady, configured: c.chatReady && c.embedReady, canTest: ctx.isAdmin };
}

export async function testAssistant(ctx: Ctx) {
  if (!ctx.isAdmin) fail('Só o administrador da plataforma pode testar.', 403);
  const t0 = Date.now();
  const text = await generate(ctx.env, [{ role: 'user', content: 'Responda apenas: OK' }], 20);
  await embedTexts(ctx.env, ['teste']);
  return { ok: !!text, reply: text.slice(0, 40), ms: Date.now() - t0, label: aiLabel(ctx.env) };
}
