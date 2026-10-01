import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { chunkText, extractText } from '../lib/rag';
import { ragAsk, ragIndexDoc, ragStatus, ragSync, type RagAnswer } from '../lib/queries';
import { Modal } from './ui';

type Turn = { q: string; a?: RagAnswer; error?: string };
const KIND: Record<string, string> = { doc: 'Documento', notice: 'Aviso', calendar: 'Calendário', plan: 'Planejamento', exam: 'Prova' };
const EXPORT_EXT: Record<string, string> = { document: '.docx', spreadsheet: '.xlsx', presentation: '.pptx' };

/** Pergunte aos documentos do Planejamento. Prepara sozinho os documentos novos ou editados. */
export function AssistantModal({ selectedIds, onClose }: { selectedIds: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: st } = useQuery({ queryKey: ['rag-status'], queryFn: ragStatus, staleTime: 0 });
  const [prep, setPrep] = useState<{ done: number; total: number; name: string } | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const started = useRef(false);

  // Indexa, um por vez, o que ainda não está pronto (o navegador extrai o texto).
  useEffect(() => {
    if (!st || started.current) return;
    started.current = true;
    (async () => {
      const bad: string[] = [];
      for (let i = 0; i < st.pending.length; i++) {
        const d = st.pending[i];
        setPrep({ done: i, total: st.pending.length, name: d.name });
        try {
          const url = d.kind === 'google' ? `/api/google/export/${d.id}` : `/api/files/${d.id}`;
          const r = await fetch(url, { credentials: 'same-origin' });
          if (!r.ok) throw new Error('inacessível');
          const name = d.kind === 'google' ? d.name + (EXPORT_EXT[d.google_kind ?? ''] ?? '') : d.name;
          await ragIndexDoc(d.id, chunkText(await extractText(await r.blob(), name)));
        } catch {
          bad.push(d.name);
          await ragIndexDoc(d.id, []).catch(() => {}); // não tentar de novo a cada abertura
        }
      }
      // Avisos, calendários, planejamentos e provas: o servidor monta o texto e atualiza o que mudou.
      try {
        setPrep({ done: 0, total: 1, name: 'avisos, calendário, planejamentos e provas' });
        for (let guard = 0; guard < 50; guard++) if (!(await ragSync()).remaining) break;
      } catch { /* sem isso o assistente ainda responde sobre os documentos */ }
      setSkipped(bad);
      setPrep(null);
      qc.invalidateQueries({ queryKey: ['rag-status'] });
    })();
  }, [st, qc]);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const scoped = selectedIds.length > 0;
  const [onlySel, setOnlySel] = useState(scoped);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth' }), [turns]);

  const ask = useMutation({
    mutationFn: (q: string) => ragAsk(q, onlySel && scoped ? selectedIds : undefined),
    onMutate: (q) => setTurns((t) => [...t, { q }]),
    onSuccess: (a) => setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x))),
    onError: (e) => setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: (e as Error).message } : x))),
  });
  const send = () => {
    const q = text.trim();
    if (q.length < 3 || ask.isPending || prep) return;
    setText('');
    ask.mutate(q);
  };

  return (
    <Modal open onClose={onClose} title="Assistente do SCOLA" size="xl">
      <div className="flex h-[70vh] min-h-[320px] flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Sparkles size={14} className="text-amber-500" />
          {prep ? (
            <span className="flex items-center gap-1.5 font-bold text-foreground"><Loader2 size={13} className="animate-spin" /> Preparando {prep.done + 1} de {prep.total}: <span className="max-w-[14rem] truncate">{prep.name}</span></span>
          ) : st ? (
            <span>{st.ready} de {st.total} documento{st.total === 1 ? '' : 's'} prontos para consulta</span>
          ) : (
            <span>Carregando…</span>
          )}
          {scoped ? (
            <label className="ml-auto flex items-center gap-1.5 font-bold text-foreground">
              <input type="checkbox" checked={onlySel} onChange={(e) => setOnlySel(e.target.checked)} className="accent-slate-900" />
              Só os {selectedIds.length} selecionados
            </label>
          ) : null}
        </div>
        {skipped.length ? <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Sem texto para consulta (imagem, PDF escaneado ou sem acesso): {skipped.join(', ')}</p> : null}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-xl border border-border bg-muted/40 p-3">
          {turns.length === 0 ? (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Pergunte sobre documentos, avisos, calendário, planejamentos e provas. Exemplos:</p>
              {['O que foi avisado sobre a próxima reunião de pais?', 'Quais eventos temos no calendário em novembro?', 'O que foi planejado para o 2º trimestre?'].map((s) => (
                <button key={s} onClick={() => setText(s)} className="block rounded-lg border border-border bg-card px-3 py-1.5 text-left text-xs font-semibold hover:bg-muted">{s}</button>
              ))}
            </div>
          ) : null}
          {turns.map((t, i) => (
            <div key={i} className="space-y-2">
              <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-slate-900 px-3 py-2 text-sm text-white">{t.q}</p>
              <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm">
                {t.error ? <span className="font-bold text-red-700">{t.error}</span> : t.a ? (
                  <>
                    <p className="whitespace-pre-wrap">{t.a.answer}</p>
                    {t.a.sources.length ? (
                      <div className="mt-2 border-t border-border pt-2">
                        <p className="mb-1 text-[11px] font-black uppercase tracking-wide text-muted-foreground">Fontes</p>
                        {t.a.sources.map((s) => (
                          <details key={s.doc_id} className="text-xs">
                            <summary className="cursor-pointer font-bold"><span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-black uppercase text-muted-foreground">{KIND[s.kind] ?? s.kind}</span>{s.name}</summary>
                            <p className="mt-0.5 text-muted-foreground">“{s.snippet}…”</p>
                          </details>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : <span className="flex items-center gap-1.5 text-muted-foreground"><Loader2 size={13} className="animate-spin" /> Procurando nos documentos…</span>}
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>

        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
            rows={2}
            placeholder={prep ? 'Aguarde, preparando os documentos…' : 'Pergunte sobre os documentos…'}
            className="min-w-0 flex-1 resize-none rounded-xl border border-border px-3 py-2 text-sm outline-none focus:border-slate-900"
          />
          <button onClick={send} disabled={ask.isPending || !!prep || text.trim().length < 3} className="grid w-12 place-items-center rounded-xl bg-slate-900 text-white disabled:opacity-40" aria-label="Enviar pergunta">
            <Send size={18} />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground">As respostas vêm só do conteúdo da escola que você tem acesso e podem conter erros: confira nas fontes.</p>
      </div>
    </Modal>
  );
}
