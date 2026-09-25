import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarCheck, LogIn, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2, Users, UserCog } from 'lucide-react';
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { successToast } from '../../components/Feedback';
import { CredentialsModal, TeamManager, type Credentials } from '../../components/TeamManager';
import { Button, EmptyState, Field, Input, Loading, Modal, PageHeader, SearchInput, Segmented, Select, StatCard } from '../../components/ui';
import { cn } from '../../lib/cn';
import { createBase, deleteOrganization, hqStats, listOrgAdmin, setOrgActive, updateOrganization, type OrgAdmin } from '../../lib/queries';

const PLANS = [
  { value: 'teste', label: 'Teste' },
  { value: 'ativo', label: 'Ativo' },
];
const fmt = (s: string | null) => (s ? new Date(s.length === 10 ? `${s}T12:00:00` : s).toLocaleDateString('pt-BR') : '—');

export function AdminPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { switchOrg } = useAuth();
  const { data: bases = [], isLoading } = useQuery({ queryKey: ['admin-bases'], queryFn: listOrgAdmin });
  const { data: stats } = useQuery({ queryKey: ['admin-stats'], queryFn: hqStats });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'todas' | 'ativas' | 'suspensas'>('todas');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<OrgAdmin | null>(null);
  const [team, setTeam] = useState<OrgAdmin | null>(null);
  const [creds, setCreds] = useState<Credentials | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-bases'] });
    qc.invalidateQueries({ queryKey: ['admin-stats'] });
  };
  const toggle = useMutation({
    mutationFn: (b: OrgAdmin) => setOrgActive(b.id, !b.active),
    onSuccess: (_r, b) => { refresh(); successToast(b.active ? 'Base suspensa' : 'Base reativada'); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteOrganization(id),
    onSuccess: () => { refresh(); successToast('Base excluída'); },
  });

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return bases.filter(
      (b) =>
        (filter === 'todas' || (filter === 'ativas' ? b.active : !b.active)) &&
        (!term || b.name.toLowerCase().includes(term) || (b.city ?? '').toLowerCase().includes(term)),
    );
  }, [bases, q, filter]);

  async function enter(b: OrgAdmin) {
    await switchOrg(b.id);
    navigate('/');
  }

  function askDelete(b: OrgAdmin) {
    const typed = prompt(
      `EXCLUIR "${b.name}" apaga DEFINITIVAMENTE turmas, alunos, chamadas, notas, avisos, planejamentos e acessos desta base.\n\nPara confirmar, digite o nome da base:`,
    );
    if (typed == null) return;
    if (typed.trim() !== b.name.trim()) return alert('Nome não confere. Nada foi excluído.');
    remove.mutate(b.id);
  }

  return (
    <>
      <PageHeader
        title="Painel do administrador"
        subtitle="Suas bases (escolas e professores), planos e acessos."
        back={false}
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} /> Nova base
          </Button>
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={<Building2 size={18} />} value={stats?.bases_active ?? '—'} label="Bases ativas" sub={stats ? `${stats.bases} no total` : undefined} />
        <StatCard icon={<Users size={18} />} value={stats?.students ?? '—'} label="Alunos ativos" />
        <StatCard icon={<UserCog size={18} />} value={stats?.users ?? '—'} label="Usuários" />
        <StatCard icon={<CalendarCheck size={18} />} value={stats?.sessions_30d ?? '—'} label="Chamadas (30 dias)" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar base ou cidade…" className="min-w-[14rem] flex-1" />
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as typeof filter)}
          options={[
            { value: 'todas', label: 'Todas' },
            { value: 'ativas', label: 'Ativas' },
            { value: 'suspensas', label: 'Suspensas' },
          ]}
        />
      </div>

      {isLoading ? (
        <Loading />
      ) : bases.length === 0 ? (
        <EmptyState
          icon={<Building2 size={24} />}
          title="Nenhuma base ainda"
          hint="Crie a primeira base: você informa a escola (ou o professor) e o gestor responsável recebe um acesso."
          action={<Button onClick={() => setCreating(true)}><Plus size={16} /> Nova base</Button>}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))_auto] gap-4 border-b border-border bg-muted/60 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground md:grid">
            <span>Base</span>
            <span>Alunos</span>
            <span>Equipe</span>
            <span>Última chamada</span>
            <span>Último acesso</span>
            <span className="w-[8.5rem]" />
          </div>
          {list.map((b) => (
            <div
              key={b.id}
              className={cn(
                'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-border px-5 py-4 last:border-0 md:grid-cols-[minmax(0,2.2fr)_repeat(4,minmax(0,1fr))_auto]',
                !b.active && 'bg-neutral-50',
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold">{b.name}</p>
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                      !b.active ? 'bg-neutral-200 text-neutral-600' : b.plan === 'teste' ? 'bg-brand/25 text-neutral-900' : 'bg-neutral-900 text-brand',
                    )}
                  >
                    {!b.active ? 'Suspensa' : b.plan === 'teste' ? 'Teste' : 'Ativa'}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[b.city, `desde ${fmt(b.created_at)}`].filter(Boolean).join(' · ')}
                </p>
              </div>
              <p className="hidden text-sm tabular-nums md:block">
                {b.students}
                {b.max_students ? <span className="text-muted-foreground"> / {b.max_students}</span> : null}
              </p>
              <p className="hidden text-sm tabular-nums md:block">{b.members}</p>
              <p className="hidden text-sm md:block">{fmt(b.last_attendance)}</p>
              <p className="hidden text-sm md:block">{fmt(b.last_login)}</p>
              <div className="flex items-center justify-end gap-2">
                <Button variant="ghost" className="min-h-9 px-3 py-1.5" onClick={() => enter(b)} title="Acessar esta base para dar suporte">
                  <LogIn size={15} /> Acessar
                </Button>
                <Menu as="div" className="relative">
                  <MenuButton className="grid h-9 w-9 place-items-center rounded-lg ring-1 ring-inset ring-border hover:bg-muted" aria-label="Mais ações">
                    <MoreHorizontal size={17} />
                  </MenuButton>
                  <MenuItems anchor="bottom end" className="z-50 w-52 rounded-lg border border-border bg-card p-1 text-sm shadow-lift focus:outline-none">
                    <MenuItem>
                      <button onClick={() => setTeam(b)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 data-[focus]:bg-muted">
                        <Users size={15} /> Equipe e senhas
                      </button>
                    </MenuItem>
                    <MenuItem>
                      <button onClick={() => setEditing(b)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 data-[focus]:bg-muted">
                        <Pencil size={15} /> Editar plano e dados
                      </button>
                    </MenuItem>
                    <MenuItem>
                      <button onClick={() => toggle.mutate(b)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 data-[focus]:bg-muted">
                        {b.active ? <Pause size={15} /> : <Play size={15} />} {b.active ? 'Suspender acesso' : 'Reativar acesso'}
                      </button>
                    </MenuItem>
                    <MenuItem>
                      <button onClick={() => askDelete(b)} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-red-600 data-[focus]:bg-red-50">
                        <Trash2 size={15} /> Excluir base
                      </button>
                    </MenuItem>
                  </MenuItems>
                </Menu>
              </div>
            </div>
          ))}
          {list.length === 0 ? <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nenhuma base encontrada.</p> : null}
        </div>
      )}

      {creating ? (
        <CreateBaseModal
          onClose={() => setCreating(false)}
          onDone={(c) => {
            refresh();
            setCreating(false);
            if (c) setCreds(c);
            else successToast('Base criada (o gestor já tinha conta e usa a mesma senha)');
          }}
        />
      ) : null}
      {editing ? <EditBaseModal base={editing} onClose={() => setEditing(null)} onDone={() => { refresh(); setEditing(null); successToast('Base atualizada'); }} /> : null}
      {team ? (
        <Modal open onClose={() => setTeam(null)} title={`Equipe — ${team.name}`} size="xl">
          <TeamManager baseId={team.id} />
        </Modal>
      ) : null}
      <CredentialsModal creds={creds} onClose={() => setCreds(null)} />
    </>
  );
}

