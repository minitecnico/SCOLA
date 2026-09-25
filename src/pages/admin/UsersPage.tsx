import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Building2, ChevronRight, KeyRound, LogOut, Mail, Phone, ShieldCheck, Trash2, UserCog, UserRound } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { successToast } from '../../components/Feedback';
import { CredentialsModal, type Credentials } from '../../components/TeamManager';
import { Button, EmptyState, Field, Input, Loading, Modal, PageHeader, SearchInput, Segmented, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import {
  deleteUserAdmin, endUserSessions, listOrgAdmin, listUsersAdmin, setUserBase, setUserDisabled, setUserPasswordAdmin, updateUserAdmin, type AdminUser,
} from '../../lib/queries';
import { ASSIGNABLE_ROLES, ROLE_LABEL, type AppRole } from '../../lib/types';

/**
 * Usuários da plataforma: todas as contas de todas as bases, num lugar só.
 * O administrador edita nome, e-mail (login) e telefone, define senha, bloqueia,
 * desconecta dos aparelhos, vincula a bases e exclui.
 */
type Filter = 'todos' | 'bloqueados' | 'provisoria' | 'nunca';
const fmt = (s: string | null) => (s ? new Date(s).toLocaleDateString('pt-BR') : 'nunca');
const initials = (u: AdminUser) => (u.full_name || u.email).slice(0, 1).toUpperCase();

export function UsersPage() {
  const { data: users = [], isLoading } = useQuery({ queryKey: ['admin-users'], queryFn: listUsersAdmin });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('todos');
  const [openId, setOpenId] = useState<string | null>(null);
  const open = users.find((u) => u.id === openId) ?? null;

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return users.filter(
      (u) =>
        (filter === 'todos' ||
          (filter === 'bloqueados' && u.disabled) ||
          (filter === 'provisoria' && u.must_change_pw) ||
          (filter === 'nunca' && !u.last_login_at)) &&
        (!t ||
          (u.full_name ?? '').toLowerCase().includes(t) ||
          u.email.toLowerCase().includes(t) ||
          (u.phone ?? '').includes(t) ||
          u.bases.some((b) => b.base_name.toLowerCase().includes(t))),
    );
  }, [users, q, filter]);
  const count = (f: Filter) => users.filter((u) => (f === 'bloqueados' ? u.disabled : f === 'provisoria' ? u.must_change_pw : !u.last_login_at)).length;

  return (
    <>
      <PageHeader title="Usuários" subtitle="Todas as contas da plataforma: dados de login, senha, bloqueio e bases." />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por nome, e-mail, telefone ou base…" className="min-w-[14rem] flex-1" />
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'todos', label: `Todos (${users.length})` },
            { value: 'bloqueados', label: `Bloqueados (${count('bloqueados')})` },
            { value: 'provisoria', label: `Senha provisória (${count('provisoria')})` },
            { value: 'nunca', label: `Nunca entraram (${count('nunca')})` },
          ]}
        />
      </div>

      {isLoading ? (
        <Loading />
      ) : !list.length ? (
        <EmptyState icon={<UserCog size={24} />} title="Nenhum usuário encontrado" hint="Ajuste a busca ou o filtro." />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {list.map((u) => (
            <button key={u.id} onClick={() => setOpenId(u.id)} className={cn('flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/50', u.disabled && 'bg-neutral-50')}>
              <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold', u.is_admin ? 'bg-neutral-950 text-brand' : 'bg-neutral-100 text-neutral-700')}>
                {initials(u)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className={cn('truncate text-sm font-semibold', u.disabled && 'text-muted-foreground line-through')}>{u.full_name || '—'}</span>
                  {u.is_admin ? <Tag tone="dark">Administrador</Tag> : null}
                  {u.disabled ? <Tag tone="red">Bloqueado</Tag> : null}
                  {u.must_change_pw ? <Tag tone="brand">Senha provisória</Tag> : null}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {u.email}
                  {u.phone ? ` · ${u.phone}` : ''}
                </span>
                {u.bases.length ? (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {u.bases.map((b) => (
                      <span key={b.base_id} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {b.base_name} · {ROLE_LABEL[b.role]}
                      </span>
                    ))}
                  </span>
                ) : !u.is_admin ? (
                  <span className="mt-1 block text-[11px] text-orange-700">Sem base: não consegue usar o sistema</span>
                ) : null}
              </span>
              <span className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block">
                último acesso
                <span className="block font-semibold text-foreground">{fmt(u.last_login_at)}</span>
              </span>
              <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}

      {open ? <UserModal user={open} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function Tag({ tone, children }: { tone: 'dark' | 'red' | 'brand'; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
        tone === 'dark' ? 'bg-neutral-950 text-brand' : tone === 'red' ? 'bg-red-100 text-red-700' : 'bg-brand/25 text-neutral-900',
      )}
    >
      {children}
    </span>
  );
}

function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-4 first:border-0 first:pt-0">
      <div className="mb-3 flex items-start gap-2.5">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div>
          <h3 className="text-sm font-bold text-foreground">{title}</h3>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

/* ------------------------------ Ficha do usuário ------------------------------ */
function UserModal({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const self = user.id === me?.id;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-users'] });
    qc.invalidateQueries({ queryKey: ['admin-bases'] });
    qc.invalidateQueries({ queryKey: ['org-members'] });
  };
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [err, setErr] = useState('');
  const onError = (e: Error) => setErr(e.message);

  // Dados
  const [form, setForm] = useState({ full_name: user.full_name ?? '', email: user.email, phone: user.phone ?? '' });
  useEffect(() => setForm({ full_name: user.full_name ?? '', email: user.email, phone: user.phone ?? '' }), [user.id, user.full_name, user.email, user.phone]);
  const dirty = form.full_name !== (user.full_name ?? '') || form.email !== user.email || form.phone !== (user.phone ?? '');
  const emailChanged = form.email.trim().toLowerCase() !== user.email.toLowerCase();
  const saveData = useMutation({
    mutationFn: () => updateUserAdmin(user.id, { full_name: form.full_name.trim(), email: form.email.trim(), phone: form.phone.trim() || null }),
    onSuccess: () => {
      refresh();
      setErr('');
      successToast(emailChanged ? 'Dados salvos. O login agora é o novo e-mail.' : 'Dados salvos');
    },
    onError,
  });

  // Senha
  const [pw, setPw] = useState('');
  const [mustChange, setMustChange] = useState(true);
  const setPassword = useMutation({
    mutationFn: (generate: boolean) => setUserPasswordAdmin(user.id, generate ? null : pw, mustChange),
    onSuccess: (r) => {
      refresh();
      setErr('');
      setPw('');
      if (r.password) setCreds({ name: r.name ?? undefined, email: r.email, password: r.password });
      else successToast(self ? 'Sua senha foi alterada' : 'Senha definida. A pessoa foi desconectada dos aparelhos.');
    },
    onError,
  });

  // Acesso
  const block = useMutation({
    mutationFn: () => setUserDisabled(user.id, !user.disabled),
    onSuccess: () => {
      refresh();
      successToast(user.disabled ? 'Acesso liberado' : 'Acesso bloqueado');
    },
    onError,
  });
  const logoutAll = useMutation({
    mutationFn: () => endUserSessions(user.id),
    onSuccess: (r) => {
      refresh();
      successToast(r.ended ? `Desconectado de ${r.ended} aparelho(s)` : 'Não havia sessão aberta');
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => deleteUserAdmin(user.id),
    onSuccess: () => {
      refresh();
      successToast('Conta excluída');
      onClose();
    },
    onError,
  });

  // Bases
  const { data: bases = [] } = useQuery({ queryKey: ['admin-bases'], queryFn: listOrgAdmin });
  const linked = new Set(user.bases.map((b) => b.base_id));
  const available = bases.filter((b) => !linked.has(b.id));
  const [newBase, setNewBase] = useState('');
  const [newRole, setNewRole] = useState<AppRole>('professor');
  const link = useMutation({
    mutationFn: (v: { baseId: string; role: AppRole | null }) => setUserBase(user.id, v.baseId, v.role),
    onSuccess: (_r, v) => {
      refresh();
      setErr('');
      if (v.role && v.baseId === newBase) setNewBase('');
      successToast(v.role ? 'Base atualizada' : 'Desvinculado da base');
    },
    onError,
  });

  return (
    <Modal open onClose={onClose} title={user.full_name || user.email} size="xl">
      <div className="space-y-5">
        <p className="-mt-2 text-xs text-muted-foreground">
          Conta criada em {fmt(user.created_at)} · último acesso {fmt(user.last_login_at)} · {user.sessions} aparelho(s) conectado(s)
        </p>
        {err ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-inset ring-red-200">{err}</p> : null}

        <Section icon={<UserRound size={17} />} title="Dados" hint="O e-mail é o login. Ao trocar, a pessoa passa a entrar com o novo (a senha continua a mesma).">
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveData.mutate();
            }}
          >
            <Field label="Nome completo">
              <Input value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} required />
            </Field>
            <Field label="Telefone / WhatsApp">
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} inputMode="tel" placeholder="Opcional" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="E-mail (login)">
                <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
              </Field>
              {emailChanged ? (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-orange-700">
                  <Mail size={13} /> Avise a pessoa: o próximo login será com {form.email.trim().toLowerCase() || '…'}.
                </p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              {dirty ? (
                <Button type="button" variant="ghost" onClick={() => setForm({ full_name: user.full_name ?? '', email: user.email, phone: user.phone ?? '' })}>
                  Descartar
                </Button>
              ) : null}
              <Button type="submit" disabled={!dirty || saveData.isPending}>
                {saveData.isPending ? 'Salvando…' : 'Salvar dados'}
              </Button>
            </div>
          </form>
        </Section>

        <Section
          icon={<KeyRound size={17} />}
          title="Senha"
          hint={self ? 'Defina uma nova senha para a sua conta.' : 'Gere uma provisória para enviar por WhatsApp, ou defina uma. A pessoa é desconectada dos aparelhos.'}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {!self ? (
              <Button variant="ghost" onClick={() => confirm(`Gerar senha provisória para ${user.full_name || user.email}? A senha atual deixa de funcionar.`) && setPassword.mutate(true)} disabled={setPassword.isPending}>
                <KeyRound size={16} /> Gerar senha provisória
              </Button>
            ) : null}
            <form
              className="flex flex-1 gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (pw.length >= 6) setPassword.mutate(false);
              }}
            >
              <Input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={self ? 'Nova senha (mín. 6)' : 'ou digite uma senha (mín. 6)'} autoComplete="new-password" className="flex-1" />
              <Button type="submit" disabled={pw.length < 6 || setPassword.isPending}>
                Definir
              </Button>
            </form>
          </div>
          {!self ? (
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} className="h-4 w-4 accent-neutral-900" />
              Pedir para a pessoa criar a própria senha no próximo acesso
            </label>
          ) : null}
        </Section>

        {!user.is_admin ? (
          <Section icon={<Building2 size={17} />} title="Bases e papéis" hint="Uma pessoa pode estar em mais de uma base (ex.: professor em 2 escolas).">
            <ul className="divide-y divide-border rounded-lg border border-border">
              {user.bases.map((b) => (
                <li key={b.base_id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {b.base_name}
                    {!b.active ? <span className="ml-1.5 text-xs text-muted-foreground">(suspensa)</span> : null}
                  </span>
                  <Select value={b.role} onChange={(e) => link.mutate({ baseId: b.base_id, role: e.target.value as AppRole })} className="w-auto min-w-[10rem] py-2" aria-label="Papel">
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </Select>
                  <button
                    onClick={() => confirm(`Tirar ${user.full_name || user.email} de ${b.base_name}?`) && link.mutate({ baseId: b.base_id, role: null })}
                    className="h-9 rounded-lg px-2.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    Desvincular
                  </button>
                </li>
              ))}
              {!user.bases.length ? <li className="px-3 py-3 text-sm text-orange-700">Nenhuma base. Vincule abaixo para a pessoa conseguir usar o sistema.</li> : null}
            </ul>
            {available.length ? (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Select value={newBase} onChange={(e) => setNewBase(e.target.value)} className="flex-1" aria-label="Base">
                  <option value="">Vincular a outra base…</option>
                  {available.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
                <Select value={newRole} onChange={(e) => setNewRole(e.target.value as AppRole)} className="sm:w-44" aria-label="Papel">
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
                <Button variant="ghost" onClick={() => link.mutate({ baseId: newBase, role: newRole })} disabled={!newBase || link.isPending}>
                  Vincular
                </Button>
              </div>
            ) : null}
          </Section>
        ) : (
          <Section icon={<ShieldCheck size={17} />} title="Administrador" hint="Acessa todas as bases pelo modo suporte. Não pode ser bloqueado nem excluído." >
            <span />
          </Section>
        )}

        {!self && !user.is_admin ? (
          <Section icon={<Ban size={17} />} title="Acesso">
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => logoutAll.mutate()} disabled={logoutAll.isPending || !user.sessions}>
                <LogOut size={16} /> Desconectar de todos os aparelhos{user.sessions ? ` (${user.sessions})` : ''}
              </Button>
              <Button
                variant="ghost"
                onClick={() => (user.disabled || confirm(`Bloquear ${user.full_name || user.email}? A pessoa sai na hora e não consegue entrar até você liberar. Nada é apagado.`)) && block.mutate()}
                disabled={block.isPending}
                className={user.disabled ? '' : 'text-red-600'}
              >
                <Ban size={16} /> {user.disabled ? 'Liberar acesso' : 'Bloquear acesso'}
              </Button>
            </div>
            <div className="mt-4 rounded-lg border border-red-200 p-3">
              <p className="text-sm font-semibold text-red-700">Excluir conta</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Apaga a conta e os avisos e planejamentos que ela escreveu. Chamadas, notas e provas continuam. Para só impedir o acesso, prefira bloquear.
              </p>
              <Button
                variant="ghost"
                className="mt-2 text-red-600"
                disabled={remove.isPending}
                onClick={() => {
                  const typed = prompt(`Para excluir de vez, digite o e-mail da conta:\n${user.email}`);
                  if (typed == null) return;
                  if (typed.trim().toLowerCase() !== user.email.toLowerCase()) return alert('E-mail não confere. Nada foi excluído.');
                  remove.mutate();
                }}
              >
                <Trash2 size={16} /> Excluir conta
              </Button>
            </div>
          </Section>
        ) : null}

        {user.phone ? (
          <a
            href={`https://wa.me/55${user.phone.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <Phone size={13} /> Conversar no WhatsApp
          </a>
        ) : null}
      </div>
      <CredentialsModal creds={creds} onClose={() => setCreds(null)} title="Nova senha provisória" />
    </Modal>
  );
}
