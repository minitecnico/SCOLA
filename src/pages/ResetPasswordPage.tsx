import { CheckCircle2, Eye, EyeOff, Lock, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { apiPost } from '../lib/api';
import { ROLE_LABEL, type AppRole } from '../lib/types';

type Preview = { kind: 'invite' | 'reset'; email: string; name: string | null; baseName: string | null; role: string | null; hasPassword: boolean };

const field = 'flex items-center gap-2 rounded-lg border border-neutral-300 px-3.5 focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-neutral-900/15';

/**
 * Página aberta pelo link recebido (e-mail ou WhatsApp):
 *  - convite (/convite): a pessoa cria a própria senha e já entra;
 *  - redefinição (/redefinir-senha): cria uma senha nova e volta ao login.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [info, setInfo] = useState<Preview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [name, setName] = useState('');
  const [pwd, setPwd] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    apiPost<Preview>('/api/auth/link/preview', { token })
      .then((p) => { setInfo(p); setName(p.name ?? ''); })
      .catch((e: Error) => setLoadError(e.message));
  }, [token]);

  const rules = [
    { ok: pwd.length >= 8, label: 'Pelo menos 8 caracteres' },
    { ok: !!pwd && pwd.trim() === pwd, label: 'Sem espaço no começo ou no fim' },
    { ok: !!pwd && pwd === again, label: 'As duas senhas conferem' },
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!rules.every((r) => r.ok)) return setError('Confira os requisitos da senha abaixo do campo.');
    setBusy(true);
    try {
      const r = await apiPost<{ kind: string; signedIn: boolean }>('/api/auth/reset', { token, password: pwd, name: name.trim() });
      if (r.signedIn) window.location.assign('/');
      else setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const invite = info?.kind === 'invite';

  return (
    <div className="grid min-h-screen place-items-center bg-white px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-10"><Logo compact height={36} /></div>
        {done ? (
          <div>
            <span className="grid h-12 w-12 place-items-center rounded-full bg-neutral-950 text-white"><CheckCircle2 size={24} /></span>
            <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-neutral-950">Senha alterada</h1>
            <p className="mt-2 text-sm text-neutral-600">Pronto! Agora entre com o seu e-mail e a senha nova.</p>
            <Link to="/login" className="mt-6 flex w-full items-center justify-center rounded-lg bg-neutral-950 py-3 text-sm font-semibold text-white hover:bg-black">Ir para o login</Link>
          </div>
        ) : !token || loadError ? (
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-neutral-950">Link inválido ou vencido</h1>
            <p className="mt-2 text-sm text-neutral-600">{loadError || 'Este link está incompleto.'}</p>
            <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-neutral-800 underline">Ir para o login</Link>
          </div>
        ) : !info ? (
          <p className="text-sm text-neutral-500">Verificando o link…</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-neutral-950">{invite ? 'Bem-vindo(a) ao SCOLA' : 'Criar nova senha'}</h1>
              <p className="mt-1.5 text-sm text-neutral-500">
                {invite
                  ? <>{info.baseName ? <><b className="text-neutral-800">{info.baseName}</b> liberou o seu acesso{info.role ? <> como <b className="text-neutral-800">{ROLE_LABEL[info.role as Exclude<AppRole, 'superadmin'>] ?? info.role}</b></> : null}. </> : null}Crie sua senha para começar.</>
                  : <>Conta <b className="text-neutral-800">{info.email}</b>. Escolha uma senha com pelo menos 8 caracteres.</>}
              </p>
            </div>

            {invite ? (
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-neutral-700">Seu nome</span>
                <span className={field}>
                  <User size={17} className="shrink-0 text-neutral-400" />
                  <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" className="w-full bg-transparent py-3 text-sm outline-none" />
                </span>
              </label>
            ) : null}

            {[
              { label: 'Nova senha', v: pwd, set: setPwd, auto: true },
              { label: 'Repita a senha', v: again, set: setAgain, auto: false },
            ].map((f) => (
              <label key={f.label} className="block">
                <span className="mb-1.5 block text-xs font-semibold text-neutral-700">{f.label}</span>
                <span className={field}>
                  <Lock size={17} className="shrink-0 text-neutral-400" />
                  <input type={show ? 'text' : 'password'} required autoFocus={f.auto && !invite} autoComplete="new-password" value={f.v} onChange={(e) => f.set(e.target.value)} className="w-full bg-transparent py-3 text-sm outline-none" />
                  {f.auto ? (
                    <button type="button" onClick={() => setShow((v) => !v)} className="text-neutral-400 hover:text-neutral-900" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
                      {show ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  ) : null}
                </span>
              </label>
            ))}
            <ul className="space-y-1 text-xs">
              {rules.map((r) => (
                <li key={r.label} className={r.ok ? 'font-semibold text-neutral-900' : 'text-neutral-500'}>{r.ok ? '✓' : '○'} {r.label}</li>
              ))}
            </ul>
            {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p> : null}
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-neutral-950 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60">
              {busy ? 'Salvando…' : invite ? 'Criar senha e entrar' : 'Salvar nova senha'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
