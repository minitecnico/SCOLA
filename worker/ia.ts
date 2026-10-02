import { requireAdmin, requireBase, requireRole, type Ctx } from './auth';
import { all, fail, first, inList, now, parse, run, stmt, uid, type Env } from './db';
import { docInBase } from './handlers/editor';

/**
 * Central de IA do SCOLA (tudo de IA do servidor está aqui).
 *  Motor: NVIDIA (segredo AI_API_KEY) e, opcionalmente, um motor externo compatível com OpenAI
 *         (OpenRouter, OpenAI, 9Router publicado…) configurado no painel do administrador.
 *         Cada tarefa tem uma fila de modelos; se um falha ou demora, o próximo assume.
 *  Recursos: conversa (página IA, com ou sem os conteúdos da escola), campo inteligente do editor
 *         (texto, imagem, ler/mudar imagem, trabalhar trecho), pareceres e o índice de busca (Vectorize).
 *  Limites por pessoa por dia: AI_DAILY_LIMIT (60) e AI_IMAGE_DAILY_LIMIT (30).
 */
export type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type Msg = { role: 'system' | 'user' | 'assistant'; content: string | Part[] };
type Task = 'texto' | 'visao' | 'imagem';

/* ===================================== Motor ===================================== */
const NV_CHAT = 'https://integrate.api.nvidia.com/v1';
const NV_IMAGE = 'https://ai.api.nvidia.com/v1/genai';
const CHAINS: Record<Task, string[]> = {
  texto: ['openai/gpt-oss-20b', 'nvidia/nemotron-3-super-120b-a12b', 'google/gemma-4-31b-it', 'moonshotai/kimi-k3'],
  visao: ['google/gemma-4-31b-it', 'meta/llama-3.2-90b-vision-instruct', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning'],
  imagem: ['black-forest-labs/flux.1-dev', 'black-forest-labs/flux.2-klein-4b'],
};
const LABELS: Record<string, string> = {
  'openai/gpt-oss-20b': 'GPT-OSS 20B', 'nvidia/nemotron-3-super-120b-a12b': 'Nemotron Super', 'google/gemma-4-31b-it': 'Gemma 4',
  'moonshotai/kimi-k3': 'Kimi K3', 'meta/llama-3.2-90b-vision-instruct': 'Llama Vision', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': 'Nemotron Omni',
  'black-forest-labs/flux.1-dev': 'FLUX.1', 'black-forest-labs/flux.2-klein-4b': 'FLUX.2 Klein',
};
const resting = new Map<string, number>(); // modelo que falhou → até quando vai para o fim da fila
const rest = (id: string) => resting.set(id, Date.now() + 10 * 60_000);

type Engine = { id: string; url: string; key: string; model: string; label: string; ext?: boolean };
type Custom = { baseUrl: string; key: string; model: string; label: string };
const ENGINE_KV = 'cfg:ai-engine';
let customCache: { at: number; v: Custom | null } | null = null;

/** Chave do motor externo cifrada no KV (AES-GCM com os segredos do Worker). */
const aes = async (env: Env) =>
  crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.GOOGLE_TOKEN_KEY || ''}|${env.AI_API_KEY || ''}|scola-ai`)), 'AES-GCM', false, ['encrypt', 'decrypt']);
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function custom(env: Env): Promise<Custom | null> {
  if (customCache && Date.now() - customCache.at < 60_000) return customCache.v;
  let v: Custom | null = null;
  try {
    const sealed = await env.FILES.get(ENGINE_KV);
    if (sealed) {
      const [iv, ct] = sealed.split('.').map(unb64);
      v = JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aes(env), ct)));
    }
  } catch (e) {
    console.error('ia: motor externo ilegível', e);
  }
  customCache = { at: Date.now(), v };
  return v;
}

/** Fila da tarefa: motor externo primeiro, depois a NVIDIA (quem falhou há pouco vai para o fim). */
async function engines(env: Env, task: Task): Promise<Engine[]> {
  const c = task === 'imagem' ? null : await custom(env);
  const nv = env.AI_API_KEY ? CHAINS[task].map((m) => ({ id: m, url: task === 'imagem' ? NV_IMAGE : NV_CHAT, key: env.AI_API_KEY!, model: m, label: LABELS[m] ?? m })) : [];
  const t = Date.now();
  const list = [...(c ? [{ id: `x:${c.model}`, url: c.baseUrl, key: c.key, model: c.model, label: c.label || c.model, ext: true }] : []), ...nv];
  if (!list.length) fail('A IA ainda não foi configurada. Fale com o administrador.', 503);
  return [...list.filter((e) => (resting.get(e.id) ?? 0) < t), ...list.filter((e) => (resting.get(e.id) ?? 0) >= t)];
}

const HEADERS = (key: string) => ({ 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://scola.app', 'X-Title': 'SCOLA' });

/**
 * Abre a resposta em streaming no primeiro modelo da fila que aceitar (até 25 s para começar).
 * Chave da NVIDIA recusada é erro de configuração (para na hora); o resto troca de modelo.
 */
async function* attempts(env: Env, task: 'texto' | 'visao', messages: Msg[], maxTokens: number, opts: { temperature?: number; fast?: boolean }) {
  for (const e of await engines(env, task)) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25_000);
    try {
      const res = await fetch(`${e.url}/chat/completions`, {
        method: 'POST', signal: ac.signal, headers: HEADERS(e.key),
        body: JSON.stringify({
          model: e.model, messages, stream: true, max_tokens: maxTokens + (e.ext ? 0 : 800),
          ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
          // GPT-OSS "pensa" calado antes de escrever: na conversa, raciocínio curto (1º texto em ~1 s).
          ...(opts.fast && e.model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
        }),
      });
      clearTimeout(timer);
      if (res.ok && res.body) {
        yield { res, e };
        continue;
      }
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      if (!e.ext && (res.status === 401 || res.status === 403)) fail('A chave de IA da NVIDIA foi recusada. Fale com o administrador.', 503);
      console.error('ia: troca de modelo', e.id, res.status, detail);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && 'status' in err) throw err;
      console.error('ia: troca de modelo', e.id, (err as Error)?.message);
    }
    rest(e.id);
  }
}

/** Eventos SSE (formato OpenAI) → só o texto. Com `head`, o fluxo começa com "\u001e<quem respondeu>\u001e". */
function sse(label: string, requested: string, head: boolean) {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = '';
  let started = !head;
  let real = '';
  const start = (ctl: TransformStreamDefaultController<Uint8Array>) => {
    started = true;
    // Roteadores (ex.: openrouter/auto) contam qual modelo respondeu de fato.
    ctl.enqueue(enc.encode(`\u001e${real && real !== requested && !requested.endsWith(real) ? `${label} → ${real}` : label}\u001e`));
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      let out = '';
      for (const line of lines) {
        const data = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : '';
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data) as { model?: string; error?: { message?: string }; choices?: { delta?: { content?: string } }[] };
          real ||= j.model ?? '';
          if (j.error) out += `\n\n_(A IA interrompeu a resposta: ${String(j.error.message || 'erro').slice(0, 120)})_`;
          out += j.choices?.[0]?.delta?.content ?? '';
        } catch {
          /* linha quebrada */
        }
      }
      if (!started && (out || real)) start(ctl);
      if (out) ctl.enqueue(enc.encode(out));
    },
    flush(ctl) {
      if (!started) start(ctl);
    },
  });
}

const clean = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<\|[a-z_]+\|>\w*/g, '').trim();

/** Resposta completa (sem streaming para quem chama). Resposta vazia também troca de modelo. */
async function ask(env: Env, task: 'texto' | 'visao', messages: Msg[], maxTokens = 1500, temperature?: number) {
  for await (const { res, e } of attempts(env, task, messages, maxTokens, { temperature })) {
    const text = clean(await new Response(res.body!.pipeThrough(sse(e.label, e.model, false))).text());
    if (text) return { text, model: e.label };
    rest(e.id);
  }
  return fail('A IA está congestionada agora. Tente de novo em instantes.', 503);
}

/** Resposta aos poucos: devolve o fluxo do primeiro modelo que aceitar. */
async function streamAsk(env: Env, task: 'texto' | 'visao', messages: Msg[]) {
  for await (const { res, e } of attempts(env, task, messages, 6000, { fast: true })) return { stream: res.body!.pipeThrough(sse(e.label, e.model, true)), model: e.label };
  return fail('A IA está congestionada agora. Tente de novo em instantes.', 503);
}

type Aspect = 'paisagem' | 'retrato' | 'quadrado';
const SIZES: Record<Aspect, { width: number; height: number }> = { paisagem: { width: 1024, height: 768 }, retrato: { width: 768, height: 1024 }, quadrado: { width: 1024, height: 1024 } };

/** Imagem (FLUX, NVIDIA) a partir de um pedido em inglês. Devolve data URL JPEG. */
async function image(env: Env, prompt: string, aspect: Aspect = 'paisagem') {
  if (!env.AI_API_KEY) fail('Imagens com IA precisam da NVIDIA configurada.', 503);
  for (const e of await engines(env, 'imagem')) {
    const klein = e.model.includes('klein');
    const res = await fetch(`${e.url}/${e.model}`, {
      method: 'POST', signal: AbortSignal.timeout(klein ? 25_000 : 40_000), headers: HEADERS(e.key),
      body: JSON.stringify({ prompt: prompt.slice(0, 1500), ...SIZES[aspect], seed: Math.floor(Math.random() * 1e6), ...(klein ? { steps: 4 } : { steps: 28, cfg_scale: 3.5, mode: 'base' }) }),
    }).catch(() => null);
    const a = res?.ok ? ((await res.json().catch(() => ({}))) as { artifacts?: { base64?: string; finishReason?: string }[] }).artifacts?.[0] : undefined;
    if (a?.finishReason === 'CONTENT_FILTERED') fail('O pedido de imagem foi bloqueado pelo filtro de conteúdo. Tente descrever de outro jeito.', 422);
    if (a?.base64) return { image: `data:image/jpeg;base64,${a.base64}`, model: e.label };
    console.error('ia: troca de modelo de imagem', e.id, res?.status ?? 'tempo esgotado');
    rest(e.id);
  }
  return fail('Os modelos de imagem estão congestionados agora. Tente de novo em instantes.', 503);
}

/** Vetores de 1024 dimensões (índice do Vectorize) pela NVIDIA, em lotes de 50. */
async function embed(env: Env, texts: string[], type: 'query' | 'passage' = 'passage') {
  if (!env.AI_API_KEY) fail('A busca nos conteúdos da escola precisa da NVIDIA configurada.', 503);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const res = await fetch(`${NV_CHAT}/embeddings`, {
      method: 'POST', headers: HEADERS(env.AI_API_KEY!),
      body: JSON.stringify({ model: 'nvidia/llama-nemotron-embed-vl-1b-v2', input: texts.slice(i, i + 50), dimensions: 1024, input_type: type, truncate: 'END' }),
    });
    const j = res.ok ? ((await res.json().catch(() => ({}))) as { data?: { index: number; embedding: number[] }[] }) : {};
    if (!j.data?.length) fail('A busca está indisponível agora. Tente mais tarde.', 503);
    out.push(...j.data!.sort((a, b) => a.index - b.index).map((d) => d.embedding));
  }
  return out;
}

/* ============================== Regras comuns ============================== */
const today = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const dailyLimit = (env: Env) => Number(env.AI_DAILY_LIMIT) || 60;
const imageLimit = (env: Env) => Number(env.AI_IMAGE_DAILY_LIMIT) || 30;

/** Conta um uso de IA da pessoa no dia (protege o gasto da chave). */
async function spend(ctx: Ctx, kind: 'texto' | 'imagem' = 'texto') {
  const key = `ai${kind === 'imagem' ? 'img' : ''}:${ctx.user.id}:${new Date().toISOString().slice(0, 10)}`;
  const limit = kind === 'imagem' ? imageLimit(ctx.env) : dailyLimit(ctx.env);
  const used = Number((await ctx.env.FILES.get(key)) || 0);
  if (used >= limit) fail(`Você usou os ${limit} pedidos de ${kind === 'imagem' ? 'imagens' : 'IA'} de hoje. Volte amanhã.`, 429);
  await ctx.env.FILES.put(key, String(used + 1), { expirationTtl: 86400 });
}

const SYSTEM = `Você é a IA do SCOLA, assistente completa (como um ChatGPT) usada por professores e gestores de escolas brasileiras. Ajude com qualquer assunto: dúvidas, explicações, textos, provas, atividades, planos de aula, correções, traduções, cálculos, e-mails e análise de documentos. Responda em português do Brasil (salvo pedido de outro idioma), em Markdown (títulos, listas, tabelas e negrito quando ajudarem), direto ao ponto, sem "Claro!" nem comentários finais. Não use LaTeX: escreva contas em texto (3/8, 2 × 4 = 8, x²). Nunca escreva códigos da BNCC (costumam sair errados): descreva a habilidade e deixe "Código BNCC: ________ (preencher)". Nunca invente dados sobre alunos. Em múltipla escolha: exatamente uma alternativa correta, letra certa variando, e confira cada cálculo e gabarito.`;
const sys = (extra = '') => ({ role: 'system' as const, content: `${SYSTEM} Hoje é ${today()}.${extra}` });
const isImage = (u: unknown): u is string => typeof u === 'string' && u.length < 2_000_000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u);

/** Segunda passada nas questões com gabarito: modelos rápidos às vezes erram a conta ou deixam duas certas. */
async function reviewKey(env: Env, text: string) {
  if (!/gabarito|resposta(s)? (correta|certa)|\bresposta:/i.test(text) || !/\b[a-e]\)/i.test(text)) return { text };
  try {
    const r = await ask(env, 'texto', [
      { role: 'system', content: 'Você revisa provas escolares. Responda só com o documento revisado, sem comentários.' },
      { role: 'user', content: `Revise o material abaixo. Resolva cada questão você mesmo, em silêncio. Corrija gabaritos errados. Se uma questão tiver mais de uma alternativa correta (ou nenhuma), troque as erradas para haver exatamente uma. Mantenha todo o resto igual. Devolva o documento completo.\n\n---\n${text}\n---` },
    ], 3000, 0);
    const out = r.text.replace(/^---\s*|\s*---$/g, '').trim();
    return out.length > text.length * 0.7 ? { text: out, model: r.model } : { text }; // encurtou demais = cortou conteúdo
  } catch {
    return { text };
  }
}

/** Visão lê bem mas raciocina mal: ela só transcreve/descreve; quem responde é o modelo de texto. */
async function readImages(env: Env, imgs: string[], instruction?: string) {
  return ask(env, 'visao', [{
    role: 'user',
    content: [
      { type: 'text', text: instruction ?? `Para cada imagem (${imgs.length}), na ordem: transcreva fielmente TODO o texto (questões, alternativas, tabelas, números) e descreva em poucas linhas o que ela mostra. Comece cada uma com "Imagem N:". Não resolva nada.` },
      ...imgs.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ],
  }], 3000, 0.1);
}

/* ===================== Campo inteligente (editor e pedidos de imagem) ===================== */
// Modelos de imagem embaralham letras: imagens sem palavras; rótulos ficam no texto do documento.
const NO_TEXT = 'Clean wordless picture, no annotations, unlabeled, pure imagery, nothing written anywhere.';
const unlabel = (p: string) =>
  p.replace(/\b(clearly |neatly )?(labell?ed|annotated|captioned|titled)\b[^,.;]*/gi, '')
    .replace(/\bwith (its |their )?(names?|labels?|captions?|titles?|text|words|arrows? (and|with) (labels?|text))\b[^,.;]*/gi, '')
    .replace(/\b(labels?|captions?|text|lettering|typography|title|names? of [^,.;]*)\b/gi, '')
    .replace(/\bfor (\w+ )?(\d+\w*[- ]grade|grade \d+|students?|pupils?|kids|children|school|classroom|teachers?)[^,.;:]*/gi, '')
    .replace(/\b(educational |scientific |labeled |school )?diagram\b/gi, 'illustration')
    .replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').replace(/([,;])\s*[,;]+/g, '$1').trim();
const READ_RE = /\b(transcrev|ler\b|leia|digit|extra[ií]|copi[ae]|quest|pergunt|exerc|atividade|prova|descrev|explic|o que (é|tem|diz|está)|resum|corrij|corrig|gabarit|tradu|identifi|analis)/i;
const EDIT_RE = /\b(transform|deix[ae]|mud[ae]|troqu?[ae]|coloqu?[ae]|acrescent|adicion|inclu[ai]|remov|tir[ae]\b|apagu?[ae]|pint[ae]|colori|redesenh|recri|refa[çz]|estilo|cartoon|desenho animado|aquarela|nova vers[ãa]o|edite a (imagem|foto)|melhor[ae] (a|essa|esta) (imagem|foto)|fundo)/i;

const TRECHO: Record<string, string> = {
  melhorar: 'Reescreva o texto deixando-o mais claro, organizado e profissional, sem mudar o sentido nem acrescentar informações.',
  corrigir: 'Corrija ortografia, acentuação, pontuação e concordância. Mantenha palavras e estrutura sempre que possível; não acrescente nada.',
  resumir: 'Resuma o texto em poucos parágrafos ou tópicos, mantendo o essencial.',
  continuar: 'Continue o texto no mesmo estilo e formato, sem repetir o que já foi escrito. Entregue só a continuação.',
  simplificar: 'Reescreva o texto em linguagem simples, fácil para alunos e famílias.',
  topicos: 'Transforme o texto em uma lista de tópicos organizada.',
};

/** Decide texto / imagem / os dois e já escreve o pedido de imagem em inglês. */
async function plan(env: Env, prompt: string, forced: 'imagem' | null) {
  try {
    const r = await ask(env, 'texto', [
      { role: 'system', content: 'Você classifica pedidos de professores e responde só com JSON válido.' },
      { role: 'user', content: `Pedido: """${prompt}"""\nJSON: {"tarefa": "texto" | "imagem" | "texto_e_imagem", "imagem_en": "...", "formato": "paisagem" | "retrato" | "quadrado"}\n- "imagem": quer só uma imagem/ilustração/desenho. "texto_e_imagem": um texto (atividade, prova, história…) que também precisa de ilustração. "texto": todo o resto.${forced ? ' O professor escolheu IMAGEM.' : ''}\n- "imagem_en": se houver imagem, prompt em inglês (até 80 palavras): assunto, composição e estilo escolar (ilustração colorida, desenho para colorir em preto e branco, foto realista). Nunca peça rótulos, nomes, legendas, números ou setas com palavras; não cite série nem "diagrama"; descreva formas e cores em vez de nomes de partes. Sem imagem: "".` },
    ], 400, 0);
    const j = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1)) as { tarefa?: string; imagem_en?: string; formato?: Aspect };
    const en = String(j.imagem_en || '').slice(0, 1200);
    const tarefa = forced ?? (en && (j.tarefa === 'imagem' || j.tarefa === 'texto_e_imagem') ? j.tarefa : 'texto');
    return { tarefa, en: en || prompt, formato: j.formato && SIZES[j.formato] ? j.formato : 'paisagem', model: r.model };
  } catch {
    return { tarefa: forced ?? 'texto', en: prompt, formato: 'paisagem' as Aspect, model: '' };
  }
}

export async function aiSmart(ctx: Ctx, input: {
  prompt?: string; mode?: 'auto' | 'texto' | 'imagem' | 'ler' | 'editar'; image?: string | null; aspect?: Aspect; context?: string; action?: string; text?: string;
}) {
  requireRole(ctx, 'gestor', 'professor', 'secretaria');
  const env = ctx.env;
  const prompt = String(input?.prompt ?? '').trim().slice(0, 3000);
  const used: string[] = [];
  const done = async (markdown: string | null, img: string | null = null) => {
    const rv = markdown ? await reviewKey(env, markdown) : null;
    if (rv?.model) used.push(`${rv.model} (revisão do gabarito)`);
    return { markdown: rv?.text ?? null, image: img, used };
  };

  /* Trecho selecionado no editor: melhorar, corrigir, resumir… */
  if (input?.action) {
    const how = TRECHO[input.action];
    const text = String(input.text ?? '').trim().slice(0, 12_000);
    if (!how || text.length < 3) fail('Selecione o trecho do documento.');
    await spend(ctx);
    const r = await ask(env, 'texto', [sys(), { role: 'user', content: `${how}${prompt ? ` Orientação: ${prompt}` : ''}\n\n"""\n${text}\n"""` }], 2000, input.action === 'corrigir' ? 0.1 : 0.5);
    used.push(r.model);
    return done(r.text);
  }

  /* Com imagem: ler/entender, ou recriar com a mudança pedida. */
  if (input?.image) {
    if (!isImage(input.image)) fail('Imagem inválida ou grande demais (até 1,5 MB).');
    const route = input.mode === 'editar' || input.mode === 'ler' ? input.mode : input.mode === 'imagem' || (EDIT_RE.test(prompt) && !READ_RE.test(prompt)) ? 'editar' : 'ler';
    if (route === 'ler') {
      await spend(ctx);
      const onlyRead = !prompt || /\b(transcrev|digit|copi[ae]|extra[ií]|o que (está )?escrito)/i.test(prompt);
      const read = await readImages(env, [input.image], onlyRead ? prompt || undefined : undefined);
      used.push(`${read.model} (leitura da imagem)`);
      if (onlyRead) return { markdown: read.text, image: null, used };
      const r = await ask(env, 'texto', [sys(), { role: 'user', content: `Conteúdo da imagem enviada:\n---\n${read.text}\n---\n\nPedido: ${prompt}` }], 2500, 0.3);
      used.push(r.model);
      return done(r.text);
    }
    if (prompt.length < 3) fail('Diga o que mudar na imagem.');
    await spend(ctx, 'imagem');
    // A NVIDIA gratuita não edita a imagem enviada: a visão descreve já com a mudança e o FLUX redesenha.
    const d = await readImages(env, [input.image], `You write prompts for an image generator. Write ONE English prompt (max 120 words) that recreates this image as faithfully as possible (subject, composition, colors, style; ignore written text) applying this change requested in Portuguese: "${prompt}". Output only the prompt.`);
    const img = await image(env, `${unlabel(d.text.replace(/^["']|["']$/g, ''))} ${NO_TEXT}`, input.aspect && SIZES[input.aspect] ? input.aspect : 'paisagem');
    used.push(`${d.model} (entender a imagem)`, `${img.model} (desenhar)`);
    return { markdown: null, image: img.image, used };
  }

  if (prompt.length < 3) fail('Escreva o que a IA deve fazer.');
  if (input?.mode === 'ler' || input?.mode === 'editar') fail('Anexe a imagem primeiro.');
  const p = input?.mode === 'texto' ? { tarefa: 'texto', en: '', formato: 'paisagem' as Aspect, model: '' } : await plan(env, prompt, input?.mode === 'imagem' ? 'imagem' : null);
  if (p.model) used.push(`${p.model} (entender o pedido)`);
  const withImage = p.tarefa !== 'texto';
  await spend(ctx);
  if (withImage) await spend(ctx, 'imagem');
  const context = String(input?.context ?? '').trim().slice(0, 6000);
  const [txt, img] = await Promise.all([
    p.tarefa === 'imagem' ? null : ask(env, 'texto', [
      sys(withImage ? ' Uma ilustração gerada à parte vai no topo: não mencione a imagem nem reserve espaço para ela.' : ''),
      { role: 'user', content: `${prompt}${context ? `\n\nContexto (texto atual do documento ou da conversa):\n"""\n${context}\n"""` : ''}` },
    ], 2500, 0.5),
    withImage ? image(env, `${unlabel(p.en)} ${NO_TEXT}`, p.formato) : null,
  ]);
  if (txt) used.push(txt.model);
  if (img) used.push(`${img.model} (imagem)`);
  // Tira os "aqui vai a imagem" que o modelo às vezes escreve.
  const text = txt && withImage ? txt.text.split('\n').filter((l) => !/(\[\s*(imagem|ilustra)|(imagem|ilustra\w*)[^\n]{0,60}(inserid|aqui|abaixo|acima))/i.test(l)).join('\n') : txt?.text ?? null;
  return done(text, img?.image ?? null);
}

/* ==================================== Pareceres ==================================== */
type ParecerStudent = { n: number; terms?: (number | null)[]; final?: number | null; activities?: { name: string; score: number | null; max: number }[] };
const nf = (v: number | null | undefined) => (v == null ? 'sem nota' : v.toFixed(1).replace('.', ','));

/** Parecer de cada aluno pelas notas (até 15 por pedido). Sem nomes: vão numerados e o nome volta no navegador. */
export async function aiPareceres(ctx: Ctx, input: { subject?: string; className?: string; period?: string; term?: number; tone?: string; extra?: string; students: ParecerStudent[] }) {
  requireRole(ctx, 'gestor', 'professor');
  const list = (Array.isArray(input?.students) ? input.students : []).slice(0, 15);
  if (!list.length) fail('Nenhum aluno para o parecer.');
  await spend(ctx);
  const term = Number(input.term) || 0;
  const lines = list.map((s) => {
    const parts: string[] = [];
    if (term >= 1 && term <= 3) {
      parts.push(`média do ${term}º trimestre ${nf(s.terms?.[term - 1])}`);
      const acts = (s.activities ?? []).filter((a) => a.name).slice(0, 15);
      if (acts.length) parts.push(`atividades: ${acts.map((a) => `${a.name} ${a.score == null ? 'não entregue' : `${nf(a.score)}/${nf(a.max)}`}`).join('; ')}`);
    } else {
      parts.push(['1º', '2º', '3º'].map((t, i) => `${t} tri ${nf(s.terms?.[i])}`).join(', '), `média final ${nf(s.final)}`);
      // Tendência e situação calculadas aqui: o modelo não deve comparar números sozinho.
      const got = (s.terms ?? []).slice(0, 3).map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => typeof x.v === 'number');
      if (got.length >= 2) {
        const [a, b] = got.slice(-2);
        const d = b.v - a.v;
        parts.push(`tendência: ${Math.abs(d) < 0.3 ? 'estável' : d > 0 ? 'melhorou' : 'piorou'} do ${a.i + 1}º para o ${b.i + 1}º trimestre (${nf(a.v)} → ${nf(b.v)})`);
      }
      const ref = s.final ?? got.at(-1)?.v ?? null;
      if (ref != null) parts.push(`situação: ${ref >= 6 ? 'acima da média' : ref >= 5 ? 'próximo da média, precisa de recuperação' : 'abaixo da média, precisa de recuperação'}`);
    }
    return `${Number(s.n)}| ${parts.join(' — ')}`;
  });
  const where = [input.subject && `na disciplina ${String(input.subject).slice(0, 80)}`, input.className && `turma ${String(input.className).slice(0, 60)}`, input.period && `período ${String(input.period).slice(0, 60)}`].filter(Boolean).join(', ');
  const out = (await ask(ctx.env, 'texto', [sys(), {
    role: 'user',
    content: `Escreva um parecer descritivo curto (3 a 4 frases) para cada estudante abaixo${where ? `, ${where}` : ''}.
Regras: notas de 0 a 10, aprovação com 6,0. Use SOMENTE os dados informados e a tendência e a situação exatamente como vierem: descreva o desempenho, reconheça avanços e dê uma orientação concreta. Não cite conteúdos nem comportamentos que não estejam na orientação do professor: fale em "os conteúdos do período". Não use nome: escreva "o(a) estudante". Sem notas, diga que não há avaliações suficientes no período.${input.tone ? `\nTom: ${String(input.tone).slice(0, 200)}.` : ''}${input.extra ? `\nOrientação do professor: ${String(input.extra).slice(0, 600)}` : ''}
Responda exatamente uma linha por estudante, no formato "número| parecer".

${lines.join('\n')}`,
  }], 260 * list.length, 0.4)).text;
  const byN = new Map<number, string>();
  for (const l of out.split('\n')) {
    const m = l.match(/^\s*\**\s*(\d+)\s*\**\s*[|:.)–-]\s*(.+)$/);
    if (m && m[2].trim().length > 10) byN.set(Number(m[1]), m[2].trim().replace(/^\*+|\*+$/g, ''));
  }
  return { items: list.map((s) => ({ n: Number(s.n), text: byN.get(Number(s.n)) ?? '' })) };
}

/* ==================== Conversa (página IA) — rota /api/ai/chat ==================== */
type ChatIn = { role: 'user' | 'assistant'; content: string | Part[] };

/**
 * Resposta em streaming. Documentos anexados chegam como texto (o navegador extrai).
 * `escola`: busca também nos documentos, avisos, calendário, planejamentos e provas da escola (com fontes).
 */
export async function chatStream(ctx: Ctx, input: { messages?: ChatIn[]; escola?: boolean; docIds?: string[] }) {
  requireRole(ctx, 'gestor', 'professor', 'secretaria');
  const list = (Array.isArray(input?.messages) ? input.messages : []).slice(-40);
  if (list.at(-1)?.role !== 'user') fail('Escreva a mensagem.');
  // Do mais recente para o mais antigo, até ~400 mil caracteres. Imagens só da mensagem atual.
  let chars = 0;
  const msgs: Msg[] = [];
  const imgs: string[] = [];
  for (let i = list.length - 1; i >= 0 && (chars < 400_000 || !msgs.length); i--) {
    const m = list[i];
    const parts: Part[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content.slice(0, 12);
    const text = parts.filter((p) => p?.type === 'text').map((p) => String((p as { text: string }).text ?? '')).join('\n').slice(0, 300_000);
    if (i === list.length - 1) for (const p of parts) if (p?.type === 'image_url' && isImage(p.image_url?.url) && imgs.length < 6) imgs.push(p.image_url.url);
    chars += text.length;
    msgs.unshift({ role: m.role === 'assistant' ? 'assistant' : 'user', content: text });
  }
  await spend(ctx);
  const last = msgs[msgs.length - 1];
  const head: string[] = [];
  // Imagens: motor externo (modelos fortes) recebe direto; só NVIDIA, a visão lê e o texto responde.
  if (imgs.length && (await custom(ctx.env))) {
    last.content = [{ type: 'text', text: String(last.content) || 'Analise a imagem.' }, ...imgs.map((url) => ({ type: 'image_url' as const, image_url: { url } }))];
  } else if (imgs.length) {
    const read = await readImages(ctx.env, imgs);
    head.push(`${read.model} (leitura)`);
    last.content = `${last.content}\n\n### Conteúdo das imagens anexadas (lido por IA de visão)\n${read.text}`;
  }
  let extra = ctx.user.full_name ? ` Você está conversando com ${ctx.user.full_name}.` : '';
  let sources: { name: string; kind: string }[] = [];
  if (input?.escola) {
    const q = String(typeof last.content === 'string' ? last.content : (last.content[0] as { text: string }).text).slice(0, 600);
    // Busca fora do ar não derruba a conversa: a IA responde e avisa que não consultou a escola.
    const found = await searchSchool(ctx, q, input.docIds).catch((e) => (console.error('ia: busca', e), { context: '', sources: [], down: true }));
    sources = found.sources;
    extra += found.context
      ? ` Use os trechos dos conteúdos da escola abaixo quando servirem e cite com [número]. Se a pergunta for sobre a escola e a resposta não estiver nos trechos, diga que não encontrou.\n\nTrechos:\n${found.context}`
      : 'down' in found
        ? ' A busca nos conteúdos da escola está indisponível agora: se a pergunta for sobre a escola, avise isso.'
        : ' Não foram encontrados conteúdos da escola sobre esta pergunta: se ela for sobre a escola, diga que não encontrou.';
  }
  const { stream, model } = await streamAsk(ctx.env, imgs.length && Array.isArray(last.content) ? 'visao' : 'texto', [sys(extra), ...msgs]);
  const label = [...head, model].join(' · ');
  const enc = new TextEncoder();
  let first = true;
  return new Response(head.length ? stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    // Inclui quem leu as imagens no cabeçalho "\u001e<modelo>\u001e" do fluxo.
    transform(chunk, ctl) {
      if (first) {
        first = false;
        ctl.enqueue(enc.encode(`\u001e${head.join(' · ')} · `));
        return ctl.enqueue(chunk.subarray(1));
      }
      ctl.enqueue(chunk);
    },
  })) : stream, {
    // event-stream sem compressão: com gzip o texto chegava todo de uma vez.
    headers: {
      'content-type': 'text/event-stream; charset=utf-8', 'content-encoding': 'identity', 'cache-control': 'no-store, no-transform', 'x-accel-buffering': 'no',
      'x-ai-model': encodeURIComponent(label), 'x-ai-sources': encodeURIComponent(JSON.stringify(sources).slice(0, 3000)),
    },
  });
}

