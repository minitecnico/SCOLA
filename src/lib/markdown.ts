import { marked, type Tokens } from 'marked';

/**
 * Markdown da IA → HTML para o editor. O editor só aceita os elementos que conhece
 * (títulos, listas, tabelas, negrito…), o resto é descartado. HTML cru, imagens e
 * links que não sejam http(s)/e-mail nunca entram (a prévia também mostra este HTML).
 */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
marked.use({
  gfm: true,
  breaks: false,
  renderer: {
    image: () => '',
    html: () => '',
    link(this: { parser: { parseInline: (t: Tokens.Link['tokens']) => string } }, { href, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      return /^(https?:|mailto:)/i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
    },
  },
});

export const markdownToHtml = (md: string) => marked.parse(md, { async: false }) as string;

/**
 * Matemática em LaTeX (\frac{3}{8}, $x^2$, \times…) → texto legível, para as respostas da IA.
 * Fora de blocos de código. Cobre o que aparece em provas e atividades do ensino básico.
 */
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ' };
const SYMBOLS: [RegExp, string][] = [
  [/\\times/g, '×'], [/\\cdot/g, '·'], [/\\div/g, '÷'], [/\\pm/g, '±'], [/\\leq?/g, '≤'], [/\\geq?/g, '≥'], [/\\neq/g, '≠'],
  [/\\approx/g, '≈'], [/\\infty/g, '∞'], [/\\pi/g, 'π'], [/\\alpha/g, 'α'], [/\\beta/g, 'β'], [/\\theta/g, 'θ'], [/\\Delta/g, 'Δ'],
  [/\\%/g, '%'], [/\\degree|\^\{?\\circ\}?/g, '°'], [/\\rightarrow|\\to/g, '→'], [/\\Rightarrow/g, '⇒'], [/\\quad|\\qquad|\\,|\;|\\!/g, ' '],
  [/\\left|\\right/g, ''], [/\\text\{([^{}]*)\}/g, '$1'], [/\\mathrm\{([^{}]*)\}/g, '$1'], [/\\(?:d|t)?frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2'],
  [/\\sqrt\{([^{}]*)\}/g, '√($1)'], [/\\boxed\{([^{}]*)\}/g, '**$1**'],
];
function delatexMath(t: string) {
  let s = t;
  for (let i = 0; i < 3; i++) for (const [re, to] of SYMBOLS) s = s.replace(re, to); // frações aninhadas
  s = s.replace(/\^\{([0-9+\-n]+)\}|\^([0-9n])/g, (_m, a: string, b: string) => [...(a ?? b)].map((ch) => SUP[ch] ?? ch).join(''));
  s = s.replace(/√\((\w+)\)/g, '√$1').replace(/\(([0-9]+\/[0-9]+)\)/g, '$1');
  return s.replace(/[{}]/g, '').replace(/\\([a-zA-Z]+)/g, '$1');
}
export function delatex(md: string) {
  return md
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, i) => {
      if (i % 2) return part; // código fica como está
      return part
        .replace(/\\\[([\s\S]*?)\\\]/g, (_m, x: string) => `\n\n${delatexMath(x).trim()}\n\n`)
        .replace(/\$\$([\s\S]*?)\$\$/g, (_m, x: string) => `\n\n${delatexMath(x).trim()}\n\n`)
        .replace(/\\\((.*?)\\\)/g, (_m, x: string) => delatexMath(x))
        // $…$ só vira matemática se tiver marcas de LaTeX (assim "custa $5 e $10" fica como está).
        .replace(/\$([^$\n]{1,200}?)\$/g, (m, x: string) => (/[\\^_{}]/.test(x) ? delatexMath(x) : m))
        // Comandos soltos, fora de delimitadores (3 \times 4, \frac{1}{2}).
        .replace(/\\(?:d|t)?frac\{[^{}]*\}\{[^{}]*\}|\\sqrt\{[^{}]*\}|\\(?:times|cdot|div|pm|leq?|geq?|neq|approx|infty|pi|rightarrow|Rightarrow)\b/g, (x) => delatexMath(x));
    })
    .join('');
}
