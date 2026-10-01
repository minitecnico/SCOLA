import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, ExternalLink, Eye, Folder, FolderInput, FolderPlus, FilePen, FileSpreadsheet, FileText, Loader2, Lock, Mail, Pencil, Presentation, ClipboardList, Plus, Search, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { canReviewPlan } from '../lib/permissions';
import { createClassFolders, createGoogleDoc, createPlanFolder, deletePlanDoc, deletePlanFolder, listPlanFolders, movePlanDocs, renamePlanFolder, disconnectGoogle, getGoogleStatus, googleLink, listClasses, listPlanDocs, updatePlanDoc, uploadPlanDoc, type EditableKind, type GoogleKind } from '../lib/queries';
import { downloadAllAttachments, safeFileName, translateStorageError } from '../lib/storage';
import type { ClassRoom, PlanDoc, PlanFolder } from '../lib/types';
import { Button, Modal, Select } from './ui';
import { SendMailModal } from './SendMailModal';
import { useSelection } from '../lib/useSelection';
import { GoogleMenus } from './GoogleHub';
import { Dropzone } from './Dropzone';
import { PreviewModal } from './Attachments';
import { successToast } from './Feedback';
import { cn } from '../lib/cn';

/** Segmentos da escola — fácil de estender (basta adicionar aqui). */
const SEGMENTS: { key: string; label: string; color: string }[] = [
  { key: 'fund1', label: 'Fundamental I', color: '#2563eb' },
  { key: 'fund2', label: 'Fundamental II', color: '#7c3aed' },
];
const TERMS = [1, 2, 3];
/** Abre no editor do SCOLA? (documentos e planilhas; o resto baixa/visualiza). */
export const editableKind = (d: Pick<PlanDoc, 'kind' | 'name'>): EditableKind | null =>
  d.kind === 'google' ? null : d.kind === 'doc' || d.kind === 'sheet' ? d.kind : /\.docx$/i.test(d.name) ? 'doc' : /\.(xlsx|xlsm|xls|ods|csv|tsv)$/i.test(d.name) ? 'sheet' : null;
const termLabel = (t: number | null) => (t ? `${t}º Trimestre` : 'Sem trimestre');
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export function PlanDocsCenter() {
  const { data: docs = [], isLoading, isError, error } = useQuery({ queryKey: ['plan-docs'], queryFn: listPlanDocs, retry: false });
  const { data: classes = [] } = useQuery({ queryKey: ['classes'], queryFn: listClasses });
  const { data: folders = [] } = useQuery({ queryKey: ['plan-folders'], queryFn: listPlanFolders, retry: false });

  const [seg, setSeg] = useState(SEGMENTS[0].key);

  const countBySeg = (key: string) => docs.filter((d) => d.segment === key).length;

  return (
    <div className="space-y-4">
      {isError ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-700">
          Não foi possível carregar. {(error as Error).message}
        </p>
      ) : null}

      {/* Abas de segmento */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
        {SEGMENTS.map((s) => {
          const active = seg === s.key;
          return (
            <button
              key={s.key}
              onClick={() => setSeg(s.key)}
              className={cn(
                'flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-bold transition',
                active ? 'text-white shadow-sm' : 'text-muted-foreground hover:bg-muted',
              )}
              style={active ? { backgroundColor: s.color } : undefined}
            >
              <FileText size={15} />
              {s.label}
              <span className={cn('rounded-full px-1.5 text-[11px] font-black', active ? 'bg-card/25' : 'bg-muted text-muted-foreground')}>{countBySeg(s.key)}</span>
            </button>
          );
        })}
      </div>

      <FileCenter key={seg} segKey={seg} docs={docs.filter((d) => d.segment === seg)} folders={folders.filter((f) => f.segment === seg)} classes={classes} loading={isLoading} />
    </div>
  );
}