/* Histórico: cada pessoa só vê as próprias conversas. */
const MAX_CHAT = 900_000;
export const listAiChats = (ctx: Ctx) =>
  all<{ id: string; title: string; updated_at: string }>(ctx.db, 'SELECT id, title, updated_at FROM ai_chats WHERE user_id = ? ORDER BY updated_at DESC LIMIT 60', ctx.user.id);

export async function getAiChat(ctx: Ctx, id: string) {
  const c = await first<{ id: string; title: string; messages: string; updated_at: string }>(ctx.db, 'SELECT id, title, messages, updated_at FROM ai_chats WHERE id = ? AND user_id = ?', id, ctx.user.id);
  if (!c) fail('Conversa não encontrada.', 404);
  return { ...c!, messages: parse<unknown[]>(c!.messages, []) };
}

export async function saveAiChat(ctx: Ctx, input: { id?: string | null; title?: string; messages: unknown[] }) {
  requireRole(ctx, 'gestor', 'professor', 'secretaria');
  const msgs = Array.isArray(input?.messages) ? [...input.messages] : [];
  while (msgs.length > 2 && JSON.stringify(msgs).length > MAX_CHAT) msgs.shift(); // guarda as mais recentes que cabem
  const json = JSON.stringify(msgs);
  if (json.length > MAX_CHAT) fail('Conversa grande demais para salvar. Comece uma nova.');
  const title = String(input.title || '').trim().slice(0, 120) || 'Nova conversa';
  const ts = now();
  if (input.id && (await run(ctx.db, 'UPDATE ai_chats SET title = ?, messages = ?, updated_at = ? WHERE id = ? AND user_id = ?', title, json, ts, input.id, ctx.user.id)).meta.changes) return { id: input.id };
  const id = uid();
  await run(ctx.db, 'INSERT INTO ai_chats (id, user_id, base_id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, ctx.user.id, ctx.baseId ?? null, title, json, ts, ts);
  return { id };
}

export const deleteAiChat = (ctx: Ctx, id: string) => run(ctx.db, 'DELETE FROM ai_chats WHERE id = ? AND user_id = ?', id, ctx.user.id).then(() => null);

/* ============================ Status e motor externo ============================ */
export async function aiStatus(ctx: Ctx) {
  const c = await custom(ctx.env);
  const nv = !!ctx.env.AI_API_KEY;
  return { ready: nv || !!c, images: nv, school: nv, engine: c ? c.label || c.model : nv ? 'NVIDIA' : null, limit: dailyLimit(ctx.env), imageLimit: imageLimit(ctx.env) };
}

export async function aiEngineInfo(ctx: Ctx) {
  requireAdmin(ctx);
  const c = await custom(ctx.env);
  return { nvidia: !!ctx.env.AI_API_KEY, custom: c ? { baseUrl: c.baseUrl, model: c.model, label: c.label, keyHint: `${c.key.slice(0, 6)}…${c.key.slice(-4)}` } : null };
}

/** Conecta qualquer API compatível com OpenAI depois de uma pergunta de teste; a chave fica cifrada no KV. */
export async function setAiEngine(ctx: Ctx, input: { baseUrl: string; key: string; model: string; label?: string }) {
  requireAdmin(ctx);
  let baseUrl = String(input?.baseUrl || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  if (!/^https:\/\/[^\s/]+\.[^\s]+$/.test(baseUrl)) fail('Endereço inválido. Use https://… (ex.: https://openrouter.ai/api/v1). "localhost" não funciona: o SCOLA roda na nuvem.');
  if (!/\/v\d+$/.test(baseUrl)) baseUrl += '/v1';
  const key = String(input?.key || '').trim();
  const model = String(input?.model || '').trim();
  if (key.length < 8 || !model) fail('Informe a chave e o modelo (ex.: openrouter/auto).');
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(45_000), headers: HEADERS(key),
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Responda apenas: OK' }], max_tokens: 400 }),
  }).catch((e) => fail(`Não consegui falar com ${baseUrl}: ${(e as Error)?.message || 'sem resposta'}.`, 400));
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const j = parse<{ error?: { message?: string } | string; message?: string }>(body, {});
    fail(`O serviço recusou (${res.status}): ${(typeof j.error === 'string' ? j.error : j.error?.message) || j.message || body.slice(0, 200)}`, 400);
  }
  const label = String(input.label || '').trim().slice(0, 40) || (baseUrl.includes('openrouter') ? `OpenRouter · ${model}` : model);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aes(ctx.env), new TextEncoder().encode(JSON.stringify({ baseUrl, key, model, label }))));
  await ctx.env.FILES.put(ENGINE_KV, `${b64(iv)}.${b64(ct)}`);
  customCache = null;
  return { label };
}