function CreateBaseModal({ onClose, onDone }: { onClose: () => void; onDone: (c: Credentials | null) => void }) {
  const create = useMutation({
    mutationFn: createBase,
    onSuccess: (r, input) => onDone(r.password ? { name: input.manager_name, email: r.email, password: r.password } : null),
  });
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const max = Number(f.get('max_students'));
    create.mutate({
      name: String(f.get('name') || '').trim(),
      city: String(f.get('city') || '').trim(),
      plan: String(f.get('plan') || 'ativo'),
      max_students: max > 0 ? max : null,
      subject: String(f.get('subject') || '').trim(),
      manager_name: String(f.get('manager_name') || '').trim(),
      manager_email: String(f.get('manager_email') || '').trim(),
    });
  }
  return (
    <Modal open onClose={onClose} title="Nova base">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Nome da escola ou do professor">
          <Input name="name" required autoFocus placeholder="Ex.: Colégio Aurora" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cidade">
            <Input name="city" placeholder="Opcional" />
          </Field>
          <Field label="Plano">
            <Select name="plan" defaultValue="ativo">
              {PLANS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Disciplina (sai no boletim)">
            <Input name="subject" placeholder="Ex.: Língua Inglesa" />
          </Field>
          <Field label="Limite de alunos ativos">
            <Input name="max_students" type="number" min={0} placeholder="Vazio = sem limite" />
          </Field>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Gestor responsável</p>
          <div className="space-y-3">
            <Field label="Nome">
              <Input name="manager_name" required placeholder="Quem administra esta base" />
            </Field>
            <Field label="E-mail (login)">
              <Input name="manager_email" type="email" required placeholder="gestor@escola.com.br" />
            </Field>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Uma senha provisória é gerada. O gestor cria a equipe (professores, secretaria) dentro da base.</p>
        </div>
        {create.isError ? <p className="text-sm font-medium text-red-600">{(create.error as Error).message}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Criando…' : 'Criar base'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditBaseModal({ base, onClose, onDone }: { base: OrgAdmin; onClose: () => void; onDone: () => void }) {
  const save = useMutation({
    mutationFn: (input: Parameters<typeof updateOrganization>[1]) => updateOrganization(base.id, input),
    onSuccess: onDone,
  });
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const max = Number(f.get('max_students'));
    save.mutate({
      name: String(f.get('name') || '').trim(),
      city: String(f.get('city') || '').trim() || null,
      cnpj: String(f.get('cnpj') || '').trim() || null,
      plan: String(f.get('plan') || 'ativo'),
      max_students: max > 0 ? max : null,
      notes: String(f.get('notes') || '').trim() || null,
    });
  }
  return (
    <Modal open onClose={onClose} title="Editar base">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Nome">
          <Input name="name" required defaultValue={base.name} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cidade">
            <Input name="city" defaultValue={base.city ?? ''} />
          </Field>
          <Field label="CNPJ / CPF">
            <Input name="cnpj" defaultValue={base.cnpj ?? ''} />
          </Field>
          <Field label="Plano">
            <Select name="plan" defaultValue={base.plan}>
              {PLANS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </Field>
          <Field label="Limite de alunos">
            <Input name="max_students" type="number" min={0} defaultValue={base.max_students ?? ''} placeholder="Sem limite" />
          </Field>
        </div>
        <Field label="Anotações internas (só você vê)">
          <textarea
            name="notes"
            defaultValue={base.notes ?? ''}
            rows={3}
            className="w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-brand/40"
            placeholder="Contato, vencimento, combinados…"
          />
        </Field>
        {save.isError ? <p className="text-sm font-medium text-red-600">{(save.error as Error).message}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </form>
    </Modal>
  );
}
