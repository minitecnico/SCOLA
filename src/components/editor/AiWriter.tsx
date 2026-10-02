import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, Loader2, Replace, Sparkles, Wand2 } from 'lucide-react';
import { useState } from 'react';
import type { Editor } from '@tiptap/react';
import { cn } from '../../lib/cn';
import { markdownToHtml } from '../../lib/markdown';
import { aiStatus, aiWrite, type AiWriteAction } from '../../lib/queries';
import { Button, Modal } from '../ui';

/**
 * "Escrever com IA" no editor de documentos: gera um texto a partir de um pedido
 * (plano de aula, atividade, comunicado…) ou transforma o trecho selecionado.
 * Nada entra no documento sem a pessoa ver antes e escolher onde colocar.
 */
const TEMPLATES: { label: string; prompt: string }[] = [
  { label: 'Plano de aula', prompt: 'Faça um plano de aula de 50 minutos.\nDisciplina: \nAno/série: \nTema: \nInclua: objetivos, habilidade da BNCC, materiais, desenvolvimento com tempos, avaliação.' },
  { label: 'Sequência didática', prompt: 'Monte uma sequência didática de 4 aulas.\nDisciplina: \nAno/série: \nTema: \nPara cada aula: objetivo, atividades e como avaliar.' },
  { label: 'Atividade com gabarito', prompt: 'Crie uma atividade avaliativa com 10 questões (6 de múltipla escolha com 4 alternativas e 4 discursivas), com gabarito no final.\nDisciplina: \nAno/série: \nConteúdo: ' },
  { label: 'Projeto', prompt: 'Escreva um projeto pedagógico interdisciplinar com justificativa, objetivos, etapas, cronograma em tabela, recursos e avaliação.\nTema: \nTurmas: \nDuração: ' },
  { label: 'Comunicado aos pais', prompt: 'Escreva um comunicado curto e cordial para as famílias.\nAssunto: \nData: \nO que as famílias precisam fazer: ' },
  { label: 'Ata de reunião', prompt: 'Redija a ata de uma reunião escolar a partir destas anotações:\n' },
];
const ACTIONS: { id: AiWriteAction; label: string }[] = [
  { id: 'melhorar', label: 'Melhorar a escrita' },
  { id: 'corrigir', label: 'Corrigir português' },
  { id: 'resumir', label: 'Resumir' },
  { id: 'simplificar', label: 'Simplificar' },
  { id: 'topicos', label: 'Em tópicos' },
  { id: 'continuar', label: 'Continuar escrevendo' },
];

export function useAiReady() {
  const { data } = useQuery({ queryKey: ['ai-status'], queryFn: aiStatus, staleTime: 5 * 60_000, retry: false });
  return data?.ready ?? false;
}

export function AiWriterModal({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { from, to, empty } = editor.state.selection;
  const selected = empty ? '' : editor.state.doc.textBetween(from, to, '\n\n');
  const [mode, setMode] = useState<'gerar' | 'trecho'>(selected.trim() ? 'trecho' : 'gerar');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState<AiWriteAction | null>(null);
  const [error, setError] = useState('');
  const [html, setHtml] = useState('');
  const [lastAction, setLastAction] = useState<AiWriteAction>('gerar');

  async function run(action: AiWriteAction) {
    setBusy(action);
    setError('');
    setHtml('');
    try {
      const docText = editor.getText({ blockSeparator: '\n' }).trim();
      const text = action === 'gerar' ? docText.slice(-6000) : action === 'continuar' && !selected.trim() ? docText.slice(-8000) : selected;
      const r = await aiWrite({ action, prompt: prompt.trim(), text });
      setHtml(markdownToHtml(r.markdown));
      setLastAction(action);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function insert(how: 'replace' | 'after') {
    const chain = editor.chain().focus();
    if (how === 'replace' && !empty) chain.insertContentAt({ from, to }, html);
    else chain.insertContentAt(empty ? from : to, html);
    chain.run();
    onClose();
  }

  const canReplace = !empty && lastAction !== 'gerar' && lastAction !== 'continuar';

  return (
    <Modal open onClose={onClose} title="Escrever com IA" size="xl">
      <div className="space-y-3">
        <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm font-semibold">
          {(['gerar', 'trecho'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn('flex-1 rounded-md px-3 py-1.5', mode === m ? 'bg-card shadow-soft' : 'text-muted-foreground')}
            >
              {m === 'gerar' ? 'Criar texto novo' : 'Trabalhar o trecho selecionado'}
            </button>
          ))}
        </div>

        {mode === 'gerar' ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {TEMPLATES.map((t) => (
                <button key={t.label} onClick={() => setPrompt(t.prompt)} className="rounded-full border border-border bg-card px-3 py-1 text-xs font-semibold hover:bg-muted">
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              autoFocus
              placeholder="Diga o que a IA deve escrever. Ex.: plano de aula de Ciências para o 6º ano sobre o ciclo da água, 50 minutos."
              className="w-full resize-y rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
            <Button onClick={() => void run('gerar')} disabled={!!busy || prompt.trim().length < 3} className="w-full">
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {busy ? 'Escrevendo… (até 30 segundos)' : 'Gerar'}
            </Button>
          </>
        ) : (
          <>
            {selected.trim() ? (
              <p className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{selected.slice(0, 1200)}{selected.length > 1200 ? '…' : ''}</p>
            ) : (
              <p className="rounded-lg bg-brand/15 px-3 py-2 text-xs font-semibold">Nenhum trecho selecionado. Feche, selecione o texto no documento e abra de novo; ou use "Continuar escrevendo" a partir do fim do documento.</p>
            )}
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Orientação opcional (ex.: tom mais formal, para o 3º ano)"
              className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-neutral-900"
            />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ACTIONS.map((a) => (
                <Button
                  key={a.id}
                  variant="ghost"
                  onClick={() => void run(a.id)}
                  disabled={!!busy || (!selected.trim() && a.id !== 'continuar')}
                  className="min-h-10 text-xs"
                >
                  {busy === a.id ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} {a.label}
                </Button>
              ))}
            </div>
          </>
        )}

        {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p> : null}

        {html ? (
          <div className="space-y-2">
            <p className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">Resultado (confira antes de usar)</p>
            <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-border bg-white px-4 py-3 text-neutral-900">
              <div className="scola-doc" dangerouslySetInnerHTML={{ __html: html }} />
            </div>
            <div className="flex flex-wrap gap-2">
              {canReplace ? (
                <Button onClick={() => insert('replace')}><Replace size={16} /> Substituir o trecho</Button>
              ) : null}
              <Button variant={canReplace ? 'ghost' : 'primary'} onClick={() => insert('after')}>
                <ArrowDownToLine size={16} /> {empty ? 'Inserir no documento' : 'Inserir depois do trecho'}
              </Button>
              <Button variant="ghost" onClick={() => void run(lastAction)} disabled={!!busy}>Gerar outra versão</Button>
            </div>
          </div>
        ) : null}
        <p className="text-[11px] text-muted-foreground">A IA pode errar: revise o texto antes de usar. Nomes e dados de alunos não são enviados por este recurso, a menos que estejam no texto.</p>
      </div>
    </Modal>
  );
}