export async function clearAiEngine(ctx: Ctx) {
  requireAdmin(ctx);
  await ctx.env.FILES.delete(ENGINE_KV);
  customCache = null;
}

/* ===================== Busca nos conteúdos da escola (Vectorize) ===================== */
/**
 * O navegador extrai o texto dos documentos do Planejamento e manda em trechos (o Worker tem pouca CPU);
 * avisos, calendários, planejamentos e provas são montados aqui. Visibilidade filtrada na busca.
 */
const KIND_LABEL: Record<string, string> = { doc: 'Documento', notice: 'Aviso', calendar: 'Calendário', plan: 'Planejamento', exam: 'Prova' };
const cut = (s: string) => s.slice(0, 3000);
const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, k) => `${prefix}:${k}`);
async function dropVectors(env: Env, list: string[]) {
  for (let i = 0; i < list.length; i += 1000) await env.VECTORIZE.deleteByIds(list.slice(i, i + 1000));
}

/** Documentos que precisam ser (re)indexados. */
export async function ragStatus(ctx: Ctx) {
  const rows = await all<{ id: string; name: string; kind: string; google_kind: string | null; stale: number; rag_chunks: number | null }>(ctx.db,
    `SELECT id, name, kind, google_kind, rag_chunks, CASE WHEN rag_at IS NULL OR rag_at < COALESCE(updated_at, created_at) THEN 1 ELSE 0 END AS stale
       FROM plan_docs WHERE base_id = ? AND NOT (kind = 'google' AND COALESCE(google_kind, '') NOT IN ('document', 'spreadsheet', 'presentation'))`, requireBase(ctx));
  return { total: rows.length, ready: rows.filter((r) => !r.stale && (r.rag_chunks ?? 0) > 0).length, pending: rows.filter((r) => r.stale) };
}

