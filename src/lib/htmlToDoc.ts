import { Editor } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import StarterKit from '@tiptap/starter-kit';
import { createEditableDoc, saveDocContent } from './queries';

/** HTML → conteúdo do editor do Planejamento (mesmas extensões do editor de documentos). */
export function htmlToDocJson(html: string) {
  const ed = new Editor({
    extensions: [StarterKit, TextStyle, Color, FontSize, Highlight.configure({ multicolor: true }), TextAlign.configure({ types: ['heading', 'paragraph'] }), TableKit, Image.configure({ allowBase64: true })],
    content: html,
  });
  const json = ed.getJSON();
  ed.destroy();
  return json;
}

/** Cria um documento editável no Planejamento com este conteúdo. Devolve o id. */
export async function saveHtmlToPlanejamento(title: string, html: string, segment: string) {
  const name = title.trim().slice(0, 90) || 'Documento da IA';
  const json = htmlToDocJson(html);
  const { id } = await createEditableDoc({ kind: 'doc', name, segment });
  const { docToDocx } = await import('./docxConvert');
  await saveDocContent(id, { content: json, file: await docToDocx(json, name), baseVersion: 0, kind: 'doc', name });
  return id;
}

export async function downloadHtmlAsDocx(title: string, html: string) {
  const { docToDocx } = await import('./docxConvert');
  const blob = await docToDocx(htmlToDocJson(html), title);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'documento'}.docx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
