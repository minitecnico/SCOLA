import { requireAdmin, requireRole, type Ctx } from '../auth';
import { all, fail, first, now, run, uid } from '../db';
import {
  aiConfig, CUSTOM_KV, customEngine, forgetCustomEngine, generate, modelLabel, nvChat, nvImage, sealSecret, streamChat, type Part, type RichMsg,
} from '../ai';

/**
 * IA para o dia a dia do professor: escrever no editor do Planejamento e redigir pareceres.
 * Usa o mesmo motor do Assistente (chave em AI_PROVIDER/AI_API_KEY). Nomes de alunos nunca
 * saem do SCOLA: os pareceres vão numerados e o nome é posto de volta no navegador.
 */
const dailyLimit = (ctx: Ctx) => Number(ctx.env.AI_DAILY_LIMIT) || 60;
const today = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

const imageLimit = (ctx: Ctx) => Number(ctx.env.AI_IMAGE_DAILY_LIMIT) || 30;

/** Conta um uso de IA da pessoa no dia (protege o gasto da chave). Imagens têm cota própria. */
async function spend(ctx: Ctx, kind: 'texto' | 'imagem' = 'texto') {
  const key = `ai${kind === 'imagem' ? 'img' : ''}:${ctx.user.id}:${new Date().toISOString().slice(0, 10)}`;
  const limit = kind === 'imagem' ? imageLimit(ctx) : dailyLimit(ctx);
  const used = Number((await ctx.env.FILES.get(key)) || 0);
  if (used >= limit) fail(`Você usou ${limit === 1 ? 'o pedido' : `os ${limit} pedidos`} de ${kind === 'imagem' ? 'imagens' : 'IA'} de hoje. Volte amanhã.`, 429);
  await ctx.env.FILES.put(key, String(used + 1), { expirationTtl: 86400 });
}

const SYSTEM = `Você é a assistente pedagógica do SCOLA, sistema de gestão escolar usado por professores e gestores de escolas brasileiras. Escreva sempre em português do Brasil, com linguagem clara, profissional e acolhedora, adequada a documentos escolares. Responda em Markdown simples (títulos com #, listas com -, negrito com **, tabelas só quando ajudarem). Não escreva introduções como "Claro!" nem comentários finais: entregue só o conteúdo pedido. Nunca escreva códigos da BNCC (como EF07MA01), pois costumam sair errados: descreva a habilidade com palavras e, logo abaixo, deixe a linha "Código BNCC: ________ (preencher)". Nunca invente dados sobre alunos. Em questões de múltipla escolha: exatamente uma alternativa correta, e a letra certa deve variar entre as questões.`;

/**
 * Revisão do gabarito: modelos rápidos às vezes erram a conta ou deixam duas alternativas certas.
 * Quando o texto tem questões com gabarito, uma segunda passada resolve cada questão e corrige.
 */
const HAS_KEY = /gabarito|resposta(s)? (correta|certa)|\bresposta:/i;
async function reviewKey(ctx: Ctx, text: string): Promise<{ text: string; model?: string }> {
  if (!HAS_KEY.test(text) || !/\b[a-e]\)/i.test(text)) return { text };
  try {
    const r = await nvChat(ctx.env, 'texto', [
      { role: 'system', content: 'Você revisa provas escolares. Responda só com o documento revisado, sem comentários.' },
      {
        role: 'user',
        content: `Revise o material abaixo. Resolva cada questão você mesmo, passo a passo, em silêncio. Se o gabarito de alguma questão estiver errado, corrija o gabarito. Se uma questão tiver mais de uma alternativa correta (ou nenhuma), troque as alternativas erradas para que haja exatamente uma correta. Mantenha todo o resto igual (textos, formato, ordem). Devolva o documento completo revisado.\n\n---\n${text}\n---`,
      },
    ], 3000, 0);
    const out = r.text.replace(/^---\s*|\s*---$/g, '').trim();
    // Revisão que encurtou demais provavelmente cortou o conteúdo: fica com o original.
    return out.length > text.length * 0.7 ? { text: out, model: r.model } : { text };
  } catch {
    return { text };
  }
}