/** Guarda os trechos de um documento (substitui os anteriores). Vazio = sem texto aproveitável. */
export async function ragIndexDoc(ctx: Ctx, docId: string, chunks: string[]) {
  requireRole(ctx, 'gestor', 'professor', 'secretaria');
  const d = await docInBase(ctx, docId);
  const list = (Array.isArray(chunks) ? chunks : []).map((c) => String(c).trim().slice(0, 1500)).filter((c) => c.length > 20).slice(0, 300);
  await dropVectors(ctx.env, ids(d.id, d.rag_chunks ?? 0));
  if (list.length) {
    const vectors = await embed(ctx.env, list.map((c) => `${d.name}\n${c}`));
    await ctx.env.VECTORIZE.upsert(vectors.map((values, i) => ({ id: `${d.id}:${i}`, values, metadata: { base_id: d.base_id, doc_id: d.id, kind: 'doc', vis: 'all', title: d.name, text: cut(list[i]) } })));
  }
  await run(ctx.db, 'UPDATE plan_docs SET rag_chunks = ?, rag_at = ? WHERE id = ?', list.length, now(), d.id);
  return { chunks: list.length };
}

/** Remove os vetores de um documento excluído. */
export const ragForget = (ctx: Ctx, docId: string, chunks: number | null) => dropVectors(ctx.env, ids(docId, chunks ?? 0)).catch((e) => console.error('rag forget', e));

