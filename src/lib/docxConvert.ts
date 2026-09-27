/**
 * Word ⇄ editor do SCOLA, no navegador (sem servidor, sem Google):
 *  - docxToHtml: abre um .docx enviado (mammoth) → HTML que o editor carrega.
 *  - docToDocx: conteúdo do editor (JSON do TipTap) → .docx de verdade (biblioteca docx),
 *    com títulos, negrito/itálico/sublinhado, cores, alinhamento, listas, tabelas e imagens.
 */
import type { JSONContent } from '@tiptap/react';

export async function docxToHtml(buffer: ArrayBuffer): Promise<{ html: string; warnings: string[] }> {
  const mammoth = (await import('mammoth/mammoth.browser.js')) as unknown as {
    convertToHtml: (i: { arrayBuffer: ArrayBuffer }, o?: unknown) => Promise<{ value: string; messages: { message: string }[] }>;
  };
  const r = await mammoth.convertToHtml(
    { arrayBuffer: buffer },
    {
      styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", 'u => u', 'strike => s'],
    },
  );
  return { html: r.value || '<p></p>', warnings: r.messages.map((m) => m.message).slice(0, 5) };
}

/* ------------------------------- Editor → .docx ------------------------------- */
type Docx = typeof import('docx');
type Mark = { type: string; attrs?: Record<string, unknown> };

const hex = (c: unknown): string | undefined => {
  const s = String(c ?? '').trim();
  if (!s) return undefined;
  if (s.startsWith('#')) {
    const h = s.slice(1);
    return (h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6)).toUpperCase();
  }
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
  if (m) return [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  return undefined;
};
const ptFromCss = (v: unknown) => {
  const m = /([\d.]+)\s*(px|pt)?/.exec(String(v ?? ''));
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'pt' ? n : n * 0.75;
};

async function imageData(src: string): Promise<{ data: Uint8Array; type: 'png' | 'jpg' | 'gif' | 'bmp'; w: number; h: number } | null> {
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    let type: 'png' | 'jpg' | 'gif' | 'bmp' = blob.type.includes('jpeg') || blob.type.includes('jpg') ? 'jpg' : blob.type.includes('gif') ? 'gif' : blob.type.includes('bmp') ? 'bmp' : 'png';
    let data = new Uint8Array(await blob.arrayBuffer());
    // webp/svg etc.: converte para PNG (o Word não abre todos os formatos).
    if (!/png|jpe?g|gif|bmp/.test(blob.type)) {
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d')!.drawImage(bmp, 0, 0);
      data = new Uint8Array(await (await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))).arrayBuffer());
      type = 'png';
    }
    return { data, type, w: bmp.width, h: bmp.height };
  } catch {
    return null;
  }
}

