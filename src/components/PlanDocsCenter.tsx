import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ArrowLeft, Sparkles, Download, ExternalLink, Eye, Folder, FolderInput, FolderPlus, FilePen, FileSpreadsheet, FileText, Loader2, Lock, Mail, Pencil, Presentation, ClipboardList, Search, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useMemo, useState } from 'react';

import { useAuth } from '../auth/AuthProvider';

import { canReviewPlan } from '../lib/permissions';

import { createClassFolders, createGoogleDoc, createPlanFolder, deletePlanDoc, deletePlanFolder, listPlanFolders, movePlanDocs, renamePlanFolder, disconnectGoogle, getGoogleStatus, googleLink, listPlanDocs, updatePlanDoc, uploadPlanDoc, type EditableKind, type GoogleKind } from '../lib/queries';
import { downloadAllAttachments, safeFileName, translateStorageError } from '../lib/storage';

import type { ClassRoom, PlanDoc, PlanFolder } from '../lib/types';

import { Button, Modal, Select } from './ui';

import { SendMailModal } from './SendMailModal';

import { useSelection } from '../lib/useSelection';

import { GoogleMenus } from './GoogleHub';

import { Dropzone } from './Dropzone';

import { PreviewModal } from './Attachments';

import { successToast, askConfirm } from './Feedback';

import { cn } from '../lib/cn';

import { useClasses } from '../lib/hooks';


/** Segmentos da escola — fácil de estender (basta adicionar aqui). */
export const SEGMENTS: { key: string; label: string; color: string }[] = [
  { key: 'fund1', label: 'Fundamental I', color: '#171717' },
  { key: 'fund2', label: 'Fundamental II', color: '#171717' },
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

const COLS = 'grid grid-cols-[auto_minmax(0,1fr)_auto] md:grid-cols-[auto_minmax(0,1fr)_5.5rem_8rem_9.5rem_13.5rem]';
const fmtSize = (n?: number | null) => (!n ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} kB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`);
/** "Hoje, 11:44", "Ontem", "Há 3 dias", "Há 2 semanas", "Há 4 meses" — como no gerenciador de arquivos. */
function fmtRel(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days <= 0) return `Hoje, ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 1) return 'Ontem';
  if (days < 7) return `Há ${days} dias`;
  if (days < 30) { const w = Math.floor(days / 7); return `Há ${w} ${w === 1 ? 'semana' : 'semanas'}`; }
  if (days < 365) { const m = Math.floor(days / 30); return `Há ${m} ${m === 1 ? 'mês' : 'meses'}`; }
  return fmtDate(iso);
}
const G_TYPE: Record<string, string> = { document: 'Google Docs', spreadsheet: 'Google Sheets', presentation: 'Google Slides', form: 'Google Forms' };
function typeLabel(d: PlanDoc) {
  if (d.kind === 'google') return G_TYPE[d.google_kind ?? ''] ?? 'Google';
  const ext = (d.name.split('.').pop() || '').toLowerCase();
  if (d.mime?.startsWith('image/')) return 'Imagem';
  if (ext === 'pdf') return 'PDF';
  if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(ext)) return 'Documento';
  if (['xls', 'xlsx', 'xlsm', 'ods', 'csv', 'tsv'].includes(ext)) return 'Planilha';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'Apresentação';
  return ext ? ext.toUpperCase() : 'Arquivo';
}
type SortKey = 'name' | 'size' | 'date';