export type WriteAction = 'gerar' | 'melhorar' | 'corrigir' | 'resumir' | 'continuar' | 'simplificar' | 'topicos';
const ACTIONS: Record<WriteAction, (p: string, t: string) => string> = {
  gerar: (p, t) => `${p}${t ? `\n\nUse como contexto o texto atual do documento:\n"""\n${t}\n"""` : ''}`,
  melhorar: (p, t) => `Reescreva o texto abaixo deixando-o mais claro, bem organizado e profissional, sem mudar o sentido nem acrescentar informações.${p ? ` Orientação: ${p}` : ''}\n\n"""\n${t}\n"""`,
  corrigir: (_p, t) => `Corrija ortografia, acentuação, pontuação e concordância do texto abaixo. Mantenha as palavras e a estrutura sempre que possível; não acrescente nada.\n\n"""\n${t}\n"""`,
  resumir: (p, t) => `Resuma o texto abaixo em poucos parágrafos ou tópicos, mantendo o essencial.${p ? ` Orientação: ${p}` : ''}\n\n"""\n${t}\n"""`,
  continuar: (p, t) => `Continue o texto abaixo no mesmo estilo e formato, sem repetir o que já foi escrito. Entregue só a continuação.${p ? ` Orientação: ${p}` : ''}\n\n"""\n${t}\n"""`,
  simplificar: (p, t) => `Reescreva o texto abaixo em linguagem simples, fácil para alunos e famílias entenderem.${p ? ` Orientação: ${p}` : ''}\n\n"""\n${t}\n"""`,
  topicos: (p, t) => `Transforme o texto abaixo em uma lista de tópicos organizada.${p ? ` Orientação: ${p}` : ''}\n\n"""\n${t}\n"""`,
};

/** Escrever com IA no editor: gerar a partir de um pedido ou transformar o trecho selecionado. */
export async function aiWrite(ctx: Ctx, input: { action: WriteAction; prompt?: string; text?: string }) {
  requireRole(ctx, 'gestor', 'professor');
  const build = ACTIONS[input?.action];
  if (!build) fail('Ação inválida.');
  const prompt = String(input.prompt ?? '').trim().slice(0, 2000);
  const text = String(input.text ?? '').trim().slice(0, 12000);
  if (input.action === 'gerar' ? prompt.length < 3 : text.length < 3) fail(input.action === 'gerar' ? 'Escreva o que a IA deve fazer.' : 'Selecione o trecho do documento.');
  await spend(ctx);
  const out = await generate(ctx.env, [
    { role: 'system', content: `${SYSTEM} Hoje é ${today()}.` },
    { role: 'user', content: build(prompt, text) },
  ], input.action === 'gerar' ? 2500 : 2000, input.action === 'corrigir' ? 0.1 : 0.5);
  if (!out) fail('A IA não devolveu texto. Tente de novo.', 502);
  return { markdown: aiConfig(ctx.env).provider === 'nvidia' ? (await reviewKey(ctx, out)).text : out };
}

/* ------------------------------------ Pareceres ------------------------------------ */
type ParecerStudent = { n: number; terms?: (number | null)[]; final?: number | null; activities?: { name: string; score: number | null; max: number }[] };
const nf = (v: number | null | undefined) => (v == null ? 'sem nota' : v.toFixed(1).replace('.', ','));

/**
 * Parecer descritivo de cada aluno a partir das notas (até 15 por pedido; o navegador manda em lotes).
 * Sem nomes: cada aluno vai como um número e o texto usa "o(a) estudante".
 */