function FileCenter({ segKey, docs, folders, classes, loading }: { segKey: string; docs: PlanDoc[]; folders: PlanFolder[]; classes: ClassRoom[]; loading: boolean }) {
  const { user, role } = useAuth();
  const userId = user?.id ?? null;
  const canReview = canReviewPlan(role);
  const qc = useQueryClient();

  const [term, setTerm] = useState(''); // '' = todos
  const [turma, setTurma] = useState(''); // '' = todas
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<PlanDoc | null>(null);
  const [editing, setEditing] = useState<PlanDoc | null>(null);
  const [zipping, setZipping] = useState(false);
  const sel = useSelection();
  const [mailDocs, setMailDocs] = useState<PlanDoc[] | null>(null);
  const { data: google } = useQuery({ queryKey: ['google-status'], queryFn: getGoogleStatus, retry: false });
  const createG = useMutation({
    mutationFn: ({ gkind }: { gkind: GoogleKind; win: Window | null }) =>
      createGoogleDoc({ gkind, segment: segKey, term: term ? Number(term) : null, class_id: destClass, turma_label: destClassName, folder_id: folder?.id ?? null }),
    onSuccess: (r, v) => {
      invalidate();
      if (v.win) v.win.location.href = r.link;
      else window.open(r.link, '_blank', 'noopener');
    },
    onError: (e, v) => {
      v.win?.close();
      alert((e as Error).message);
    },
  });
  const newGoogle = (gkind: GoogleKind) => createG.mutate({ gkind, win: window.open('', '_blank') });
  const unlink = useMutation({
    mutationFn: disconnectGoogle,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['google-status'] });
      successToast('Google desconectado');
    },
  });
  const gParam = new URLSearchParams(window.location.search).get('google');

  const navigate = useNavigate();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['plan-docs'] });
  const [folderId, setFolderId] = useState<string | null>(null);
  const folder = folders.find((f) => f.id === folderId) ?? null;
  // Dentro de uma pasta de turma, tudo o que for criado/enviado já fica dessa turma.
  const destClass = folder?.class_id ?? (turma || null);
  const destClassName = destClass ? classes.find((c) => c.id === destClass)?.name ?? null : null;
  const segLabel = SEGMENTS.find((s) => s.key === segKey)?.label ?? '';
  const turmaName = turma ? classes.find((c) => c.id === turma)?.name ?? null : null;

  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadPlanDoc({ segment: segKey, term: term ? Number(term) : null, classId: destClass, turmaLabel: destClassName, folderId: folder?.id ?? null, file }),
    onSuccess: () => {
      invalidate();
      successToast('Arquivo enviado');
    },
    onError: (e) => alert(translateStorageError((e as Error).message)),
  });

  const remove = useMutation({
    mutationFn: (doc: PlanDoc) => deletePlanDoc(doc),
    onSuccess: () => {
      invalidate();
      successToast('Arquivo excluído');
    },
  });

  async function handleFiles(list: FileList | null) {
    if (!list?.length) return;
    for (const f of Array.from(list)) await upload.mutateAsync(f).catch(() => {});
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return docs.filter(
      (d) =>
        // Com busca, procura em todas as pastas; sem busca, só na pasta aberta (ou na raiz).
        (needle || (d.folder_id ?? null) === folderId) &&
        (!term || d.term === Number(term)) &&
        (!turma || d.class_id === turma) &&
        (!needle || d.name.toLowerCase().includes(needle)),
    );
  }, [docs, term, turma, q, folderId]);

  // Agrupa por trimestre quando sem filtro/busca; senão lista plana.
  const grouped = useMemo(() => {
    if (term || q.trim()) return null;
    const order: (number | null)[] = [1, 2, 3, null];
    return order
      .map((t) => ({ term: t, items: filtered.filter((d) => (d.term ?? null) === t) }))
      .filter((g) => g.items.length > 0);
  }, [filtered, term, q]);

  const [newFolder, setNewFolder] = useState(false);
  const countIn = (id: string | null) => docs.filter((d) => (d.folder_id ?? null) === id).length;
  const refreshFolders = () => qc.invalidateQueries({ queryKey: ['plan-folders'] });
  const move = useMutation({
    mutationFn: ({ ids, to }: { ids: string[]; to: string | null }) => movePlanDocs(ids, to),
    onSuccess: (r) => {
      invalidate();
      sel.clear();
      successToast(r.moved ? `${r.moved} arquivo${r.moved > 1 ? 's' : ''} movido${r.moved > 1 ? 's' : ''}` : 'Nada foi movido (só o autor ou a gestão move arquivos)');
    },
    onError: (e) => alert((e as Error).message),
  });
  const renameFolder = useMutation({
    mutationFn: (name: string) => renamePlanFolder(folder!.id, name),
    onSuccess: refreshFolders,
    onError: (e) => alert((e as Error).message),
  });
  const removeFolder = useMutation({
    mutationFn: () => deletePlanFolder(folder!.id),
    onSuccess: () => {
      setFolderId(null);
      refreshFolders();
      invalidate();
      successToast('Pasta excluída. Os arquivos voltaram para o início.');
    },
    onError: (e) => alert((e as Error).message),
  });
  const canManageFolder = !!folder && (folder.author_id === userId || canReview);

  async function baixarTodos() {
    if (zipping || filtered.length === 0) return;
    setZipping(true);
    try {
      await downloadAllAttachments(filtered.filter((d) => d.kind !== 'google').map((d) => ({ name: d.name, url: d.url })), safeFileName(segLabel) || 'arquivos');
      successToast(filtered.length > 1 ? 'Baixado (.zip)' : 'Arquivo baixado');
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setZipping(false);
    }
  }

  const canManage = (d: PlanDoc) => d.author_id === userId || canReview;
  const destino = [segLabel, folder?.name, term ? `${term}º tri` : 'sem trimestre', destClassName].filter(Boolean).join(' · ');

  const row = (d: PlanDoc) => (
    <FileRow
      key={d.id}
      doc={d}
      canManage={canManage(d)}
      onPreview={() => setPreview(d)}
      onOpenEditor={editableKind(d) ? () => navigate(`/planejamento/editor/${d.id}`) : undefined}
      lockedByOther={!!d.lock_by && d.lock_by !== userId}
      selected={sel.has(d.id)}
      onToggle={() => sel.toggle(d.id)}
      onMail={() => setMailDocs([d])}
      onEdit={() => setEditing(d)}
      onDelete={() => confirm(`Excluir "${d.name}"?\n\n⚠️ Ação irreversível: remove o arquivo do banco e do armazenamento.`) && remove.mutate(d)}
    />
  );

  return (
    <div className="space-y-4">
      {/* Barra de ferramentas: filtros + busca + baixar todos */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-44">
          <Select value={term} onChange={(e) => setTerm(e.target.value)} className="py-2 text-sm">
            <option value="">Todos os trimestres</option>
            {TERMS.map((t) => <option key={t} value={t}>{t}º trimestre</option>)}
          </Select>
        </div>
        <div className="w-full sm:w-48">
          <Select value={turma} onChange={(e) => setTurma(e.target.value)} className="py-2 text-sm">
            <option value="">Todas as turmas</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 sm:max-w-xs">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar arquivo…" className="w-full bg-transparent text-sm outline-none" />
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <GoogleMenus
            available={!!google?.available}
            connected={!!google?.connected}
            email={google?.email ?? null}
            busy={createG.isPending}
            message={gParam === 'escopo' ? 'Faltou marcar a permissão do Drive na tela do Google; conecte de novo com todas as caixas marcadas.' : gParam === 'negado' ? 'Conexão cancelada.' : gParam === 'erro' ? 'Não deu certo, tente de novo.' : undefined}
            onCreate={newGoogle}
            onDisconnect={() => confirm('Desconectar sua conta do Google? Os arquivos continuam no seu Drive.') && unlink.mutate()}
          />
        </div>
        {filtered.length >= 2 ? (
          <button
            onClick={baixarTodos}
            disabled={zipping}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {zipping ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {zipping ? 'Compactando…' : `Baixar todos (.zip) — ${filtered.length}`}
          </button>
        ) : null}
      </div>

      {sel.size > 0 ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-white shadow-lg">
          <span className="text-sm font-black">{sel.size} selecionado{sel.size > 1 ? 's' : ''}</span>
          <button onClick={() => setMailDocs(docs.filter((d) => sel.has(d.id)))} className="inline-flex items-center gap-1.5 rounded-lg bg-yellow-400 px-3 py-1.5 text-xs font-black text-slate-900">
            <Mail size={14} /> Enviar por e-mail
          </button>
          <select
            value=""
            onChange={(e) => e.target.value && move.mutate({ ids: [...sel.ids], to: e.target.value === '__root' ? null : e.target.value })}
            className="rounded-lg bg-white/10 px-2 py-1.5 text-xs font-bold text-white outline-none"
            aria-label="Mover para pasta"
          >
            <option value="" className="text-slate-900">Mover para…</option>
            {folderId ? <option value="__root" className="text-slate-900">Início (sem pasta)</option> : null}
            {folders.filter((f) => f.id !== folderId).map((f) => <option key={f.id} value={f.id} className="text-slate-900">{f.name}</option>)}
          </select>
          <button onClick={() => sel.setAll(filtered.map((d) => d.id))} className="text-xs font-bold underline">Selecionar todos ({filtered.length})</button>
          <button onClick={sel.clear} className="ml-auto text-xs font-bold underline">Limpar</button>
        </div>
      ) : null}

      {/* Pastas */}
      {folder ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <button onClick={() => { setFolderId(null); sel.clear(); }} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-bold text-muted-foreground hover:bg-muted">
            <ArrowLeft size={15} /> Pastas
          </button>
          <span className="text-muted-foreground">/</span>
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-black"><Folder size={16} className="shrink-0 text-amber-500" /><span className="truncate">{folder.name}</span></span>
          {canManageFolder ? (
            <span className="ml-auto flex gap-1">
              <IconBtn label="Renomear pasta" onClick={() => { const n = prompt('Novo nome da pasta:', folder.name); if (n && n.trim()) renameFolder.mutate(n); }}><Pencil size={15} /></IconBtn>
              <IconBtn label="Excluir pasta" danger onClick={() => confirm(`Excluir a pasta "${folder.name}"?\n\nOs arquivos NÃO são apagados: voltam para o início.`) && removeFolder.mutate()}><Trash2 size={15} /></IconBtn>
            </span>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {folders.map((f) => (
            <button
              key={f.id}
              onClick={() => { setFolderId(f.id); sel.clear(); }}
              className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition hover:border-amber-300 hover:bg-amber-50"
            >
              <Folder size={22} className="shrink-0 fill-amber-200 text-amber-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">{f.name}</span>
                <span className="text-[11px] text-muted-foreground">{countIn(f.id)} arquivo{countIn(f.id) === 1 ? '' : 's'}</span>
              </span>
            </button>
          ))}
          <button
            onClick={() => setNewFolder(true)}
            className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm font-bold text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <FolderPlus size={18} /> Nova pasta
          </button>
        </div>
      )}

      {/* Dropzone slim — destino atual derivado dos filtros acima */}
      <Dropzone
        compact
        onFiles={handleFiles}
        title={upload.isPending ? 'Enviando…' : `Arraste ou clique para enviar — ${destino}`}
      />

      {/* Lista */}
      {loading ? (
        <p className="py-10 text-center text-sm font-bold text-muted-foreground">Carregando…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card py-12 text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground"><FileText size={22} /></div>
          <p className="text-sm font-bold text-muted-foreground">Nenhum arquivo {term || turma || q ? 'com esse filtro' : 'ainda'}</p>
          <p className="mt-1 text-xs text-muted-foreground">Arraste para a área acima ou clique para enviar.</p>
        </div>
      ) : grouped ? (
        <div className="space-y-5">
          {grouped.map((g) => (
            <div key={String(g.term)}>
              <div className="mb-2 flex items-center gap-2 px-1">
                <h3 className="text-[11px] font-black uppercase tracking-wide text-muted-foreground">{termLabel(g.term)}</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-black text-muted-foreground">{g.items.length}</span>
              </div>
              <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-card">{g.items.map(row)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-card">{filtered.map(row)}</div>
      )}

      {newFolder ? <NewFolderModal segment={segKey} classes={classes} folders={folders} onClose={() => setNewFolder(false)} onDone={(id) => { refreshFolders(); if (id) setFolderId(id); }} /> : null}
      {mailDocs ? <SendMailModal docs={mailDocs} google={google} onClose={() => setMailDocs(null)} onSent={sel.clear} /> : null}
      {preview?.url ? <PreviewModal name={preview.name} url={preview.url} mime={preview.mime} onClose={() => setPreview(null)} /> : null}
      {editing ? <EditDocModal doc={editing} classes={classes} onClose={() => setEditing(null)} onSaved={invalidate} /> : null}
    </div>
  );
}

function NewFolderModal({ segment, classes, folders, onClose, onDone }: { segment: string; classes: ClassRoom[]; folders: PlanFolder[]; onClose: () => void; onDone: (openId?: string) => void }) {
  const [name, setName] = useState('');
  const [turma, setTurma] = useState('');
  const missing = classes.filter((c) => !c.archived_at && !folders.some((f) => f.class_id === c.id));
  const create = useMutation({
    mutationFn: () => createPlanFolder({ name: name.trim() || classes.find((c) => c.id === turma)?.name || '', segment, class_id: turma || null }),
    onSuccess: (r) => { onDone(r.id); onClose(); },
    onError: (e) => alert((e as Error).message),
  });
  const all = useMutation({
    mutationFn: () => createClassFolders(segment),
    onSuccess: (r) => { onDone(); onClose(); successToast(r.created ? `${r.created} pasta${r.created > 1 ? 's' : ''} criada${r.created > 1 ? 's' : ''}` : 'As turmas já têm pasta'); },
    onError: (e) => alert((e as Error).message),
  });
  return (
    <Modal open onClose={onClose} title="Nova pasta">
      <div className="space-y-3">
        <label className="block"><span className="mb-1 block text-xs font-bold text-muted-foreground">Nome</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Planejamento de outubro" className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-slate-900" />
        </label>
        <label className="block"><span className="mb-1 block text-xs font-bold text-muted-foreground">Turma (opcional — o que entrar na pasta já fica dessa turma)</span>
          <Select value={turma} onChange={(e) => setTurma(e.target.value)}>
            <option value="">Nenhuma</option>
            {classes.filter((c) => !c.archived_at).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || (!name.trim() && !turma)}>{create.isPending ? 'Criando…' : 'Criar pasta'}</Button>
        </div>
        {missing.length > 0 ? (
          <div className="border-t border-border pt-3">
            <button onClick={() => all.mutate()} disabled={all.isPending} className="inline-flex items-center gap-2 text-sm font-bold underline disabled:opacity-50">
              <FolderInput size={15} /> {all.isPending ? 'Criando…' : `Criar uma pasta para cada turma (${missing.length})`}
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function FileRow({
  doc,
  canManage,
  onPreview,
  onOpenEditor,
  lockedByOther,
  onEdit,
  onDelete,
  selected,
  onToggle,
  onMail,
}: {
  doc: PlanDoc;
  canManage: boolean;
  onPreview: () => void;
  onOpenEditor?: () => void;
  lockedByOther?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  selected: boolean;
  onToggle: () => void;
  onMail: () => void;
}) {
  const isImg = !!doc.mime?.startsWith('image/');
  const canPrev = !!doc.url && (isImg || doc.mime === 'application/pdf');
  const ext = (doc.name.split('.').pop() || 'arq').toUpperCase().slice(0, 4);
  const gLink = doc.kind === 'google' && doc.google_id && doc.google_kind ? googleLink(doc.google_kind, doc.google_id) : null;
  const openExternal = () => (gLink ?? doc.url) && window.open(gLink ?? doc.url, '_blank', 'noopener');
  const ek = editableKind(doc);
  const open = gLink ? openExternal : onOpenEditor ?? (canPrev ? onPreview : openExternal);

  return (
    <div className={cn('flex items-center gap-3 px-3 py-2.5 transition hover:bg-muted sm:px-4', selected && 'bg-amber-50')}>
      <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Selecionar ${doc.name}`} className="h-4 w-4 shrink-0 accent-slate-900" />
      <button
        onClick={open}
        className={cn(
          'grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg',
          ek === 'doc' || doc.google_kind === 'document' ? 'bg-blue-600 text-white' : ek === 'sheet' || doc.google_kind === 'spreadsheet' ? 'bg-green-600 text-white' : doc.google_kind === 'presentation' ? 'bg-yellow-500 text-white' : doc.google_kind === 'form' ? 'bg-purple-600 text-white' : 'bg-muted text-muted-foreground',
        )}
        aria-label="Abrir"
      >
        {isImg && doc.url ? (
          <img src={doc.url} alt={doc.name} className="h-full w-full object-cover" />
        ) : doc.google_kind === 'presentation' ? (
          <Presentation size={18} />
        ) : doc.google_kind === 'form' ? (
          <ClipboardList size={18} />
        ) : ek === 'doc' || doc.google_kind === 'document' ? (
          <FileText size={18} />
        ) : ek === 'sheet' || doc.google_kind === 'spreadsheet' ? (
          <FileSpreadsheet size={18} />
        ) : (
          <span className="text-[9px] font-black text-muted-foreground">{ext}</span>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <button onClick={open} className="block max-w-full truncate text-left text-sm font-bold text-foreground hover:underline" title={doc.name}>{doc.name}</button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
          {doc.turma_label ? <span className="font-bold text-muted-foreground">{doc.turma_label}</span> : null}
          {doc.turma_label ? <span>·</span> : null}
          <span>{doc.updated_at && doc.kind !== 'file' ? `editado ${fmtDate(doc.updated_at)}` : fmtDate(doc.created_at)}</span>
          {lockedByOther ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-1.5 py-0.5 font-semibold text-orange-800">
              <Lock size={10} /> em edição
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <IconBtn label="Enviar por e-mail" onClick={onMail}><Mail size={15} /></IconBtn>
        {gLink ? <IconBtn label="Abrir no Google" onClick={openExternal}><ExternalLink size={15} /></IconBtn> : null}
        {onOpenEditor ? <IconBtn label={canManage ? 'Abrir no editor' : 'Abrir'} onClick={onOpenEditor}><FilePen size={15} /></IconBtn> : null}
        {!onOpenEditor && !gLink ? <IconBtn label="Visualizar" onClick={canPrev ? onPreview : openExternal}><Eye size={15} /></IconBtn> : null}
        {gLink ? null : <IconBtn label="Baixar" href={doc.url} download={doc.name}><Download size={15} /></IconBtn>}
        {canManage ? <IconBtn label="Renomear / mover" onClick={onEdit}><Pencil size={15} /></IconBtn> : null}
        {canManage ? <IconBtn label="Excluir" danger onClick={onDelete}><Trash2 size={15} /></IconBtn> : null}
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  href,
  download,
  danger,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  download?: string;
  danger?: boolean;
}) {
  const cls = cn(
    'grid h-8 w-8 place-items-center rounded-lg transition',
    danger ? 'text-muted-foreground hover:bg-red-50 hover:text-red-600' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  );
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" download={download} className={cls} title={label} aria-label={label}>{children}</a>;
  return <button type="button" onClick={onClick} className={cls} title={label} aria-label={label}>{children}</button>;
}

function EditDocModal({ doc, classes, onClose, onSaved }: { doc: PlanDoc; classes: ClassRoom[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(doc.name);
  const [segment, setSegment] = useState(doc.segment);
  const [term, setTerm] = useState(doc.term ? String(doc.term) : '');
  const [turma, setTurma] = useState(doc.class_id ?? '');

  const save = useMutation({
    mutationFn: () =>
      updatePlanDoc(doc.id, {
        name: name.trim() || doc.name,
        segment,
        term: term ? Number(term) : null,
        class_id: turma || null,
        turma_label: turma ? classes.find((c) => c.id === turma)?.name ?? null : null,
      }),
    onSuccess: () => {
      onSaved();
      onClose();
      successToast('Arquivo atualizado');
    },
  });

  return (
    <Modal open onClose={onClose} title="Editar arquivo">
      <div className="space-y-3">
        <label className="block"><span className="mb-1 block text-xs font-bold text-muted-foreground">Nome</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block"><span className="mb-1 block text-xs font-bold text-muted-foreground">Segmento</span>
            <Select value={segment} onChange={(e) => setSegment(e.target.value)}>
              {SEGMENTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-muted-foreground">Trimestre</span>
            <Select value={term} onChange={(e) => setTerm(e.target.value)}>
              <option value="">—</option>
              {TERMS.map((t) => <option key={t} value={t}>{t}º</option>)}
            </Select>
          </label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-muted-foreground">Turma</span>
            <Select value={turma} onChange={(e) => setTurma(e.target.value)}>
              <option value="">Todas</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </div>
    </Modal>
  );
}
