import { requireRole, type Ctx } from '../auth';
import { fail } from '../db';
import { aiConfig, generate } from '../ai';

/**
 * IA para o dia a dia do professor: escrever no editor do Planejamento e redigir pareceres.
 * Usa o mesmo motor do Assistente (chave em AI_PROVIDER/AI_API_KEY). Nomes de alunos nunca
 * saem do SCOLA: os pareceres vão numerados e o nome é posto de volta no navegador.
 */
const dailyLimit = (ctx: Ctx) => Number(ctx.env.AI_DAILY_LIMIT) || 60;
const today = () => new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

/** Conta um uso de IA da pessoa no dia (protege o gasto da chave). */
async function spend(ctx: Ctx) {
  const key = `ai:${ctx.user.id}:${new Date().toISOString().slice(0, 10)}`;
  const used = Number((await ctx.env.FILES.get(key)) || 0);
  if (used >= dailyLimit(ctx)) fail(`Você usou os ${dailyLimit(ctx)} pedidos de IA de hoje. Volte amanhã.`, 429);
  await ctx.env.FILES.put(key, String(used + 1), { expirationTtl: 86400 });
}

const SYSTEM = `Você é a assistente pedagógica do SCOLA, sistema de gestão escolar usado por professores e gestores de escolas brasileiras. Escreva sempre em português do Brasil, com linguagem clara, profissional e acolhedora, adequada a documentos escolares. Responda em Markdown simples (títulos com #, listas com -, negrito com **, tabelas só quando ajudarem). Não escreva introduções como "Claro!" nem comentários finais: entregue só o conteúdo pedido. Nunca escreva códigos da BNCC (como EF07MA01), pois costumam sair errados: descreva a habilidade com palavras e, logo abaixo, deixe a linha "Código BNCC: ________ (preencher)". Nunca invente dados sobre alunos.`;

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
  return { markdown: out };
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

/** Se a IA de escrita está disponível (para mostrar ou esconder os botões). */
export async function aiStatus(ctx: Ctx) {
  const c = aiConfig(ctx.env);
  return { ready: c.chatReady, limit: dailyLimit(ctx) };
}