export async function aiPareceres(ctx: Ctx, input: {
  subject?: string; className?: string; period?: string; term?: number; tone?: string; extra?: string; students: ParecerStudent[];
}) {
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
      parts.push(['1º', '2º', '3º'].map((t, i) => `${t} tri ${nf(s.terms?.[i])}`).join(', '));
      parts.push(`média final ${nf(s.final)}`);
      // Tendência e situação já calculadas: o modelo não precisa (nem deve) comparar números sozinho.
      const got = (s.terms ?? []).slice(0, 3).map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => typeof x.v === 'number');
      if (got.length >= 2) {
        const [a, b] = got.slice(-2);
        const d = b.v - a.v;
        parts.push(`tendência: ${Math.abs(d) < 0.3 ? 'estável' : d > 0 ? 'melhorou' : 'piorou'} do ${a.i + 1}º para o ${b.i + 1}º trimestre (${nf(a.v)} → ${nf(b.v)})`);
      }
      const ref = s.final ?? (got.length ? got[got.length - 1].v : null);
      if (ref != null) parts.push(`situação: ${ref >= 6 ? 'acima da média' : ref >= 5 ? 'próximo da média, precisa de recuperação' : 'abaixo da média, precisa de recuperação'}`);
    }
    return `${Number(s.n)}| ${parts.join(' — ')}`;
  });
  const tone = String(input.tone ?? '').slice(0, 200);
  const extra = String(input.extra ?? '').slice(0, 600);
  const out = await generate(ctx.env, [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: `Escreva um parecer descritivo curto (3 a 4 frases) para cada estudante abaixo${input.subject ? `, na disciplina ${String(input.subject).slice(0, 80)}` : ''}${input.className ? `, turma ${String(input.className).slice(0, 60)}` : ''}${input.period ? `, período ${String(input.period).slice(0, 60)}` : ''}.
Regras: escala de notas de 0 a 10, média para aprovação 6,0. Baseie-se SOMENTE nos dados informados e use a tendência e a situação exatamente como vierem (não compare números por conta própria): descreva o desempenho, reconheça avanços e dê uma orientação concreta. Não cite conteúdos ou temas específicos (como frações, operações, leitura) nem comportamentos (participação, atenção) que não estejam na orientação do professor: fale em "os conteúdos do período". Não invente fatos. Não use nome: escreva "o(a) estudante". Sem notas registradas, diga que não há avaliações suficientes no período.${tone ? `\nTom: ${tone}.` : ''}${extra ? `\nOrientação do professor: ${extra}` : ''}
Responda exatamente uma linha por estudante, no formato "número| parecer", sem linhas extras.

${lines.join('\n')}`,
    },
  ], 260 * list.length, 0.4);
  const byN = new Map<number, string>();
  for (const l of out.split('\n')) {
    const m = l.match(/^\s*\**\s*(\d+)\s*\**\s*[|:.)–-]\s*(.+)$/);
    if (m && m[2].trim().length > 10) byN.set(Number(m[1]), m[2].trim().replace(/^\*+|\*+$/g, ''));
  }
  return { items: list.map((s) => ({ n: Number(s.n), text: byN.get(Number(s.n)) ?? '' })) };
}

/** Se a IA está disponível (para mostrar ou esconder os botões) e o que ela sabe fazer. */
export async function aiStatus(ctx: Ctx) {
  const c = aiConfig(ctx.env);
  const custom = await customEngine(ctx.env);
  return {
    ready: c.chatReady || !!custom, images: c.chatReady && c.provider === 'nvidia', limit: dailyLimit(ctx), imageLimit: imageLimit(ctx),
    engine: custom ? custom.label || custom.model : c.chatReady ? 'NVIDIA' : null,
  };
}

/* -------------------------------- Campo inteligente -------------------------------- */
/**
 * Um pedido só: o SCOLA entende se é texto, imagem, leitura de foto ou edição de imagem
 * e escolhe o modelo da NVIDIA certo para cada parte (com troca automática se um falhar).
 */
export type SmartMode = 'auto' | 'texto' | 'imagem' | 'ler' | 'editar';
type Aspect = 'paisagem' | 'retrato' | 'quadrado';
const SIZES: Record<Aspect, { width: number; height: number }> = {
  paisagem: { width: 1024, height: 768 }, retrato: { width: 768, height: 1024 }, quadrado: { width: 1024, height: 1024 },
};
// Modelos de imagem embaralham letras: rótulos e enunciados ficam no documento, em texto de verdade.
const NO_TEXT = 'Clean wordless picture, no annotations, unlabeled, pure imagery, nothing written anywhere.';
/** Pedidos de rótulo/legenda fazem o modelo desenhar letras embaralhadas: tira essas partes. */
const unlabel = (p: string) =>
  p.replace(/\b(clearly |neatly )?(labell?ed|annotated|captioned|titled)\b[^,.;]*/gi, '')
    .replace(/\bwith (its |their )?(names?|labels?|captions?|titles?|text|words|arrows? (and|with) (labels?|text))\b[^,.;]*/gi, '')
    .replace(/\b(labels?|captions?|text|lettering|typography|title|names? of [^,.;]*)\b/gi, '')
    // Público-alvo ("for 7th grade students") e "diagram" puxam títulos e legendas escritas.
    .replace(/\bfor (\w+ )?(\d+\w*[- ]grade|grade \d+|students?|pupils?|kids|children|school|classroom|teachers?)[^,.;:]*/gi, '')
    .replace(/\b(educational |scientific |labeled |school )?diagram\b/gi, 'illustration')
    .replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').replace(/([,;])\s*[,;]+/g, '$1').trim();
