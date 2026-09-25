import { ArrowRight, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Logo, LogoMark } from '../components/Logo';

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [forgot, setForgot] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[1.1fr_1fr]">
      {/* Painel institucional */}
      <aside className="relative hidden overflow-hidden bg-neutral-950 p-12 text-white lg:flex lg:flex-col">
        <Logo variant="dark" />
        <div className="my-auto max-w-md">
          <p className="mb-4 inline-block rounded-full border border-brand/40 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-brand">
            Plataforma de gestão escolar
          </p>
          <h1 className="text-4xl font-extrabold leading-[1.1] tracking-tight">
            Chamada, notas e boletim <span className="text-brand">no mesmo lugar.</span>
          </h1>
          <p className="mt-5 text-base leading-relaxed text-neutral-400">
            Frequência em poucos toques, notas por trimestre com média automática, relatórios prontos para imprimir e comunicação com a equipe.
          </p>
        </div>
        <p className="text-xs text-neutral-600">© {new Date().getFullYear()} SCOLA</p>
        <LogoMark className="pointer-events-none absolute -bottom-24 -right-24 h-96 w-96 opacity-[0.06]" />
      </aside>

      {/* Formulário */}
      <main className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-neutral-950">Entrar</h2>
          <p className="mt-1.5 text-sm text-neutral-500">Use o e-mail e a senha que você recebeu da sua escola.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-neutral-700">E-mail</span>
              <span className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3.5 focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-brand/40">
                <Mail size={17} className="shrink-0 text-neutral-400" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-transparent py-3 text-sm outline-none"
                  placeholder="voce@escola.com.br"
                />
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-neutral-700">Senha</span>
              <span className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3.5 focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-brand/40">
                <Lock size={17} className="shrink-0 text-neutral-400" />
                <input
                  type={show ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-transparent py-3 text-sm outline-none"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShow((v) => !v)} className="text-neutral-400 hover:text-neutral-900" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </label>

            {error ? <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p> : null}

            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-950 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60"
            >
              {busy ? 'Entrando…' : 'Entrar'} {busy ? null : <ArrowRight size={17} />}
            </button>
          </form>

          <button onClick={() => setForgot((v) => !v)} className="mt-5 text-sm font-medium text-neutral-500 underline-offset-4 hover:text-neutral-900 hover:underline">
            Esqueci minha senha
          </button>
          {forgot ? (
            <p className="mt-3 rounded-lg border-l-4 border-brand bg-brand/10 px-3 py-2.5 text-sm text-neutral-700">
              Peça à gestão da sua escola para gerar uma senha provisória em <b>Equipe</b>. No próximo acesso você cria uma senha nova.
            </p>
          ) : null}
        </div>
      </main>
    </div>
  );
}
