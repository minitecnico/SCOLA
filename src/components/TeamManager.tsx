import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { addMember, listOrgMembers, removeMember, resetMemberPassword, setMemberRole } from '../lib/queries';
import { ASSIGNABLE_ROLES, ROLE_HINT, ROLE_LABEL, type AppRole } from '../lib/types';
import { successToast } from './Feedback';
import { Button, Field, Input, Loading, Modal, Select } from './ui';

export interface Credentials {
  name?: string;
  email: string;
  password: string;
}

/** Mostra a senha provisória UMA vez, com mensagem pronta para enviar por WhatsApp/e-mail. */
export function CredentialsModal({ creds, onClose }: { creds: Credentials | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  if (!creds) return null;
  const message =
    `Olá${creds.name ? `, ${creds.name.split(' ')[0]}` : ''}! Seu acesso ao SCOLA:\n` +
    `Endereço: ${window.location.origin}\nE-mail: ${creds.email}\nSenha provisória: ${creds.password}\n` +
    `No primeiro acesso você vai criar sua própria senha.`;
  async function copy() {
    await navigator.clipboard.writeText(message).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Modal open onClose={onClose} title="Acesso criado">
      <p className="text-sm text-muted-foreground">Anote ou envie agora — a senha provisória não será exibida de novo.</p>
      <div className="mt-4 space-y-2 rounded-lg bg-neutral-950 p-4 font-mono text-sm text-white">
        <p><span className="text-neutral-500">E-mail </span>{creds.email}</p>
        <p><span className="text-neutral-500">Senha  </span><span className="font-bold text-brand">{creds.password}</span></p>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={copy}>{copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copiado' : 'Copiar mensagem'}</Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold ring-1 ring-inset ring-border hover:bg-muted"
        >
          Enviar pelo WhatsApp
        </a>
        <Button variant="ghost" onClick={onClose} className="ml-auto">Fechar</Button>
      </div>
    </Modal>
  );
}

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('pt-BR') : 'nunca');

/** Lista e gerencia as pessoas de uma base. Usado pelo gestor (Equipe) e pelo administrador. */
export function TeamManager({ baseId }: { baseId: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = ['org-members', baseId];
  const { data: members = [], isLoading } = useQuery({ queryKey: key, queryFn: () => listOrgMembers(baseId) });
  const [adding, setAdding] = useState(false);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ['org-people'] });
    qc.invalidateQueries({ queryKey: ['admin-bases'] });
  };

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: AppRole }) => setMemberRole(baseId, userId, role),
    onSuccess: () => { refresh(); successToast('Papel atualizado'); },
  });
  const remove = useMutation({
    mutationFn: (userId: string) => removeMember(baseId, userId),
    onSuccess: () => { refresh(); successToast('Pessoa removida da base'); },
  });
  const reset = useMutation({
    mutationFn: (m: { userId: string; name: string; email: string }) => resetMemberPassword(baseId, m.userId).then((r) => ({ ...m, ...r })),
    onSuccess: (r) => { refresh(); setCreds({ name: r.name, email: r.email, password: r.password }); },
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{members.length} pessoa(s) com acesso.</p>
        <Button onClick={() => setAdding(true)}>
          <UserPlus size={16} /> Adicionar pessoa
        </Button>
      </div>

      {isLoading ? (
        <Loading />
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {members.map((m) => {
            const me = m.user_id === user?.id;
            return (
              <div key={m.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-neutral-100 text-sm font-bold uppercase text-neutral-700">
                  {(m.full_name || m.email || '?').slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {m.full_name || '—'} {me ? <span className="text-muted-foreground">(você)</span> : null}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {m.email} · último acesso: {fmtDate(m.last_login_at)}
                    {m.must_change_pw ? <span className="ml-1.5 rounded bg-brand/25 px-1.5 py-0.5 font-semibold text-neutral-800">senha provisória</span> : null}
                  </p>
                </div>
                <Select
                  value={m.role}
                  onChange={(e) => changeRole.mutate({ userId: m.user_id, role: e.target.value as AppRole })}
                  className="w-auto min-w-[11rem] py-2"
                  disabled={me}
                  aria-label="Papel"
                >
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </Select>
                <button
                  onClick={() =>
                    confirm(`Gerar nova senha provisória para ${m.full_name || m.email}? A senha atual deixa de funcionar.`) &&
                    reset.mutate({ userId: m.user_id, name: m.full_name || '', email: m.email || '' })
                  }
                  disabled={me}
                  title="Gerar nova senha"
                  className="grid h-9 w-9 place-items-center rounded-lg text-neutral-500 ring-1 ring-inset ring-border hover:bg-muted hover:text-neutral-900 disabled:opacity-30"
                >
                  <KeyRound size={16} />
                </button>
                <button
                  onClick={() => confirm(`Remover ${m.full_name || m.email} desta base?`) && remove.mutate(m.user_id)}
                  disabled={me}
                  title="Remover da base"
                  className="grid h-9 w-9 place-items-center rounded-lg text-red-600 ring-1 ring-inset ring-red-100 hover:bg-red-50 disabled:opacity-30"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      {changeRole.isError || remove.isError || reset.isError ? (
        <p className="mt-2 text-sm font-medium text-red-600">{((changeRole.error || remove.error || reset.error) as Error).message}</p>
      ) : null}

      {adding ? (
        <AddMemberModal
          baseId={baseId}
          onClose={() => setAdding(false)}
          onDone={(c) => {
            refresh();
            setAdding(false);
            if (c) setCreds(c);
            else successToast('Pessoa vinculada (já tinha conta — usa a mesma senha)');
          }}
        />
      ) : null}
      <CredentialsModal creds={creds} onClose={() => setCreds(null)} />
    </div>
  );
}

function AddMemberModal({ baseId, onClose, onDone }: { baseId: string; onClose: () => void; onDone: (c: Credentials | null) => void }) {
  const [role, setRole] = useState<AppRole>('professor');
  const add = useMutation({
    mutationFn: (input: { email: string; full_name: string; role: AppRole }) => addMember(baseId, input),
    onSuccess: (r, input) => onDone(r.password ? { name: input.full_name, email: r.email, password: r.password } : null),
  });
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    add.mutate({ full_name: String(f.get('name') || '').trim(), email: String(f.get('email') || '').trim(), role });
  }
  return (
    <Modal open onClose={onClose} title="Adicionar pessoa">
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Nome completo">
          <Input name="name" required autoFocus placeholder="Ex.: Maria Oliveira" />
        </Field>
        <Field label="E-mail (login)">
          <Input name="email" type="email" required placeholder="maria@escola.com.br" />
        </Field>
        <Field label="Papel">
          <Select value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </Select>
        </Field>
        <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{ROLE_HINT[role as Exclude<AppRole, 'superadmin'>]}</p>
        {add.isError ? <p className="text-sm font-medium text-red-600">{(add.error as Error).message}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={add.isPending}>{add.isPending ? 'Criando…' : 'Criar acesso'}</Button>
        </div>
      </form>
    </Modal>
  );
}
