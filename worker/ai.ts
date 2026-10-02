import { fail, type Env } from './db';

/**
 * IA do Assistente — tudo por chave de API (segredos do Worker), nada embutido:
 *  Respostas:  AI_PROVIDER = nvidia | anthropic | openai, AI_API_KEY, AI_MODEL (opcional),
 *              "nvidia" (build.nvidia.com) já vem pronto: uma chave nvapi-… serve para respostas e busca.
 *              AI_BASE_URL (só "openai": qualquer API compatível — Gemini, Groq, OpenRouter...; padrão https://api.openai.com/v1)
 *  Busca:      /embeddings de uma API compatível com OpenAI — AI_EMBED_API_KEY (ou AI_API_KEY se AI_PROVIDER=openai),
 *              AI_EMBED_BASE_URL (padrão AI_BASE_URL ou OpenAI), AI_EMBED_MODEL (padrão text-embedding-3-small).
 *              O índice do Vectorize tem 1024 dimensões: o modelo precisa aceitar "dimensions": 1024.
 *              Trocou de modelo de busca? Os vetores antigos não servem: apague o índice e reindexe (README).
 */
export type Msg = { role: 'system' | 'user' | 'assistant'; content: string };
export type Provider = 'none' | 'anthropic' | 'openai' | 'nvidia';
export const EMBED_DIMENSIONS = 1024;

const DEFAULT_MODEL: Record<string, string> = { anthropic: 'claude-haiku-4-5-20251001', openai: 'gpt-4o-mini', nvidia: 'openai/gpt-oss-20b' };
const OPENAI_BASE = 'https://api.openai.com/v1';
const NVIDIA_BASE = 'https://integrate.api.nvidia.com/v1';
const PROVIDER_LABEL: Record<string, string> = { anthropic: 'Claude (Anthropic)', openai: 'API compatível com OpenAI', nvidia: 'NVIDIA' };

export function aiConfig(env: Env) {
  const p = String(env.AI_PROVIDER || '').toLowerCase();
  const provider: Provider = p === 'anthropic' || p === 'openai' || p === 'nvidia' ? p : 'none';
  const nv = provider === 'nvidia';
  const baseUrl = (env.AI_BASE_URL || (nv ? NVIDIA_BASE : OPENAI_BASE)).replace(/\/+$/, '');
  const embedKey = env.AI_EMBED_API_KEY || (provider === 'openai' || nv ? env.AI_API_KEY : '');
  const embedBase = (env.AI_EMBED_BASE_URL || env.AI_BASE_URL || (nv ? NVIDIA_BASE : OPENAI_BASE)).replace(/\/+$/, '');
  return {
    provider,
    model: env.AI_MODEL || DEFAULT_MODEL[provider] || '',
    baseUrl,
    chatReady: provider !== 'none' && !!env.AI_API_KEY,
    embedReady: !!embedKey,
    embedKey: embedKey || '',
    embedBase,
    embedModel: env.AI_EMBED_MODEL || (embedBase.includes('nvidia.com') ? 'nvidia/llama-nemotron-embed-vl-1b-v2' : 'text-embedding-3-small'),
    // Modelos de busca da NVIDIA são assimétricos: pedem o tipo (pergunta ou trecho).
    embedTyped: embedBase.includes('nvidia.com'),
  };
}

export const aiLabel = (env: Env) => {
  const c = aiConfig(env);
  return c.chatReady ? `${PROVIDER_LABEL[c.provider]} · ${c.model}` : 'Nenhum (configure a chave de IA)';
};

/** Tira o "raciocínio" que alguns modelos devolvem junto do texto. */
const clean = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\|[a-z_]+\|>\w*/g, '').trim();

const NOT_CONFIGURED = 'O assistente ainda não foi configurado com uma chave de IA. Fale com o administrador.';

/** Gera a resposta no provedor configurado. Erros viram mensagens amigáveis (a chave nunca aparece). */
export async function generate(env: Env, messages: Msg[], maxTokens = 700, temperature?: number): Promise<string> {
  const c = aiConfig(env);
  if (!c.chatReady) fail(NOT_CONFIGURED, 503);
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system');
  const signal = AbortSignal.timeout(90_000);
  const res = await (c.provider === 'anthropic'
    ? fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', 'x-api-key': env.AI_API_KEY!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: c.model, max_tokens: maxTokens, system, messages: rest, ...(temperature != null ? { temperature } : {}) }),
      })
    : fetch(`${c.baseUrl}/chat/completions`, {
        method: 'POST',
        signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AI_API_KEY}` },
        // Modelos que "pensam" antes gastam parte dos tokens nisso: dá folga para a resposta não sair cortada.
        body: JSON.stringify({ model: c.model, max_tokens: c.provider === 'nvidia' ? maxTokens + 800 : maxTokens, messages, ...(temperature != null ? { temperature } : {}) }),
      })
  ).catch((e) => {
    console.error('ai provider chat', e);
    return fail('A IA demorou demais para responder. Tente de novo.', 504);
  });
  if (!res.ok) await providerError('chat', res);
  const j = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; choices?: { message?: { content?: string } }[] };
  return clean(String(c.provider === 'anthropic' ? (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('') : j.choices?.[0]?.message?.content ?? ''));
}

/** Vetores (1024 dimensões) para os textos, em lotes, por uma API /embeddings compatível com OpenAI. */
export async function embedTexts(env: Env, texts: string[], type: 'query' | 'passage' = 'passage'): Promise<number[][]> {
  const c = aiConfig(env);
  if (!c.embedReady) fail(NOT_CONFIGURED, 503);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const res = await fetch(`${c.embedBase}/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${c.embedKey}` },
      body: JSON.stringify({
        model: c.embedModel, input: texts.slice(i, i + 50), dimensions: EMBED_DIMENSIONS,
        ...(c.embedTyped ? { input_type: type, truncate: 'END' } : {}),
      }),
    });
    if (!res.ok) await providerError('embed', res);
    const j = (await res.json().catch(() => ({}))) as { data?: { index?: number; embedding: number[] }[] };
    const rows = [...(j.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== Math.min(50, texts.length - i) || rows.some((r) => r.embedding.length !== EMBED_DIMENSIONS)) {
      console.error('embed: resposta inesperada', rows.length, rows[0]?.embedding?.length);
      fail('O modelo de busca não devolveu vetores de 1024 dimensões. Confira AI_EMBED_MODEL.', 503);
    }
    out.push(...rows.map((r) => r.embedding));
  }
  return out;
}

async function providerError(what: string, res: Response): Promise<never> {
  console.error('ai provider', what, res.status, (await res.text().catch(() => '')).slice(0, 500));
  if (res.status === 401 || res.status === 403) fail('A chave de IA foi recusada pelo provedor. Fale com o administrador.', 503);
  if (res.status === 429) fail('O provedor de IA atingiu o limite de uso. Tente em instantes.', 503);
  if (res.status === 404 || res.status === 410) fail('O modelo de IA configurado não está mais disponível. Fale com o administrador.', 503);
  return fail('O assistente está indisponível agora. Tente mais tarde.', 503);
}
