import { KeyRound, LogOut, PauseCircle } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from '../components/Logo';
import { Button, Field, Input } from '../components/ui';
import { changePassword } from '../lib/queries';

function GateFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-5 py-10">
      <div className="mb-8">
        <Logo compact height={36} />
      </div>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-7 shadow-card">{children}</div>
    </div>
  );
}

/** Primeiro acesso (ou senha redefinida): obriga a criar uma senha própria. */
export function ChangePasswordGate() {
  const { refreshContext, signOut, user } = useAuth();
  const [pwd, setPwd] = useState('');
  const [pwd2, setPwd2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (pwd.length < 6) return setError('A senha precisa de pelo menos 6 caracteres.');
    if (pwd !== pwd2) return setError('As senhas não conferem.');
    setBusy(true);
    try {
      await changePassword('', pwd);
      await refreshContext();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <GateFrame>
      <div className="mb-5 grid h-11 w-11 place-items-center rounded-lg bg-brand text-neutral-950">
        <KeyRound size={20} />
      </div>
      <h1 className="text-xl font-bold">Crie sua senha</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Você entrou com uma senha provisória ({user?.email}). Defina agora uma senha pessoal para continuar.
      </p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <Field label="Nova senha">
          <Input type="password" autoComplete="new-password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus placeholder="Mínimo 6 caracteres" />
        </Field>
        <Field label="Confirmar senha">
          <Input type="password" autoComplete="new-password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} placeholder="Repita a senha" />
        </Field>
        {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar e entrar'}
        </Button>
      </form>
      <button onClick={() => signOut()} className="mt-4 text-sm text-muted-foreground hover:text-foreground">
        Sair
      </button>
    </GateFrame>
  );
}

/** Base suspensa ou usuário sem vínculo. */
export function BlockedGate({ suspended }: { suspended: boolean }) {
  const { signOut } = useAuth();
  return (
    <GateFrame>
      <div className="mb-5 grid h-11 w-11 place-items-center rounded-lg bg-neutral-950 text-brand">
        <PauseCircle size={20} />
      </div>
      <h1 className="text-xl font-bold">{suspended ? 'Acesso suspenso' : 'Sem acesso a nenhuma base'}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {suspended
          ? 'O acesso desta escola está temporariamente suspenso. Entre em contato com o suporte do SCOLA para regularizar.'
          : 'Sua conta ainda não está vinculada a uma escola. Peça à gestão da escola para adicionar você na Equipe.'}
      </p>
      <Button variant="ghost" className="mt-6" onClick={() => signOut()}>
        <LogOut size={16} /> Sair
      </Button>
    </GateFrame>
  );
}
