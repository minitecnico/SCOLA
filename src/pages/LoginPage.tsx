import { ArrowRight, ChevronDown, Eye, EyeOff, KeyRound, Lock, Mail } from 'lucide-react';
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
        <Logo variant="dark" height={52} />
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
        <LogoMark className="pointer-events-none absolute -bottom-24 -right-24 h-96 w-96 opacity-[0.06] grayscale" />
      </aside>

      {/* Formulário */}
      <main className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Logo compact height={36} />
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-neutral-950">Entrar</h2>
          <p className="mt-1.5 text-sm text-neutral-500">Use o e-mail e a senha que você recebeu da sua escola.</p>

          <form onSubmit={onSubmit} className="mt-8 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-neutral-700">E-mail</span>
              <span className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3.5 focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-neutral-900/15">
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
              <span className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3.5 focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-neutral-900/15">
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

          <div className="mt-6 border-t border-neutral-200 pt-5">
            <button
              type="button"
              onClick={() => setForgot((v) => !v)}
              aria-expanded={forgot}
              className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-sm font-semibold text-neutral-700 transition hover:text-neutral-950"
            >
              <span className="flex items-center gap-2"><KeyRound size={16} /> Esqueci minha senha</span>
              <ChevronDown size={16} className={`transition-transform ${forgot ? 'rotate-180' : ''}`} />
            </button>
            {forgot ? (
              <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-soft">
                <p className="text-sm font-semibold text-neutral-900">Como recuperar o acesso</p>
                <ol className="mt-3 space-y-3 text-sm text-neutral-600">
                  {[
                    <>Fale com a <b className="text-neutral-900">gestão da sua escola</b>.</>,
                    <>Peça uma <b className="text-neutral-900">senha provisória</b>: ela é gerada em <b className="text-neutral-900">Equipe</b>, no sistema.</>,
                    <>Entre com a senha provisória e <b className="text-neutral-900">crie sua senha nova</b> no primeiro acesso.</>,
                  ].map((t, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-neutral-950 text-xs font-bold text-white">{i + 1}</span>
                      <span className="pt-0.5">{t}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-4 rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-600">
                  É gestor ou professor sem escola vinculada? Fale com o suporte do SCOLA.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
