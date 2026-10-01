import { fail, type Env } from './db';

/**
 * Motor de IA do Assistente (só a RESPOSTA; a busca usa sempre os embeddings do Workers AI, para o índice não mudar).
 * Escolha pelos segredos do Worker — sem eles, usa o Workers AI gratuito do Cloudflare:
 *   AI_PROVIDER  = workers (padrão) | anthropic | openai
 *   AI_API_KEY   = chave do provedor (anthropic/openai)
 *   AI_MODEL     = opcional (padrão: claude-haiku-4-5-20251001 | gpt-4o-mini | @cf/google/gemma-3-12b-it)
 *   AI_BASE_URL  = só para "openai": qualquer API compatível (Gemini, Groq, OpenRouter, Azure...). Padrão: https://api.openai.com/v1
 */
export type Msg = { role: 'system' | 'user' | 'assistant'; content: string };
export type Provider = 'workers' | 'anthropic' | 'openai';

const DEFAULTS: Record<Provider, string> = {
  workers: '@cf/google/gemma-3-12b-it',
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
};

export function aiConfig(env: Env) {
  const p = String(env.AI_PROVIDER || 'workers').toLowerCase();
  const provider: Provider = p === 'anthropic' || p === 'openai' ? p : 'workers';
  const needsKey = provider !== 'workers';
  return {
    provider,
    model: env.AI_MODEL || DEFAULTS[provider],
    baseUrl: (env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    configured: !needsKey || !!env.AI_API_KEY,
  };
}

const LABEL: Record<Provider, string> = { workers: 'Cloudflare Workers AI (gratuito)', anthropic: 'Claude (Anthropic)', openai: 'API compatível com OpenAI' };
export const aiLabel = (env: Env) => {
  const c = aiConfig(env);
  return `${LABEL[c.provider]} · ${c.model}`;
};

/** Gera a resposta no provedor configurado. Erros viram mensagens amigáveis (a chave nunca aparece). */
export async function generate(env: Env, messages: Msg[], maxTokens = 700): Promise<string> {
  const c = aiConfig(env);
  if (!c.configured) fail('O assistente está sem chave de IA configurada. Fale com o administrador.', 503);
  const unavailable = () => fail('O assistente está indisponível agora. Tente mais tarde.', 503);

  if (c.provider === 'workers') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (env.AI as any).run(c.model, { max_tokens: maxTokens, messages }).catch((e: Error) => { console.error('workers ai', e); return unavailable(); });
    return String(r?.response ?? r?.choices?.[0]?.message?.content ?? '').trim();
  }

  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const rest = messages.filter((m) => m.role !== 'system');
  const res = c.provider === 'anthropic'
    ? await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': env.AI_API_KEY!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: c.model, max_tokens: maxTokens, system, messages: rest }),
      })
    : await fetch(`${c.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AI_API_KEY}` },
        body: JSON.stringify({ model: c.model, max_tokens: maxTokens, messages }),
      });
  if (!res.ok) {
    console.error('ai provider', c.provider, res.status, (await res.text().catch(() => '')).slice(0, 500));
    if (res.status === 401 || res.status === 403) fail('A chave de IA foi recusada pelo provedor. Fale com o administrador.', 503);
    if (res.status === 429) fail('O provedor de IA atingiu o limite de uso. Tente em instantes.', 503);
    return unavailable();
  }
  const j = (await res.json().catch(() => ({}))) as { content?: { type: string; text?: string }[]; choices?: { message?: { content?: string } }[] };
  return String(c.provider === 'anthropic' ? (j.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('') : j.choices?.[0]?.message?.content ?? '').trim();
}
