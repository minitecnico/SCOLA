import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp, Check, Copy, Download, FileText, FolderInput, ImageIcon, Loader2, MessageSquarePlus, Paperclip, Sparkles, Square, Trash2, Upload, X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SEGMENTS } from '../components/PlanDocsCenter';
import { cn } from '../lib/cn';
import { ACCEPT, readAttachment, type ChatAttachment } from '../lib/chatFiles';
import { delatex, markdownToHtml } from '../lib/markdown';
import {
  aiSmart, aiStatus, deleteAiChat, getAiChat, listAiChats, saveAiChat, streamAiChat, type ChatMsg,
} from '../lib/queries';

/**
 * IA do SCOLA: conversa sobre qualquer assunto, com documentos anexados (arrastar e soltar,
 * colar ou botão). Respostas chegam aos poucos; o histórico fica salvo para cada pessoa.
 */
const SUGGESTIONS = [
  'Crie uma prova de Matemática com 10 questões sobre frações para o 6º ano, com gabarito',
  'Explique a fotossíntese de um jeito simples para o 6º ano',
  'Monte um plano de aula de 50 minutos sobre o ciclo da água',
  'Crie uma ilustração de um vulcão em erupção para uma atividade',
  'Resuma o documento anexado em tópicos',
  'Escreva um e-mail cordial para os pais sobre a reunião de sexta',
];
// Pedido de imagem (sem anexos): vai para o campo inteligente, que gera a ilustração.
const IMAGE_ASK = /\b(cri[ea]|ger[ea]|fa[çz]a|desenh[ea]|quero|preciso de)\b[^.?!]{0,50}\b(imagem|ilustra[çc][ãa]o|desenho|figura|gravura|foto)\b/i;
const MAX_DOC_IN_HISTORY = 60_000;

type Pending = { id: string; name: string; status: 'lendo' | 'pronto' | 'erro'; att?: ChatAttachment[]; error?: string };

