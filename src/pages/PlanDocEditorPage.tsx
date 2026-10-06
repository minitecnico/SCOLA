import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Check, CloudOff, Download, FileSpreadsheet, FileText, History, Loader2, Lock, Printer, RotateCcw, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useParams } from 'react-router-dom';
import { DocEditor, useDocEditor, type JSONContent } from '../components/editor/DocEditor';
import { blankSheets, gridToSheets, SheetEditor, xlsxToSheets, type SheetData, type SheetEditorHandle } from '../components/editor/SheetEditor';
import { Button, EmptyState, Loading, Modal } from '../components/ui';
import { cn } from '../lib/cn';
import { downloadBlob } from '../lib/storage';
import { printDocument } from '../lib/print';
import {
  getPlanDocMeta, listPlanDocVersions, loadDocContent, loadDocVersion, lockPlanDoc, saveDocContent, unlockPlanDoc, type EditableKind, type PlanDocMeta,
} from '../lib/queries';
import { askConfirm } from '../components/Feedback';

/**
 * Editor do Planejamento (documento ou planilha), em tela cheia.
 * Salva sozinho enquanto a pessoa edita; trava "em edição" para ninguém sobrescrever.
 */
type Status = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

const kindOf = (m: PlanDocMeta): EditableKind | null => {
  if (m.kind === 'doc' || m.kind === 'sheet') return m.kind;
  const n = m.name.toLowerCase();
  if (n.endsWith('.docx')) return 'doc';
  if (/\.(xlsx|xlsm|xls|ods|csv|tsv)$/.test(n)) return 'sheet';
  return null;
};
const stripExt = (n: string) => n.replace(/\.(docx?|xlsx?|xlsm|csv|tsv|ods|odt)$/i, '');
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dt = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function PlanDocEditorPage() {
  const { id = '' } = useParams();
  const { data: meta, isLoading, error } = useQuery({ queryKey: ['plan-doc-meta', id], queryFn: () => getPlanDocMeta(id), staleTime: Infinity, retry: false });
  if (isLoading) return <Loading />;
  if (!meta) return <EmptyState icon={<FileText size={24} />} title="Documento não encontrado" hint={(error as Error)?.message} />;
  const kind = kindOf(meta);
  if (!kind) return <EmptyState icon={<FileText size={24} />} title="Este arquivo não abre no editor" hint="O editor abre Word (.docx) e planilhas (.xlsx, .xls, .ods, .csv). Use Baixar para abrir no computador." />;
  return createPortal(<EditorShell meta={meta} kind={kind} />, document.body);
}

