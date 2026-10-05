import { ArrowLeft, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Lock, Mail } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Logo, LogoMark } from '../components/Logo';
import { apiPost } from '../lib/api';

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
          {forgot ? <Recover initialEmail={email} onBack={() => setForgot(false)} /> : null}
          <div className={forgot ? 'hidden' : undefined}>
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

          <div className="mt-6 border-t border-neutral-200 pt-5 text-center">
            <button type="button" onClick={() => { setForgot(true); setError(''); }} className="inline-flex items-center gap-2 text-sm font-semibold text-neutral-700 underline-offset-4 hover:text-neutral-950 hover:underline">
              <KeyRound size={16} /> Esqueci minha senha
            </button>
          </div>
          </div>
        </div>
      </main>
    </div>
  );
}

/** "Esqueci minha senha": pede o e-mail e manda o link para criar uma senha nova. */
function Recover({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiPost('/api/auth/forgot', { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div>
        <span className="grid h-12 w-12 place-items-center rounded-full bg-neutral-950 text-white"><CheckCircle2 size={24} /></span>
        <h2 className="mt-5 text-2xl font-extrabold tracking-tight text-neutral-950">Confira seu e-mail</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          Se <b className="text-neutral-900">{email}</b> estiver cadastrado, enviamos um link para criar uma nova senha. Ele vale por 1 hora e só pode ser usado uma vez.
        </p>
        <p className="mt-3 rounded-lg bg-neutral-100 px-3 py-2.5 text-xs text-neutral-600">Não chegou? Veja a pasta de spam ou lixo eletrônico. Se o e-mail não estiver cadastrado, fale com a gestão da sua escola.</p>
        <button onClick={onBack} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-neutral-700 hover:text-neutral-950"><ArrowLeft size={16} /> Voltar para o login</button>
      </div>
    );
  }
  return (
    <form onSubmit={submit}>
      <h2 className="text-2xl font-extrabold tracking-tight text-neutral-950">Esqueci minha senha</h2>
      <p className="mt-1.5 text-sm text-neutral-500">Informe o e-mail da sua conta. Enviaremos um link para você criar uma nova senha.</p>
      <label className="mt-8 block">
        <span className="mb-1.5 block text-xs font-semibold text-neutral-700">E-mail</span>
        <span className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3.5 focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-neutral-900/15">
          <Mail size={17} className="shrink-0 text-neutral-400" />
          <input type="email" required autoFocus autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-transparent py-3 text-sm outline-none" placeholder="voce@escola.com.br" />
        </span>
      </label>
      {error ? <p className="mt-4 rounded-lg bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p> : null}
      <button type="submit" disabled={busy} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-950 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60">
        {busy ? 'Enviando…' : 'Enviar link por e-mail'}
      </button>
      <button type="button" onClick={onBack} className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-neutral-700 hover:text-neutral-950"><ArrowLeft size={16} /> Voltar para o login</button>
    </form>
  );
}