// Com imagem: ler/entender vem primeiro ("transcreva para eu editar" é leitura, não edição da imagem).
const READ_RE = /\b(transcrev|ler\b|leia|digit|extra[ií]|copi[ae]|quest|pergunt|exerc|atividade|prova|descrev|explic|o que (é|tem|diz|está)|resum|corrij|corrig|gabarit|tradu|identifi|analis)/i;
const EDIT_RE = /\b(transform|deix[ae]|mud[ae]|troqu?[ae]|coloqu?[ae]|acrescent|adicion|inclu[ai]|remov|tir[ae]\b|apagu?[ae]|pint[ae]|colori|redesenh|recri|refa[çz]|estilo|cartoon|desenho animado|aquarela|nova vers[ãa]o|edite a (imagem|foto)|melhor[ae] (a|essa|esta) (imagem|foto)|fundo)/i;
const IMG_RE = /\b(imagem|imagens|ilustra\w*|desenh\w*|figura|gravura|foto\b|clip ?art|ícone|icone|mascote|cartaz|capa|colorir)/i;

type Plan = { tarefa: 'texto' | 'imagem' | 'texto_e_imagem'; imagem_en: string; formato: Aspect };

/** Decide o que fazer (e já escreve o pedido de imagem em inglês, que os modelos de imagem entendem melhor). */
async function plan(ctx: Ctx, prompt: string, forced: 'texto' | 'imagem' | null): Promise<Plan & { model?: string }> {
  const guess: Plan['tarefa'] = forced ?? (IMG_RE.test(prompt) ? 'imagem' : 'texto');
  if (forced === 'texto') return { tarefa: 'texto', imagem_en: '', formato: 'paisagem' };
  try {
    const r = await nvChat(ctx.env, 'texto', [
      { role: 'system', content: 'Você classifica pedidos de professores para um assistente de IA e responde só com JSON válido, sem comentários.' },
      {
        role: 'user',
        content: `Pedido do professor: """${prompt}"""

Responda em JSON: {"tarefa": "texto" | "imagem" | "texto_e_imagem", "imagem_en": "...", "formato": "paisagem" | "retrato" | "quadrado"}
- "imagem": quer só uma imagem/ilustração/desenho/figura.
- "texto_e_imagem": quer um texto (atividade, prova, história, cartaz com texto…) que também precisa de uma ilustração.
- "texto": todo o resto.${forced === 'imagem' ? '\nO professor escolheu IMAGEM: use "imagem".' : ''}
- "imagem_en": se houver imagem, um prompt em inglês (até 80 palavras) descrevendo a ilustração: assunto, composição, estilo adequado à escola (ex.: ilustração didática colorida, desenho para colorir em preto e branco, foto realista) e público. NUNCA peça rótulos, nomes, legendas, títulos, números ou setas com palavras, não cite a série/ano nem a palavra diagrama, e descreva o visual (formas e cores) em vez de listar nomes de partes (o modelo de imagem tenta escrever os nomes e erra). Se não houver imagem, "".`,
      },
    ], 400, 0);
    const j = JSON.parse(r.text.slice(r.text.indexOf('{'), r.text.lastIndexOf('}') + 1)) as Partial<Plan>;
    const tarefa = forced === 'imagem' ? 'imagem' : j.tarefa === 'imagem' || j.tarefa === 'texto_e_imagem' ? j.tarefa : 'texto';
    return {
      tarefa: tarefa !== 'texto' && !String(j.imagem_en || '').trim() ? 'texto' : tarefa,
      imagem_en: String(j.imagem_en || '').slice(0, 1200),
      formato: j.formato === 'retrato' || j.formato === 'quadrado' ? j.formato : 'paisagem',
      model: r.model,
    };
  } catch {
    // Sem o planejador: segue pela regra simples (imagem só se o pedido falar em imagem).
    return { tarefa: guess, imagem_en: guess === 'texto' ? '' : prompt, formato: 'paisagem' };
  }
}