const stripHtml = (h: string) => h.replace(/<\/(p|div|li|h\d|tr)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const strings = (v: unknown, out: string[] = [], depth = 0): string[] => {
  if (depth > 6) return out;
  if (typeof v === 'string') v.trim().length > 1 && out.push(v.trim());
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out, depth + 1));
  return out;
};
const dateBr = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Trechos de ~900 caracteres com um pouco de sobreposição. */
function chunk(text: string, size = 900, overlap = 120) {
  const out: string[] = [];
  let cur = '';
  for (const p of text.split(/\n+/).flatMap((p) => (p.length > size ? p.match(new RegExp(`.{1,${size}}`, 'gs')) ?? [] : [p]))) {
    if (cur && cur.length + p.length + 1 > size) {
      out.push(cur);
      cur = `${cur.slice(-overlap)} ${p}`;
    } else cur = cur ? `${cur}\n${p}` : p;
  }
  if (cur.trim().length > 20) out.push(cur);
  return out.slice(0, 60);
}

type Item = { id: string; kind: string; title: string; text: string; vis: string; owner: string };
async function collectItems(ctx: Ctx, base: string): Promise<Item[]> {
  const [notices, cals, plans, msgs, exams, classes] = await Promise.all([
    all<{ id: string; author_id: string; title: string; body: string; audience: string; target_role: string | null; target_user: string | null; created_at: string }>(ctx.db,
      'SELECT id, author_id, title, body, audience, target_role, target_user, created_at FROM notices WHERE base_id = ?', base),
    all<{ id: string; title: string; data: string; created_by: string | null }>(ctx.db, 'SELECT id, title, data, created_by FROM calendars WHERE base_id = ?', base),
    all<{ id: string; author_id: string; class_id: string | null; title: string; week_start: string | null; content: string; plan_data: string | null; status: string; feedback: string | null }>(ctx.db,
      'SELECT id, author_id, class_id, title, week_start, content, plan_data, status, feedback FROM lesson_plans WHERE base_id = ?', base),
    all<{ plan_id: string; body: string; created_at: string }>(ctx.db, 'SELECT plan_id, body, created_at FROM lesson_plan_messages WHERE base_id = ? ORDER BY created_at', base),
    all<{ id: string; author_id: string | null; class_id: string; title: string; exam_date: string | null; questions: number }>(ctx.db, 'SELECT id, author_id, class_id, title, exam_date, questions FROM exams WHERE base_id = ?', base),
    all<{ id: string; name: string }>(ctx.db, 'SELECT id, name FROM classes WHERE base_id = ?', base),
  ]);
  const cls = new Map(classes.map((c) => [c.id, c.name]));
  const items: Item[] = notices.map((n) => ({
    id: `notice:${n.id}`, kind: 'notice', title: n.title, owner: n.author_id, text: `Aviso "${n.title}" (${dateBr(n.created_at)})\n${stripHtml(n.body)}`,
    vis: n.audience === 'role' && n.target_role ? `role:${n.target_role}` : n.audience === 'user' && n.target_user ? `user:${n.target_user}` : 'all',
  }));
  for (const c of cals) {
    const d = parse<{ events?: { title: string; categoryId: string; start: string; end?: string }[]; categories?: { id: string; label: string }[] }>(c.data, {});
    const cats = new Map((d.categories ?? []).map((x) => [x.id, x.label]));
    const lines = (d.events ?? []).filter((e) => e?.start && e.title).sort((a, b) => a.start.localeCompare(b.start))
      .map((e) => `${dateBr(e.start)}${e.end && e.end !== e.start ? ` a ${dateBr(e.end)}` : ''}: ${e.title} (${cats.get(e.categoryId) ?? 'Evento'})`);
    if (lines.length) items.push({ id: `calendar:${c.id}`, kind: 'calendar', title: c.title, vis: 'all', owner: c.created_by ?? '', text: `Calendário "${c.title}"\n${lines.join('\n')}` });
  }
  const notes = new Map<string, string[]>();
  for (const m of msgs) notes.set(m.plan_id, [...(notes.get(m.plan_id) ?? []), `Comentário (${dateBr(m.created_at)}): ${m.body}`]);
  for (const p of plans) {
    const turma = p.class_id && cls.get(p.class_id) ? ` — turma ${cls.get(p.class_id)}` : '';
    const text = [`Planejamento "${p.title}"${turma}${p.week_start ? ` — semana de ${dateBr(p.week_start)}` : ''} (${p.status})`, stripHtml(p.content || ''),
      strings(parse(p.plan_data, null)).join('\n'), p.feedback ? `Retorno da gestão: ${p.feedback}` : '', ...(notes.get(p.id) ?? [])].filter(Boolean).join('\n');
    items.push({ id: `plan:${p.id}`, kind: 'plan', title: p.title, vis: 'role:gestor', owner: p.author_id, text }); // só autor e gestão
  }
  for (const e of exams) {
    items.push({ id: `exam:${e.id}`, kind: 'exam', title: e.title, vis: 'role:gestor', owner: e.author_id ?? '', text: `Prova "${e.title}" — turma ${cls.get(e.class_id) ?? '?'}${e.exam_date ? ` — ${dateBr(e.exam_date)}` : ''} — ${e.questions} questões` });
  }
  return items;
}

