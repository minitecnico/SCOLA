import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Check, ImagePlus, KeyRound, LogOut, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ROLE_LABEL, type School } from '../lib/types';
import { Button, Card, Field, Input, PageHeader } from '../components/ui';
import { successToast } from '../components/Feedback';
import { can } from '../lib/permissions';
import { fileToCompressedDataUrl } from '../lib/image';
import { changePassword, getProfile, listSchools, saveSchool, updateProfile } from '../lib/queries';

export function SettingsPage() {
  const qc = useQueryClient();
  const { user, role, signOut, refreshContext } = useAuth();
  const { data: profile } = useQuery({
    queryKey: ['profile', user?.id],
    queryFn: () => getProfile(user!.id),
    enabled: !!user,
  });

  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [photoErr, setPhotoErr] = useState('');
  const [current, setCurrent] = useState('');
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');

  useEffect(() => {
    if (profile) {
      setName(profile.full_name ?? '');
      setAvatar(profile.avatar_url ?? null);
    }
  }, [profile]);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPhotoErr('');
    try {
      // foto de perfil: 192px, JPEG (leve)
      setAvatar(await fileToCompressedDataUrl(file, 192, 0.72, true));
    } catch (err) {
      setPhotoErr((err as Error).message);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      await updateProfile(user!.id, { full_name: name.trim(), avatar_url: avatar });
      await refreshContext();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile', user?.id] });
      successToast('Dados salvos com sucesso');
    },
  });

  const changePwd = useMutation({
    mutationFn: async () => {
      if (pwd.length < 6) throw new Error('A senha precisa de pelo menos 6 caracteres.');
      if (pwd !== pwd2) throw new Error('As senhas não conferem.');
      if (!current) throw new Error('Informe a senha atual.');
      await changePassword(current, pwd);
    },
    onSuccess: () => {
      setCurrent('');
      setPwd('');
      setPwd2('');
      successToast('Senha alterada com sucesso');
    },
  });

  return (
    <>
      <PageHeader
        title="Configurações"
        subtitle="Seus dados, sua senha e os dados da escola."
        action={
          role ? (
            <span className="rounded-full bg-neutral-950 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand">
              {ROLE_LABEL[role]}
            </span>
          ) : undefined
        }
      />

      <div className="space-y-5">
        {/* Dados pessoais */}
        <Card>
          <h2 className="mb-4 text-sm font-black uppercase tracking-wide text-muted-foreground">Dados pessoais</h2>

          {/* Foto de perfil */}
          <div className="mb-5 flex items-center gap-4">
            {avatar ? (
              <img src={avatar} alt="" className="h-20 w-20 shrink-0 rounded-full border border-border object-cover" />
            ) : (
              <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full bg-emerald-600 text-2xl font-black uppercase text-white">
                {(name || user?.email || '?').slice(0, 1)}
              </div>
            )}
            <div>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 hover:bg-emerald-100">
                <ImagePlus size={18} /> {avatar ? 'Trocar foto' : 'Adicionar foto'}
                <input type="file" accept="image/*" className="hidden" onChange={onPhoto} />
              </label>
              {avatar ? (
                <button type="button" onClick={() => setAvatar(null)} className="ml-2 inline-flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-red-600">
                  <X size={14} /> Remover
                </button>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">Foto sua ou qualquer imagem. Fica leve e salva no banco.</p>
              {photoErr ? <p className="mt-1 text-xs font-semibold text-red-600">{photoErr}</p> : null}
            </div>
          </div>

          <div className="space-y-4">
            <Field label="Nome de exibição">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Seu nome" />
            </Field>
            <Field label="E-mail de acesso">
              <Input value={user?.email ?? ''} disabled className="bg-muted text-muted-foreground" />
            </Field>
          </div>
        </Card>

        {/* Dados da escola (base de uma escola só) */}
        {can(role, 'turmas') ? <SchoolSettingsCard /> : null}

        {/* Senha */}
        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
            <KeyRound size={16} /> Trocar senha
          </h2>
          <div className="space-y-4">
            <Field label="Senha atual">
              <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label="Nova senha">
              <Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Mínimo 6 caracteres" autoComplete="new-password" />
            </Field>
            <Field label="Confirmar nova senha">
              <Input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} placeholder="Repita a senha" autoComplete="new-password" />
            </Field>
            {changePwd.isError ? <p className="text-sm font-semibold text-red-600">{(changePwd.error as Error).message}</p> : null}
            {changePwd.isSuccess ? <p className="text-sm font-semibold text-emerald-700">Senha alterada com sucesso.</p> : null}
            <Button variant="soft" onClick={() => changePwd.mutate()} disabled={changePwd.isPending || !pwd}>
              {changePwd.isPending ? 'Salvando…' : 'Atualizar senha'}
            </Button>
          </div>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isSuccess && !save.isPending ? (
              <>
                <Check size={18} /> Salvo
              </>
            ) : save.isPending ? (
              'Salvando…'
            ) : (
              'Salvar alterações'
            )}
          </Button>
          <Button variant="danger" onClick={() => signOut()}>
            <LogOut size={18} /> Sair da conta
          </Button>
        </div>
        {save.isError ? <p className="text-sm font-semibold text-red-600">{(save.error as Error).message}</p> : null}
      </div>
    </>
  );
}

