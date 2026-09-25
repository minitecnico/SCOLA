import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileText, Loader2, Pencil, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { canReviewPlan } from '../lib/permissions';
import { deletePlanDoc, listClasses, listPlanDocs, updatePlanDoc, uploadPlanDoc } from '../lib/queries';
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

  const invalidate = () => qc.invalidateQueries({ queryKey: ['plan-docs'] });
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
      await downloadAllAttachments(filtered.map((d) => ({ name: d.name, url: d.url })), safeFileName(segLabel) || 'arquivos');
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
  onEdit,
  onDelete,
}: {
  doc: PlanDoc;
  canManage: boolean;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isImg = !!doc.mime?.startsWith('image/');
  const canPrev = !!doc.url && (isImg || doc.mime === 'application/pdf');
  const ext = (doc.name.split('.').pop() || 'arq').toUpperCase().slice(0, 4);
  const openExternal = () => doc.url && window.open(doc.url, '_blank', 'noopener');

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 transition hover:bg-muted sm:px-4">
      <button
        onClick={canPrev ? onPreview : openExternal}
        className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground"
        aria-label="Abrir"
      >
        {isImg && doc.url ? <img src={doc.url} alt={doc.name} className="h-full w-full object-cover" /> : <span className="text-[9px] font-black text-muted-foreground">{ext}</span>}
      </button>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-foreground" title={doc.name}>{doc.name}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
          {doc.turma_label ? <span className="font-bold text-muted-foreground">{doc.turma_label}</span> : null}
          {doc.turma_label ? <span>·</span> : null}
          <span>{fmtDate(doc.created_at)}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <IconBtn label="Visualizar" onClick={canPrev ? onPreview : openExternal}><Eye size={15} /></IconBtn>
        <IconBtn label="Baixar" href={doc.url} download={doc.name}><Download size={15} /></IconBtn>
        {canManage ? <IconBtn label="Editar" onClick={onEdit}><Pencil size={15} /></IconBtn> : null}
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
