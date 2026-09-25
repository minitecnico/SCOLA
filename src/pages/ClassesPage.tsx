import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, FileSpreadsheet, GraduationCap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { canManageOrg } from '../lib/permissions';
import { useState } from 'react';
import { ImportModal } from '../components/ImportModal';
import { successToast } from '../components/Feedback';
import { ActionsMenu, AddButton, Button, Card, CheckBox, EmptyState, Field, Input, Modal, PageHeader, Select, SelectionBar, SelectModeButton, Loading} from '../components/ui';
import { bulkDeleteClasses, bulkImportAll, importResultToModal, deleteClass, listClasses, saveClass } from '../lib/queries';
import { useSelection } from '../lib/useSelection';
import { CADASTRO_COLUMNS } from '../lib/importSheet';
import { SHIFTS, type ClassRoom } from '../lib/types';

export function ClassesPage() {
  const qc = useQueryClient();
  const { data: classes = [], isLoading } = useQuery({ queryKey: ['classes'], queryFn: listClasses });
  const manager = canManageOrg(useAuth().role);
  const [editing, setEditing] = useState<ClassRoom | null>(null);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['classes'] });
    qc.invalidateQueries({ queryKey: ['students'] });
    qc.invalidateQueries({ queryKey: ['students-by-class'] });
    qc.invalidateQueries({ queryKey: ['recent-sessions'] });
    qc.invalidateQueries({ queryKey: ['counts'] });
  };

  const save = useMutation({
    mutationFn: saveClass,
    onSuccess: () => {
      refresh();
      setOpen(false);
      successToast(editing ? 'Turma atualizada com sucesso' : 'Turma cadastrada com sucesso');
    },
  });
  const remove = useMutation({
    mutationFn: deleteClass,
    onSuccess: () => {
      refresh();
      successToast('Turma excluída com sucesso');
    },
  });
  const sel = useSelection();
  const bulkRemove = useMutation({
    mutationFn: () => bulkDeleteClasses([...sel.ids]),
    onSuccess: () => {
      refresh();
      sel.disable();
      successToast('Turmas excluídas com sucesso');
    },
  });
  const allSelected = classes.length > 0 && classes.every((c) => sel.has(c.id));
  const toggleAll = () => (allSelected ? sel.clear() : sel.setAll(classes.map((c) => c.id)));

  function openNew() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(c: ClassRoom) {
    setEditing(c);
    setOpen(true);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    save.mutate({
      id: editing?.id,
      name: String(f.get('name') || '').trim(),
      shift: String(f.get('shift') || 'Manhã'),
      year: f.get('year') ? Number(f.get('year')) : null,
      does_exams: f.get('does_exams') === 'on',
    });
  }

  return (
    <>
      <PageHeader
        title="Turmas"
        subtitle="Turmas da escola, com turno e ano letivo."
        action={
          <div className="flex flex-wrap gap-2">
            {manager ? (
              <Link to="/ano-letivo" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold ring-1 ring-inset ring-border hover:bg-muted">
                <Archive size={17} /> Ano letivo
              </Link>
            ) : null}
            <SelectModeButton active={sel.active} onEnable={sel.enable} onCancel={sel.disable} />
            <Button variant="ghost" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet size={18} /> Importar
            </Button>
            <AddButton onClick={openNew} label="Nova turma" />
          </div>
        }
      />

      {isLoading ? (
        <Loading />
      ) : classes.length === 0 ? (
        <EmptyState
          icon={<GraduationCap size={26} />}
          title="Nenhuma turma"
          hint="Crie a primeira turma para organizar os alunos."
          action={<AddButton onClick={openNew} label="Nova turma" />}
        />
      ) : (
        <>
          <div className={`grid gap-3 sm:grid-cols-2 ${sel.active ? 'pb-24' : ''}`}>
          {classes.map((c) => (
            <Card key={c.id} className="flex items-start gap-3">
              {sel.active ? <CheckBox checked={sel.has(c.id)} onChange={() => sel.toggle(c.id)} /> : null}
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-black text-foreground">{c.name}</h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">{c.shift}</span>
                  {c.year ? <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-muted-foreground">{c.year}</span> : null}
                  {c.does_exams === false ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">Sem prova</span> : null}
                </div>
              </div>
              <ActionsMenu
                onEdit={() => openEdit(c)}
                onDelete={() => confirm(`Excluir a turma "${c.name}"? Os alunos não são excluídos, ficam sem turma.`) && remove.mutate(c.id)}
              />
            </Card>
          ))}
          </div>
        </>
      )}

      <SelectionBar
        active={sel.active}
        count={sel.size}
        allSelected={allSelected}
        onToggleAll={toggleAll}
        onCancel={sel.disable}
        onDelete={() => confirm(`Excluir ${sel.size} turma(s)? Os alunos não são excluídos, ficam sem turma.`) && bulkRemove.mutate()}
        busy={bulkRemove.isPending}
      />

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar turma' : 'Nova turma'}>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Nome da turma">
            <Input name="name" defaultValue={editing?.name} required autoFocus placeholder="Ex.: 5º ano A" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Turno">
              <Select name="shift" defaultValue={editing?.shift ?? 'Manhã'}>
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ano letivo">
              <Input name="year" type="number" defaultValue={editing?.year ?? new Date().getFullYear()} />
            </Field>
          </div>
          <label className="flex items-center gap-3 rounded-xl border border-border bg-muted px-4 py-3">
            <input
              type="checkbox"
              name="does_exams"
              defaultChecked={editing ? editing.does_exams !== false : true}
              className="h-5 w-5 rounded border-border text-emerald-600 focus:ring-emerald-500"
            />
            <span>
              <span className="block text-sm font-bold text-foreground">Esta turma faz provas</span>
              <span className="block text-xs text-muted-foreground">Desmarque para turmas mais novas (ex.: Fund. 1). Só turmas que fazem prova aparecem no Modo prova da chamada.</span>
            </span>
          </label>
          {save.isError ? <p className="text-sm font-semibold text-red-600">{(save.error as Error).message}</p> : null}
          <div className="mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </form>
      </Modal>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Importar cadastros"
        columns={CADASTRO_COLUMNS}
        templateFileName="modelo-cadastro.xlsx"
        importFn={(rows) => bulkImportAll(rows).then(importResultToModal)}
        onDone={refresh}
      />
    </>
  );
}