function EditorShell({ meta, kind }: { meta: PlanDocMeta; kind: EditableKind }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [editable, setEditable] = useState(false);
  const [lockedBy, setLockedBy] = useState<string | null>(meta.lock?.name ?? null);
  const [status, setStatus] = useState<Status>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(meta.updated_at);
  const [error, setError] = useState('');
  const [title, setTitle] = useState(stripExt(meta.name));
  const [loaded, setLoaded] = useState(false);
  const [loadNote, setLoadNote] = useState('');
  const [sheetData, setSheetData] = useState<SheetData | null>(null);
  const [sheetKey, setSheetKey] = useState(0);
  const [history, setHistory] = useState(false);
  const version = useRef(meta.version);
  const dirty = useRef(false);
  const saving = useRef<Promise<void> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const sheetRef = useRef<SheetEditorHandle>(null);
  const titleRef = useRef(title);
  titleRef.current = title;

  const loadedRef = useRef(false);
  const markDirty = useCallback(() => {
    // Nunca salva antes de o conteúdo terminar de abrir (senão gravaria um documento vazio por cima).
    if (!editableRef.current || !loadedRef.current) return;
    dirty.current = true;
    setStatus('dirty');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 1800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const editableRef = useRef(false);
  editableRef.current = editable;

  const editor = useDocEditor({ editable: false, onChange: markDirty });
  const editorRef = useRef(editor);
  editorRef.current = editor;

  /* ---------------------------- Salvar ---------------------------- */
  async function save(): Promise<void> {
    if (saving.current) {
      await saving.current;
      if (!dirty.current) return;
    }
    if (!dirty.current) return;
    const run = (async () => {
      dirty.current = false;
      setStatus('saving');
      try {
        let content: unknown;
        let file: Blob | null = null;
        if (kind === 'doc') {
          const ed = editorRef.current;
          if (!ed) return;
          const json = ed.getJSON();
          content = json;
          const { docToDocx } = await import('../lib/docxConvert');
          file = await docToDocx(json, titleRef.current);
        } else {
          if (!sheetRef.current) return;
          content = sheetRef.current.getContent();
          file = await sheetRef.current.toXlsx().catch(() => null);
        }
        const r = await saveDocContent(meta.id, { content, file, baseVersion: version.current, kind, name: titleRef.current });
        version.current = r.version;
        setSavedAt(r.updated_at);
        setStatus(dirty.current ? 'dirty' : 'saved');
        setError('');
        qc.invalidateQueries({ queryKey: ['plan-docs'] });
      } catch (e) {
        dirty.current = true;
        const st = (e as { status?: number }).status;
        setStatus(st === 409 ? 'conflict' : 'error');
        setError((e as Error).message);
        if (st === 409) setEditable(false);
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
  }

  /* ------------------------ Trava de edição ------------------------ */
  useEffect(() => {
    if (!meta.can_edit) return;
    let alive = true;
    const take = async (force = false) => {
      const r = await lockPlanDoc(meta.id, force).catch(() => null);
      if (!alive || !r) return;
      if (r.ok) {
        setEditable(true);
        setLockedBy(null);
      } else {
        setEditable(false);
        setLockedBy(r.by);
      }
    };
    void take();
    const beat = window.setInterval(() => editableRef.current && void lockPlanDoc(meta.id).catch(() => {}), 30_000);
    (window as unknown as { __takeLock?: (f: boolean) => Promise<void> }).__takeLock = take;
    return () => {
      alive = false;
      window.clearInterval(beat);
    };
  }, [meta.id, meta.can_edit]);

  useEffect(() => {
    // false = sem disparar "update": trocar para editável não é uma edição.
    editor?.setEditable(editable, false);
  }, [editor, editable]);

  // Ao sair: salva o que falta e libera a trava.
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current || saving.current) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      window.clearTimeout(timer.current);
      void save().finally(() => {
        if (editableRef.current) void unlockPlanDoc(meta.id).catch(() => {});
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------- Carregar conteúdo ------------------------- */
  useEffect(() => {
    if (kind === 'doc' && !editor) return;
    let alive = true;
    (async () => {
      try {
        const { content, version: v } = await loadDocContent(meta.id);
        version.current = v;
        if (content) {
          if (kind === 'doc') editor!.commands.setContent(content as JSONContent, { emitUpdate: false });
          else setSheetData(content as SheetData);
        } else if (meta.kind === 'file' && meta.url) {
          // Arquivo enviado: converte para o editor (o original só é substituído quando alguém editar).
          const buf = await (await fetch(meta.url, { credentials: 'same-origin' })).arrayBuffer();
          if (kind === 'doc') {
            const { docxToHtml } = await import('../lib/docxConvert');
            const { html, warnings } = await docxToHtml(buf);
            editor!.commands.setContent(html, { emitUpdate: false });
            if (warnings.length) setLoadNote('Alguns elementos do Word (caixas de texto, cabeçalho/rodapé) podem ter ficado de fora. O arquivo original só muda quando você editar.');
          } else if (/\.xlsx?m?$/i.test(meta.name) && !/\.xls$/i.test(meta.name)) {
            setSheetData(await xlsxToSheets(buf, meta.name));
          } else {
            const { fileToGrids } = await import('../lib/anyToGrid');
            const parts = await fileToGrids(new File([buf], meta.name));
            setSheetData(parts.flatMap((p, i) => gridToSheets(p.grid, p.name || `Planilha${i + 1}`).map((s) => ({ ...s, order: i }))));
          }
        } else if (kind === 'sheet') setSheetData(blankSheets());
        if (alive) {
          setLoaded(true);
          // Um instante depois da carga: o editor termina de montar antes de aceitar edições.
          window.setTimeout(() => (loadedRef.current = true), 300);
        }
      } catch (e) {
        if (alive) setError((e as Error).message || 'Não consegui abrir o arquivo.');
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, meta.id]);

  /* ------------------------------ Ações ------------------------------ */
  async function download() {
    const name = `${title || 'documento'}.${kind === 'doc' ? 'docx' : 'xlsx'}`;
    if (kind === 'doc' && editor) {
      const { docToDocx } = await import('../lib/docxConvert');
      downloadBlob(await docToDocx(editor.getJSON(), title), name);
    } else if (sheetRef.current) downloadBlob(await sheetRef.current.toXlsx(), name);
  }

  async function restore(vid: string) {
    const content = await loadDocVersion(meta.id, vid);
    if (kind === 'doc') editor?.commands.setContent(content as JSONContent, { emitUpdate: false });
    else {
      setSheetData(content as SheetData);
      setSheetKey((k) => k + 1);
    }
    setHistory(false);
    dirty.current = true;
    void save();
  }

  const close = () => navigate('/planejamento');

  return (
    <div className="fixed inset-0 z-[55] flex flex-col bg-background text-foreground">
      {/* Cabeçalho */}
      <header className="flex items-center gap-2 border-b border-border bg-card px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:px-3">
        <button onClick={close} className="grid h-10 w-10 shrink-0 place-items-center rounded-lg hover:bg-muted" aria-label="Voltar ao planejamento" title="Voltar">
          <ArrowLeft size={18} />
        </button>
        <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', kind === 'doc' ? 'bg-neutral-900 text-white' : 'bg-neutral-900 text-white')}>
          {kind === 'doc' ? <FileText size={18} /> : <FileSpreadsheet size={18} />}
        </span>
        <div className="min-w-0 flex-1">
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
            readOnly={!editable}
            className="w-full truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[15px] font-semibold outline-none hover:border-border focus:border-neutral-400"
            aria-label="Nome do arquivo"
          />
          <p className="flex items-center gap-1.5 truncate px-1.5 text-[11px] text-muted-foreground">
            <SaveStatus status={status} savedAt={savedAt} editable={editable} />
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <HeaderBtn label="Histórico de versões" onClick={() => setHistory(true)}><History size={17} /></HeaderBtn>
          {kind === 'doc' ? (
            <HeaderBtn label="Imprimir / PDF" onClick={() => editor && printDocument(title, `<div class="doc">${editor.getHTML()}</div>`)}><Printer size={17} /></HeaderBtn>
          ) : null}
          <HeaderBtn label={`Baixar .${kind === 'doc' ? 'docx' : 'xlsx'}`} onClick={() => void download()}><Download size={17} /></HeaderBtn>
          <button onClick={close} className="ml-1 hidden h-9 items-center gap-1.5 rounded-lg bg-neutral-950 px-3 text-sm font-semibold text-white hover:bg-black sm:inline-flex">
            <Check size={15} /> Concluir
          </button>
        </div>
      </header>

      {/* Avisos */}
      {!meta.can_edit ? (
        <Banner icon={<Lock size={14} />}>Somente leitura: quem criou o arquivo e a gestão podem editar.</Banner>
      ) : lockedBy && !editable ? (
        <Banner icon={<Lock size={14} />} tone="warn">
          <b>{lockedBy}</b> está editando agora. Você vê o conteúdo, mas só edita quando a pessoa fechar.
          <button
            className="ml-2 font-semibold underline"
            onClick={() => void (window as unknown as { __takeLock?: (f: boolean) => Promise<void> }).__takeLock?.(false)}
          >
            Tentar de novo
          </button>
          {meta.can_edit ? (
            <button
              className="ml-2 font-semibold underline"
              onClick={() => askConfirm(`Assumir a edição? Se ${lockedBy} ainda estiver editando, as alterações dela que não foram salvas podem se perder.`).then((ok) => ok && void (window as unknown as { __takeLock?: (f: boolean) => Promise<void> }).__takeLock?.(true))}
            >
              Assumir edição
            </button>
          ) : null}
        </Banner>
      ) : null}
      {status === 'conflict' ? (
        <Banner icon={<AlertTriangle size={14} />} tone="bad">
          {error} <button className="ml-2 font-semibold underline" onClick={() => window.location.reload()}>Recarregar</button>
        </Banner>
      ) : status === 'error' ? (
        <Banner icon={<CloudOff size={14} />} tone="bad">
          Não salvou: {error} <button className="ml-2 font-semibold underline" onClick={() => { dirty.current = true; void save(); }}>Tentar de novo</button>
        </Banner>
      ) : null}
      {loadNote ? <Banner icon={<AlertTriangle size={14} />} tone="warn" onClose={() => setLoadNote('')}>{loadNote}</Banner> : null}

      {/* Conteúdo */}
      {!loaded && !error ? (
        <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Abrindo…</span>
        </div>
      ) : null}
      {kind === 'doc' ? (
        <div className={cn('flex min-h-0 flex-1 flex-col', !loaded && 'hidden')}>
          <DocEditor editor={editor} editable={editable} />
        </div>
      ) : sheetData ? (
        <SheetEditor key={`${sheetKey}-${editable}`} ref={sheetRef} initial={sheetData} editable={editable} onChange={markDirty} />
      ) : null}

      {history ? <HistoryModal id={meta.id} canRestore={editable} onClose={() => setHistory(false)} onRestore={restore} /> : null}
    </div>
  );
}

function SaveStatus({ status, savedAt, editable }: { status: Status; savedAt: string | null; editable: boolean }) {
  if (!editable) return <>{savedAt ? `Última alteração ${dt(savedAt)}` : 'Somente leitura'}</>;
  if (status === 'saving') return <><Loader2 size={11} className="animate-spin" /> Salvando…</>;
  if (status === 'dirty') return <>Alterações não salvas…</>;
  if (status === 'error' || status === 'conflict') return <span className="font-semibold text-red-600">Não salvo</span>;
  if (status === 'saved' && savedAt) return <><Check size={11} className="text-green-600" /> Salvo às {hhmm(savedAt)}</>;
  return <>{savedAt ? `Salvo ${dt(savedAt)}` : 'Salva sozinho enquanto você edita'}</>;
}

function HeaderBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
      {children}
    </button>
  );
}

function Banner({ icon, tone = 'info', children, onClose }: { icon: React.ReactNode; tone?: 'info' | 'warn' | 'bad'; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b px-4 py-2 text-xs',
        tone === 'bad' ? 'border-red-200 bg-red-50 text-red-800' : tone === 'warn' ? 'border-neutral-300 bg-neutral-100 text-neutral-800' : 'border-border bg-muted text-muted-foreground',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {onClose ? (
        <button onClick={onClose} className="shrink-0 opacity-60 hover:opacity-100" aria-label="Fechar aviso">
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

function HistoryModal({ id, canRestore, onClose, onRestore }: { id: string; canRestore: boolean; onClose: () => void; onRestore: (vid: string) => Promise<void> }) {
  const { data = [], isLoading } = useQuery({ queryKey: ['plan-doc-versions', id], queryFn: () => listPlanDocVersions(id) });
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title="Histórico de versões">
      <p className="mb-3 text-sm text-muted-foreground">Uma cópia é guardada a cada 15 minutos de edição. Restaurar traz aquela versão de volta (a atual também fica no histórico).</p>
      {isLoading ? (
        <Loading />
      ) : !data.length ? (
        <p className="rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">Ainda não há versões anteriores.</p>
      ) : (
        <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {data.map((v) => (
            <li key={v.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{dt(v.created_at)}</span>
                <span className="block text-xs text-muted-foreground">{v.author_name ?? '—'}</span>
              </span>
              {canRestore ? (
                <Button
                  variant="ghost"
                  disabled={!!busy}
                  onClick={async () => {
                    if (!(await askConfirm('Restaurar esta versão? O conteúdo atual vai para o histórico.'))) return;
                    setBusy(v.id);
                    await onRestore(v.id).finally(() => setBusy(null));
                  }}
                >
                  <RotateCcw size={15} /> {busy === v.id ? 'Restaurando…' : 'Restaurar'}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