export function PlanDocsCenter() {
  const { data: docs = [], isLoading, isError, error } = useQuery({ queryKey: ['plan-docs'], queryFn: listPlanDocs, retry: false });
  const { data: classes = [] } = useClasses();
  const { data: folders = [] } = useQuery({ queryKey: ['plan-folders'], queryFn: listPlanFolders, retry: false });

  const [seg, setSeg] = useState(SEGMENTS[0].key);

  const countBySeg = (key: string) => docs.filter((d) => d.segment === key).length;

  return (
    <div className="space-y-4">
      {isError ? (
        <p className="rounded-xl bg-neutral-100 p-3 text-sm font-bold text-neutral-800">
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
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const toggleSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'name' ? 1 : -1 }));
  const children = folders
    .filter((f) => (f.parent_id ?? null) === folderId)
    .sort((a, b) => (sort.key === 'date' ? (a.created_at ?? '').localeCompare(b.created_at ?? '') * sort.dir : a.name.localeCompare(b.name, 'pt-BR') * (sort.key === 'name' ? sort.dir : 1)));
  // Caminho da raiz até a pasta (para o "Pastas / A / B") e rótulos "A / B" no seletor de mover.
  const pathOf = (id: string | null): PlanFolder[] => {
    const out: PlanFolder[] = [];
    for (let cur = id ? folders.find((f) => f.id === id) : undefined; cur && out.length < 8; cur = cur.parent_id ? folders.find((f) => f.id === cur!.parent_id) : undefined) out.unshift(cur);
    return out;
  };
  const labelOfFolder = (id: string) => pathOf(id).map((f) => f.name).join(' / ');
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
  const sortedFiles = useMemo(() => {
    const f = [...filtered];
    const by = (d: PlanDoc) => (sort.key === 'size' ? d.size ?? 0 : sort.key === 'date' ? Date.parse(d.updated_at ?? d.created_at) : 0);
    return f.sort((a, b) => (sort.key === 'name' ? a.name.localeCompare(b.name, 'pt-BR', { numeric: true }) * sort.dir : (by(a) - by(b)) * sort.dir));
  }, [filtered, sort]);

  const grouped = useMemo(() => {
    if (term || q.trim()) return null;
    const order: (number | null)[] = [1, 2, 3, null];
    return order
      .map((t) => ({ term: t, items: filtered.filter((d) => (d.term ?? null) === t) }))
      .filter((g) => g.items.length > 0);
  }, [filtered, term, q]);

  const [newFolder, setNewFolder] = useState(false);
  const countIn = (id: string | null) => docs.filter((d) => (d.folder_id ?? null) === id).length;
  const subCount = (id: string) => folders.filter((f) => f.parent_id === id).length;
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
    mutationFn: ({ id, name }: { id: string; name: string }) => renamePlanFolder(id, name),
    onSuccess: refreshFolders,
    onError: (e) => alert((e as Error).message),
  });
  const removeFolder = useMutation({
    mutationFn: (id: string) => deletePlanFolder(id),
    onSuccess: (_r, id) => {
      if (folderId === id) setFolderId(folder?.parent_id ?? null);
      refreshFolders();
      invalidate();
      successToast('Pasta excluída. O conteúdo subiu um nível.');
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
      onDelete={() => askConfirm(`Excluir "${d.name}"?\n\n⚠️ Ação irreversível: remove o arquivo do banco e do armazenamento.`).then((ok) => ok && remove.mutate(d))}
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
          <button onClick={() => setNewFolder(true)} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-bold transition hover:bg-muted">
            <FolderPlus size={15} /> {folder ? 'Nova subpasta' : 'Nova pasta'}
          </button>
          <button
            onClick={() => navigate(`/ia?escola=1${sel.ids.size ? `&docs=${[...sel.ids].join(',')}` : ''}`)}
            title="Perguntar à IA sobre os documentos (os selecionados, se houver)"
            className="inline-flex items-center gap-2 rounded-xl border border-neutral-300 bg-neutral-100 px-3 py-2 text-sm font-bold text-neutral-800 transition hover:bg-neutral-200"
          >
            <Sparkles size={15} /> Perguntar à IA
          </button>
          <GoogleMenus
            available={!!google?.available}
            connected={!!google?.connected}
            email={google?.email ?? null}
            busy={createG.isPending}
            message={gParam === 'escopo' ? 'Faltou marcar a permissão do Drive na tela do Google; conecte de novo com todas as caixas marcadas.' : gParam === 'negado' ? 'Conexão cancelada.' : gParam === 'erro' ? 'Não deu certo, tente de novo.' : undefined}
            onCreate={newGoogle}
            onDisconnect={() => askConfirm('Desconectar sua conta do Google? Os arquivos continuam no seu Drive.').then((ok) => ok && unlink.mutate())}
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
          <button onClick={() => setMailDocs(docs.filter((d) => sel.has(d.id)))} className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-black text-neutral-900">
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
            {[...folders].filter((f) => f.id !== folderId).sort((a, b) => labelOfFolder(a.id).localeCompare(labelOfFolder(b.id), 'pt-BR')).map((f) => <option key={f.id} value={f.id} className="text-slate-900">{labelOfFolder(f.id)}</option>)}
          </select>
          <button onClick={() => sel.setAll(filtered.map((d) => d.id))} className="text-xs font-bold underline">Selecionar todos ({filtered.length})</button>
          <button onClick={sel.clear} className="ml-auto text-xs font-bold underline">Limpar</button>
        </div>
      ) : null}

      {/* Pastas e subpastas */}
      {folder ? (
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-sm">
          <button onClick={() => { setFolderId(null); sel.clear(); }} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-bold text-muted-foreground hover:bg-muted">
            <ArrowLeft size={15} /> Pastas
          </button>
          {pathOf(folder.id).map((f, i, arr) => (
            <span key={f.id} className="flex min-w-0 items-center gap-1">
              <span className="text-muted-foreground">/</span>
              {i === arr.length - 1 ? (
                <span className="flex min-w-0 items-center gap-1.5 font-black"><Folder size={16} className="shrink-0 text-neutral-500" /><span className="truncate">{f.name}</span></span>
              ) : (
                <button onClick={() => { setFolderId(f.id); sel.clear(); }} className="max-w-[10rem] truncate rounded-lg px-1.5 py-1 font-bold text-muted-foreground hover:bg-muted">{f.name}</button>
              )}
            </span>
          ))}
          {canManageFolder ? (
            <span className="ml-auto flex gap-1">
              <IconBtn label="Renomear pasta" onClick={() => { const n = prompt('Novo nome da pasta:', folder.name); if (n && n.trim()) renameFolder.mutate({ id: folder.id, name: n }); }}><Pencil size={15} /></IconBtn>
              <IconBtn label="Excluir pasta" danger onClick={() => askConfirm(`Excluir a pasta "${folder.name}"?\n\nNada é apagado: subpastas e arquivos sobem um nível.`).then((ok) => ok && removeFolder.mutate(folder.id))}><Trash2 size={15} /></IconBtn>
            </span>
          ) : null}
        </div>
      ) : null}
      {/* Dropzone slim — destino atual derivado dos filtros acima */}
      <Dropzone
        compact
        onFiles={handleFiles}
        title={upload.isPending ? 'Enviando…' : `Arraste ou clique para enviar — ${destino}`}
      />

      {/* Lista no estilo gerenciador de arquivos: pastas primeiro, depois arquivos */}
      {loading ? (
        <p className="py-10 text-center text-sm font-bold text-muted-foreground">Carregando…</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
          <div className={cn(COLS, 'hidden items-center gap-3 border-b border-border px-4 py-2 text-[11px] font-black uppercase tracking-wide text-muted-foreground md:grid')}>
            <span className="w-4" />
            <SortHead label="Nome" k="name" sort={sort} onSort={toggleSort} />
            <SortHead label="Tamanho" k="size" sort={sort} onSort={toggleSort} />
            <span>Tipo</span>
            <SortHead label="Modificado" k="date" sort={sort} onSort={toggleSort} />
            <span />
          </div>
          <div className="divide-y divide-border">
            {children.map((f) => (
              <FolderRow
                key={f.id}
                folder={f}
                items={countIn(f.id) + subCount(f.id)}
                canManage={f.author_id === userId || canReview}
                onOpen={() => { setFolderId(f.id); sel.clear(); }}
                onRename={() => { const n = prompt('Novo nome da pasta:', f.name); if (n && n.trim()) renameFolder.mutate({ id: f.id, name: n }); }}
                onDelete={() => askConfirm(`Excluir a pasta "${f.name}"?\n\nNada é apagado: subpastas e arquivos sobem um nível.`).then((ok) => ok && removeFolder.mutate(f.id))}
              />
            ))}
            {sortedFiles.map(row)}
          </div>
          {children.length === 0 && sortedFiles.length === 0 ? (
            <div className="py-12 text-center">
              <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground"><Folder size={22} /></div>
              <p className="text-sm font-bold text-muted-foreground">{term || turma || q ? 'Nada com esse filtro' : folder ? 'Pasta vazia' : 'Nenhum arquivo ainda'}</p>
              <p className="mt-1 text-xs text-muted-foreground">Arraste arquivos para a área acima ou crie uma pasta.</p>
            </div>
          ) : null}
        </div>
      )}

      {newFolder ? <NewFolderModal segment={segKey} parentId={folderId} classes={classes} folders={folders} onClose={() => setNewFolder(false)} onDone={(id) => { refreshFolders(); if (id) setFolderId(id); }} /> : null}
      {mailDocs ? <SendMailModal docs={mailDocs} google={google} onClose={() => setMailDocs(null)} onSent={sel.clear} /> : null}
      {preview?.url ? <PreviewModal name={preview.name} url={preview.url} mime={preview.mime} onClose={() => setPreview(null)} /> : null}
      {editing ? <EditDocModal doc={editing} classes={classes} onClose={() => setEditing(null)} onSaved={invalidate} /> : null}
    </div>
  );
}

