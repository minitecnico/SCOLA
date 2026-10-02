import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUp, Check, Copy, Download, FileText, FolderInput, ImageIcon, Library, Loader2, MessageSquarePlus, Paperclip, Sparkles, Square, Trash2, Upload, X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import BlurText from '../components/bits/BlurText';
import ShinyText from '../components/bits/ShinyText';
import { SEGMENTS } from '../components/PlanDocsCenter';
import { cn } from '../lib/cn';
import { ACCEPT, downloadDocx, ia, mdToHtml, prepareSchool, readAttachment, saveToPlanejamento, streamChat, useAi, type Attachment, type ChatMsg } from '../lib/ia';

/**
 * Central de IA: conversa sobre qualquer assunto, com documentos e fotos (arrastar, colar ou clipe)
 * e, ligando "Conteúdos da escola", também sobre documentos, avisos, calendário, planejamentos e provas.
 */
const SUGGESTIONS = [
  'Crie uma prova de Matemática com 10 questões sobre frações para o 6º ano, com gabarito',
  'Explique a fotossíntese de um jeito simples para o 6º ano',
  'Monte um plano de aula de 50 minutos sobre o ciclo da água',
  'Crie uma ilustração de um vulcão em erupção para uma atividade',
  'Resuma o documento anexado em tópicos',
  'O que foi avisado sobre a próxima reunião de pais?',
];
// Pedido de imagem (sem anexos) vai para o campo inteligente, que gera a ilustração.
const IMAGE_ASK = /\b(cri[ea]|ger[ea]|fa[çz]a|desenh[ea]|quero|preciso de)\b[^.?!]{0,50}\b(imagem|ilustra[çc][ãa]o|desenho|figura|gravura|foto)\b/i;
type Pending = { id: string; name: string; att?: Attachment[]; error?: string };

/** Para o servidor: documentos viram texto; imagens só na mensagem atual. */
const toApi = (list: ChatMsg[]) =>
  list.map((m, i) => {
    const docs = (m.attachments ?? []).filter((a) => a.kind === 'doc');
    const imgs = (m.attachments ?? []).filter((a) => a.kind === 'image');
    let text = m.content + docs.map((d) => `\n\n### Documento anexado: ${d.name}\n"""\n${d.text ?? ''}\n"""`).join('');
    if (m.image) text += '\n\n(Uma imagem foi gerada nesta resposta.)';
    if (i < list.length - 1 || !imgs.length) return { role: m.role, content: imgs.length ? `${text}\n\n(Imagens anexadas: ${imgs.map((x) => x.name).join(', ')})` : text };
    return { role: m.role, content: [{ type: 'text' as const, text: text || 'Analise a imagem.' }, ...imgs.map((x) => ({ type: 'image_url' as const, image_url: { url: x.image! } }))] };
  });

/** Para guardar: sem as imagens anexadas (pesadas) e com documentos até 60 mil caracteres. */
const toStore = (list: ChatMsg[]): ChatMsg[] =>
  list.map((m) => ({
    ...m,
    attachments: m.attachments?.map((a) => (a.kind === 'image' ? { name: a.name, kind: a.kind } : { ...a, text: a.text?.slice(0, 60_000) })),
    image: m.image && m.image.length < 600_000 ? m.image : null,
  }));

