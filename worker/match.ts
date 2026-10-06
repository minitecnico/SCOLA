/**
 * Reconhece o nome de uma instituição digitado à mão ("escola abc", "Esc. A.B.C", "colegio aurroa")
 * entre as escolas cadastradas. Ignora acento, pontuação, maiúsculas, abreviações comuns ("E.M.E.F.", "Col."),
 * palavras genéricas ("escola", "municipal"…) e tolera erros de digitação (letra trocada, faltando ou a mais).
 */
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'na', 'no', 'nas', 'nos', 'para', 'the']);
const GENERIC = new Set([
  'escola', 'esc', 'colegio', 'col', 'colg', 'centro', 'ctr', 'educacional', 'educacao', 'instituto', 'inst', 'instituicao', 'ensino',
  'creche', 'municipal', 'mun', 'estadual', 'est', 'federal', 'particular', 'publica', 'publico', 'infantil', 'fundamental', 'medio',
  'basico', 'escolar', 'unidade', 'nucleo', 'professor', 'professora', 'prof', 'profa', 'dr', 'dra', 'doutor', 'doutora',
  'emef', 'emei', 'emeief', 'emeb', 'ceim', 'cmei', 'cemei', 'cei', 'ceu', 'eefm', 'eeef', 'eeb', 'ee', 'ie', 'ei', 'ef', 'cef', 'cem',
]);

const ROMAN = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;
const romanToNumber = (s: string) => {
  const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let n = 0;
  for (let i = 0; i < s.length; i++) n += v[s[i]] < (v[s[i + 1]] ?? 0) ? -v[s[i]] : v[s[i]];
  return n;
};

/** Aproxima a escrita: sem acento, y→i, ph→f, k→c, z→s, h mudo, letras dobradas viram uma. */
const phonetic = (t: string) =>
  t
    .replace(/ph/g, 'f')
    .replace(/[yw]/g, (c) => (c === 'y' ? 'i' : 'v'))
    .replace(/k/g, 'c')
    .replace(/z/g, 's')
    .replace(/(?<![clns])h/g, '')
    .replace(/(.)\1+/g, '$1');

export function tokens(raw: string): string[] {
  let s = String(raw || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  // "E.M.E.F." / "A B C" → siglas coladas (emef, abc)
  s = s.replace(/\b[a-z](?: [a-z])+\b/g, (m) => m.replace(/ /g, ''));
  const all = s.split(' ').filter(Boolean).map((t) => (ROMAN.test(t) && t.length >= 2 ? String(romanToNumber(t)) : t));
  const noStop = all.filter((t) => !STOP.has(t));
  const core = noStop.filter((t) => !GENERIC.has(t));
  return (core.length ? core : noStop).map(phonetic);
}

/** Distância de edição com troca de letras vizinhas (aurroa → aurora = 1). */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

const ratio = (a: string, b: string) => 1 - distance(a, b) / Math.max(a.length, b.length, 1);

function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  if (/^\d+$/.test(a) || /^\d+$/.test(b)) return 0; // números (XXIII, 2) só valem se iguais
  const min = Math.min(a.length, b.length);
  if (min < 4) return 0; // palavras curtas não aceitam erro (abc ≠ abd)
  if ((a.startsWith(b) || b.startsWith(a)) && min >= 4) return 0.85; // "aurora" ~ "auror"
  const r = ratio(a, b);
  return r >= 0.74 ? r : 0;
}

/** Semelhança de 0 a 100 entre o que a pessoa digitou e o nome cadastrado. */
export function similarity(typed: string, registered: string): number {
  const q = [...new Set(tokens(typed))];
  const c = [...new Set(tokens(registered))];
  if (!q.length || !c.length) return 0;
  const best = (x: string, list: string[]) => Math.max(...list.map((y) => tokenSim(x, y)));
  const recall = q.reduce((s, t) => s + best(t, c), 0) / q.length;
  const precision = c.reduce((s, t) => s + best(t, q), 0) / c.length;
  const f = recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision);
  // "santaluzia" ≈ "santa luzia" (espaço a mais ou a menos)
  // (só quando os números batem: "João 24" nunca é "João XXIII")
  const nums = (l: string[]) => l.filter((t) => /^\d+$/.test(t)).sort().join(',');
  const joined = q.join('').length >= 4 && nums(q) === nums(c) ? ratio(q.join(''), c.join('')) * 0.97 : 0;
  return Math.round(Math.max(f, joined) * 100);
}

export const MATCH_MAYBE = 70; // sugere ("Você quis dizer…?")
export const MATCH_SURE = 88; // praticamente certo

export function bestMatch<T extends { name: string }>(typed: string, bases: T[]): { base: T; score: number } | null {
  if (tokens(typed).join('').length < 3) return null;
  let top: { base: T; score: number } | null = null;
  for (const b of bases) {
    const score = similarity(typed, b.name);
    if (!top || score > top.score) top = { base: b, score };
  }
  return top && top.score >= MATCH_MAYBE ? top : null;
}
