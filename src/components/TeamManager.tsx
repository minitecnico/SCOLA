import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { addMember, listOrgMembers, memberAccessLink, removeMember, setMemberRole } from '../lib/queries';
import { ASSIGNABLE_ROLES, ROLE_HINT, ROLE_LABEL, type AppRole } from '../lib/types';
import { successToast } from './Feedback';
import { Button, Field, Input, Loading, Modal, Select } from './ui';

export interface AccessLinkInfo {
  url: string;
  email: string;
  name?: string | null;
  kind: 'invite' | 'reset';
  baseName?: string;
}

/** Mostra o link de acesso (convite ou redefinição) com mensagem pronta para WhatsApp. Nenhuma senha circula. */
export function AccessLinkModal({ link, onClose, title }: { link: AccessLinkInfo | null; onClose: () => void; title?: string }) {
  const [copied, setCopied] = useState<'link' | 'msg' | null>(null);
  if (!link) return null;
  const invite = link.kind === 'invite';
  const hi = link.name ? `Olá, ${link.name.split(' ')[0]}!` : 'Olá!';
  const message = invite
    ? `${hi} ${link.baseName ? `A escola ${link.baseName} liberou` : 'Foi liberado'} o seu acesso ao SCOLA. Crie a sua senha por este link (vale 7 dias, uso único):\n${link.url}\nSe você usa Gmail, também pode entrar com o Google usando o e-mail ${link.email}.`
    : `${hi} Para criar uma nova senha no SCOLA, abra este link (vale 24 horas, uso único):\n${link.url}`;
  async function copy(what: 'link' | 'msg') {
    await navigator.clipboard.writeText(what === 'link' ? link!.url : message).catch(() => {});
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  }
  return (
    <Modal open onClose={onClose} title={title ?? (invite ? 'Convite criado' : 'Link de acesso')}>
      <p className="text-sm text-muted-foreground">
        Envie este link para <b className="text-foreground">{link.name || link.email}</b>. A pessoa cria a própria senha — ninguém precisa anotar ou repassar senha.
      </p>
      <div className="mt-4 break-all rounded-lg bg-muted p-3 font-mono text-xs text-foreground">{link.url}</div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => copy('link')}>{copied === 'link' ? <Check size={16} /> : <Link2 size={16} />} {copied === 'link' ? 'Copiado' : 'Copiar link'}</Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold ring-1 ring-inset ring-border hover:bg-muted"
        >
          Enviar pelo WhatsApp
        </a>
        <Button variant="ghost" onClick={() => copy('msg')}>{copied === 'msg' ? <Check size={16} /> : <Copy size={16} />} {copied === 'msg' ? 'Copiado' : 'Copiar mensagem'}</Button>
      </div>
      <p className="mt-4 text-xs text-muted-foreground">O link vale {invite ? '7 dias' : '24 horas'} e só funciona uma vez. Gerar outro cancela este.</p>
      <div className="mt-4 flex justify-end border-t border-border pt-4"><Button variant="ghost" onClick={onClose}>Fechar</Button></div>
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
  const [link, setLink] = useState<AccessLinkInfo | null>(null);
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
  const access = useMutation({
    mutationFn: (userId: string) => memberAccessLink(baseId, userId),
    onSuccess: (r) => { refresh(); setLink(r); },
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
                    {m.pending ? <span className="ml-1.5 rounded bg-neutral-900 px-1.5 py-0.5 font-semibold text-white">convite pendente</span> : null}
                    {m.must_change_pw ? <span className="ml-1.5 rounded bg-brand/25 px-1.5 py-0.5 font-semibold text-neutral-800">senha provisória</span> : null}
                    {m.google ? <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 font-semibold text-neutral-700">Google</span> : null}
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
                  onClick={() => access.mutate(m.user_id)}
                  disabled={me || access.isPending}
                  title={m.pending ? 'Gerar novo link de convite' : 'Gerar link para criar nova senha'}
                  className="grid h-9 w-9 place-items-center rounded-lg text-neutral-500 ring-1 ring-inset ring-border hover:bg-muted hover:text-neutral-900 disabled:opacity-30"
                >
                  <Link2 size={16} />
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
      {changeRole.isError || remove.isError || access.isError ? (
        <p className="mt-2 text-sm font-medium text-red-600">{((changeRole.error || remove.error || access.error) as Error).message}</p>
      ) : null}

      {adding ? (
        <AddMemberModal
          baseId={baseId}
          onClose={() => setAdding(false)}
          onDone={(l) => {
            refresh();
            setAdding(false);
            if (l) setLink(l);
            else successToast('Pessoa vinculada (já tinha conta — usa o mesmo acesso)');
          }}
        />
      ) : null}
      <AccessLinkModal link={link} onClose={() => setLink(null)} />
    </div>
  );
}

function AddMemberModal({ baseId, onClose, onDone }: { baseId: string; onClose: () => void; onDone: (l: AccessLinkInfo | null) => void }) {
  const [role, setRole] = useState<AppRole>('professor');
  const add = useMutation({
    mutationFn: (input: { email: string; full_name: string; role: AppRole }) => addMember(baseId, input),
    onSuccess: (r, input) => onDone(r.inviteUrl ? { name: input.full_name, email: r.email, url: r.inviteUrl, kind: 'invite', baseName: r.baseName } : null),
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
        <p className="text-xs text-muted-foreground">A pessoa recebe um <b>convite por link</b> (envie pelo WhatsApp) e cria a própria senha — ou entra com o Google, se o e-mail for Gmail.</p>
        {add.isError ? <p className="text-sm font-medium text-red-600">{(add.error as Error).message}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={add.isPending}>{add.isPending ? 'Criando…' : 'Convidar'}</Button>
        </div>
      </form>
    </Modal>
  );
}