export function IAPage() {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const status = useAi();
  const { data: chats = [] } = useQuery({ queryKey: ['ai-chats'], queryFn: ia.chats });
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [text, setText] = useState('');
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(0);
  const [showList, setShowList] = useState(false);
  const [escola, setEscola] = useState(params.get('escola') === '1');
  const [prep, setPrep] = useState<string | null>(null);
  const [docIds] = useState(() => params.get('docs')?.split(',').filter(Boolean));
  const prepared = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (messages.length) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  useEffect(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
    }
  }, [text]);

  // "Conteúdos da escola" ligado: prepara o índice uma vez (documentos novos ou editados).
  useEffect(() => {
    if (!escola || !status?.school || prepared.current) return;
    prepared.current = true;
    setPrep('Preparando os conteúdos da escola…');
    prepareSchool(setPrep).finally(() => setPrep(null));
  }, [escola, status?.school]);

  async function addFiles(files: File[]) {
    for (const f of files) {
      const id = `${Date.now()}-${Math.random()}`;
      setPending((p) => [...p, { id, name: f.name }]);
      const done = await readAttachment(f).then((att) => ({ att }), (e: Error) => ({ error: e.message }));
      setPending((p) => p.map((x) => (x.id === id ? { ...x, ...done } : x)));
    }
  }

  function newChat() {
    abort.current?.abort();
    setChatId(null);
    setMessages([]);
    setPending([]);
    setShowList(false);
    inputRef.current?.focus();
  }

  async function send(prompt = text) {
    const ready = pending.flatMap((p) => p.att ?? []);
    const reading = pending.some((p) => !p.att && !p.error);
    if (busy || reading || (!prompt.trim() && !ready.length)) return;
    const history = [...messages, { role: 'user' as const, content: prompt.trim(), attachments: ready.length ? ready : undefined }];
    setMessages([...history, { role: 'assistant', content: '' }]);
    setText('');
    setPending([]);
    setBusy(true);
    abort.current = new AbortController();
    let answer: ChatMsg;
    let partial = '';
    try {
      if (!ready.length && !escola && status?.images && IMAGE_ASK.test(prompt)) {
        const r = await ia.smart({ prompt: prompt.trim(), context: messages.slice(-4).map((m) => `${m.role === 'user' ? 'Professor' : 'IA'}: ${m.content.slice(0, 1500)}`).join('\n') || undefined });
        answer = { role: 'assistant', content: r.markdown ?? '', image: r.image, model: r.used.join(' · ') };
      } else {
        const r = await streamChat(toApi(history), { escola, docIds, signal: abort.current.signal }, (full, model) => {
          partial = full;
          setMessages([...history, { role: 'assistant', content: full, model }]);
        });
        answer = { role: 'assistant', content: r.text || '_(A IA não devolveu texto. Tente de novo.)_', model: r.model, sources: r.sources, error: !r.text };
      }
    } catch (e) {
      const stopped = (e as Error).name === 'AbortError';
      answer = { role: 'assistant', content: stopped ? `${partial}\n\n_(Resposta interrompida.)_` : (e as Error).message, error: !stopped };
    }
    const all = [...history, answer];
    setMessages(all);
    setBusy(false);
    const first = all.find((m) => m.role === 'user');
    ia.saveChat({ id: chatId, title: (first?.content || first?.attachments?.[0]?.name || 'Nova conversa').replace(/\s+/g, ' ').slice(0, 70), messages: toStore(all) })
      .then((r) => {
        setChatId(r.id);
        qc.invalidateQueries({ queryKey: ['ai-chats'] });
      })
      .catch(() => {}); // não salvar o histórico não atrapalha a conversa
  }

  if (status && !status.ready) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <Sparkles className="mx-auto mb-3 text-muted-foreground" />
        <h1 className="text-xl font-bold">A IA ainda não está ligada</h1>
        <p className="mt-2 text-sm text-muted-foreground">O administrador da plataforma precisa conectar o motor de IA no painel do administrador.</p>
      </div>
    );
  }

  const reading = pending.some((p) => !p.att && !p.error);
  return (
    <div
      className="relative flex h-[calc(100dvh-4rem)] min-h-[420px] lg:h-[calc(100dvh-7rem)]"
      onDragEnter={(e) => [...e.dataTransfer.types].includes('Files') && setDrag((d) => d + 1)}
      onDragLeave={() => setDrag((d) => Math.max(0, d - 1))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(0);
        void addFiles([...e.dataTransfer.files]);
      }}
    >
      {/* Conversas: coluna no computador, gaveta no celular */}
      <aside className={cn('absolute inset-y-0 left-0 z-20 w-72 max-w-[85vw] flex-col border-r border-border bg-card lg:static lg:flex', showList ? 'flex shadow-lift' : 'hidden')}>
        <div className="flex gap-2 p-3">
          <button onClick={newChat} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-sm font-semibold text-brand hover:bg-black">
            <MessageSquarePlus size={16} /> Nova conversa
          </button>
          <button onClick={() => setShowList(false)} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted lg:hidden" aria-label="Fechar"><X size={16} /></button>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {chats.length ? null : <li className="px-2 py-3 text-xs text-muted-foreground">Nenhuma conversa ainda.</li>}
          {chats.map((c) => (
            <li key={c.id} className="group flex items-center">
              <button
                onClick={async () => {
                  if (busy) return;
                  const r = await ia.chat(c.id);
                  setChatId(r.id);
                  setMessages(r.messages);
                  setShowList(false);
                }}
                className={cn('min-w-0 flex-1 truncate rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted', chatId === c.id && 'bg-muted font-semibold')}
                title={c.title}
              >
                {c.title}
              </button>
              <button
                onClick={async () => {
                  if (!confirm('Apagar esta conversa?')) return;
                  await ia.deleteChat(c.id);
                  if (chatId === c.id) newChat();
                  qc.invalidateQueries({ queryKey: ['ai-chats'] });
                }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-red-600 lg:opacity-0 lg:group-hover:opacity-100"
                aria-label="Apagar conversa"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 lg:hidden">
          <button onClick={() => setShowList(true)} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold">Conversas</button>
          <button onClick={newChat} className="ml-auto rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-brand">Nova</button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {messages.length ? (
              <div className="space-y-6">
                {messages.map((m, i) => <Message key={i} m={m} streaming={busy && i === messages.length - 1} />)}
              </div>
            ) : (
              <div className="py-4 text-center">
                <span className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-neutral-900 text-brand"><Sparkles size={22} /></span>
                <BlurText as="h1" text="Como posso ajudar?" delay={90} className="justify-center text-2xl font-bold" />
                <p className="mt-1 text-sm text-muted-foreground">Pergunte qualquer coisa, peça provas e atividades ou arraste documentos e fotos para cá.</p>
                <div className="mt-6 grid gap-2 text-left sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => { setText(s); inputRef.current?.focus(); }} className="rounded-xl border border-border bg-card px-3 py-2.5 text-sm hover:bg-muted">{s}</button>
                  ))}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>

        {/* Campo */}
        <div className="border-t border-border px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          <div className="mx-auto w-full max-w-3xl">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {status?.school ? (
                <button
                  onClick={() => setEscola((v) => !v)}
                  title="Buscar também nos documentos, avisos, calendário, planejamentos e provas da escola"
                  className={cn('inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold', escola ? 'bg-neutral-900 text-brand' : 'border border-border text-muted-foreground hover:text-foreground')}
                >
                  <Library size={13} /> Conteúdos da escola{escola && docIds?.length ? ` (${docIds.length} selecionados)` : ''}
                </button>
              ) : null}
              {prep ? <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground"><Loader2 size={12} className="shrink-0 animate-spin" /> {prep}</span> : null}
              {pending.map((p) => (
                <span key={p.id} title={p.error} className={cn('inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg border px-2 py-1 text-xs', p.error ? 'border-red-200 bg-red-50 text-red-700' : 'border-border bg-card')}>
                  {!p.att && !p.error ? <Loader2 size={12} className="animate-spin" /> : p.att?.[0]?.kind === 'image' ? <ImageIcon size={12} /> : <FileText size={12} />}
                  <span className="truncate">{p.error ?? p.name}</span>
                  {(p.att?.length ?? 0) > 1 ? <span className="text-muted-foreground">({p.att!.length} pág.)</span> : null}
                  <button onClick={() => setPending((x) => x.filter((y) => y.id !== p.id))} aria-label="Remover anexo" className="opacity-60 hover:opacity-100"><X size={12} /></button>
                </span>
              ))}
            </div>
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-soft focus-within:border-neutral-900">
              <label className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground" title="Anexar documentos ou imagens">
                <Paperclip size={18} />
                <input type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
              </label>
              <textarea
                ref={inputRef}
                value={text}
                rows={1}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && (e.preventDefault(), void send())}
                onPaste={(e) => e.clipboardData.files.length && (e.preventDefault(), void addFiles([...e.clipboardData.files]))}
                placeholder={escola ? 'Pergunte sobre os conteúdos da escola…' : 'Pergunte qualquer coisa ou arraste arquivos aqui…'}
                className="max-h-56 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] outline-none"
              />
              <button
                onClick={() => (busy ? abort.current?.abort() : void send())}
                disabled={!busy && (reading || (!text.trim() && !pending.some((p) => p.att)))}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-900 text-brand disabled:opacity-30"
                aria-label={busy ? 'Parar' : 'Enviar'}
              >
                {busy ? <Square size={14} fill="currentColor" className="text-white" /> : <ArrowUp size={18} />}
              </button>
            </div>
            <p className="mt-1.5 hidden text-center text-[11px] text-muted-foreground sm:block">
              Word, Excel, PowerPoint, PDF (até escaneado), texto e imagens · Enter envia, Shift+Enter quebra linha · A IA pode errar: confira.
              {status?.engine ? <> Motor: <b>{status.engine}</b>.</> : null}
            </p>
          </div>
        </div>
      </section>

      {drag ? (
        <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center bg-neutral-900/70 p-4">
          <div className="rounded-2xl border-2 border-dashed border-brand px-8 py-8 text-center text-white">
            <Upload className="mx-auto mb-2 text-brand" size={30} />
            <p className="text-lg font-bold">Solte os arquivos aqui</p>
            <p className="text-sm text-white/70">Documentos, planilhas, PDFs, apresentações e imagens</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Message({ m, streaming }: { m: ChatMsg; streaming: boolean }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState<null | 'menu' | 'busy'>(null);
  if (m.role === 'user') {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {m.attachments?.length ? (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
            {m.attachments.map((a, i) => a.image
              ? <img key={i} src={a.image} alt={a.name} className="h-24 rounded-lg border border-border object-cover" />
              : <span key={i} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 text-xs">{a.kind === 'image' ? <ImageIcon size={12} /> : <FileText size={12} />} {a.name}</span>)}
          </div>
        ) : null}
        {m.content ? <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-neutral-900 px-4 py-2.5 text-[15px] text-white">{m.content}</p> : null}
      </div>
    );
  }
  const html = m.content ? mdToHtml(m.content) : '';
  const title = (m.content.match(/^#+\s*(.+)$/m)?.[1] ?? m.content.split('\n')[0] ?? '').replace(/[*_#`]/g, '').trim().slice(0, 80) || 'Documento da IA';
  const full = (m.image ? `<img src="${m.image}">` : '') + html;
  const act = 'inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted hover:text-foreground';
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-neutral-900 text-brand"><Sparkles size={14} /></span>
      <div className="min-w-0 flex-1">
        {m.image ? <img src={m.image} alt="Imagem gerada" className="mb-3 max-h-96 w-auto max-w-full rounded-xl border border-border" /> : null}
        {html ? <div className={cn('scola-chat', m.error && 'text-red-700')} dangerouslySetInnerHTML={{ __html: html }} />
          : streaming ? <p className="flex items-center gap-2 text-sm"><Loader2 size={14} className="animate-spin text-muted-foreground" /> <ShinyText text="Pensando…" color="#737373" shineColor="#e5e5e5" speed={1.6} /></p> : null}
        {m.sources?.length && !streaming ? (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            <span className="font-bold uppercase text-muted-foreground">Fontes:</span>
            {m.sources.map((s, i) => <span key={i} className="rounded bg-muted px-1.5 py-0.5">[{i + 1}] {s.kind}: {s.name}</span>)}
          </div>
        ) : null}
        {!streaming && !m.error && (m.content || m.image) ? (
          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <button onClick={() => { void navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className={act}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copiado' : 'Copiar'}
            </button>
            <button onClick={() => void downloadDocx(title, full)} className={act}><Download size={13} /> Word</button>
            <span className="relative">
              <button onClick={() => setSaving(saving ? null : 'menu')} disabled={saving === 'busy'} className={act}>
                {saving === 'busy' ? <Loader2 size={13} className="animate-spin" /> : <FolderInput size={13} />} Salvar no Planejamento
              </button>
              {saving === 'menu' ? (
                <span className="absolute bottom-8 left-0 z-10 w-48 rounded-lg border border-border bg-card p-1 shadow-lift">
                  {SEGMENTS.map((s) => (
                    <button
                      key={s.key}
                      onClick={async () => {
                        setSaving('busy');
                        try {
                          const id = await saveToPlanejamento(title, full, s.key);
                          if (confirm('Salvo no Planejamento. Abrir para editar?')) navigate(`/planejamento/editor/${id}`);
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
            {m.image ? <a href={m.image} download="imagem-scola.jpg" className={act}><ImageIcon size={13} /> Baixar imagem</a> : null}
            {m.model ? <span className="ml-auto truncate pl-2 text-[11px]">respondido por {m.model}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