function NewFolderModal({ segment, parentId, classes, folders, onClose, onDone }: { segment: string; parentId: string | null; classes: ClassRoom[]; folders: PlanFolder[]; onClose: () => void; onDone: (openId?: string) => void }) {
  const [name, setName] = useState('');
  const [turma, setTurma] = useState('');
  const missing = classes.filter((c) => !c.archived_at && !folders.some((f) => f.class_id === c.id && !f.parent_id));
  const create = useMutation({
    mutationFn: () => createPlanFolder({ name: name.trim() || classes.find((c) => c.id === turma)?.name || '', segment, class_id: turma || null, parent_id: parentId }),
    onSuccess: (r) => { onDone(r.id); onClose(); },
    onError: (e) => alert((e as Error).message),
  });
  const all = useMutation({
    mutationFn: () => createClassFolders(segment),
    onSuccess: (r) => { onDone(); onClose(); successToast(r.created ? `${r.created} pasta${r.created > 1 ? 's' : ''} criada${r.created > 1 ? 's' : ''}` : 'As turmas já têm pasta'); },
    onError: (e) => alert((e as Error).message),
  });
  return (
    <Modal open onClose={onClose} title={parentId ? "Nova subpasta" : "Nova pasta"}>
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
          <Button onClick={() => create.mutate()} disabled={create.isPending || (!name.trim() && !turma)}>{create.isPending ? 'Criando…' : 'Criar'}</Button>
        </div>
        {missing.length > 0 && !parentId ? (
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

function SortHead({ label, k, sort, onSort }: { label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void }) {
  return (
    <button onClick={() => onSort(k)} className="inline-flex items-center gap-1 text-left uppercase hover:text-foreground">
      {label} {sort.key === k ? <span aria-hidden>{sort.dir === 1 ? '▲' : '▼'}</span> : null}
    </button>
  );
}

function FolderRow({ folder, items, canManage, onOpen, onRename, onDelete }: { folder: PlanFolder; items: number; canManage: boolean; onOpen: () => void; onRename: () => void; onDelete: () => void }) {
  return (
    <div className={cn(COLS, 'items-center gap-3 px-3 py-2 transition hover:bg-neutral-100 sm:px-4')}>
      <span className="w-4" />
      <button onClick={onOpen} className="flex min-w-0 items-center gap-3 text-left">
        <span className="grid h-10 w-10 shrink-0 place-items-center"><Folder size={26} className="fill-neutral-200 text-neutral-500" /></span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold">{folder.name}</span>
          <span className="text-[11px] text-muted-foreground md:hidden">{items} {items === 1 ? 'item' : 'itens'}</span>
        </span>
      </button>
      <span className="hidden text-xs text-muted-foreground md:block">{items} {items === 1 ? 'item' : 'itens'}</span>
      <span className="hidden text-xs text-muted-foreground md:block">Pasta</span>
      <span className="hidden text-xs text-muted-foreground md:block">{fmtRel(folder.created_at)}</span>
      <div className="flex justify-end gap-0.5">
        {canManage ? <IconBtn label="Renomear pasta" onClick={onRename}><Pencil size={15} /></IconBtn> : null}
        {canManage ? <IconBtn label="Excluir pasta" danger onClick={onDelete}><Trash2 size={15} /></IconBtn> : null}
      </div>
    </div>
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
    <div className={cn(COLS, 'items-center gap-3 px-3 py-2 transition hover:bg-muted sm:px-4', selected && 'bg-neutral-100')}>
      <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Selecionar ${doc.name}`} className="h-4 w-4 shrink-0 accent-slate-900" />
      <div className="flex min-w-0 items-center gap-3">
      <button
        onClick={open}
        className={cn(
          'grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg',
          ek === 'doc' || doc.google_kind === 'document' ? 'bg-neutral-900 text-white' : ek === 'sheet' || doc.google_kind === 'spreadsheet' ? 'bg-neutral-900 text-white' : doc.google_kind === 'presentation' ? 'bg-neutral-900 text-white' : doc.google_kind === 'form' ? 'bg-neutral-900 text-white' : 'bg-muted text-muted-foreground',
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

      <div className="min-w-0">
        <button onClick={open} className="block max-w-full truncate text-left text-sm font-bold text-foreground hover:underline" title={doc.name}>{doc.name}</button>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
          {doc.turma_label ? <span className="font-bold text-muted-foreground">{doc.turma_label}</span> : null}
          {doc.turma_label ? <span>·</span> : null}
          {doc.term ? <><span>{doc.term}º tri</span><span>·</span></> : null}
          <span className="md:hidden">{typeLabel(doc)} · {fmtSize(doc.size)} · {fmtRel(doc.updated_at ?? doc.created_at)}</span>
          {lockedByOther ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-1.5 py-0.5 font-semibold text-neutral-800">
              <Lock size={10} /> em edição
            </span>
          ) : null}
        </div>
      </div>

      </div>

      <span className="hidden text-xs text-muted-foreground md:block">{fmtSize(doc.size)}</span>
      <span className="hidden truncate text-xs text-muted-foreground md:block">{typeLabel(doc)}</span>
      <span className="hidden truncate text-xs text-muted-foreground md:block">{fmtRel(doc.updated_at ?? doc.created_at)}</span>

      <div className="flex shrink-0 items-center justify-end gap-0.5">
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
