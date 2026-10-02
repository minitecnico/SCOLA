import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { Color, FontSize, TextStyle } from '@tiptap/extension-text-style';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor, useEditorState, type Editor, type JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Highlighter, ImagePlus, Italic, List, ListOrdered, Minus, Redo2, RemoveFormatting,
  Sparkles, Strikethrough, Table2, Underline, Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { AiWriterModal, useAiReady } from './AiWriter';

/**
 * Editor de documento (tipo Docs) — TipTap, código aberto, roda no navegador.
 * Página branca em formato A4, barra de ferramentas fixa no topo.
 */
const COLORS = ['#000000', '#374151', '#DC2626', '#EA580C', '#CA8A04', '#16A34A', '#2563EB', '#7C3AED', '#DB2777'];
const HIGHLIGHTS = ['#FEF08A', '#BBF7D0', '#BFDBFE', '#FBCFE8', '#FED7AA'];
const SIZES = ['10px', '12px', '14px', '16px', '18px', '24px', '32px'];

export function useDocEditor({ editable, onChange }: { editable: boolean; onChange: () => void }) {
  const change = useRef(onChange);
  change.current = onChange;
  return useEditor({
    editable,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TextStyle,
      Color,
      FontSize,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TableKit.configure({ table: { resizable: true } }),
      Image.configure({ allowBase64: true }),
      Placeholder.configure({ placeholder: 'Comece a escrever o planejamento…' }),
    ],
    editorProps: { attributes: { class: 'scola-doc focus:outline-none' } },
    onUpdate: () => change.current(),
  });
}

/** Imagem colada/enviada: reduz para no máximo 1400 px (documento leve, salva rápido). */
async function imageToDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85);
}

export function DocEditor({ editor, editable }: { editor: Editor | null; editable: boolean }) {
  if (!editor) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {editable ? <Toolbar editor={editor} /> : null}
      <div className="min-h-0 flex-1 overflow-auto bg-neutral-100 px-2 py-4 sm:px-6 sm:py-8 dark:bg-neutral-900">
        <div className="mx-auto w-full max-w-[816px] rounded-sm bg-white px-6 py-8 text-neutral-900 shadow-lift sm:min-h-[1056px] sm:px-[72px] sm:py-[72px]">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}

function Btn({ on, title, onClick, children, disabled }: { on?: boolean; title: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'grid h-8 min-w-8 shrink-0 place-items-center rounded-md px-1.5 text-neutral-700 transition hover:bg-neutral-200 disabled:opacity-30',
        on && 'bg-neutral-900 text-brand hover:bg-neutral-800',
      )}
    >
      {children}
    </button>
  );
}
const Sep = () => <span className="mx-1 h-5 w-px shrink-0 bg-neutral-300" />;