export async function aiSmart(ctx: Ctx, input: { prompt?: string; mode?: SmartMode; image?: string | null; aspect?: Aspect; context?: string }) {
  requireRole(ctx, 'gestor', 'professor');
  const prompt = String(input?.prompt ?? '').trim().slice(0, 3000);
  const context = String(input?.context ?? '').trim().slice(0, 6000);
  const image = typeof input?.image === 'string' && input.image ? input.image : null;
  if (image && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 2_000_000)) fail('Imagem inválida ou grande demais (até 1,5 MB).');
  const mode: SmartMode = ['auto', 'texto', 'imagem', 'ler', 'editar'].includes(String(input?.mode)) ? (input!.mode as SmartMode) : 'auto';
  const used = new Set<string>();

  /* Com imagem anexada: ler/entender ou recriar com a mudança pedida. */
  if (image) {
    const route = mode === 'editar' || mode === 'ler' ? mode : mode === 'imagem' || (EDIT_RE.test(prompt) && !READ_RE.test(prompt)) ? 'editar' : 'ler';
    if (route === 'ler') {
      await spend(ctx);
      // Só transcrever: a visão resolve. Criar algo a partir da imagem: a visão lê e o modelo de texto
      // (que raciocina melhor — gabaritos, cálculos) faz o pedido em cima da leitura.
      const onlyRead = !prompt || /\b(transcrev|digit|copi[ae]|extra[ií]|o que (está )?escrito)/i.test(prompt);
      const read = await nvChat(ctx.env, 'visao', [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: onlyRead
                ? prompt || 'Transcreva todo o texto desta imagem, mantendo a organização (questões, alternativas, tabelas). Se não houver texto, descreva a imagem para uso em aula.'
                : 'Transcreva fielmente todo o texto desta imagem (mantendo questões, alternativas e tabelas) e depois descreva em poucas linhas o que a imagem mostra. Não resolva nada.',
            } as Part,
            { type: 'image_url', image_url: { url: image } } as Part,
          ],
        },
      ], 2500, 0.1);
      used.add(`${modelLabel(read.model)} (leitura da imagem)`);
      if (onlyRead) return { route, markdown: read.text, used: [...used] };
      const r = await nvChat(ctx.env, 'texto', [
        { role: 'system', content: `${SYSTEM} Confira cada cálculo e cada gabarito antes de responder.` },
        { role: 'user', content: `Conteúdo da imagem enviada pelo professor:\n---\n${read.text}\n---\n\nPedido: ${prompt}` },
      ], 2500, 0.3);
      used.add(`${modelLabel(r.model)} (texto)`);
      const rv = await reviewKey(ctx, r.text);
      if (rv.model) used.add(`${modelLabel(rv.model)} (revisão do gabarito)`);
      return { route, markdown: rv.text, used: [...used] };
    }
    if (prompt.length < 3) fail('Diga o que mudar na imagem.');
    await spend(ctx, 'imagem');
    // A NVIDIA gratuita não edita a imagem enviada: o modelo de visão descreve a imagem já com a mudança e o FLUX redesenha.
    const d = await nvChat(ctx.env, 'visao', [{
      role: 'user',
      content: [
        { type: 'text', text: `You write prompts for an image generator. Look at this image and write ONE English prompt (max 120 words) that recreates it as faithfully as possible (subject, composition, colors, style; ignore any written text in it) but applying this change requested by a teacher (in Portuguese): "${prompt}". Output only the prompt.` } as Part,
        { type: 'image_url', image_url: { url: image } } as Part,
      ],
    }], 500, 0.3);
    used.add(`${modelLabel(d.model)} (entender a imagem)`);
    const img = await nvImage(ctx.env, `${unlabel(d.text.replace(/^["']|["']$/g, ''))} ${NO_TEXT}`, SIZES[input.aspect ?? 'paisagem'] ?? SIZES.paisagem);
    used.add(`${modelLabel(img.model)} (desenhar)`);
    return { route, image: img.image, used: [...used] };
  }

  if (prompt.length < 3) fail('Escreva o que a IA deve fazer.');
  if (mode === 'ler' || mode === 'editar') fail('Anexe a imagem primeiro.');
  const p = await plan(ctx, prompt, mode === 'texto' ? 'texto' : mode === 'imagem' ? 'imagem' : null);
  if (p.model) used.add(`${modelLabel(p.model)} (entender o pedido)`);

  const wantText = p.tarefa !== 'imagem';
  const wantImage = p.tarefa !== 'texto';
  await spend(ctx);
  if (wantImage) await spend(ctx, 'imagem');
  const [txt, img] = await Promise.all([
    wantText
      ? nvChat(ctx.env, 'texto', [
          { role: 'system', content: `${SYSTEM} Hoje é ${today()}.${wantImage ? ' Uma ilustração gerada à parte será colocada automaticamente no topo: não mencione a imagem, não reserve espaço para ela e não escreva "[imagem]".' : ''}` },
          { role: 'user', content: `${prompt}${context ? `\n\nUse como contexto o texto atual do documento:\n"""\n${context}\n"""` : ''}` },
        ], 2500, 0.5)
      : null,
    wantImage ? nvImage(ctx.env, `${unlabel(p.imagem_en)} ${NO_TEXT}`, SIZES[p.formato]) : null,
  ]);
  if (txt) used.add(`${modelLabel(txt.model)} (texto)`);
  // A imagem entra no topo: tira os "aqui vai a imagem" que o modelo às vezes escreve.
  const reviewed = txt ? await reviewKey(ctx, txt.text) : null;
  if (reviewed?.model) used.add(`${modelLabel(reviewed.model)} (revisão do gabarito)`);
  const text = reviewed && wantImage
    ? reviewed.text.split('\n').filter((l) => !/(\[\s*(imagem|ilustra)|(imagem|ilustra\w*)[^\n]{0,60}(inserid|aqui|abaixo|acima))/i.test(l)).join('\n').replace(/\n{3,}/g, '\n\n')
    : reviewed?.text;
  if (img) used.add(`${modelLabel(img.model)} (imagem)`);
  return { route: p.tarefa, markdown: text ?? null, image: img?.image ?? null, used: [...used] };
}