/** Atualiza o índice com avisos, calendários, planejamentos e provas (10 por vez: chame até remaining = 0). */
export async function ragSync(ctx: Ctx) {
  const base = requireBase(ctx);
  const items = await collectItems(ctx, base);
  const known = new Map((await all<{ id: string; hash: string; chunks: number }>(ctx.db, 'SELECT id, hash, chunks FROM rag_items WHERE base_id = ?', base)).map((r) => [r.id, r]));
  const stale = (await Promise.all(items.map(async (it) => ({ it, hash: await sha(`${it.vis}|${it.owner}|${it.title}|${it.text}`) })))).filter(({ it, hash }) => known.get(it.id)?.hash !== hash);
  const alive = new Set(items.map((i) => i.id));
  const orphans = [...known.keys()].filter((id) => !alive.has(id));
  const todo = stale.slice(0, 10);
  const gone = orphans.slice(0, Math.max(0, 10 - todo.length));
  await dropVectors(ctx.env, [...todo.map(({ it }) => it.id), ...gone].flatMap((id) => ids(id, known.get(id)?.chunks ?? 0)));
  const pieces = todo.map(({ it }) => ({ it, parts: chunk(it.text) }));
  const flat = pieces.flatMap((p) => p.parts.map((t, i) => ({ it: p.it, t, i })));
  if (flat.length) {
    const vecs = await embed(ctx.env, flat.map((f) => `${KIND_LABEL[f.it.kind]}: ${f.it.title}\n${f.t}`));
    for (let i = 0; i < flat.length; i += 500) {
      await ctx.env.VECTORIZE.upsert(flat.slice(i, i + 500).map((f, k) => ({
        id: `${f.it.id}:${f.i}`, values: vecs[i + k],
        metadata: { base_id: base, kind: f.it.kind, ref: f.it.id, vis: f.it.vis, owner: f.it.owner || 'none', title: f.it.title.slice(0, 120), text: cut(f.t) },
      })));
    }
  }
  const writes = [
    ...pieces.map(({ it, parts }, i) => stmt(ctx.db, `INSERT INTO rag_items (id, base_id, hash, chunks, indexed_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET hash = excluded.hash, chunks = excluded.chunks, indexed_at = excluded.indexed_at`, it.id, base, todo[i].hash, parts.length, now())),
    ...gone.map((id) => stmt(ctx.db, 'DELETE FROM rag_items WHERE id = ?', id)),
  ];
  if (writes.length) await ctx.db.batch(writes);
  return { remaining: stale.length - todo.length + orphans.length - gone.length };
}

