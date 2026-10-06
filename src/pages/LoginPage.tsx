import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { AuthShell, authField, authPrimary } from '../components/AuthShell';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signIn(email.trim(), password, remember);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <h2 className="text-2xl font-extrabold tracking-tight text-neutral-950">Entrar</h2>
      <p className="mt-1.5 text-sm text-neutral-500">Acesse o SCOLA com o seu e-mail e senha.</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-neutral-700">E-mail</span>
          <span className={authField}>
            <Mail size={17} className="shrink-0 text-neutral-400" />
            <input type="email" required autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-transparent py-3 text-sm outline-none" placeholder="voce@escola.com.br" />
          </span>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-neutral-700">Senha</span>
          <span className={authField}>
            <Lock size={17} className="shrink-0 text-neutral-400" />
            <input type={show ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-transparent py-3 text-sm outline-none" placeholder="••••••••" />
            <button type="button" onClick={() => setShow((v) => !v)} className="text-neutral-400 hover:text-neutral-900" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </span>
        </label>

        <div className="flex items-center justify-between gap-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-neutral-900" />
            Manter conectado
          </label>
          <Link to="/esqueci-senha" state={{ email }} className="text-sm font-semibold text-neutral-700 underline-offset-4 hover:text-neutral-950 hover:underline">
            Esqueci minha senha
          </Link>
        </div>

        {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p> : null}

        <button type="submit" disabled={busy} className={authPrimary}>
          {busy ? 'Entrando…' : 'Entrar'} {busy ? null : <ArrowRight size={17} />}
        </button>
      </form>

      <div className="mt-6 border-t border-neutral-200 pt-5 text-center">
        <p className="text-sm text-neutral-600">Ainda não tem acesso?</p>
        <Link to="/cadastro" className="mt-2 inline-flex w-full items-center justify-center rounded-lg border border-neutral-300 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-50">
          Criar minha conta
        </Link>
      </div>
    </AuthShell>
  );
}