function Toolbar({ editor }: { editor: Editor }) {
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      table: e.isActive('table'),
      h: [1, 2, 3].find((l) => e.isActive('heading', { level: l })) ?? 0,
      align: (['left', 'center', 'right', 'justify'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'left',
      size: (e.getAttributes('textStyle').fontSize as string | undefined) ?? '',
      undo: e.can().undo(),
      redo: e.can().redo(),
    }),
  });
  const [palette, setPalette] = useState<'color' | 'hl' | null>(null);
  const [ai, setAi] = useState(false);
  const aiReady = useAiReady();
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const close = () => setPalette(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);
  const c = () => editor.chain().focus();

  return (
    <div className="sticky top-0 z-10 flex items-center gap-0.5 overflow-x-auto border-b border-border bg-card px-2 py-1.5 [scrollbar-width:thin]">
      {aiReady ? (
        <>
          <button
            type="button"
            title="IA do SCOLA: textos, provas, atividades, imagens, ler fotos e melhorar o trecho ou a imagem selecionada"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setAi(true)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-neutral-900 px-2.5 text-sm font-semibold text-brand hover:bg-black"
          >
            <Sparkles size={15} /> IA
          </button>
          {ai ? <AiWriterModal editor={editor} onClose={() => setAi(false)} /> : null}
          <Sep />
        </>
      ) : null}
      <Btn title="Desfazer (Ctrl+Z)" onClick={() => c().undo().run()} disabled={!st.undo}><Undo2 size={16} /></Btn>
      <Btn title="Refazer (Ctrl+Y)" onClick={() => c().redo().run()} disabled={!st.redo}><Redo2 size={16} /></Btn>
      <Sep />
      <select
        value={st.h}
        onChange={(e) => {
          const l = Number(e.target.value);
          if (l) c().setHeading({ level: l as 1 | 2 | 3 }).run();
          else c().setParagraph().run();
        }}
        className="h-8 shrink-0 rounded-md border border-border bg-card px-1.5 text-sm"
        aria-label="Estilo"
      >
        <option value={0}>Texto normal</option>
        <option value={1}>Título 1</option>
        <option value={2}>Título 2</option>
        <option value={3}>Título 3</option>
      </select>
      <select
        value={st.size}
        onChange={(e) => (e.target.value ? c().setFontSize(e.target.value).run() : c().unsetFontSize().run())}
        className="ml-1 h-8 shrink-0 rounded-md border border-border bg-card px-1 text-sm"
        aria-label="Tamanho da fonte"
      >
        <option value="">Tam.</option>
        {SIZES.map((s) => (
          <option key={s} value={s}>
            {Math.round(parseInt(s) * 0.75)}
          </option>
        ))}
      </select>
      <Sep />
      <Btn title="Negrito (Ctrl+B)" on={st.bold} onClick={() => c().toggleBold().run()}><Bold size={16} /></Btn>
      <Btn title="Itálico (Ctrl+I)" on={st.italic} onClick={() => c().toggleItalic().run()}><Italic size={16} /></Btn>
      <Btn title="Sublinhado (Ctrl+U)" on={st.underline} onClick={() => c().toggleUnderline().run()}><Underline size={16} /></Btn>
      <Btn title="Tachado" on={st.strike} onClick={() => c().toggleStrike().run()}><Strikethrough size={16} /></Btn>
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <Btn title="Cor do texto" onClick={() => setPalette(palette === 'color' ? null : 'color')}>
          <span className="text-sm font-bold underline decoration-[3px] decoration-red-600">A</span>
        </Btn>
        {palette === 'color' ? (
          <Palette colors={COLORS} onPick={(col) => { c().setColor(col).run(); setPalette(null); }} onClear={() => { c().unsetColor().run(); setPalette(null); }} />
        ) : null}
      </div>
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <Btn title="Marca-texto" onClick={() => setPalette(palette === 'hl' ? null : 'hl')}><Highlighter size={16} /></Btn>
        {palette === 'hl' ? (
          <Palette colors={HIGHLIGHTS} onPick={(col) => { c().setHighlight({ color: col }).run(); setPalette(null); }} onClear={() => { c().unsetHighlight().run(); setPalette(null); }} />
        ) : null}
      </div>
      <Sep />
      <Btn title="Alinhar à esquerda" on={st.align === 'left'} onClick={() => c().setTextAlign('left').run()}><AlignLeft size={16} /></Btn>
      <Btn title="Centralizar" on={st.align === 'center'} onClick={() => c().setTextAlign('center').run()}><AlignCenter size={16} /></Btn>
      <Btn title="Alinhar à direita" on={st.align === 'right'} onClick={() => c().setTextAlign('right').run()}><AlignRight size={16} /></Btn>
      <Btn title="Justificar" on={st.align === 'justify'} onClick={() => c().setTextAlign('justify').run()}><AlignJustify size={16} /></Btn>
      <Sep />
      <Btn title="Lista com marcadores" on={st.bullet} onClick={() => c().toggleBulletList().run()}><List size={16} /></Btn>
      <Btn title="Lista numerada" on={st.ordered} onClick={() => c().toggleOrderedList().run()}><ListOrdered size={16} /></Btn>
      <Sep />
      <Btn title="Inserir tabela" on={st.table} onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 size={16} /></Btn>
      {st.table ? (
        <span className="flex shrink-0 items-center gap-0.5 rounded-md bg-neutral-100 px-1 text-xs">
          <Btn title="Linha abaixo" onClick={() => c().addRowAfter().run()}>+ lin</Btn>
          <Btn title="Coluna à direita" onClick={() => c().addColumnAfter().run()}>+ col</Btn>
          <Btn title="Excluir linha" onClick={() => c().deleteRow().run()}>− lin</Btn>
          <Btn title="Excluir coluna" onClick={() => c().deleteColumn().run()}>− col</Btn>
          <Btn title="Mesclar/separar células" onClick={() => c().mergeOrSplit().run()}>⊞</Btn>
          <Btn title="Excluir tabela" onClick={() => c().deleteTable().run()}>✕</Btn>
        </span>
      ) : null}
      <Btn title="Inserir imagem" onClick={() => fileRef.current?.click()}><ImagePlus size={16} /></Btn>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) c().setImage({ src: await imageToDataUrl(f) }).run();
        }}
      />
      <Btn title="Linha divisória" onClick={() => c().setHorizontalRule().run()}><Minus size={16} /></Btn>
      <Btn title="Limpar formatação" onClick={() => c().unsetAllMarks().clearNodes().run()}><RemoveFormatting size={16} /></Btn>
    </div>
  );
}

function Palette({ colors, onPick, onClear }: { colors: string[]; onPick: (c: string) => void; onClear: () => void }) {
  return (
    <div className="absolute left-0 top-9 z-20 w-40 rounded-lg border border-border bg-card p-2 shadow-lift">
      <div className="grid grid-cols-5 gap-1.5">
        {colors.map((col) => (
          <button key={col} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(col)} className="h-6 w-6 rounded-full ring-1 ring-black/10" style={{ background: col }} aria-label={col} />
        ))}
      </div>
      <button onMouseDown={(e) => e.preventDefault()} onClick={onClear} className="mt-2 w-full rounded-md py-1 text-xs font-semibold text-muted-foreground hover:bg-muted">
        Sem cor
      </button>
    </div>
  );
}

export type { Editor, JSONContent };