/* ------------------------------- Página "IA" (conversa) ------------------------------- */
const CHAT_SYSTEM = `Você é a IA do SCOLA, uma assistente de inteligência artificial completa, como um ChatGPT, usada por professores e gestores de escolas brasileiras. Ajude com QUALQUER assunto: dúvidas gerais, explicações, textos, provas, atividades, planos de aula, correções, traduções, cálculos, ideias, e-mails, análise de documentos anexados. Responda em português do Brasil (a menos que peçam outro idioma), em Markdown (títulos, listas, tabelas, negrito quando ajudarem). Seja direta e útil, sem rodeios. Não use LaTeX nem cifrões para matemática: escreva contas em texto simples (ex.: 3/8, 2 × 4 = 8, x² + 1). Quando houver documentos anexados, use o conteúdo deles e cite de qual documento veio a informação. Em questões de múltipla escolha: exatamente uma alternativa correta, letra certa variando, e confira cada gabarito e cálculo antes de responder. Não invente códigos da BNCC: descreva a habilidade e deixe "Código BNCC: ________ (preencher)".`;

type ChatPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type ChatIn = { role: 'user' | 'assistant'; content: string | ChatPart[] };

/** Resposta em streaming (rota /api/ai/chat). Os documentos chegam já como texto (o navegador extrai). */
export async function chatStream(ctx: Ctx, input: { messages?: ChatIn[] }) {
  requireRole(ctx, 'gestor', 'professor', 'secretaria');
  const list = (Array.isArray(input?.messages) ? input.messages : []).slice(-40);
  if (!list.length || list[list.length - 1].role !== 'user') fail('Escreva a mensagem.');
  let chars = 0;
  let images = 0;
  const msgs: RichMsg[] = [];
  // Do fim para o começo: guarda o mais recente e corta o histórico antigo se passar de ~400 mil caracteres.
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    let content: string | Part[];
    if (typeof m.content === 'string') {
      content = m.content.slice(0, 300_000);
      chars += content.length;
    } else {
      const parts: Part[] = [];
      for (const p of m.content.slice(0, 12)) {
        if (p?.type === 'text') {
          const t = String(p.text ?? '').slice(0, 300_000);
          chars += t.length;
          parts.push({ type: 'text', text: t });
        } else if (p?.type === 'image_url' && i === list.length - 1 && images < 6) {
          const url = String(p.image_url?.url ?? '');
          if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(url) && url.length < 2_000_000) {
            parts.push({ type: 'image_url', image_url: { url } });
            images++;
          }
        }
      }
      content = parts;
    }
    if (chars > 400_000 && msgs.length) break;
    msgs.unshift({ role, content });
  }
  await spend(ctx);
  // Só NVIDIA: os modelos de visão leem bem mas raciocinam mal (erram contas e gabaritos).
  // Então a visão transcreve/descreve as imagens e o modelo de texto responde em cima disso.
  // Com um motor externo (ex.: OpenRouter), as imagens vão direto para ele.
  let task: 'texto' | 'visao' = images ? 'visao' : 'texto';
  let readBy = '';
  if (images && !(await customEngine(ctx.env))) {
    const last = msgs[msgs.length - 1];
    const parts = Array.isArray(last.content) ? last.content : [];
    const imgs = parts.filter((p): p is Extract<Part, { type: 'image_url' }> => p.type === 'image_url');
    const read = await nvChat(ctx.env, 'visao', [{
      role: 'user',
      content: [
        { type: 'text', text: `Para cada uma das ${imgs.length} imagem(ns), na ordem: transcreva fielmente TODO o texto (mantendo questões, alternativas, tabelas e números) e depois descreva em poucas linhas o que a imagem mostra. Comece cada uma com "Imagem N:". Não resolva nem responda nada.` } as Part,
        ...imgs,
      ],
    }], 3000, 0.1);
    readBy = modelLabel(read.model);
    const text = parts.filter((p): p is Extract<Part, { type: 'text' }> => p.type === 'text').map((p) => p.text).join('\n');
    msgs[msgs.length - 1] = { role: 'user', content: `${text}\n\n### Conteúdo das imagens anexadas (lido por IA de visão)\n${read.text}` };
    task = 'texto';
  }
  const who = ctx.user.full_name ? ` Você está conversando com ${ctx.user.full_name}.` : '';
  const { stream, model: answeredBy } = await streamChat(ctx.env, task, [
    { role: 'system', content: `${CHAT_SYSTEM} Hoje é ${today()}.${who}` },
    ...msgs,
  ]);
  const model = readBy ? `${readBy} (leitura) · ${answeredBy}` : answeredBy;
  return new Response(readBy ? prefixModel(stream, model) : stream, {
    // event-stream + sem compressão: com gzip a Cloudflare/navegador acumulam o texto e ele aparece todo de uma vez.
    headers: {
      'content-type': 'text/event-stream; charset=utf-8', 'content-encoding': 'identity', 'cache-control': 'no-store, no-transform',
      'x-ai-model': encodeURIComponent(model), 'x-content-type-options': 'nosniff', 'x-accel-buffering': 'no',
    },
  });
}

