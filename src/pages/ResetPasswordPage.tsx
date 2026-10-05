import { CheckCircle2, Eye, EyeOff, Lock } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Logo } from '../components/Logo';
import { apiPost } from '../lib/api';

/** Página aberta pelo link do e-mail: cria a senha nova. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [pwd, setPwd] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (pwd.length < 8) return setError('A senha precisa de pelo menos 8 caracteres.');
    if (pwd !== again) return setError('As duas senhas não são iguais.');
    setBusy(true);
    try {
      await apiPost('/api/auth/reset', { token, password: pwd });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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
        ) : !token ? (
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-neutral-950">Link inválido</h1>
            <p className="mt-2 text-sm text-neutral-600">Peça um novo link em “Esqueci minha senha”, na tela de login.</p>
            <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-neutral-800 underline">Voltar para o login</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-neutral-950">Criar nova senha</h1>
              <p className="mt-1.5 text-sm text-neutral-500">Escolha uma senha com pelo menos 8 caracteres.</p>
            </div>
            {[
              { label: 'Nova senha', v: pwd, set: setPwd, auto: true },
              { label: 'Repita a nova senha', v: again, set: setAgain, auto: false },
            ].map((f) => (
              <label key={f.label} className="block">
                <span className="mb-1.5 block text-xs font-semibold text-neutral-700">{f.label}</span>
                <span className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3.5 focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-neutral-900/15">
                  <Lock size={17} className="shrink-0 text-neutral-400" />
                  <input type={show ? 'text' : 'password'} required autoFocus={f.auto} autoComplete="new-password" value={f.v} onChange={(e) => f.set(e.target.value)} className="w-full bg-transparent py-3 text-sm outline-none" />
                  {f.auto ? (
                    <button type="button" onClick={() => setShow((v) => !v)} className="text-neutral-400 hover:text-neutral-900" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
                      {show ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  ) : null}
                </span>
              </label>
            ))}
            {error ? <p className="rounded-lg bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p> : null}
            <button type="submit" disabled={busy} className="w-full rounded-lg bg-neutral-950 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60">{busy ? 'Salvando…' : 'Salvar nova senha'}</button>
          </form>
        )}
      </div>
    </div>
  );
}
