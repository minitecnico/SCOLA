import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Phone, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ImportModal } from '../components/ImportModal';
import { successToast } from '../components/Feedback';
import { ActionsMenu, AddButton, Button, Card, CheckBox, EmptyState, Field, Input, Modal, PageHeader, SearchInput, Select, SelectionBar, SelectModeButton, Loading} from '../components/ui';
import { archiveStudent, bulkDeleteStudents, bulkImportAll, importResultToModal, deleteStudent, listClasses, listStudents, saveStudent } from '../lib/queries';
import { CADASTRO_COLUMNS } from '../lib/importSheet';
import type { Student } from '../lib/types';
import { useSelection } from '../lib/useSelection';

export function StudentsPage() {
  const qc = useQueryClient();
  const { data: students = [], isLoading } = useQuery({ queryKey: ['students'], queryFn: listStudents });
  const { data: classes = [] } = useQuery({ queryKey: ['classes'], queryFn: listClasses });
  const [editing, setEditing] = useState<Student | null>(null);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [q, setQ] = useState('');
  const [classFilter, setClassFilter] = useState('all');

  // Atualiza listas dependentes: cadastro, chamada/notas por turma e contadores.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['students'] });
    qc.invalidateQueries({ queryKey: ['students-by-class'] });
    qc.invalidateQueries({ queryKey: ['schools'] });
    qc.invalidateQueries({ queryKey: ['classes'] });
    qc.invalidateQueries({ queryKey: ['counts'] });
  };

  const save = useMutation({
    mutationFn: saveStudent,
    onSuccess: () => {
      refresh();
      setOpen(false);
      successToast(editing ? 'Aluno atualizado com sucesso' : 'Aluno cadastrado com sucesso');
    },
  });
  const remove = useMutation({
    mutationFn: deleteStudent,
    onSuccess: () => {
      refresh();
      successToast('Aluno excluído com sucesso');
    },
  });
  const archive = useMutation({
    mutationFn: archiveStudent,
    onSuccess: () => {
      refresh();
      successToast('Aluno arquivado com sucesso');
    },
  });
  const sel = useSelection();
  const bulkRemove = useMutation({
    mutationFn: () => bulkDeleteStudents([...sel.ids]),
    onSuccess: () => {
      refresh();
      sel.disable();
      successToast('Alunos excluídos com sucesso');
    },
  });

  const className = (id: string | null) => classes.find((c) => c.id === id)?.name ?? 'Sem turma';

  const list = useMemo(
    () =>
      students
        .filter((s) => s.full_name.toLowerCase().includes(q.toLowerCase()))
        .filter((s) =>
          classFilter === 'all' ? true : classFilter === 'none' ? s.class_id === null : s.class_id === classFilter,
        ),
    [students, q, classFilter],
  );

  const orphans = useMemo(() => students.filter((s) => s.class_id === null).length, [students]);
  const allSelected = list.length > 0 && list.every((s) => sel.has(s.id));
  const toggleAll = () => (allSelected ? sel.clear() : sel.setAll(list.map((s) => s.id)));

  function openNew() {
    setEditing(null);
    setOpen(true);
  }
  function openEdit(s: Student) {
    setEditing(s);
    setOpen(true);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const classId = String(f.get('class_id') || '');
    const school_id = classes.find((c) => c.id === classId)?.school_id;
    if (!school_id) return;
    save.mutate({
      id: editing?.id,
      full_name: String(f.get('full_name') || '').trim(),
      class_id: classId,
      school_id,
      registration: String(f.get('registration') || '').trim() || null,
      guardian_name: String(f.get('guardian_name') || '').trim() || null,
      guardian_phone: String(f.get('guardian_phone') || '').trim() || null,
    });
  }

  return (
    <>
      <PageHeader
        title="Alunos"
        subtitle={`${students.length} aluno(s) cadastrado(s).`}
        action={
          <div className="flex flex-wrap gap-2">
            <SelectModeButton active={sel.active} onEnable={sel.enable} onCancel={sel.disable} />
            <Button variant="ghost" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet size={18} /> Importar
            </Button>
            <AddButton onClick={openNew} label="Novo aluno" />
          </div>
        }
      />

      {classes.length === 0 && students.length === 0 ? (
        <EmptyState
          icon={<Users size={26} />}
          title="Cadastre uma turma primeiro"
          hint="Os alunos precisam estar em uma turma."
          action={
            <Link to="/turmas">
              <Button>Cadastrar turma</Button>
            </Link>
          }
        />
      ) : (
        <>
      {orphans > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-800">
          {orphans} aluno(s) sem turma (turma excluída). Mova-os para uma turma (editar) ou exclua.
          <Button variant="ghost" className="ml-auto py-1.5" onClick={() => setClassFilter('none')}>
            Ver sem turma
          </Button>
        </div>
      ) : null}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar aluno…" className="flex-1" />
        <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="sm:w-56">
          <option value="all">Todas as turmas</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          {orphans > 0 ? <option value="none">Sem turma</option> : null}
        </Select>
      </div>

      {isLoading ? (
        <Loading />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Users size={26} />}
          title="Nenhum aluno"
          hint="Cadastre alunos para fazer as chamadas."
          action={<AddButton onClick={openNew} label="Novo aluno" />}
        />
      ) : (
        <div className={`space-y-2 ${sel.active ? 'pb-24' : ''}`}>
          {list.map((s, i) => (
            <Card key={s.id} className="flex items-center justify-between gap-3 p-4">
              {sel.active ? <CheckBox checked={sel.has(s.id)} onChange={() => sel.toggle(s.id)} /> : null}
              <span className="w-6 shrink-0 text-right text-sm font-bold text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <h3 className="break-words text-base font-bold leading-snug text-foreground">{s.full_name}</h3>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-semibold text-emerald-700">{className(s.class_id)}</span>
                  {s.registration ? <span>Mat. {s.registration}</span> : null}
                  {s.guardian_phone ? (
                    <span className="flex items-center gap-1">
                      <Phone size={12} /> {s.guardian_phone}
                    </span>
                  ) : null}
                </p>
              </div>
              <ActionsMenu
                onEdit={() => openEdit(s)}
                onArchive={() => confirm(`Arquivar o aluno "${s.full_name}"? Isso também removerá notas, faltas e avaliações relacionadas.`) && archive.mutate(s.id)}
                onDelete={() => confirm(`Excluir o aluno "${s.full_name}"?`) && remove.mutate(s.id)}
              />
            </Card>
          ))}
        </div>
      )}
        </>
      )}

      <SelectionBar
        active={sel.active}
        count={sel.size}
        allSelected={allSelected}
        onToggleAll={toggleAll}
        onCancel={sel.disable}
        onDelete={() => confirm(`Excluir ${sel.size} aluno(s)?`) && bulkRemove.mutate()}
        busy={bulkRemove.isPending}
      />

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Editar aluno' : 'Novo aluno'}>
        {classes.length === 0 ? (
          <div className="space-y-4 text-center">
            <p className="text-sm font-medium text-muted-foreground">Cadastre uma turma antes de adicionar alunos.</p>
            <Link to="/turmas">
              <Button onClick={() => setOpen(false)}>Cadastrar turma</Button>
            </Link>
          </div>
        ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Nome completo">
            <Input name="full_name" defaultValue={editing?.full_name} required autoFocus placeholder="Nome do aluno" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Turma">
              <Select name="class_id" defaultValue={editing?.class_id ?? classes[0]?.id} required>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Matrícula">
              <Input name="registration" defaultValue={editing?.registration ?? ''} placeholder="Opcional" />
            </Field>
          </div>
          <Field label="Responsável">
            <Input name="guardian_name" defaultValue={editing?.guardian_name ?? ''} placeholder="Nome do responsável" />
          </Field>
          <Field label="Telefone do responsável">
            <Input name="guardian_phone" defaultValue={editing?.guardian_phone ?? ''} placeholder="(00) 00000-0000" />
          </Field>
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
        )}
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
