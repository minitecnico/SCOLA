import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, KeyRound, MapPin, MessageCircle, UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { successToast } from '../../components/Feedback';
import { Button, EmptyState, Field, Input, Loading, Modal, PageHeader, Segmented, Select } from '../../components/ui';
import { cn } from '../../lib/cn';
import {
  approveAccessRequest, countAccessRequests, listAccessRequests, listOrgAdmin, rejectAccessRequest, type AccessRequest,
} from '../../lib/queries';
import { ASSIGNABLE_ROLES, ROLE_LABEL, type AppRole } from '../../lib/types';

const when = (s: string) => new Date(s).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const waLink = (phone: string | null, text: string) => `https://wa.me/55${(phone ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;

/** Fila de pedidos: pessoas novas pedindo cadastro e pessoas que esqueceram a senha. O administrador analisa e aprova. */
export function AccessRequestsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<AccessRequest['status']>('pendente');
  const { data: list = [], isLoading } = useQuery({ queryKey: ['access-requests', status], queryFn: () => listAccessRequests(status) });
  const { data: counts } = useQuery({ queryKey: ['access-count'], queryFn: countAccessRequests });
  const [approving, setApproving] = useState<AccessRequest | null>(null);
  const [rejecting, setRejecting] = useState<AccessRequest | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['access-requests'] });
    qc.invalidateQueries({ queryKey: ['access-count'] });
    qc.invalidateQueries({ queryKey: ['admin-users'] });
    qc.invalidateQueries({ queryKey: ['admin-bases'] });
    qc.invalidateQueries({ queryKey: ['admin-stats'] });
  };
  const approvePassword = useMutation({
    mutationFn: (r: AccessRequest) => approveAccessRequest(r.id),
    onSuccess: () => { refresh(); successToast('Nova senha liberada'); },
  });
  const pending = (counts?.cadastros ?? 0) + (counts?.senhas ?? 0);

  return (
    <>
      <PageHeader title="Acessos" subtitle="Pedidos de cadastro e de nova senha. Nada vira conta sem a sua aprovação." back={false} />
      <div className="mb-4">
        <Segmented<AccessRequest['status']>
          value={status}
          onChange={setStatus}
          options={[
            { value: 'pendente', label: `Pendentes${status === 'pendente' || pending ? ` (${status === 'pendente' ? list.length : pending})` : ''}` },
            { value: 'aprovado', label: 'Aprovados' },
            { value: 'recusado', label: 'Recusados' },
          ]}
        />
      </div>

      {isLoading ? (
        <Loading />
      ) : !list.length ? (
        <EmptyState icon={<UserPlus size={24} />} title={status === 'pendente' ? 'Nenhum pedido esperando' : 'Nada por aqui'} hint={status === 'pendente' ? 'Quando alguém pedir cadastro ou nova senha, aparece aqui.' : undefined} />
      ) : (
        <ul className="space-y-3">
          {list.map((r) => {
            const isPwd = r.kind === 'senha';
            return (
              <li key={r.id} className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
                <div className="flex flex-wrap items-start gap-3">
                  <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-full', isPwd ? 'bg-neutral-100 text-neutral-700' : 'bg-neutral-950 text-brand')}>
                    {isPwd ? <KeyRound size={18} /> : <UserPlus size={18} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-foreground">{r.full_name || r.email}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{isPwd ? 'Nova senha' : 'Novo cadastro'}</span>
                    </p>
                    <p className="truncate text-sm text-muted-foreground">{r.email}</p>
                    <p className="text-xs text-muted-foreground">{when(r.created_at)}{r.device ? ` · ${r.device}` : ''}</p>
                  </div>
                  {r.phone ? (
                    <a href={waLink(r.phone, `Olá, ${(r.full_name || '').split(' ')[0]}! Aqui é do SCOLA. ${isPwd ? 'Foi você que pediu uma nova senha?' : 'Recebemos o seu pedido de cadastro.'}`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ring-1 ring-inset ring-border hover:bg-muted">
                      <MessageCircle size={15} /> {r.phone}
                    </a>
                  ) : null}
                </div>

                <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  {!isPwd ? (
                    <>
                      <div>
                        <dt className="text-xs font-semibold text-muted-foreground">Instituição informada</dt>
                        <dd className="font-medium text-foreground">{r.institution}</dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-muted-foreground">Reconhecimento do sistema</dt>
                        <dd className="font-medium text-foreground">
                          {r.match_name ? <span>✓ {r.match_name} <span className="text-muted-foreground">({r.match_score}% de semelhança)</span></span> : <span className="text-neutral-600">Não encontrada — instituição nova?</span>}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs font-semibold text-muted-foreground">Função pedida</dt>
                        <dd className="font-medium text-foreground">{ROLE_LABEL[(r.role ?? 'professor') as Exclude<AppRole, 'superadmin'>] ?? r.role}</dd>
                      </div>
                      {r.city ? (
                        <div>
                          <dt className="text-xs font-semibold text-muted-foreground">Cidade</dt>
                          <dd className="inline-flex items-center gap-1 font-medium text-foreground"><MapPin size={13} /> {r.city}</dd>
                        </div>
                      ) : null}
                      {r.note ? (
                        <div className="sm:col-span-2">
                          <dt className="text-xs font-semibold text-muted-foreground">Observação da pessoa</dt>
                          <dd className="text-foreground">{r.note}</dd>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="sm:col-span-2">
                      <dt className="text-xs font-semibold text-muted-foreground">Conta</dt>
                      <dd className="text-foreground">
                        {r.memberships.map((m) => `${m.base_name} (${ROLE_LABEL[m.role as Exclude<AppRole, 'superadmin'>] ?? m.role})`).join(' · ') || 'Sem escola'}
                        {' · '}último acesso: {r.last_login_at ? when(r.last_login_at) : 'nunca'}
                      </dd>
                    </div>
                  )}
                  {r.user_id && !isPwd ? (
                    <div className="sm:col-span-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-700">
                      Este e-mail <b>já tem conta</b>{r.memberships.length ? ` (${r.memberships.map((m) => m.base_name).join(', ')})` : ''}. Aprovar só vincula à escola; a senha atual continua a mesma.
                    </div>
                  ) : null}
                  {isPwd && r.status === 'pendente' ? (
                    <div className="sm:col-span-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-700">
                      <b>Confirme que foi a própria pessoa</b> (ligue ou mande mensagem). Ao aprovar, a senha que ela escolheu no pedido passa a valer e as outras sessões dela são encerradas.
                    </div>
                  ) : null}
                  {r.status !== 'pendente' && r.decision_note ? <div className="sm:col-span-2 text-xs text-muted-foreground">Motivo: {r.decision_note}</div> : null}
                </dl>

                {r.status === 'pendente' ? (
                  <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                    <Button variant="ghost" onClick={() => setRejecting(r)}><X size={16} /> Recusar</Button>
                    {isPwd ? (
                      <Button onClick={() => approvePassword.mutate(r)} disabled={approvePassword.isPending}><Check size={16} /> Confirmar que é a pessoa</Button>
                    ) : (
                      <Button onClick={() => setApproving(r)}><Check size={16} /> Aprovar…</Button>
                    )}
                  </div>
                ) : r.decided_at ? (
                  <p className="mt-3 text-xs text-muted-foreground">{status === 'aprovado' ? 'Aprovado' : 'Recusado'} em {when(r.decided_at)}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {approvePassword.isError ? <p className="mt-3 text-sm font-medium text-red-600">{(approvePassword.error as Error).message}</p> : null}

      {approving ? <ApproveModal req={approving} onClose={() => setApproving(null)} onDone={() => { setApproving(null); refresh(); successToast('Cadastro aprovado — a pessoa já pode entrar'); }} /> : null}
      {rejecting ? <RejectModal req={rejecting} onClose={() => setRejecting(null)} onDone={() => { setRejecting(null); refresh(); successToast('Pedido recusado'); }} /> : null}
    </>
  );
}

/** Aprovar cadastro: vincula à escola reconhecida (ou escolhida) ou cria a instituição nova. */
function ApproveModal({ req, onClose, onDone }: { req: AccessRequest; onClose: () => void; onDone: () => void }) {
  const { data: schools = [] } = useQuery({ queryKey: ['admin-bases'], queryFn: listOrgAdmin });
  const [mode, setMode] = useState<'existing' | 'new'>(req.match_base_id ? 'existing' : 'new');
  const [baseId, setBaseId] = useState(req.match_base_id ?? '');
  const [role, setRole] = useState<AppRole>((req.role as AppRole) ?? 'professor');
  const [name, setName] = useState(req.institution ?? '');
  const [city, setCity] = useState(req.city ?? '');
  const [plan, setPlan] = useState('teste');
  const approve = useMutation({
    mutationFn: () => approveAccessRequest(req.id, mode === 'new' ? { newBase: { name, city, plan } } : { baseId, role }),
    onSuccess: onDone,
  });
  const active = schools.filter((s) => s.active);
  return (
    <Modal open onClose={onClose} title={`Aprovar ${req.full_name ?? req.email}`}>
      <form onSubmit={(e) => { e.preventDefault(); approve.mutate(); }} className="space-y-4">
        <p className="text-sm text-muted-foreground">Pediu acesso a <b className="text-foreground">{req.institution}</b>. A pessoa entra com o e-mail e a senha que escolheu.</p>
        <Segmented<'existing' | 'new'> value={mode} onChange={setMode} options={[{ value: 'existing', label: 'Escola já cadastrada' }, { value: 'new', label: 'Instituição nova' }]} />
        {mode === 'existing' ? (
          <>
            <Field label="Escola">
              <Select value={baseId} onChange={(e) => setBaseId(e.target.value)} required>
                <option value="">Escolha…</option>
                {active.map((s) => <option key={s.id} value={s.id}>{s.name}{s.city ? ` — ${s.city}` : ''}</option>)}
              </Select>
            </Field>
            <Field label="Função na escola">
              <Select value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
                {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </Select>
            </Field>
            {role === 'gestor' ? <p className="rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-700">Coordenação enxerga e altera tudo da escola. Confira se a pessoa realmente tem esse cargo.</p> : null}
          </>
        ) : (
          <>
            <Field label="Nome da nova escola"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cidade"><Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Opcional" /></Field>
              <Field label="Plano">
                <Select value={plan} onChange={(e) => setPlan(e.target.value)}><option value="teste">Teste</option><option value="ativo">Ativo</option></Select>
              </Field>
            </div>
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground"><Building2 size={13} className="mr-1 inline" /> A escola é criada e a pessoa vira a <b>coordenação</b> dela.</p>
          </>
        )}
        {approve.isError ? <p className="text-sm font-medium text-red-600">{(approve.error as Error).message}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={approve.isPending || (mode === 'existing' ? !baseId : !name.trim())}>{approve.isPending ? 'Aprovando…' : 'Aprovar e liberar acesso'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function RejectModal({ req, onClose, onDone }: { req: AccessRequest; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const reject = useMutation({ mutationFn: () => rejectAccessRequest(req.id, note), onSuccess: onDone });
  return (
    <Modal open onClose={onClose} title={`Recusar ${req.full_name ?? req.email}`}>
      <form onSubmit={(e) => { e.preventDefault(); reject.mutate(); }} className="space-y-4">
        <Field label="Motivo (opcional — a pessoa vê ao tentar entrar)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Ex.: Não encontramos você na lista da escola." />
        </Field>
        {reject.isError ? <p className="text-sm font-medium text-red-600">{(reject.error as Error).message}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="danger" disabled={reject.isPending}>Recusar pedido</Button>
        </div>
      </form>
    </Modal>
  );
}