export async function docToDocx(json: JSONContent, title = 'Documento'): Promise<Blob> {
  const D: Docx = await import('docx');
  const align = (a: unknown) =>
    a === 'center' ? D.AlignmentType.CENTER : a === 'right' ? D.AlignmentType.RIGHT : a === 'justify' ? D.AlignmentType.JUSTIFIED : undefined;
  const HEAD = [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4];
  const MAX_W = 600; // largura útil da página (px, ~16 cm)

  // Texto e marcas → "runs"
  async function inline(nodes: JSONContent[] = []): Promise<(InstanceType<Docx['TextRun']> | InstanceType<Docx['ImageRun']> | InstanceType<Docx['ExternalHyperlink']>)[]> {
    const out: (InstanceType<Docx['TextRun']> | InstanceType<Docx['ImageRun']> | InstanceType<Docx['ExternalHyperlink']>)[] = [];
    for (const n of nodes) {
      if (n.type === 'hardBreak') {
        out.push(new D.TextRun({ text: '', break: 1 }));
        continue;
      }
      if (n.type === 'image') {
        const img = await imageData(String(n.attrs?.src ?? ''));
        if (img) {
          const scale = Math.min(1, MAX_W / img.w);
          out.push(new D.ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(img.w * scale), height: Math.round(img.h * scale) } }));
        }
        continue;
      }
      if (n.type !== 'text') continue;
      const marks = (n.marks ?? []) as Mark[];
      const has = (t: string) => marks.some((m) => m.type === t);
      const ts = marks.find((m) => m.type === 'textStyle')?.attrs ?? {};
      const hl = marks.find((m) => m.type === 'highlight')?.attrs;
      const size = ptFromCss(ts.fontSize);
      const run = new D.TextRun({
        text: n.text ?? '',
        bold: has('bold') || undefined,
        italics: has('italic') || undefined,
        underline: has('underline') || has('link') ? {} : undefined,
        strike: has('strike') || undefined,
        color: hex(ts.color) ?? (has('link') ? '1D4ED8' : undefined),
        size: size ? Math.round(size * 2) : undefined,
        font: ts.fontFamily ? String(ts.fontFamily).split(',')[0].replace(/["']/g, '').trim() : undefined,
        shading: hl ? { type: D.ShadingType.CLEAR, color: 'auto', fill: hex(hl.color) ?? 'FFF59D' } : undefined,
      });
      const link = marks.find((m) => m.type === 'link')?.attrs?.href;
      out.push(link ? new D.ExternalHyperlink({ link: String(link), children: [run] }) : run);
    }
    return out;
  }

  type Block = InstanceType<Docx['Paragraph']> | InstanceType<Docx['Table']>;
  async function blocks(nodes: JSONContent[] = [], ctx: { list?: { ordered: boolean; level: number } } = {}): Promise<Block[]> {
    const out: Block[] = [];
    for (const n of nodes) {
      switch (n.type) {
        case 'paragraph':
          out.push(
            new D.Paragraph({
              children: await inline(n.content),
              alignment: align(n.attrs?.textAlign),
              ...(ctx.list
                ? ctx.list.ordered
                  ? { numbering: { reference: 'num', level: Math.min(ctx.list.level, 8) } }
                  : { bullet: { level: Math.min(ctx.list.level, 8) } }
                : {}),
            }),
          );
          break;
        case 'heading':
          out.push(new D.Paragraph({ heading: HEAD[Math.min(4, Number(n.attrs?.level ?? 1))], alignment: align(n.attrs?.textAlign), children: await inline(n.content) }));
          break;
        case 'bulletList':
        case 'orderedList':
        case 'taskList': {
          const level = ctx.list ? ctx.list.level + 1 : 0;
          for (const li of n.content ?? []) out.push(...(await blocks(li.content, { list: { ordered: n.type === 'orderedList', level } })));
          break;
        }
        case 'blockquote':
          for (const b of await blocks(n.content, ctx)) out.push(b);
          break;
        case 'horizontalRule':
          out.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 1 } }, children: [] }));
          break;
        case 'codeBlock':
          out.push(new D.Paragraph({ children: [new D.TextRun({ text: (n.content ?? []).map((t) => t.text ?? '').join(''), font: 'Courier New' })] }));
          break;
        case 'image':
          out.push(new D.Paragraph({ children: await inline([n]) }));
          break;
        case 'table': {
          const rows = await Promise.all(
            (n.content ?? []).map(
              async (tr) =>
                new D.TableRow({
                  children: await Promise.all(
                    (tr.content ?? []).map(async (td) => {
                      const kids = await blocks(td.content);
                      return new D.TableCell({
                        columnSpan: Number(td.attrs?.colspan ?? 1) || 1,
                        rowSpan: Number(td.attrs?.rowspan ?? 1) || 1,
                        shading: td.type === 'tableHeader' ? { type: D.ShadingType.CLEAR, color: 'auto', fill: 'F1F5F9' } : undefined,
                        children: kids.length ? kids : [new D.Paragraph('')],
                      });
                    }),
                  ),
                }),
            ),
          );
          out.push(new D.Table({ rows, width: { size: 100, type: D.WidthType.PERCENTAGE } }));
          out.push(new D.Paragraph(''));
          break;
        }
        default:
          if (n.content) out.push(...(await blocks(n.content, ctx)));
      }
    }
    return out;
  }

  const children = await blocks(json.content ?? []);
  const doc = new D.Document({
    creator: 'SCOLA',
    title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: [
        {
          reference: 'num',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: [D.LevelFormat.DECIMAL, D.LevelFormat.LOWER_LETTER, D.LevelFormat.LOWER_ROMAN][level % 3],
            text: `%${level + 1}.`,
            alignment: D.AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: children.length ? children : [new D.Paragraph('')] }],
  });
  return D.Packer.toBlob(doc);
}