export function IAPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: status } = useQuery({ queryKey: ['ai-status'], queryFn: aiStatus, staleTime: 5 * 60_000 });
  const { data: chats = [] } = useQuery({ queryKey: ['ai-chats'], queryFn: listAiChats });
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [showList, setShowList] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragDepth = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  // Ocupa a altura que sobra abaixo do cabeçalho (o campo fica sempre visível no rodapé).
  useEffect(() => {
    const fit = () => rootRef.current && setHeight(Math.max(420, window.innerHeight - rootRef.current.getBoundingClientRect().top - window.scrollY));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  // Altura do campo acompanha o texto.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  async function addFiles(files: File[]) {
    for (const f of files) {
      const id = `${Date.now()}-${Math.random()}`;
      setPending((p) => [...p, { id, name: f.name, status: 'lendo' }]);
      try {
        const att = await readAttachment(f);
        setPending((p) => p.map((x) => (x.id === id ? { ...x, status: 'pronto', att } : x)));
      } catch (e) {
        setPending((p) => p.map((x) => (x.id === id ? { ...x, status: 'erro', error: (e as Error).message } : x)));
      }
    }
  }

  async function openChat(id: string) {
    if (busy) return;
    const c = await getAiChat(id);
    setChatId(c.id);
    setMessages(c.messages);
    setShowList(false);
  }

  function newChat() {
    if (busy) abort.current?.abort();
    setChatId(null);
    setMessages([]);
    setPending([]);
    setText('');
    setShowList(false);
    inputRef.current?.focus();
  }

  /** O que vai para o servidor: documentos viram texto; imagens só na mensagem atual. */
  function toApi(list: ChatMsg[]) {
    return list.map((m, i) => {
      const last = i === list.length - 1;
      const docs = (m.attachments ?? []).filter((a) => a.kind === 'doc');
      const imgs = (m.attachments ?? []).filter((a) => a.kind === 'image');
      let body = m.content;
      if (docs.length) body += docs.map((d) => `\n\n### Documento anexado: ${d.name}\n"""\n${d.text ?? ''}\n"""`).join('');
      if (imgs.length && !last) body += `\n\n(Imagens anexadas nesta mensagem: ${imgs.map((x) => x.name).join(', ')})`;
      if (m.role === 'assistant' && m.image) body += '\n\n(Uma imagem foi gerada nesta resposta.)';
      if (last && imgs.length) {
        return { role: m.role, content: [{ type: 'text' as const, text: body || 'Analise a imagem.' }, ...imgs.map((x) => ({ type: 'image_url' as const, image_url: { url: x.image! } }))] };
      }
      return { role: m.role, content: body };
    });
  }

  /** O que fica salvo: sem imagens anexadas (pesadas) e com documentos até 60 mil caracteres. */
  function toStore(list: ChatMsg[]): ChatMsg[] {
    return list.map((m) => ({
      ...m,
      attachments: m.attachments?.map((a) => (a.kind === 'image' ? { name: a.name, kind: a.kind } : { ...a, text: (a.text ?? '').slice(0, MAX_DOC_IN_HISTORY) })),
      image: m.image && m.image.length < 600_000 ? m.image : null,
    }));
  }

  async function persist(list: ChatMsg[], id: string | null) {
    const firstUser = list.find((m) => m.role === 'user');
    const title = (firstUser?.content || firstUser?.attachments?.[0]?.name || 'Nova conversa').replace(/\s+/g, ' ').slice(0, 70);
    try {
      const r = await saveAiChat({ id, title, messages: toStore(list) });
      setChatId(r.id);
      qc.invalidateQueries({ queryKey: ['ai-chats'] });
    } catch {
      /* não salvar o histórico não atrapalha a conversa */
    }
  }

  async function send(prompt = text) {
    const ready = pending.filter((p) => p.status === 'pronto').flatMap((p) => p.att ?? []);
    if (busy || pending.some((p) => p.status === 'lendo') || (!prompt.trim() && !ready.length)) return;
    const user: ChatMsg = { role: 'user', content: prompt.trim(), attachments: ready.length ? ready : undefined };
    const history = [...messages, user];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setText('');
    setPending([]);
    setBusy(true);
    const ac = new AbortController();
    abort.current = ac;
    let final: ChatMsg;
    try {
      if (!ready.length && IMAGE_ASK.test(prompt) && status?.images) {
        const ctxText = messages.slice(-4).map((m) => `${m.role === 'user' ? 'Professor' : 'IA'}: ${m.content.slice(0, 1500)}`).join('\n');
        const r = await aiSmart({ prompt: prompt.trim(), mode: 'auto', context: ctxText || undefined });
        final = { role: 'assistant', content: r.markdown ?? '', image: r.image ?? null, model: r.used.join(' · ') };
      } else {
        const r = await streamAiChat(toApi(history), (full, model) => {
          setMessages([...history, { role: 'assistant', content: full, model }]);
        }, ac.signal);
        final = { role: 'assistant', content: r.text || '_(A IA não devolveu texto. Tente de novo.)_', model: r.model, error: !r.text };
      }
    } catch (e) {
      const stopped = (e as Error).name === 'AbortError';
      const partial = (document.querySelector('[data-streaming="1"]') as HTMLElement | null)?.dataset.raw ?? '';
      final = { role: 'assistant', content: stopped ? `${partial}\n\n_(Resposta interrompida.)_` : (e as Error).message, error: !stopped };
    }
    const done = [...history, final];
    setMessages(done);
    setBusy(false);
    abort.current = null;
    void persist(done, chatId);
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setDrag(false);
    const files = [...e.dataTransfer.files];
    if (files.length) void addFiles(files);
  };

  if (status && !status.ready) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <Sparkles className="mx-auto mb-3 text-brand" />
        <h1 className="text-xl font-bold">A IA ainda não está ligada</h1>
        <p className="mt-2 text-sm text-muted-foreground">O administrador da plataforma precisa configurar o motor de IA no painel do administrador.</p>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      style={{ height: height ?? undefined }}
      className="relative flex h-[calc(100dvh-7rem)] min-h-0"
      onDragEnter={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return;
        dragDepth.current++;
        setDrag(true);
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDrag(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      {/* Conversas */}
      <aside className={cn('absolute inset-y-0 left-0 z-20 w-72 flex-col border-r border-border bg-card lg:static lg:flex', showList ? 'flex shadow-lift' : 'hidden')}>
        <div className="flex items-center gap-2 p-3">
          <button onClick={newChat} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-brand hover:bg-black">
            <MessageSquarePlus size={16} /> Nova conversa
          </button>
          <button onClick={() => setShowList(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted lg:hidden" aria-label="Fechar lista"><X size={16} /></button>
        </div>
        <p className="px-4 pb-1 text-[11px] font-black uppercase tracking-wide text-muted-foreground">Suas conversas</p>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {chats.length === 0 ? <li className="px-2 py-3 text-xs text-muted-foreground">Nenhuma conversa ainda.</li> : null}
          {chats.map((c) => (
            <li key={c.id} className="group flex items-center">
              <button
                onClick={() => void openChat(c.id)}
                className={cn('min-w-0 flex-1 truncate rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted', chatId === c.id && 'bg-muted font-semibold')}
                title={c.title}
              >
                {c.title}
              </button>
              <button
                onClick={async () => {
                  if (!confirm('Apagar esta conversa?')) return;
                  await deleteAiChat(c.id);
                  if (chatId === c.id) newChat();
                  qc.invalidateQueries({ queryKey: ['ai-chats'] });
                }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 hover:bg-muted hover:text-red-600 group-hover:opacity-100"
                aria-label="Apagar conversa"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Conversa */}
      <section className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 lg:hidden">
          <button onClick={() => setShowList(true)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Conversas</button>
          <button onClick={newChat} className="ml-auto rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-brand">Nova</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {messages.length === 0 ? (
              <div className="py-6 text-center">
                <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-neutral-900 text-brand"><Sparkles size={22} /></span>
                <h1 className="text-2xl font-bold">Como posso ajudar?</h1>
                <p className="mt-1 text-sm text-muted-foreground">Pergunte qualquer coisa, peça provas e atividades, ou arraste documentos e fotos para cá.</p>
                <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => { setText(s); inputRef.current?.focus(); }} className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm hover:bg-muted">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-6">
              {messages.map((m, i) => (
                <Message key={i} m={m} streaming={busy && i === messages.length - 1} onSaved={(id) => navigate(`/planejamento/editor/${id}`)} />
              ))}
            </div>
            <div ref={endRef} />
          </div>
        </div>

        {/* Campo */}
        <div className="border-t border-border bg-background px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto w-full max-w-3xl">
            {pending.length ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {pending.map((p) => (
                  <span
                    key={p.id}
                    title={p.error}
                    className={cn('inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg border px-2 py-1 text-xs', p.status === 'erro' ? 'border-red-200 bg-red-50 text-red-700' : 'border-border bg-card')}
                  >
                    {p.status === 'lendo' ? <Loader2 size={12} className="animate-spin" /> : p.att?.[0]?.kind === 'image' ? <ImageIcon size={12} /> : <FileText size={12} />}
                    <span className="truncate">{p.status === 'erro' ? p.error : p.name}</span>
                    {p.att && p.att.length > 1 ? <span className="text-muted-foreground">({p.att.length} pág.)</span> : null}
                    <button onClick={() => setPending((x) => x.filter((y) => y.id !== p.id))} aria-label="Remover anexo" className="opacity-60 hover:opacity-100"><X size={12} /></button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-soft focus-within:border-neutral-900">
              <label className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground" title="Anexar documentos ou imagens">
                <Paperclip size={18} />
                <input type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
              </label>
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                onPaste={(e) => {
                  const files = [...e.clipboardData.files];
                  if (files.length) {
                    e.preventDefault();
                    void addFiles(files);
                  }
                }}
                rows={1}
                placeholder="Pergunte qualquer coisa ou arraste arquivos aqui…"
                className="max-h-56 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] outline-none"
              />
              {busy ? (
                <button onClick={() => abort.current?.abort()} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-900 text-white" aria-label="Parar resposta" title="Parar">
                  <Square size={14} fill="currentColor" />
                </button>
              ) : (
                <button
                  onClick={() => void send()}
                  disabled={pending.some((p) => p.status === 'lendo') || (!text.trim() && !pending.some((p) => p.status === 'pronto'))}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-900 text-brand disabled:opacity-30"
                  aria-label="Enviar"
                >
                  <ArrowUp size={18} />
                </button>
              )}
            </div>
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
              Word, Excel, PowerPoint, PDF (até escaneado), texto e imagens · Enter envia, Shift+Enter quebra linha · A IA pode errar: confira.
              {status?.engine ? <> Motor: <b>{status.engine}</b>.</> : null}
            </p>
          </div>
        </div>
      </section>

      {drag ? (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-neutral-900/70 backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-brand px-10 py-8 text-center text-white">
            <Upload className="mx-auto mb-2 text-brand" size={30} />
            <p className="text-lg font-bold">Solte os arquivos aqui</p>
            <p className="text-sm text-white/70">Documentos, planilhas, PDFs, apresentações e imagens</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Message({ m, streaming, onSaved }: { m: ChatMsg; streaming: boolean; onSaved: (id: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState<null | 'menu' | 'busy'>(null);
  if (m.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {m.attachments?.length ? (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
            {m.attachments.map((a, i) =>
              a.kind === 'image' && a.image ? (
                <img key={i} src={a.image} alt={a.name} className="h-24 rounded-lg border border-border object-cover" />
              ) : (
                <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-xs">
                  {a.kind === 'image' ? <ImageIcon size={12} /> : <FileText size={12} />} {a.name}
                </span>
              ),
            )}
          </div>
        ) : null}
        {m.content ? <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-neutral-900 px-4 py-2.5 text-[15px] text-white">{m.content}</p> : null}
      </div>
    );
  }
  const html = m.content ? markdownToHtml(delatex(m.content)) : '';
  const title = (m.content.match(/^#+\s*(.+)$/m)?.[1] ?? m.content.split('\n')[0] ?? 'Documento da IA').replace(/[*_#`]/g, '').trim().slice(0, 80);
  const fullHtml = (m.image ? `<img src="${m.image}">` : '') + html;
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-neutral-900 text-brand"><Sparkles size={14} /></span>
      <div className="min-w-0 flex-1">
        {m.image ? <img src={m.image} alt="Imagem gerada" className="mb-3 max-h-96 rounded-xl border border-border" /> : null}
        {html ? (
          <div data-streaming={streaming ? '1' : undefined} data-raw={streaming ? m.content : undefined} className={cn('scola-chat', m.error && 'text-red-700')} dangerouslySetInnerHTML={{ __html: html }} />
        ) : streaming ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Pensando…</p>
        ) : null}
        {!streaming && !m.error && (m.content || m.image) ? (
          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <button onClick={() => { void navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground">
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copiado' : 'Copiar'}
            </button>
            <button onClick={async () => { const { downloadHtmlAsDocx } = await import('../lib/htmlToDoc'); await downloadHtmlAsDocx(title, fullHtml); }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground">
              <Download size={13} /> Word
            </button>
            <span className="relative">
              <button onClick={() => setSaving(saving === 'menu' ? null : 'menu')} disabled={saving === 'busy'} className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground">
                {saving === 'busy' ? <Loader2 size={13} className="animate-spin" /> : <FolderInput size={13} />} Salvar no Planejamento
              </button>
              {saving === 'menu' ? (
                <span className="absolute bottom-8 left-0 z-10 w-48 rounded-lg border border-border bg-card p-1 shadow-lift">
                  <span className="block px-2 py-1 text-[11px] font-bold uppercase text-muted-foreground">Salvar em</span>
                  {SEGMENTS.map((s) => (
                    <button
                      key={s.key}
                      onClick={async () => {
                        setSaving('busy');
                        try {
                          const { saveHtmlToPlanejamento } = await import('../lib/htmlToDoc');
                          const id = await saveHtmlToPlanejamento(title, fullHtml, s.key);
                          if (confirm('Salvo no Planejamento. Abrir o documento agora para editar?')) onSaved(id);
                        } catch (e) {
                          alert((e as Error).message);
                        } finally {
                          setSaving(null);
                        }
                      }}
                      className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted"
                    >
                      {s.label}
                    </button>
                  ))}
                </span>
              ) : null}
            </span>
            {m.image ? (
              <a href={m.image} download="imagem-scola.jpg" className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground"><ImageIcon size={13} /> Baixar imagem</a>
            ) : null}
            {m.model ? <span className="ml-auto truncate pl-2 text-[11px]">respondido por {m.model}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