/** Edição dos dados da escola quando a base tem exatamente uma escola
 *  (substitui o cadastro "Escolas" no caso comum de uma escola por base). */
function SchoolSettingsCard() {
  const qc = useQueryClient();
  const { refreshContext } = useAuth();
  const { data: schools = [] } = useQuery({ queryKey: ['schools'], queryFn: listSchools });
  const school = schools.length === 1 ? schools[0] : null;

  const [form, setForm] = useState<Partial<School>>({});
  const [logo, setLogo] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (school) {
      setForm({
        name: school.name,
        director: school.director ?? '',
        address: school.address ?? '',
        phone: school.phone ?? '',
        inep: school.inep ?? '',
        city: school.city ?? '',
        subject: school.subject ?? '',
      });
      setLogo(school.logo_url ?? null);
    }
  }, [school]);

  async function onLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr('');
    try {
      setLogo(await fileToCompressedDataUrl(file, 256, 0.8, false));
    } catch (x) {
      setErr((x as Error).message);
    }
  }

  const save = useMutation({
    mutationFn: () => saveSchool({ id: school!.id, name: (form.name || '').trim() || school!.name, ...form, logo_url: logo }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schools'] });
      refreshContext();
      successToast('Dados da escola salvos');
    },
  });

  // Só faz sentido quando a base tem UMA escola (rede usa o menu Escolas).
  if (schools.length !== 1) return null;

  const set = (k: keyof School) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Card>
      <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-wide text-muted-foreground">
        <Building2 size={16} /> Dados da escola
      </h2>
      <p className="mb-4 text-xs text-muted-foreground">Aparecem no cabeçalho dos relatórios (logo, diretor, endereço).</p>

      <div className="mb-5 flex items-center gap-4">
        {logo ? (
          <img src={logo} alt="" className="h-16 w-16 shrink-0 rounded-xl border border-border bg-card object-contain p-1" />
        ) : (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Building2 size={24} />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-muted px-3 py-2 text-sm font-bold text-foreground hover:bg-muted">
            <ImagePlus size={16} /> {logo ? 'Trocar logo' : 'Enviar logo'}
            <input type="file" accept="image/*" className="hidden" onChange={onLogo} />
          </label>
          {logo ? (
            <button onClick={() => setLogo(null)} className="text-left text-xs font-bold text-red-600">
              Remover logo
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome da escola">
          <Input value={form.name ?? ''} onChange={set('name')} />
        </Field>
        <Field label="Diretor(a)">
          <Input value={form.director ?? ''} onChange={set('director')} />
        </Field>
        <Field label="Endereço">
          <Input value={form.address ?? ''} onChange={set('address')} />
        </Field>
        <Field label="Cidade">
          <Input value={form.city ?? ''} onChange={set('city')} />
        </Field>
        <Field label="Telefone">
          <Input value={form.phone ?? ''} onChange={set('phone')} />
        </Field>
        <Field label="Código INEP">
          <Input value={form.inep ?? ''} onChange={set('inep')} />
        </Field>
        <Field label="Disciplina (aparece no boletim)">
          <Input value={form.subject ?? ''} onChange={set('subject')} placeholder="Ex.: Língua Inglesa" />
        </Field>
      </div>
      {err ? <p className="mt-2 text-sm font-semibold text-red-600">{err}</p> : null}
      {save.isError ? <p className="mt-2 text-sm font-semibold text-red-600">{(save.error as Error).message}</p> : null}
      <div className="mt-4">
        <Button variant="soft" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? 'Salvando…' : 'Salvar dados da escola'}
        </Button>
      </div>
    </Card>
  );
}
