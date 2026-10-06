import { ArrowLeft, ArrowRight, Eye, EyeOff, Lock, Mail, MessageCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Logo, LogoMark } from '../components/Logo';
import { apiGet } from '../lib/api';

type AuthConfig = { google: boolean };

/** Mensagens para os retornos do "Entrar com Google" (/login?erro=...). */
const GOOGLE_ERRORS: Record<string, string> = {
  'sem-conta': 'Este e-mail do Google não está cadastrado em nenhuma escola. Peça um convite à gestão da sua escola.',
  bloqueado: 'Seu acesso está bloqueado. Fale com o administrador do SCOLA.',
  'google-cancelado': 'Você cancelou a entrada com o Google.',
  'google-erro': 'Não foi possível entrar com o Google. Tente de novo.',
  'google-indisponivel': 'A entrada com o Google não está ativada neste servidor.',
};

const field = 'flex items-center gap-2 rounded-lg border border-neutral-300 px-3.5 focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-neutral-900/15';
const primary = 'flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-950 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60';

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export function LoginPage() {
  const { signIn } = useAuth();
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => GOOGLE_ERRORS[new URLSearchParams(window.location.search).get('erro') ?? ''] ?? '');
  const [forgot, setForgot] = useState(false);

  useEffect(() => {
    apiGet<AuthConfig>('/api/auth/config').then(setCfg).catch(() => setCfg({ google: false }));
  }, []);

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

  const googleHref = `/api/auth/google/start?remember=${remember ? 1 : 0}`;

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

          {forgot ? <Recover onBack={() => setForgot(false)} /> : null}

          {!forgot ? (
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight text-neutral-950">Entrar</h2>
              <p className="mt-1.5 text-sm text-neutral-500">Acesse o SCOLA com a sua conta.</p>

              {cfg?.google ? (
                <>
                  <a
                    href={googleHref}
                    className="mt-7 flex w-full items-center justify-center gap-3 rounded-lg border border-neutral-300 bg-white py-3 text-sm font-semibold text-neutral-900 transition hover:bg-neutral-50"
                  >
                    <GoogleG /> Continuar com o Google
                  </a>
                  <div className="my-5 flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-neutral-400">
                    <span className="h-px flex-1 bg-neutral-200" /> ou com e-mail <span className="h-px flex-1 bg-neutral-200" />
                  </div>
                </>
              ) : null}

              <form onSubmit={onSubmit} className={cfg?.google ? 'space-y-4' : 'mt-8 space-y-4'}>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-neutral-700">E-mail</span>
                  <span className={field}>
                    <Mail size={17} className="shrink-0 text-neutral-400" />
                    <input type="email" required autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-transparent py-3 text-sm outline-none" placeholder="voce@escola.com.br" />
                  </span>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-neutral-700">Senha</span>
                  <span className={field}>
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
                  <button type="button" onClick={() => { setForgot(true); setError(''); }} className="text-sm font-semibold text-neutral-700 underline-offset-4 hover:text-neutral-950 hover:underline">
                    Esqueci minha senha
                  </button>
                </div>

                {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p> : null}

                <button type="submit" disabled={busy} className={primary}>
                  {busy ? 'Entrando…' : 'Entrar'} {busy ? null : <ArrowRight size={17} />}
                </button>
              </form>

              <p className="mt-6 border-t border-neutral-200 pt-5 text-center text-xs leading-relaxed text-neutral-500">
                Primeiro acesso? Abra o <b className="text-neutral-700">link de convite</b> que a sua escola enviou pelo WhatsApp. Não há cadastro aberto: a escola libera cada pessoa.
              </p>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}

/** "Esqueci minha senha": sem e-mail automático — quem libera o acesso (a coordenação) gera um link novo. */
function Recover({ onBack }: { onBack: () => void }) {
  return (
    <div>
      <span className="grid h-12 w-12 place-items-center rounded-full bg-neutral-950 text-white"><MessageCircle size={22} /></span>
      <h2 className="mt-5 text-2xl font-extrabold tracking-tight text-neutral-950">Esqueceu a senha?</h2>
      <p className="mt-2 text-sm leading-relaxed text-neutral-600">
        Peça um <b className="text-neutral-900">novo link de acesso</b> à coordenação da sua escola. Ela gera o link em <b className="text-neutral-900">Equipe</b> e envia pelo WhatsApp; você abre e cria uma senha nova em segundos.
      </p>
      <ul className="mt-4 space-y-2 rounded-lg bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
        <li>• Sua conta é do Gmail? Use <b>Continuar com o Google</b> e não precisa de senha.</li>
        <li>• É da coordenação ou professor autônomo? Chame o suporte do SCOLA.</li>
      </ul>
      <button onClick={onBack} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-neutral-700 hover:text-neutral-950"><ArrowLeft size={16} /> Voltar para o login</button>
    </div>
  );
}
