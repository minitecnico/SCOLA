import { Building2, CheckCircle2, Eye, EyeOff, Lock, Mail, Phone, User } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthShell, authField, authPrimary } from '../components/AuthShell';
import { apiPost } from '../lib/api';

const ROLES = [
  { value: 'professor', label: 'Professor(a)' },
  { value: 'gestor', label: 'Coordenação / Direção' },
  { value: 'secretaria', label: 'Secretaria' },
];

function maskPhone(v: string) {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

type Match = { name: string; sure: boolean } | null;

/** Pedido de cadastro: o administrador analisa e aprova; a pessoa entra com a senha que escolheu aqui. */
export function SignupPage() {
  const [f, setF] = useState({ full_name: '', email: '', phone: '', institution: '', role: 'professor', city: '', note: '', password: '', again: '' });
  const [website, setWebsite] = useState(''); // campo-isca (robôs preenchem)
  const [accepted, setAccepted] = useState(false);
  const [show, setShow] = useState(false);
  const [match, setMatch] = useState<Match>(null);
  const [checking, setChecking] = useState(false);
  const [noMatch, setNoMatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  // "Essa escola existe?" — consulta o sistema enquanto a pessoa digita (tolera erro de digitação e pontuação).
  useEffect(() => {
    setNoMatch(false);
    if (f.institution.trim().length < 3) { setMatch(null); return; }
    setChecking(true);
    const t = setTimeout(() => {
      apiPost<{ match: Match }>('/api/signup/match', { institution: f.institution })
        .then((r) => setMatch(r.match))
        .catch(() => setMatch(null))
        .finally(() => setChecking(false));
    }, 500);
    return () => clearTimeout(t);
  }, [f.institution]);

  const rules = [
    { ok: f.password.length >= 8, label: 'Pelo menos 8 caracteres' },
    { ok: !!f.password && f.password.trim() === f.password, label: 'Sem espaço no começo ou no fim' },
    { ok: !!f.password && f.password === f.again, label: 'As duas senhas conferem' },
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!rules.every((r) => r.ok)) return setError('Confira os requisitos da senha.');
    setBusy(true);
    try {
      await apiPost('/api/signup/request', { ...f, again: undefined, website, accepted, noMatch });
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
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-neutral-950">Cadastro enviado!</h1>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">
          Recebemos o seu pedido. O administrador do SCOLA vai analisar e liberar o seu acesso. Depois disso, é só entrar com o e-mail <b className="text-neutral-900">{f.email}</b> e a senha que você escolheu.
        </p>
        <p className="mt-3 rounded-lg bg-neutral-100 px-3 py-2.5 text-xs text-neutral-600">Se tentar entrar antes da aprovação, o sistema avisa que o cadastro está em análise.</p>
        <Link to="/login" className={`${authPrimary} mt-6`}>Voltar para o login</Link>
      </AuthShell>
    );
  }

  const showMatch = !noMatch && !checking && match;
  return (
    <AuthShell wide>
      <h1 className="text-2xl font-extrabold tracking-tight text-neutral-950">Criar minha conta</h1>
      <p className="mt-1.5 text-sm text-neutral-500">Preencha os dados abaixo. O administrador analisa e libera o seu acesso.</p>

      <form onSubmit={submit} className="mt-7 space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-neutral-700">Nome completo</span>
          <span className={authField}><User size={17} className="shrink-0 text-neutral-400" /><input required autoComplete="name" value={f.full_name} onChange={set('full_name')} className="w-full bg-transparent py-3 text-sm outline-none" placeholder="Maria da Silva" /></span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-neutral-700">E-mail</span>
            <span className={authField}><Mail size={17} className="shrink-0 text-neutral-400" /><input type="email" required autoComplete="email" value={f.email} onChange={set('email')} className="w-full min-w-0 bg-transparent py-3 text-sm outline-none" placeholder="voce@email.com" /></span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-neutral-700">Telefone (WhatsApp)</span>
            <span className={authField}><Phone size={17} className="shrink-0 text-neutral-400" /><input type="tel" inputMode="tel" required autoComplete="tel" value={f.phone} onChange={(e) => setF((p) => ({ ...p, phone: maskPhone(e.target.value) }))} className="w-full min-w-0 bg-transparent py-3 text-sm outline-none" placeholder="(00) 00000-0000" /></span>
          </label>
        </div>

        <div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-neutral-700">Instituição de ensino</span>
            <span className={authField}><Building2 size={17} className="shrink-0 text-neutral-400" /><input required value={f.institution} onChange={set('institution')} className="w-full bg-transparent py-3 text-sm outline-none" placeholder="Ex.: Escola ABC" /></span>
          </label>
          <div className="mt-1.5 min-h-[1.25rem] text-xs" aria-live="polite">
            {checking ? <span className="text-neutral-500">Procurando no sistema…</span> : null}
            {showMatch ? (
              <span className="text-neutral-800">
                ✓ {match.sure ? 'Encontramos' : 'Você quis dizer'} <b>{match.name}</b>?{' '}
                <button type="button" onClick={() => setNoMatch(true)} className="font-semibold underline underline-offset-2">Não é essa</button>
              </span>
            ) : null}
            {!checking && f.institution.trim().length >= 3 && (!match || noMatch) ? (
              <span className="text-neutral-500">Não encontramos essa instituição entre as cadastradas. Tudo bem: o administrador vai analisar o seu pedido.</span>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-neutral-700">Sua função</span>
            <select value={f.role} onChange={set('role')} className="w-full rounded-lg border border-neutral-300 bg-white px-3.5 py-3 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/15">
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-neutral-700">Cidade / UF <span className="font-normal text-neutral-400">(opcional)</span></span>
            <input value={f.city} onChange={set('city')} className="w-full rounded-lg border border-neutral-300 px-3.5 py-3 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/15" placeholder="Goiânia - GO" />
          </label>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-neutral-700">Algo que ajude na análise <span className="font-normal text-neutral-400">(opcional)</span></span>
          <textarea value={f.note} onChange={set('note')} rows={2} maxLength={500} className="w-full resize-none rounded-lg border border-neutral-300 px-3.5 py-3 text-sm outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/15" placeholder="Ex.: Sou professora de Matemática do 6º ao 9º ano; a coordenadora é a Ana." />
        </label>

        <div className="space-y-4 rounded-lg border border-neutral-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Escolha sua senha</p>
          {[
            { label: 'Senha', k: 'password' as const, toggle: true },
            { label: 'Repita a senha', k: 'again' as const, toggle: false },
          ].map((p) => (
            <label key={p.k} className="block">
              <span className="mb-1.5 block text-xs font-semibold text-neutral-700">{p.label}</span>
              <span className={authField}>
                <Lock size={17} className="shrink-0 text-neutral-400" />
                <input type={show ? 'text' : 'password'} required autoComplete="new-password" value={f[p.k]} onChange={set(p.k)} className="w-full bg-transparent py-3 text-sm outline-none" />
                {p.toggle ? (
                  <button type="button" onClick={() => setShow((v) => !v)} className="text-neutral-400 hover:text-neutral-900" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}>
                    {show ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                ) : null}
              </span>
            </label>
          ))}
          <ul className="space-y-1 text-xs">
            {rules.map((r) => <li key={r.label} className={r.ok ? 'font-semibold text-neutral-900' : 'text-neutral-500'}>{r.ok ? '✓' : '○'} {r.label}</li>)}
          </ul>
        </div>

        {/* campo-isca: invisível para pessoas */}
        <input tabIndex={-1} autoComplete="off" aria-hidden value={website} onChange={(e) => setWebsite(e.target.value)} className="absolute -left-[9999px] h-0 w-0 opacity-0" name="website" />

        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-neutral-700">
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-neutral-900" />
          <span>Li e aceito os <a href="/termos.html" target="_blank" rel="noreferrer" className="font-semibold underline">Termos de Uso</a> e a <a href="/privacidade.html" target="_blank" rel="noreferrer" className="font-semibold underline">Política de Privacidade</a>.</span>
        </label>

        {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p> : null}
        <button type="submit" disabled={busy || !accepted} className={authPrimary}>{busy ? 'Enviando…' : 'Enviar pedido de cadastro'}</button>
      </form>

      <p className="mt-6 text-center text-sm text-neutral-600">Já tem acesso? <Link to="/login" className="font-semibold text-neutral-900 underline underline-offset-2">Entrar</Link></p>
    </AuthShell>
  );
}
