import { fail, HttpError, type Env } from './db';

/**
 * IA do Assistente — tudo por chave de API (segredos do Worker), nada embutido:
 *  Respostas:  AI_PROVIDER = nvidia | anthropic | openai, AI_API_KEY, AI_MODEL (opcional),
 *              "nvidia" (build.nvidia.com) já vem pronto: uma chave nvapi-… serve para respostas e busca.
 *              AI_BASE_URL (só "openai": qualquer API compatível — Gemini, Groq, OpenRouter...; padrão https://api.openai.com/v1)
 *              Com "nvidia", cada tarefa (texto, visão, imagem) tem sua fila de modelos com troca automática
 *              (AI_VISION_MODEL / AI_IMAGE_MODEL opcionais).
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

/* ------------------------- NVIDIA: um modelo para cada tarefa ------------------------- */
/**
 * Cada tarefa tem uma fila de modelos. Usa o primeiro; se ele falhar (fora do ar, sobrecarregado,
 * aposentado, resposta vazia), troca sozinho para o próximo e evita o que falhou por 10 minutos.
 * AI_MODEL / AI_VISION_MODEL / AI_IMAGE_MODEL põem um modelo na frente da fila.
 */
export type Task = 'texto' | 'visao' | 'imagem';
const NV_CHAINS: Record<Task, string[]> = {
  texto: ['openai/gpt-oss-20b', 'nvidia/nemotron-3-super-120b-a12b', 'google/gemma-4-31b-it', 'moonshotai/kimi-k3'],
  visao: ['google/gemma-4-31b-it', 'meta/llama-3.2-90b-vision-instruct', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'],
  imagem: ['black-forest-labs/flux.1-dev', 'black-forest-labs/flux.2-klein-4b'],
};
const MODEL_LABEL: Record<string, string> = {
  'openai/gpt-oss-20b': 'GPT-OSS 20B', 'nvidia/nemotron-3-super-120b-a12b': 'Nemotron Super', 'google/gemma-4-31b-it': 'Gemma 4',
  'moonshotai/kimi-k3': 'Kimi K3', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': 'Nemotron Omni', 'meta/llama-3.2-90b-vision-instruct': 'Llama Vision',
  'black-forest-labs/flux.1-dev': 'FLUX.1', 'black-forest-labs/flux.2-klein-4b': 'FLUX.2 Klein',
};
export const modelLabel = (m: string) => MODEL_LABEL[m] ?? m.split('/').pop() ?? m;
const resting = new Map<string, number>();

function chainFor(env: Env, task: Task) {
  const pinned = task === 'texto' ? env.AI_MODEL : task === 'visao' ? env.AI_VISION_MODEL : env.AI_IMAGE_MODEL;
  const list = [...new Set([pinned, ...NV_CHAINS[task]].filter((m): m is string => !!m))];
  // Quem falhou há pouco vai para o fim da fila (não some: pode ser o único disponível agora).
  const now = Date.now();
  return [...list.filter((m) => (resting.get(m) ?? 0) < now), ...list.filter((m) => (resting.get(m) ?? 0) >= now)];
}

class Skip extends Error {}

/** Tempos por tarefa: quando chamar um modelo reserva em paralelo, quanto esperar cada um e o prazo total. */
const TIMING: Record<Task, { hedgeMs: number; perMs: number; totalMs: number }> = {
  texto: { hedgeMs: 25_000, perMs: 60_000, totalMs: 90_000 },
  visao: { hedgeMs: 18_000, perMs: 60_000, totalMs: 95_000 },
  imagem: { hedgeMs: 22_000, perMs: 60_000, totalMs: 90_000 },
};

/**
 * Pedido com reserva: começa no melhor modelo; se ele demorar (hedgeMs) ou falhar, dispara o próximo
 * em paralelo e fica com o primeiro que responder (os outros são cancelados). 401/403 (chave) para na hora.
 * A NVIDIA gratuita varia muito de velocidade: assim ninguém fica preso num modelo congestionado.
 */
function withFallback<T>(env: Env, task: Task, attempt: (model: string, signal: AbortSignal) => Promise<T>): Promise<T & { model: string }> {
  const models = chainFor(env, task);
  const { hedgeMs, perMs, totalMs } = TIMING[task];
  return new Promise((resolve, reject) => {
    let next = 0;
    let running = 0;
    let done = false;
    let last = '';
    let hedge: ReturnType<typeof setTimeout> | null = null;
    const ctrls: AbortController[] = [];
    const finish = () => {
      done = true;
      clearTimeout(hedge);
      clearTimeout(deadline);
      ctrls.forEach((c) => c.abort());
    };
    const giveUp = () => {
      if (done) return;
      finish();
      console.error('ai: nenhum modelo respondeu', task, last);
      reject(new HttpError(503, task === 'imagem'
        ? 'Os modelos de imagem estão congestionados agora. Tente de novo em instantes.'
        : 'A IA está congestionada agora. Tente de novo em instantes.'));
    };
    const deadline = setTimeout(giveUp, totalMs);
    const launch = () => {
      if (done || next >= models.length) return;
      const model = models[next++];
      const ac = new AbortController();
      ctrls.push(ac);
      running++;
      const timer = setTimeout(() => ac.abort(), perMs);
      clearTimeout(hedge);
      hedge = setTimeout(launch, hedgeMs);
      attempt(model, ac.signal).then(
        (r) => {
          clearTimeout(timer);
          if (done) return;
          finish();
          resolve({ ...r, model });
        },
        (e) => {
          clearTimeout(timer);
          running--;
          if (done) return;
          if (!(e instanceof Skip)) {
            finish();
            reject(e);
            return;
          }
          last = `${model}: ${e.message}`;
          resting.set(model, Date.now() + 10 * 60_000);
          console.error('ai fallback', task, last);
          if (next < models.length) launch();
          else if (running === 0) giveUp();
        },
      );
    };
    launch();
  });
}

async function nvPost(env: Env, url: string, body: unknown, signal: AbortSignal) {
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${env.AI_API_KEY}` },
    body: JSON.stringify(body),
  }).catch((e) => {
    throw new Skip(`rede/tempo: ${(e as Error)?.message}`);
  });
  if (res.status === 401 || res.status === 403) await providerError('nvidia', res);
  if (!res.ok) throw new Skip(`${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json().catch(() => {
    throw new Skip('resposta inválida');
  });
}

export type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type RichMsg = { role: 'system' | 'user' | 'assistant'; content: string | Part[] };

/** Conversa na NVIDIA escolhendo o modelo da tarefa (texto ou visão), com troca automática. */
export async function nvChat(env: Env, task: 'texto' | 'visao', messages: RichMsg[], maxTokens = 1500, temperature?: number) {
  const c = aiConfig(env);
  if (!c.chatReady) fail(NOT_CONFIGURED, 503);
  return withFallback(env, task, async (model, signal) => {
    // Modelos que "pensam" antes gastam parte dos tokens nisso: dá folga para a resposta não sair cortada.
    const j = (await nvPost(env, `${c.baseUrl}/chat/completions`, {
      model, messages, max_tokens: maxTokens + 800, ...(temperature != null ? { temperature } : {}),
    }, signal)) as { choices?: { message?: { content?: string } }[] };
    const text = clean(String(j.choices?.[0]?.message?.content ?? ''));
    if (!text) throw new Skip('resposta vazia');
    return { text };
  });
}

/** Imagem (FLUX) a partir de um pedido em inglês. Devolve data URL JPEG. */
export async function nvImage(env: Env, prompt: string, size: { width: number; height: number } = { width: 1024, height: 768 }) {
  const c = aiConfig(env);
  if (c.provider !== 'nvidia' || !c.chatReady) fail('Imagens com IA precisam da NVIDIA configurada (AI_PROVIDER=nvidia).', 503);
  return withFallback(env, 'imagem', async (model, signal) => {
    const klein = model.includes('klein');
    const j = (await nvPost(env, `https://ai.api.nvidia.com/v1/genai/${model}`, {
      prompt: prompt.slice(0, 1500), width: size.width, height: size.height, seed: Math.floor(Math.random() * 1e6),
      ...(klein ? { steps: 4 } : { steps: 28, cfg_scale: 3.5, mode: 'base' }),
    }, signal)) as { artifacts?: { base64?: string; finishReason?: string }[] };
    const a = j.artifacts?.[0];
    if (a?.finishReason === 'CONTENT_FILTERED') fail('O pedido de imagem foi bloqueado pelo filtro de conteúdo. Tente descrever de outro jeito.', 422);
    if (!a?.base64) throw new Skip('sem imagem');
    return { image: `data:image/jpeg;base64,${a.base64}` };
  });
}

/** Gera a resposta no provedor configurado. Erros viram mensagens amigáveis (a chave nunca aparece). */
export async function generate(env: Env, messages: Msg[], maxTokens = 700, temperature?: number): Promise<string> {
  const c = aiConfig(env);
  if (!c.chatReady) fail(NOT_CONFIGURED, 503);
  if (c.provider === 'nvidia') return (await nvChat(env, 'texto', messages, maxTokens, temperature)).text;
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
        body: JSON.stringify({ model: c.model, max_tokens: maxTokens, messages, ...(temperature != null ? { temperature } : {}) }),
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
