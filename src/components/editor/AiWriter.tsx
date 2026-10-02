import { NodeSelection } from '@tiptap/pm/state';
import {
  ArrowDownToLine, Contrast, Download, ImagePlus, Loader2, Palette, Paperclip, RefreshCw, Replace, RotateCw, Sparkles, Wand2, X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { cn } from '../../lib/cn';
import { applyTool, ia, imageAspect, mdToHtml, toDataUrl, useAi, type ImageTool, type SmartMode, type TrechoAction } from '../../lib/ia';
import { Button, Modal } from '../ui';

/**
 * Campo inteligente de IA do editor: um pedido só e o SCOLA decide se é texto, imagem,
 * leitura de foto (ex.: prova fotografada → texto editável) ou edição de imagem, e qual
 * modelo da NVIDIA usar. Nada entra no documento sem a pessoa ver antes.
 */
const TEMPLATES: { label: string; prompt: string; needsImage?: boolean }[] = [
  { label: 'Plano de aula', prompt: 'Faça um plano de aula de 50 minutos.\nDisciplina: \nAno/série: \nTema: \nInclua: objetivos, habilidade da BNCC, materiais, desenvolvimento com tempos, avaliação.' },
  { label: 'Atividade ilustrada', prompt: 'Crie uma atividade com 5 questões, com uma ilustração para os alunos.\nDisciplina: \nAno/série: \nConteúdo: ' },
  { label: 'Prova com gabarito', prompt: 'Crie uma prova com 10 questões (6 de múltipla escolha com 4 alternativas e 4 discursivas), com gabarito no final.\nDisciplina: \nAno/série: \nConteúdo: ' },
  { label: 'Ilustração', prompt: 'Crie uma ilustração didática colorida de: ' },
  { label: 'Desenho para colorir', prompt: 'Crie um desenho para colorir, em preto e branco, de: ' },
  { label: 'Sequência didática', prompt: 'Monte uma sequência didática de 4 aulas.\nDisciplina: \nAno/série: \nTema: \nPara cada aula: objetivo, atividades e como avaliar.' },
  { label: 'Comunicado aos pais', prompt: 'Escreva um comunicado curto e cordial para as famílias.\nAssunto: \nData: \nO que as famílias precisam fazer: ' },
  { label: 'Transcrever foto', prompt: 'Transcreva o texto desta imagem para eu editar, mantendo questões e alternativas.', needsImage: true },
  { label: 'Questões sobre a imagem', prompt: 'Crie 5 questões para alunos sobre esta imagem, com gabarito.', needsImage: true },
];
const MODES: { id: SmartMode; label: string; image: boolean | null }[] = [
  { id: 'auto', label: 'Automático', image: null },
  { id: 'texto', label: 'Texto', image: false },
  { id: 'imagem', label: 'Imagem', image: false },
  { id: 'ler', label: 'Ler a imagem', image: true },
  { id: 'editar', label: 'Mudar a imagem', image: true },
];
const ACTIONS: { id: TrechoAction; label: string }[] = [
  { id: 'melhorar', label: 'Melhorar a escrita' },
  { id: 'corrigir', label: 'Corrigir português' },
  { id: 'resumir', label: 'Resumir' },
  { id: 'simplificar', label: 'Simplificar' },
  { id: 'topicos', label: 'Em tópicos' },
  { id: 'continuar', label: 'Continuar escrevendo' },
];
const TOOLS: { id: ImageTool; label: string; icon: React.ReactNode }[] = [
  { id: 'girar', label: 'Girar', icon: <RotateCw size={14} /> },
  { id: 'pb', label: 'Preto e branco', icon: <Contrast size={14} /> },
  { id: 'contraste', label: 'Mais contraste', icon: <Sparkles size={14} /> },
  { id: 'colorir', label: 'Para colorir', icon: <Palette size={14} /> },
];

type Result = { html: string; image: string | null; used: string[]; replaceable: boolean };

export function AiWriterModal({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const status = useAi();
  const sel = editor.state.selection;
  const { from, to, empty } = sel;
  const selectedImage = sel instanceof NodeSelection && sel.node.type.name === 'image' ? String(sel.node.attrs.src || '') : '';
  const selected = empty || selectedImage ? '' : editor.state.doc.textBetween(from, to, '\n\n');
  const [tab, setTab] = useState<'pedir' | 'trecho'>(selected.trim() ? 'trecho' : 'pedir');
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<SmartMode>('auto');
  const [attach, setAttach] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [last, setLast] = useState<() => Promise<void>>(() => async () => {});

  // Imagem selecionada no documento: já vem anexada.
  useEffect(() => {
    if (selectedImage) void toDataUrl(selectedImage).then(setAttach).catch(() => {});
  }, [selectedImage]);

  const images = status?.images ?? false;
  const attachFile = async (f: File | null | undefined) => {
    if (!f || !f.type.startsWith('image/')) return;
    setAttach(await toDataUrl(f, 1280));
    setMode('auto');
  };

  async function exec(label: string, job: () => Promise<Result>) {
    setBusy(label);
    setError('');
    setResult(null);
    try {
      setResult(await job());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const runSmart = () =>
    exec('smart', async () => {
      const aspect = attach ? await imageAspect(attach).catch(() => 'paisagem' as const) : undefined;
      const r = await ia.smart({
        prompt: prompt.trim(), mode, image: attach, aspect,
        context: attach ? undefined : editor.getText({ blockSeparator: '\n' }).trim().slice(-5000),
      });
      return { html: r.markdown ? mdToHtml(r.markdown) : '', image: r.image, used: r.used, replaceable: !!selectedImage && !!r.image };
    });

  const runAction = (action: TrechoAction) =>
    exec(action, async () => {
      const text = action === 'continuar' && !selected.trim() ? editor.getText({ blockSeparator: '\n' }).trim().slice(-8000) : selected;
      const r = await ia.smart({ action, prompt: prompt.trim(), text });
      return { html: mdToHtml(r.markdown ?? ''), image: null, used: r.used, replaceable: !empty && action !== 'continuar' };
    });

  const runTool = (tool: ImageTool, src: string) =>
    exec(tool, async () => ({ html: '', image: await applyTool(src, tool), used: ['Ajuste no navegador (sem IA)'], replaceable: !!selectedImage }));

  function insert(how: 'replace' | 'after') {
    if (!result) return;
    const img = result.image ? `<img src="${result.image}">` : '';
    const content = img + result.html;
    const chain = editor.chain().focus();
    if (how === 'replace' && !empty) {
      if (selectedImage && result.image && !result.html) chain.insertContentAt({ from, to }, { type: 'image', attrs: { src: result.image } });
      else chain.insertContentAt({ from, to }, content);
    } else chain.insertContentAt(empty ? from : to, content);
    chain.run();
    onClose();
  }

  function download() {
    if (!result?.image) return;
    const a = document.createElement('a');
    a.href = result.image;
    a.download = `imagem-scola.${result.image.startsWith('data:image/png') ? 'png' : 'jpg'}`;
    a.click();
  }

  const isBusy = !!busy;
  const modes = MODES.filter((m) => m.image === null || m.image === !!attach).filter((m) => images || m.id === 'auto' || m.id === 'texto' || m.id === 'ler');

  return (
    <Modal open onClose={onClose} title="IA do SCOLA" size="xl">
      <div className="space-y-3">
        {selected.trim() ? (
          <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm font-semibold">
            {(['pedir', 'trecho'] as const).map((m) => (
              <button key={m} onClick={() => setTab(m)} className={cn('flex-1 rounded-md px-3 py-1.5', tab === m ? 'bg-card shadow-soft' : 'text-muted-foreground')}>
                {m === 'pedir' ? 'Pedir à IA' : 'Trabalhar o trecho selecionado'}
              </button>
            ))}
          </div>
        ) : null}

        {tab === 'pedir' ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.filter((t) => (t.needsImage ? !!attach : true)).filter((t) => images || !/ilustr|colorir/i.test(t.label)).map((t) => (
                <button key={t.label} onClick={() => setPrompt(t.prompt)} className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold hover:bg-muted">
                  {t.label}
                </button>
              ))}
            </div>
            <div className="rounded-xl border border-border bg-card focus-within:border-neutral-900">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onPaste={(e) => {
                  const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
                  if (f) {
                    e.preventDefault();
                    void attachFile(f);
                  }
                }}
                rows={5}
                autoFocus
                placeholder={attach
                  ? 'O que fazer com a imagem? Ex.: transcreva a questão · crie 5 perguntas sobre ela · deixe em estilo desenho animado'
                  : 'Peça qualquer coisa: texto, prova, atividade ilustrada, imagem, desenho para colorir… Também dá para colar ou anexar uma foto.'}
                className="block w-full resize-y rounded-t-xl bg-transparent px-3 py-2 text-sm outline-none"
              />
              <div className="flex flex-wrap items-center gap-2 border-t border-border px-2 py-1.5">
                <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted">
                  <Paperclip size={14} /> {attach ? 'Trocar imagem' : 'Anexar imagem'}
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { void attachFile(e.target.files?.[0]); e.target.value = ''; }} />
                </label>
                {attach ? (
                  <span className="relative">
                    <img src={attach} alt="Imagem anexada" className="h-10 w-14 rounded border border-border object-cover" />
                    <button onClick={() => { setAttach(null); setMode('auto'); }} className="absolute -right-1.5 -top-1.5 grid h-4 w-4 place-items-center rounded-full bg-neutral-900 text-white" aria-label="Remover imagem">
                      <X size={10} />
                    </button>
                  </span>
                ) : null}
                <div className="ml-auto flex flex-wrap gap-1">
                  {modes.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setMode(m.id)}
                      className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold', mode === m.id ? 'bg-neutral-900 text-brand' : 'bg-muted text-muted-foreground hover:text-foreground')}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {attach ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Ajustes rápidos (sem IA):</span>
                {TOOLS.map((t) => (
                  <button key={t.id} disabled={isBusy} onClick={() => { const a = attach; setLast(() => () => runTool(t.id, a)); void runTool(t.id, a); }} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-40">
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            ) : null}
            <Button onClick={() => { setLast(() => runSmart); void runSmart(); }} disabled={isBusy || (!attach && prompt.trim().length < 3)} className="w-full">
              {busy === 'smart' ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {busy === 'smart' ? 'Trabalhando… (até 40 segundos)' : 'Pedir'}
            </Button>
          </>
        ) : (
          <>
            <p className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{selected.slice(0, 1200)}{selected.length > 1200 ? '…' : ''}</p>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Orientação opcional (ex.: tom mais formal, para o 3º ano)"
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ACTIONS.map((a) => (
                <Button key={a.id} variant="ghost" onClick={() => { setLast(() => () => runAction(a.id)); void runAction(a.id); }} disabled={isBusy} className="min-h-10 text-xs">
                  {busy === a.id ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} {a.label}
                </Button>
              ))}
            </div>
          </>
        )}

        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}
        {busy && busy !== 'smart' && !ACTIONS.some((a) => a.id === busy) ? <p className="flex items-center gap-2 text-sm"><Loader2 size={14} className="animate-spin" /> Ajustando a imagem…</p> : null}

        {result && (result.html || result.image) ? (
          <div className="space-y-2">
            <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">
              Resultado (confira antes de usar){result.used.length ? <span className="ml-1 font-semibold normal-case tracking-normal">· feito com {result.used.join(' · ')}</span> : null}
            </p>
            <div className="max-h-[45vh] overflow-y-auto rounded-xl border border-border bg-white px-4 py-3 text-neutral-900">
              {result.image ? <img src={result.image} alt="Imagem gerada" className="mx-auto mb-3 max-h-[32vh] rounded-lg" /> : null}
              {result.html ? <div className="scola-doc" dangerouslySetInnerHTML={{ __html: result.html }} /> : null}
            </div>
            {result.image ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {TOOLS.map((t) => (
                  <button key={t.id} disabled={isBusy} onClick={() => { const img = result.image!; const keep = result; void exec(t.id, async () => ({ ...keep, image: await applyTool(img, t.id) })); }} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted disabled:opacity-40">
                    {t.icon} {t.label}
                  </button>
                ))}
                <button onClick={download} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted"><Download size={14} /> Baixar imagem</button>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {result.replaceable ? (
                <Button onClick={() => insert('replace')}><Replace size={16} /> {selectedImage ? 'Trocar a imagem' : 'Substituir o trecho'}</Button>
              ) : null}
              <Button variant={result.replaceable ? 'ghost' : 'primary'} onClick={() => insert('after')}>
                {result.image && !result.html ? <ImagePlus size={16} /> : <ArrowDownToLine size={16} />} {empty ? 'Inserir no documento' : 'Inserir depois da seleção'}
              </Button>
              <Button variant="ghost" onClick={() => void last()} disabled={isBusy}><RefreshCw size={15} /> Gerar outra versão</Button>
            </div>
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground">
          A IA pode errar: revise antes de usar. O SCOLA escolhe sozinho o modelo da NVIDIA para cada tarefa e troca de modelo se um estiver fora do ar.
          Imagens geradas não trazem palavras: rótulos e enunciados ficam no texto do documento.
        </p>
      </div>
    </Modal>
  );
}
