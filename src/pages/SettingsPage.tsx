import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Eye, EyeOff, ImagePlus, KeyRound, LogOut, ShieldCheck, Trash2, User, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { successToast } from '../components/Feedback';
import { Button, Field, Input, PageHeader, SegmentedField, StatusBadge, fieldCls } from '../components/ui';
import { cn } from '../lib/cn';
import { fileToCompressedDataUrl } from '../lib/image';
import { can } from '../lib/permissions';
import {
  changePassword, getProfile, listOrgAdmin, listSchools, saveSchool, setOrgActive, updateOrganization, updateProfile,
} from '../lib/queries';
import { ROLE_LABEL } from '../lib/types';

/**
 * Configurações em seções: Perfil, Segurança, Escola (dados da base que aparecem nos
 * documentos) e Plano e acesso (só o administrador, em modo suporte).
 * Cada seção salva sozinha e só libera o botão quando há alteração.
 */
type TabKey = 'perfil' | 'seguranca' | 'escola' | 'plano';

/* --------------------------------- Máscaras --------------------------------- */
const digits = (v: string) => v.replace(/\D/g, '');
function maskPhone(v: string) {
  const d = digits(v).slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
function maskCnpj(v: string) {
  const d = digits(v).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

/** Estado de formulário com "sujo" (houve alteração?) e descarte. */
function useForm<T extends Record<string, unknown>>(initial: T | null) {
  const [form, setForm] = useState<T | null>(initial);
  const key = JSON.stringify(initial);
  useEffect(() => setForm(initial), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !!form && JSON.stringify(form) !== key;
  const set = <K extends keyof T>(k: K, v: T[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  return { form, set, dirty, reset: () => setForm(initial) };
}

export function SettingsPage() {
  const { role, isSuperadmin, activeOrgId } = useAuth();
  const tabs = useMemo(
    () =>
      [
        { key: 'perfil', label: 'Perfil', hint: 'Seu nome e foto', icon: User },
        { key: 'seguranca', label: 'Segurança', hint: 'Senha e sessão', icon: KeyRound },
        can(role, 'turmas') && { key: 'escola', label: 'Escola', hint: 'Dados dos documentos', icon: Building2 },
        isSuperadmin && activeOrgId && { key: 'plano', label: 'Plano e acesso', hint: 'Só o administrador', icon: ShieldCheck },
      ].filter(Boolean) as { key: TabKey; label: string; hint: string; icon: LucideIcon }[],
    [role, isSuperadmin, activeOrgId],
  );
  const fromHash = (): TabKey => {
    const h = window.location.hash.slice(1) as TabKey;
    return ['perfil', 'seguranca', 'escola', 'plano'].includes(h) ? h : 'perfil';
  };
  const [tab, setTab] = useState<TabKey>(fromHash);
  useEffect(() => {
    const onHash = () => setTab(fromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const current = tabs.some((t) => t.key === tab) ? tab : 'perfil';
  function go(k: TabKey) {
    setTab(k);
    window.history.replaceState(null, '', `#${k}`);
  }

  return (
    <>
      <PageHeader title="Configurações" subtitle="Seu perfil, sua senha e os dados da escola." />

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
        {/* Navegação: lista no desktop, abas roláveis no celular */}
        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:sticky lg:top-6 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0" aria-label="Seções">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = current === t.key;
            return (
              <button
                key={t.key}
                ref={active ? (el) => el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) : undefined}
                onClick={() => go(t.key)}
                className={cn(
                  'flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition lg:py-2.5',
                  active ? 'bg-neutral-950 text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon size={17} className={active ? 'text-brand' : undefined} />
                <span className="min-w-0">
                  <span className="block font-semibold">{t.label}</span>
                  <span className={cn('hidden text-xs lg:block', active ? 'text-white/60' : 'text-muted-foreground')}>{t.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 space-y-5">
          {current === 'perfil' ? <ProfileSection /> : null}
          {current === 'seguranca' ? <SecuritySection /> : null}
          {current === 'escola' ? <SchoolSection /> : null}
          {current === 'plano' && activeOrgId ? <PlanSection baseId={activeOrgId} /> : null}
        </div>
      </div>
    </>
  );
}

/* ------------------------------ Estrutura comum ------------------------------ */
function Section({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      <header className="border-b border-border px-5 py-4 sm:px-6">
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </header>
      <div className="px-5 py-5 sm:px-6">{children}</div>
      {footer ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3 sm:px-6">{footer}</footer> : null}
    </section>
  );
}

function SaveBar({ dirty, pending, onSave, onReset, label = 'Salvar alterações', error }: { dirty: boolean; pending: boolean; onSave: () => void; onReset: () => void; label?: string; error?: string | null }) {
  return (
    <>
      <span className={cn('w-full text-xs sm:mr-auto sm:w-auto', error ? 'font-semibold text-red-600' : 'text-muted-foreground')}>
        {error ?? (dirty ? 'Alterações não salvas' : 'Tudo salvo')}
      </span>
      <div className="flex w-full gap-2 sm:w-auto">
        {dirty ? (
          <Button variant="ghost" onClick={onReset} disabled={pending} className="flex-1 sm:flex-none">
            Descartar
          </Button>
        ) : null}
        <Button onClick={onSave} disabled={!dirty || pending} className="flex-1 sm:flex-none">
          {pending ? 'Salvando…' : label}
        </Button>
      </div>
    </>
  );
}

/** Grupo de campos com rótulo à esquerda no desktop (padrão de páginas de configuração). */
function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-3 border-b border-border py-5 first:pt-0 last:border-0 last:pb-0 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-6">
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function ImagePicker({
  value,
  onChange,
  shape,
  fallback,
  size,
  quality,
  square,
  hint,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  shape: 'round' | 'square';
  fallback: ReactNode;
  size: number;
  quality: number;
  square: boolean;
  hint: string;
}) {
  const [err, setErr] = useState('');
  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    try {
      onChange(await fileToCompressedDataUrl(file, size, quality, square));
    } catch (x) {
      setErr((x as Error).message);
    }
  }
  return (
    <div className="flex items-center gap-4">
      {value ? (
        <img src={value} alt="" className={cn('h-16 w-16 shrink-0 border border-border bg-card', shape === 'round' ? 'rounded-full object-cover' : 'rounded-xl object-contain p-1')} />
      ) : (
        <div className={cn('grid h-16 w-16 shrink-0 place-items-center bg-muted text-muted-foreground', shape === 'round' ? 'rounded-full' : 'rounded-xl')}>{fallback}</div>
      )}
      <div className="min-w-0">
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-card px-3 text-sm font-semibold text-foreground ring-1 ring-inset ring-border transition hover:bg-muted">
            <ImagePlus size={15} /> {value ? 'Trocar' : 'Enviar imagem'}
            <input type="file" accept="image/*" className="hidden" onChange={pick} />
          </label>
          {value ? (
            <button type="button" onClick={() => onChange(null)} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <Trash2 size={15} /> Remover
            </button>
          ) : null}
        </div>
        <p className={cn('mt-1.5 text-xs', err ? 'font-semibold text-red-600' : 'text-muted-foreground')}>{err || hint}</p>
      </div>
    </div>
  );
}

/* ---------------------------------- Perfil ---------------------------------- */
function ProfileSection() {
  const qc = useQueryClient();
  const { user, role, isSuperadmin, refreshContext } = useAuth();
  const { data: profile } = useQuery({ queryKey: ['profile', user?.id], queryFn: () => getProfile(user!.id), enabled: !!user });
  const initial = useMemo(
    () => (profile ? { full_name: profile.full_name ?? '', phone: profile.phone ?? '', avatar_url: profile.avatar_url ?? null } : null),
    [profile],
  );
  const { form, set, dirty, reset } = useForm(initial);

  const save = useMutation({
    mutationFn: async () => {
      if (!form?.full_name.trim()) throw new Error('Informe seu nome.');
      await updateProfile(user!.id, { full_name: form.full_name.trim(), phone: form.phone.trim() || null, avatar_url: form.avatar_url });
      await refreshContext();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile', user?.id] });
      successToast('Perfil salvo');
    },
  });

  if (!form) return <Section title="Perfil">Carregando…</Section>;
  return (
    <Section
      title="Perfil"
      description="Como você aparece para a equipe e nos avisos."
      footer={<SaveBar dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} onReset={reset} error={save.isError ? (save.error as Error).message : null} />}
    >
      <Group title="Foto" hint="Aparece no menu e nos avisos.">
        <div className="sm:col-span-2">
          <ImagePicker
            value={form.avatar_url}
            onChange={(v) => set('avatar_url', v)}
            shape="round"
            size={192}
            quality={0.72}
            square
            hint="JPG ou PNG. A imagem é reduzida automaticamente."
            fallback={<span className="text-xl font-bold uppercase">{(form.full_name || user?.email || '?').slice(0, 1)}</span>}
          />
        </div>
      </Group>
      <Group title="Dados pessoais">
        <Field label="Nome">
          <Input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} placeholder="Seu nome completo" autoComplete="name" />
        </Field>
        <Field label="Telefone / WhatsApp">
          <Input value={form.phone} onChange={(e) => set('phone', maskPhone(e.target.value))} placeholder="(00) 00000-0000" inputMode="tel" autoComplete="tel" />
        </Field>
      </Group>
      <Group title="Acesso" hint="Para trocar o e-mail, fale com o administrador.">
        <Field label="E-mail">
          <Input value={user?.email ?? ''} disabled className="bg-muted text-muted-foreground" />
        </Field>
        <Field label="Papel">
          <div className="flex h-[42px] items-center">
            <StatusBadge tone="none">{isSuperadmin ? 'Administrador' : role ? ROLE_LABEL[role] : '—'}</StatusBadge>
          </div>
        </Field>
      </Group>
    </Section>
  );
}

/* --------------------------------- Segurança -------------------------------- */
function SecuritySection() {
  const { signOut } = useAuth();
  const [current, setCurrent] = useState('');
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [show, setShow] = useState(false);
  const rules = [
    { ok: pwd.length >= 6, label: 'Pelo menos 6 caracteres' },
    { ok: !!pwd && pwd.trim() === pwd, label: 'Sem espaço no começo ou no fim' },
    { ok: !!pwd && pwd === pwd2, label: 'As duas senhas conferem' },
  ];
  const valid = !!current && rules.every((r) => r.ok);

  const change = useMutation({
    mutationFn: () => changePassword(current, pwd),
    onSuccess: () => {
      setCurrent('');
      setPwd('');
      setPwd2('');
      successToast('Senha alterada');
    },
  });
  const type = show ? 'text' : 'password';

  return (
    <>
      <Section
        title="Senha"
        description="Use uma senha que só você saiba. Ela vale para o celular e o computador."
        footer={
          <>
            <span className={cn('mr-auto text-xs', change.isError ? 'font-semibold text-red-600' : 'text-muted-foreground')}>
              {change.isError ? (change.error as Error).message : 'Você continua conectado depois de trocar.'}
            </span>
            <Button onClick={() => change.mutate()} disabled={!valid || change.isPending}>
              {change.isPending ? 'Salvando…' : 'Trocar senha'}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:max-w-md">
          <Field label="Senha atual">
            <Input type={type} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="Nova senha">
            <div className="relative">
              <Input type={type} value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="new-password" className="pr-11" />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground hover:text-foreground"
                aria-label={show ? 'Ocultar senhas' : 'Mostrar senhas'}
              >
                {show ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </Field>
          <Field label="Confirmar nova senha">
            <Input type={type} value={pwd2} onChange={(e) => setPwd2(e.target.value)} autoComplete="new-password" />
          </Field>
          <ul className="space-y-1.5">
            {rules.map((r) => (
              <li key={r.label} className={cn('flex items-center gap-2 text-xs', r.ok ? 'text-foreground' : 'text-muted-foreground')}>
                <span className={cn('grid h-4 w-4 place-items-center rounded-full', r.ok ? 'bg-neutral-950 text-brand' : 'bg-muted')}>
                  {r.ok ? <Check size={11} strokeWidth={3} /> : null}
                </span>
                {r.label}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section title="Sessão" description="Encerra o acesso neste aparelho.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">Em computador compartilhado, sempre saia ao terminar.</p>
          <Button variant="danger" onClick={() => signOut()}>
            <LogOut size={16} /> Sair da conta
          </Button>
        </div>
      </Section>
    </>
  );
}

/* ---------------------------------- Escola ---------------------------------- */
function SchoolSection() {
  const qc = useQueryClient();
  const { refreshContext } = useAuth();
  const { data: schools, isLoading } = useQuery({ queryKey: ['schools'], queryFn: listSchools });
  const school = schools?.[0] ?? null;
  const initial = useMemo(
    () =>
      school
        ? {
            name: school.name ?? '',
            subject: school.subject ?? '',
            logo_url: school.logo_url ?? null,
            director: school.director ?? '',
            cnpj: school.cnpj ?? '',
            inep: school.inep ?? '',
            address: school.address ?? '',
            city: school.city ?? '',
            phone: school.phone ?? '',
          }
        : null,
    [school],
  );
  const { form, set, dirty, reset } = useForm(initial);

  const save = useMutation({
    mutationFn: async () => {
      if (!form?.name.trim()) throw new Error('Informe o nome da escola.');
      await saveSchool({ id: school!.id, ...form, name: form.name.trim() });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schools'] });
      void refreshContext();
      successToast('Dados da escola salvos');
    },
  });

  if (isLoading || !form) return <Section title="Escola">Carregando…</Section>;
  if (!school) return <Section title="Escola">Nenhuma base selecionada.</Section>;

  const text = (k: keyof typeof form, placeholder?: string, extra?: Partial<React.InputHTMLAttributes<HTMLInputElement>>) => (
    <Input value={String(form[k] ?? '')} onChange={(e) => set(k, e.target.value as never)} placeholder={placeholder} {...extra} />
  );

  return (
    <>
      <Section
        title="Escola"
        description="Estes dados aparecem no cabeçalho de boletins, relatórios e links enviados às famílias."
        footer={<SaveBar dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} onReset={reset} error={save.isError ? (save.error as Error).message : null} />}
      >
        <Group title="Identidade" hint="Logo em fundo branco ou transparente fica melhor.">
          <div className="sm:col-span-2">
            <ImagePicker
              value={form.logo_url}
              onChange={(v) => set('logo_url', v)}
              shape="square"
              size={256}
              quality={0.8}
              square={false}
              hint="PNG ou JPG. Aparece no topo dos documentos."
              fallback={<Building2 size={22} />}
            />
          </div>
          <Field label="Nome da escola">{text('name', 'Ex.: Colégio Aurora')}</Field>
          <Field label="Disciplina (boletim)">{text('subject', 'Ex.: Língua Inglesa')}</Field>
        </Group>
        <Group title="Registro" hint="Dados oficiais da instituição.">
          <Field label="Diretor(a)">{text('director', 'Nome completo')}</Field>
          <Field label="CNPJ">
            <Input value={form.cnpj} onChange={(e) => set('cnpj', maskCnpj(e.target.value))} placeholder="00.000.000/0000-00" inputMode="numeric" />
          </Field>
          <Field label="Código INEP">
            <Input value={form.inep} onChange={(e) => set('inep', digits(e.target.value).slice(0, 8))} placeholder="8 dígitos" inputMode="numeric" />
          </Field>
        </Group>
        <Group title="Contato">
          <div className="sm:col-span-2">
            <Field label="Endereço">{text('address', 'Rua, número, bairro')}</Field>
          </div>
          <Field label="Cidade / UF">{text('city', 'Ex.: Goiânia - GO')}</Field>
          <Field label="Telefone">
            <Input value={form.phone} onChange={(e) => set('phone', maskPhone(e.target.value))} placeholder="(00) 0000-0000" inputMode="tel" />
          </Field>
        </Group>
      </Section>

      <DocumentPreview form={form} />
    </>
  );
}

/** Prévia do cabeçalho dos documentos, atualizada enquanto digita. */
function DocumentPreview({ form }: { form: { name: string; subject: string; logo_url: string | null; director: string; cnpj: string; inep: string; address: string; city: string; phone: string } }) {
  const line2 = [form.address, form.city].filter(Boolean).join(' · ');
  const line3 = [form.phone && `Tel. ${form.phone}`, form.cnpj && `CNPJ ${form.cnpj}`, form.inep && `INEP ${form.inep}`].filter(Boolean).join(' · ');
  return (
    <section className="rounded-xl border border-dashed border-border p-4 sm:p-5">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Prévia do cabeçalho dos documentos</p>
      <div className="rounded-lg bg-white p-4 text-neutral-900 ring-1 ring-inset ring-neutral-200 sm:p-5">
        <div className="flex items-center gap-4 border-b border-neutral-200 pb-3">
          {form.logo_url ? <img src={form.logo_url} alt="" className="h-14 w-14 shrink-0 object-contain" /> : null}
          <div className="min-w-0">
            <p className="truncate text-base font-extrabold uppercase tracking-wide">{form.name || 'Nome da escola'}</p>
            {line2 ? <p className="truncate text-xs text-neutral-600">{line2}</p> : null}
            {line3 ? <p className="truncate text-xs text-neutral-600">{line3}</p> : null}
            {form.director ? <p className="truncate text-xs text-neutral-600">Diretor(a): {form.director}</p> : null}
          </div>
        </div>
        <p className="mt-3 text-center text-sm font-bold uppercase tracking-wide">
          Boletim escolar{form.subject ? ` — ${form.subject}` : ''} — {new Date().getFullYear()}
        </p>
      </div>
    </section>
  );
}

/* ------------------------------ Plano e acesso ------------------------------ */
function PlanSection({ baseId }: { baseId: string }) {
  const qc = useQueryClient();
  const { data: bases = [], isLoading } = useQuery({ queryKey: ['admin-bases'], queryFn: listOrgAdmin });
  const base = bases.find((b) => b.id === baseId) ?? null;
  const initial = useMemo(
    () => (base ? { plan: base.plan || 'ativo', max_students: base.max_students ? String(base.max_students) : '', notes: base.notes ?? '' } : null),
    [base],
  );
  const { form, set, dirty, reset } = useForm(initial);

  const save = useMutation({
    mutationFn: () =>
      updateOrganization(baseId, { plan: form!.plan, max_students: form!.max_students ? Math.max(1, Number(form!.max_students)) : null, notes: form!.notes.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-bases'] });
      successToast('Plano atualizado');
    },
  });
  const toggle = useMutation({
    mutationFn: () => setOrgActive(baseId, !base!.active),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-bases'] });
      successToast(base!.active ? 'Base suspensa' : 'Base reativada');
    },
  });

  if (isLoading || !base || !form) return <Section title="Plano e acesso">Carregando…</Section>;
  const limit = form.max_students ? Number(form.max_students) : null;
  const usage = limit ? Math.min(100, Math.round((base.students / limit) * 100)) : null;

  return (
    <>
      <Section
        title="Plano e acesso"
        description="Visível só para você, administrador da plataforma."
        footer={<SaveBar dirty={dirty} pending={save.isPending} onSave={() => save.mutate()} onReset={reset} error={save.isError ? (save.error as Error).message : null} />}
      >
        <Group title="Plano">
          <Field label="Tipo">
            <SegmentedField
              options={[
                { value: 'teste', label: 'Teste' },
                { value: 'ativo', label: 'Ativo' },
              ]}
              value={form.plan}
              onChange={(v) => set('plan', String(v))}
            />
          </Field>
          <Field label="Limite de alunos">
            <input
              value={form.max_students}
              onChange={(e) => set('max_students', digits(e.target.value).slice(0, 6))}
              placeholder="Sem limite"
              inputMode="numeric"
              className={fieldCls}
            />
          </Field>
          <div className="sm:col-span-2">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-semibold text-foreground">
                {base.students} aluno(s) ativo(s){limit ? ` de ${limit}` : ''}
              </span>
              <span className="text-muted-foreground">
                {base.classes} turma(s) · {base.members} pessoa(s) na equipe
              </span>
            </div>
            {usage != null ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className={cn('h-full rounded-full', usage >= 100 ? 'bg-red-500' : usage >= 90 ? 'bg-orange-500' : 'bg-neutral-900')} style={{ width: `${usage}%` }} />
              </div>
            ) : null}
          </div>
        </Group>
        <Group title="Anotações internas" hint="Contrato, contato, combinados. O cliente não vê.">
          <div className="sm:col-span-2">
            <textarea
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              rows={4}
              placeholder="Ex.: contrato anual, vence em 03/2027. Falar com a coordenadora Ana."
              className="w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-brand/40"
            />
          </div>
        </Group>
      </Section>

      <Section title="Situação da base" description="Base suspensa: a equipe não consegue entrar, mas nenhum dado é apagado.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <StatusBadge tone={base.active ? 'ok' : 'bad'}>{base.active ? 'Ativa' : 'Suspensa'}</StatusBadge>
            <span className="text-muted-foreground">desde o cadastro em {new Date(base.created_at).toLocaleDateString('pt-BR')}</span>
          </div>
          <Button
            variant={base.active ? 'danger' : 'primary'}
            disabled={toggle.isPending}
            onClick={() => {
              if (!base.active || confirm(`Suspender "${base.name}"? A equipe perde o acesso até você reativar.`)) toggle.mutate();
            }}
          >
            {base.active ? 'Suspender base' : 'Reativar base'}
          </Button>
        </div>
      </Section>
    </>
  );
}
