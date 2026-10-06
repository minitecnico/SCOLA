import { CheckCircle2, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AuthShell, authField, authPrimary } from '../components/AuthShell';
import { apiPost } from '../lib/api';

/**
 * "Esqueci minha senha", sem e-mail e sem conta externa: a pessoa já escolhe a senha nova e envia o pedido.
 * A coordenação da escola (ou o administrador) confirma que é ela mesma; aprovado, a senha nova passa a valer.
 */
export function ForgotPage() {
  const loc = useLocation();
  const [email, setEmail] = useState((loc.state as { email?: string } | null)?.email ?? '');
  const [pwd, setPwd] = useState('');
  const [again, setAgain] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const rules = [
    { ok: pwd.length >= 8, label: 'Pelo menos 8 caracteres' },
    { ok: !!pwd && pwd.trim() === pwd, label: 'Sem espaço no começo ou no fim' },
    { ok: !!pwd && pwd === again, label: 'As duas senhas conferem' },
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!rules.every((r) => r.ok)) return setError('Confira os requisitos da senha.');
    setBusy(true);
    try {
      await apiPost('/api/signup/reset', { email: email.trim(), password: pwd });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthShell>
        <span className="grid h-12 w-12 place-items-center rounded-full bg-neutral-950 text-white"><CheckCircle2 size={24} /></span>
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-neutral-950">Pedido enviado</h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          A coordenação da sua escola foi avisada. Quando ela confirmar que é você, a senha que você acabou de escolher passa a valer — é só entrar com ela.
        </p>
        <p className="mt-3 rounded-lg bg-neutral-100 px-3 py-2.5 text-xs text-neutral-600">Para agilizar, avise a coordenação pelo WhatsApp que você pediu uma nova senha. Se você é a coordenação, o pedido vai para o administrador do SCOLA.</p>
        <Link to="/login" className={`${authPrimary} mt-6`}>Voltar para o login</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-2xl font-extrabold tracking-tight text-neutral-950">Esqueci minha senha</h1>
      <p className="mt-1.5 text-sm text-neutral-500">Informe seu e-mail e escolha uma senha nova. A coordenação confirma que é você e libera.</p>
      <form onSubmit={submit} className="mt-7 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-neutral-700">E-mail da sua conta</span>
          <span className={authField}><Mail size={17} className="shrink-0 text-neutral-400" /><input type="email" required autoFocus autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-transparent py-3 text-sm outline-none" placeholder="voce@escola.com.br" /></span>
        </label>
        {[
          { label: 'Nova senha', v: pwd, set: setPwd, toggle: true },
          { label: 'Repita a nova senha', v: again, set: setAgain, toggle: false },
        ].map((p) => (
          <label key={p.label} className="block">
            <span className="mb-1.5 block text-xs font-semibold text-neutral-700">{p.label}</span>
            <span className={authField}>
              <Lock size={17} className="shrink-0 text-neutral-400" />
              <input type={show ? 'text' : 'password'} required autoComplete="new-password" value={p.v} onChange={(e) => p.set(e.target.value)} className="w-full bg-transparent py-3 text-sm outline-none" />
              {p.toggle ? (
                <button type="button" onClick={() => setShow((v) => !v)} className="text-neutral-400 hover:text-neutral-900" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>{show ? <EyeOff size={17} /> : <Eye size={17} />}</button>
              ) : null}
            </span>
          </label>
        ))}
        <ul className="space-y-1 text-xs">
          {rules.map((r) => <li key={r.label} className={r.ok ? 'font-semibold text-neutral-900' : 'text-neutral-500'}>{r.ok ? '✓' : '○'} {r.label}</li>)}
        </ul>
        {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p> : null}
        <button type="submit" disabled={busy} className={authPrimary}>{busy ? 'Enviando…' : 'Pedir nova senha'}</button>
      </form>
      <p className="mt-6 text-center text-sm text-neutral-600"><Link to="/login" className="font-semibold text-neutral-900 underline underline-offset-2">Voltar para o login</Link></p>
    </AuthShell>
  );
}
