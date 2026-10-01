import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, Eye, FilePen, FileSpreadsheet, FileText, Loader2, Lock, Pencil, Presentation, Plus, Search, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { canReviewPlan } from '../lib/permissions';
import { createEditableDoc, createGoogleDoc, deletePlanDoc, disconnectGoogle, getGoogleStatus, googleLink, listClasses, listPlanDocs, updatePlanDoc, uploadPlanDoc, type EditableKind, type GoogleKind } from '../lib/queries';
import { downloadAllAttachments, safeFileName, translateStorageError } from '../lib/storage';
import type { ClassRoom, PlanDoc } from '../lib/types';
import { Button, Modal, Select } from './ui';
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

      <FileCenter segKey={seg} docs={docs.filter((d) => d.segment === seg)} classes={classes} loading={isLoading} />
    </div>
  );
}

function FileCenter({ segKey, docs, classes, loading }: { segKey: string; docs: PlanDoc[]; classes: ClassRoom[]; loading: boolean }) {
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
  const { data: google } = useQuery({ queryKey: ['google-status'], queryFn: getGoogleStatus, retry: false });
  const createG = useMutation({
    mutationFn: ({ gkind }: { gkind: GoogleKind; win: Window | null }) =>
      createGoogleDoc({ gkind, segment: segKey, term: term ? Number(term) : null, class_id: turma || null, turma_label: turmaName }),
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
  const create = useMutation({
    mutationFn: (kind: EditableKind) =>
      createEditableDoc({ kind, segment: segKey, term: term ? Number(term) : null, class_id: turma || null, turma_label: turmaName }),
    onSuccess: (r) => {
      invalidate();
      navigate(`/planejamento/editor/${r.id}`);
    },
    onError: (e) => alert((e as Error).message),
  });
  const segLabel = SEGMENTS.find((s) => s.key === segKey)?.label ?? '';
  const turmaName = turma ? classes.find((c) => c.id === turma)?.name ?? null : null;

  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadPlanDoc({ segment: segKey, term: term ? Number(term) : null, classId: turma || null, turmaLabel: turmaName, file }),
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
        (!term || d.term === Number(term)) &&
        (!turma || d.class_id === turma) &&
        (!needle || d.name.toLowerCase().includes(needle)),
    );
  }, [docs, term, turma, q]);

  // Agrupa por trimestre quando sem filtro/busca; senão lista plana.
  const grouped = useMemo(() => {
    if (term || q.trim()) return null;
    const order: (number | null)[] = [1, 2, 3, null];
    return order
      .map((t) => ({ term: t, items: filtered.filter((d) => (d.term ?? null) === t) }))
      .filter((g) => g.items.length > 0);
  }, [filtered, term, q]);

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
  const destino = [segLabel, term ? `${term}º tri` : 'sem trimestre', turmaName].filter(Boolean).join(' · ');

  const row = (d: PlanDoc) => (
    <FileRow
      key={d.id}
      doc={d}
      canManage={canManage(d)}
      onPreview={() => setPreview(d)}
      onOpenEditor={editableKind(d) ? () => navigate(`/planejamento/editor/${d.id}`) : undefined}
      lockedByOther={!!d.lock_by && d.lock_by !== userId}
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

      {/* Criar no próprio SCOLA (tipo Docs/Sheets) */}
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <button
          onClick={() => create.mutate('doc')}
          disabled={create.isPending}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold transition hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-blue-600 text-white"><FileText size={15} /></span>
          <Plus size={14} className="-ml-1" /> Novo documento
        </button>
        <button
          onClick={() => create.mutate('sheet')}
          disabled={create.isPending}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold transition hover:border-green-300 hover:bg-green-50 disabled:opacity-50"
        >
          <span className="grid h-7 w-7 place-items-center rounded-md bg-green-600 text-white"><FileSpreadsheet size={15} /></span>
          <Plus size={14} className="-ml-1" /> Nova planilha
        </button>
        <p className="col-span-2 self-center text-xs text-muted-foreground sm:ml-2">Edite direto no SCOLA, como no Docs e no Sheets. Word e Excel enviados também abrem aqui.</p>
      </div>

      {/* Google Docs / Sheets / Slides (conta de cada usuário) */}
      {google?.available ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
          {google.connected ? (
            <>
              {([['document', 'Google Docs', FileText, 'bg-blue-500'], ['spreadsheet', 'Google Sheets', FileSpreadsheet, 'bg-green-500'], ['presentation', 'Google Slides', Presentation, 'bg-yellow-500']] as const).map(([k, label, Icon, color]) => (
                <button
                  key={k}
                  onClick={() => newGoogle(k)}
                  disabled={createG.isPending}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold transition hover:bg-muted disabled:opacity-50"
                >
                  <span className={cn('grid h-6 w-6 place-items-center rounded-md text-white', color)}><Icon size={13} /></span>
                  <Plus size={13} className="-ml-1" /> {label}
                </button>
              ))}
              <span className="text-xs text-muted-foreground sm:ml-2">
                Conectado como <b>{google.email || 'sua conta'}</b> ·{' '}
                <button onClick={() => confirm('Desconectar sua conta do Google? Os arquivos continuam no seu Drive.') && unlink.mutate()} className="font-bold underline">desconectar</button>
              </span>
            </>
          ) : (
            <>
              <a href="/api/google/connect" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white hover:bg-slate-800">
                <ExternalLink size={14} /> Conectar Google
              </a>
              <span className="text-xs text-muted-foreground">
                {gParam === 'negado' ? 'Conexão cancelada. ' : gParam === 'erro' ? 'Não deu certo, tente de novo. ' : ''}
                Crie Docs, Sheets e Slides no seu Google Drive direto daqui. O SCOLA só acessa o que ele mesmo criar.
              </span>
            </>
          )}
        </div>
      ) : null}

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

      {preview?.url ? <PreviewModal name={preview.name} url={preview.url} mime={preview.mime} onClose={() => setPreview(null)} /> : null}
      {editing ? <EditDocModal doc={editing} classes={classes} onClose={() => setEditing(null)} onSaved={invalidate} /> : null}
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
}: {
  doc: PlanDoc;
  canManage: boolean;
  onPreview: () => void;
  onOpenEditor?: () => void;
  lockedByOther?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isImg = !!doc.mime?.startsWith('image/');
  const canPrev = !!doc.url && (isImg || doc.mime === 'application/pdf');
  const ext = (doc.name.split('.').pop() || 'arq').toUpperCase().slice(0, 4);
  const gLink = doc.kind === 'google' && doc.google_id && doc.google_kind ? googleLink(doc.google_kind, doc.google_id) : null;
  const openExternal = () => (gLink ?? doc.url) && window.open(gLink ?? doc.url, '_blank', 'noopener');
  const ek = editableKind(doc);
  const open = gLink ? openExternal : onOpenEditor ?? (canPrev ? onPreview : openExternal);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-muted sm:px-4">
      <button
        onClick={open}
        className={cn(
          'grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg',
          ek === 'doc' || doc.google_kind === 'document' ? 'bg-blue-600 text-white' : ek === 'sheet' || doc.google_kind === 'spreadsheet' ? 'bg-green-600 text-white' : doc.google_kind === 'presentation' ? 'bg-yellow-500 text-white' : 'bg-muted text-muted-foreground',
        )}
        aria-label="Abrir"
      >
        {isImg && doc.url ? (
          <img src={doc.url} alt={doc.name} className="h-full w-full object-cover" />
        ) : doc.google_kind === 'presentation' ? (
          <Presentation size={18} />
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
