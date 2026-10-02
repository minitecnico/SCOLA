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