/* Histórico: cada pessoa só vê as próprias conversas. */
const MAX_CHAT = 900_000;

export async function listAiChats(ctx: Ctx) {
  return all<{ id: string; title: string; updated_at: string }>(ctx.db,
    'SELECT id, title, updated_at FROM ai_chats WHERE user_id = ? ORDER BY updated_at DESC LIMIT 60', ctx.user.id);
}

export async function getAiChat(ctx: Ctx, id: string) {
  const c = await first<{ id: string; title: string; messages: string; updated_at: string }>(ctx.db,
    'SELECT id, title, messages, updated_at FROM ai_chats WHERE id = ? AND user_id = ?', id, ctx.user.id);
  if (!c) fail('Conversa não encontrada.', 404);
  return { ...c!, messages: JSON.parse(c!.messages) as unknown[] };
}

export async function saveAiChat(ctx: Ctx, input: { id?: string | null; title?: string; messages: unknown[] }) {
  requireRole(ctx, 'gestor', 'professor', 'secretaria');
  let json = JSON.stringify(Array.isArray(input?.messages) ? input.messages : []);
  // Conversa enorme: guarda só as mensagens mais recentes que cabem.
  if (json.length > MAX_CHAT) {
    const msgs = [...(input.messages as unknown[])];
    while (msgs.length > 2 && JSON.stringify(msgs).length > MAX_CHAT) msgs.shift();
    json = JSON.stringify(msgs);
    if (json.length > MAX_CHAT) fail('Conversa grande demais para salvar. Comece uma nova.');
  }
  const title = String(input.title || 'Nova conversa').trim().slice(0, 120) || 'Nova conversa';
  const ts = now();
  if (input.id) {
    const r = await run(ctx.db, 'UPDATE ai_chats SET title = ?, messages = ?, updated_at = ? WHERE id = ? AND user_id = ?', title, json, ts, input.id, ctx.user.id);
    if (r.meta.changes) return { id: input.id, updated_at: ts };
  }
  const id = uid();
  await run(ctx.db, 'INSERT INTO ai_chats (id, user_id, base_id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, ctx.user.id, ctx.baseId ?? null, title, json, ts, ts);
  return { id, updated_at: ts };
}

export async function deleteAiChat(ctx: Ctx, id: string) {
  await run(ctx.db, 'DELETE FROM ai_chats WHERE id = ? AND user_id = ?', id, ctx.user.id);
}

/* ------------------- Motor externo (só o administrador da plataforma) ------------------- */
export async function aiEngineInfo(ctx: Ctx) {
  requireAdmin(ctx);
  const c = aiConfig(ctx.env);
  const custom = await customEngine(ctx.env);
  return {
    nvidia: c.chatReady && c.provider === 'nvidia',
    custom: custom ? { baseUrl: custom.baseUrl, model: custom.model, label: custom.label, keyHint: `${custom.key.slice(0, 6)}…${custom.key.slice(-4)}` } : null,
  };
}

/** Salva endereço + chave + modelo de uma API compatível com OpenAI, depois de testar de verdade. */
export async function setAiEngine(ctx: Ctx, input: { baseUrl: string; key: string; model: string; label?: string }) {
  requireAdmin(ctx);
  let baseUrl = String(input?.baseUrl || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  if (!/^https:\/\/[^\s/]+\.[^\s]+$/.test(baseUrl)) fail('Endereço inválido. Use https://… (ex.: https://openrouter.ai/api/v1). Endereços "localhost" não funcionam: o SCOLA roda na nuvem.');
  if (!/\/v\d+$/.test(baseUrl) && !/\/api\/v\d+$/.test(baseUrl)) baseUrl += '/v1';
  const key = String(input?.key || '').trim();
  const model = String(input?.model || '').trim();
  if (key.length < 8) fail('Cole a chave da API.');
  if (!model) fail('Informe o modelo (ex.: openrouter/auto).');
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(45_000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://scola.app', 'X-Title': 'SCOLA' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Responda apenas: OK' }], max_tokens: 400 }),
  }).catch((e) => fail(`Não consegui falar com ${baseUrl}: ${(e as Error)?.message || 'sem resposta'}.`, 400));
  const body = await res.text().catch(() => '');
  if (!res.ok) {
    let msg = body.slice(0, 200);
    try {
      const j = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
      msg = (typeof j.error === 'string' ? j.error : j.error?.message) || j.message || msg;
    } catch { /* texto puro */ }
    fail(`O serviço recusou (${res.status}): ${msg}`, 400);
  }
  const label = String(input.label || '').trim().slice(0, 40) || (baseUrl.includes('openrouter') ? `OpenRouter · ${model}` : model);
  await ctx.env.FILES.put(CUSTOM_KV, await sealSecret(ctx.env, JSON.stringify({ baseUrl, key, model, label })));
  forgetCustomEngine();
  return { ok: true, label };
}

export async function clearAiEngine(ctx: Ctx) {
  requireAdmin(ctx);
  await ctx.env.FILES.delete(CUSTOM_KV);
  forgetCustomEngine();
}

/** Troca o cabeçalho "\u001e<modelo>\u001e" do fluxo para mostrar também quem leu as imagens. */
function prefixModel(stream: ReadableStream<Uint8Array>, label: string) {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let head = '';
  let done = false;
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      if (done) return ctl.enqueue(chunk);
      head += dec.decode(chunk, { stream: true });
      const m = head.match(/^\u001e([^\u001e]*)\u001e/);
      if (!m) return;
      done = true;
      ctl.enqueue(enc.encode(`\u001e${label.includes(m[1]) ? label : `${label.split(' · ')[0]} · ${m[1]}`}\u001e${head.slice(m[0].length)}`));
    },
  }));
}