/** Trechos da escola que a pessoa pode ver, numerados para citação, e a lista de fontes. */
async function searchSchool(ctx: Ctx, question: string, docIds?: string[]) {
  const base = requireBase(ctx);
  const [qv] = await embed(ctx.env, [question], 'query');
  const filter: VectorizeVectorMetadataFilter = { base_id: base };
  if (docIds?.length) filter.doc_id = { $in: docIds.slice(0, 50) };
  const found = await ctx.env.VECTORIZE.query(qv, { topK: 20, returnMetadata: 'all', filter });
  // Escala do modelo da NVIDIA: trecho certo ~0,2–0,35, resto ~0,1. Corte: 0,15 ou 60% do melhor.
  const top = Math.max(0, ...found.matches.map((m) => m.score));
  const role = ctx.role === 'superadmin' || ctx.isAdmin ? 'gestor' : ctx.role;
  const allowed = new Set(['all', `role:${role}`, `user:${ctx.user.id}`]);
  const hits = found.matches
    .filter((m) => typeof m.metadata?.text === 'string' && m.score >= Math.max(0.15, top * 0.6))
    .filter((m) => allowed.has(String(m.metadata!.vis ?? 'all')) || m.metadata!.owner === ctx.user.id)
    .slice(0, 8);
  const docRefs = [...new Set(hits.filter((h) => (h.metadata!.kind ?? 'doc') === 'doc').map((h) => String(h.metadata!.doc_id)))];
  const names = new Map((docRefs.length ? await all<{ id: string; name: string }>(ctx.db, `SELECT id, name FROM plan_docs WHERE base_id = ? AND id IN ${inList}`, base, JSON.stringify(docRefs)) : []).map((d) => [d.id, d.name]));
  const labeled = hits.map((h) => {
    const kind = String(h.metadata!.kind ?? 'doc');
    return { kind, name: kind === 'doc' ? names.get(String(h.metadata!.doc_id)) ?? String(h.metadata!.title ?? 'documento') : String(h.metadata!.title ?? ''), text: String(h.metadata!.text) };
  });
  return {
    context: labeled.map((h, i) => `[${i + 1}] (${KIND_LABEL[h.kind] ?? h.kind}: ${h.name})\n${h.text}`).join('\n\n'),
    sources: labeled.map(({ kind, name }) => ({ kind: KIND_LABEL[kind] ?? kind, name })),
  };
}
