import { requireBase, requireRole, type Ctx } from '../auth';
import { all, fail, first, inList, now, run } from '../db';
import { docInBase } from './editor';

/**
 * Assistente (RAG) sobre os documentos do Planejamento. Tudo no Cloudflare (plano gratuito):
 * o navegador extrai o texto e quebra em trechos (o Worker tem só 10 ms de CPU); aqui só embutimos
 * (bge-m3, multilíngue), guardamos no Vectorize e, na pergunta, buscamos os trechos e pedimos a resposta.
 */
const EMBED_MODEL = '@cf/baai/bge-m3';
const CHAT_MODEL = '@cf/google/gemma-3-12b-it';
const MAX_CHUNKS = 300;
const MAX_CHUNK_CHARS = 1500;
const EMBED_BATCH = 50;
const DAILY_QUESTIONS = 60; // protege a cota gratuita do Workers AI

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ai = (env: Ctx['env']) => env.AI as any;

async function embed(ctx: Ctx, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const r = await ai(ctx.env).run(EMBED_MODEL, { text: texts.slice(i, i + EMBED_BATCH) }).catch((e: Error) => {
      console.error('embed', e);
      return fail('O assistente está indisponível agora (limite diário do Cloudflare?). Tente mais tarde.', 503);
    });
    out.push(...(r.data as number[][]));
  }
  return out;
}

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
      id: `${d.id}:${i}`, values, metadata: { base_id: d.base_id, doc_id: d.id, text: c0(list[i]) },
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

/** Pergunta aos documentos da base (ou só a alguns: docIds). */
export async function ragAsk(ctx: Ctx, question: string, docIds?: string[]) {
  const base = requireBase(ctx);
  const q = String(question || '').trim().slice(0, 600);
  if (q.length < 3) fail('Escreva a pergunta.');

  // Limite diário por pessoa (a cota gratuita do Workers AI é da conta toda).
  const key = `rag:${ctx.user.id}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await ctx.env.FILES.get(key)) || 0);
  if (used >= DAILY_QUESTIONS) fail(`Você usou as ${DAILY_QUESTIONS} perguntas de hoje. Volte amanhã.`, 429);
  await ctx.env.FILES.put(key, String(used + 1), { expirationTtl: 86400 });

  const [qv] = await embed(ctx, [q]);
  const filter: VectorizeVectorMetadataFilter = { base_id: base };
  if (docIds?.length) filter.doc_id = { $in: docIds.slice(0, 50) };
  const found = await ctx.env.VECTORIZE.query(qv, { topK: 8, returnMetadata: 'all', filter });
  const hits = found.matches.filter((m) => m.score > 0.3 && typeof m.metadata?.text === 'string');
  if (!hits.length) return { answer: 'Não encontrei nada sobre isso nos documentos. Tente outras palavras ou confira se os documentos já foram preparados.', sources: [] };

  const ids = [...new Set(hits.map((h) => String(h.metadata!.doc_id)))];
  const docs = await all<{ id: string; name: string }>(ctx.db, `SELECT id, name FROM plan_docs WHERE base_id = ? AND id IN ${inList}`, base, JSON.stringify(ids));
  const nameOf = new Map(docs.map((d) => [d.id, d.name]));
  const context = hits.map((h, i) => `[${i + 1}] (${nameOf.get(String(h.metadata!.doc_id)) ?? 'documento'})\n${h.metadata!.text}`).join('\n\n');

  const r = await ai(ctx.env).run(CHAT_MODEL, {
    max_tokens: 700,
    messages: [
      { role: 'system', content: 'Você é o assistente pedagógico do SCOLA. Responda em português do Brasil, de forma objetiva, usando SOMENTE os trechos fornecidos. Se a resposta não estiver nos trechos, diga que não encontrou. Cite a origem com [número] ao fim das frases. Nunca invente.' },
      { role: 'user', content: `Trechos dos documentos:\n\n${context}\n\nPergunta: ${q}` },
    ],
  }).catch((e: Error) => {
    console.error('chat', e);
    return fail('O assistente está indisponível agora (limite diário do Cloudflare?). Tente mais tarde.', 503);
  });
  const answer = String(r?.response ?? r?.choices?.[0]?.message?.content ?? '').trim() || 'Não consegui montar a resposta. Tente reformular.';

  // Só as fontes realmente citadas (ou todas, se o modelo não citou número).
  const cited = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]) - 1).filter((i) => hits[i]);
  const used2 = cited.length ? [...new Set(cited)] : hits.map((_, i) => i);
  const seen = new Set<string>();
  const sources = used2.flatMap((i) => {
    const id = String(hits[i].metadata!.doc_id);
    if (seen.has(id) || !nameOf.has(id)) return [];
    seen.add(id);
    return [{ doc_id: id, name: nameOf.get(id)!, snippet: String(hits[i].metadata!.text).slice(0, 220) }];
  });
  return { answer, sources };
}
