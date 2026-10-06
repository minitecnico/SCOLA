import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Download, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { confirmTwoFactor, disableTwoFactor, getSecurityStatus, startTwoFactor } from '../lib/queries';
import { successToast } from './Feedback';
import { Button, Input } from './ui';

/** Ativar/desativar a verificação em duas etapas (aplicativo autenticador). Só aparece se o servidor permite. */
export function TwoFactorCard() {
  const qc = useQueryClient();
  const { data: st } = useQuery({ queryKey: ['security-status'], queryFn: getSecurityStatus });
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [pwd, setPwd] = useState('');
  const [copied, setCopied] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['security-status'] });

  useEffect(() => {
    if (!setup) return setQr('');
    import('qrcode').then((m) => m.toDataURL(setup.otpauth, { margin: 1, width: 192 })).then(setQr).catch(() => setQr(''));
  }, [setup]);

  const start = useMutation({ mutationFn: startTwoFactor, onSuccess: (r) => { setSetup(r); setCode(''); } });
  const confirm = useMutation({
    mutationFn: () => confirmTwoFactor(code),
    onSuccess: (r) => { setCodes(r.backupCodes); setSetup(null); setCode(''); refresh(); successToast('Verificação em duas etapas ativada'); },
  });
  const disable = useMutation({
    mutationFn: () => disableTwoFactor({ password: pwd, code }),
    onSuccess: () => { setDisabling(false); setPwd(''); setCode(''); refresh(); successToast('Verificação em duas etapas desativada'); },
  });

  if (!st?.twoFactorAvailable) return null;

  if (codes) {
    const text = `Códigos de recuperação do SCOLA (cada um vale uma vez)\n\n${codes.join('\n')}\n`;
    return (
      <div>
        <p className="text-sm font-semibold text-foreground">Guarde seus códigos de recuperação</p>
        <p className="mt-1 text-sm text-muted-foreground">Se perder o celular, cada código entra uma vez no lugar do aplicativo. Eles não serão mostrados de novo.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-muted p-4 font-mono text-sm sm:grid-cols-4">{codes.map((c) => <span key={c}>{c}</span>)}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={async () => { await navigator.clipboard.writeText(text).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
            {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copiado' : 'Copiar'}
          </Button>
          <a download="scola-codigos-de-recuperacao.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-4 text-sm font-semibold ring-1 ring-inset ring-border hover:bg-muted"><Download size={16} /> Baixar</a>
          <Button onClick={() => setCodes(null)} className="ml-auto">Guardei os códigos</Button>
        </div>
      </div>
    );
  }

  if (st.twoFactorEnabled) {
    return (
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><ShieldCheck size={17} /> Ativada <span className="font-normal text-muted-foreground">· {st.backupLeft} código(s) de recuperação restante(s)</span></p>
        {disabling ? (
          <form className="mt-3 space-y-3" onSubmit={(e) => { e.preventDefault(); disable.mutate(); }}>
            {st.hasPassword ? <Input type="password" placeholder="Sua senha" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="current-password" required /> : null}
            <Input placeholder="Código do aplicativo (ou de recuperação)" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" required />
            {disable.isError ? <p className="text-sm font-medium text-red-600">{(disable.error as Error).message}</p> : null}
            <div className="flex gap-2"><Button type="submit" variant="danger" disabled={disable.isPending}>Desativar</Button><Button type="button" variant="ghost" onClick={() => setDisabling(false)}>Cancelar</Button></div>
          </form>
        ) : (
          <Button variant="ghost" className="mt-3" onClick={() => setDisabling(true)}>Desativar</Button>
        )}
      </div>
    );
  }

  if (setup) {
    return (
      <form onSubmit={(e) => { e.preventDefault(); confirm.mutate(); }} className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Instale um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…).</li>
          <li>Escaneie o QR code (ou digite a chave) no aplicativo.</li>
          <li>Digite o código de 6 dígitos que o aplicativo mostrar.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-4">
          {qr ? <img src={qr} alt="QR code para o aplicativo autenticador" width={160} height={160} className="rounded-lg border border-border" /> : <div className="h-40 w-40 rounded-lg bg-muted" />}
          <div className="min-w-0 text-sm">
            <p className="text-xs text-muted-foreground">Não consegue escanear? Digite esta chave:</p>
            <p className="mt-1 break-all font-mono text-sm font-semibold text-foreground">{setup.secret.match(/.{1,4}/g)?.join(' ')}</p>
          </div>
        </div>
        <Input inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value)} required className="max-w-[10rem] tracking-widest" />
        {confirm.isError ? <p className="text-sm font-medium text-red-600">{(confirm.error as Error).message}</p> : null}
        <div className="flex gap-2"><Button type="submit" disabled={confirm.isPending || code.replace(/\s/g, '').length < 6}>Confirmar e ativar</Button><Button type="button" variant="ghost" onClick={() => setSetup(null)}>Cancelar</Button></div>
      </form>
    );
  }

  return (
    <div>
      <p className="text-sm text-muted-foreground">Além da senha, pede um código do seu celular a cada entrada. Recomendado para gestão e secretaria, que acessam dados de alunos.</p>
      {start.isError ? <p className="mt-2 text-sm font-medium text-red-600">{(start.error as Error).message}</p> : null}
      <Button className="mt-3" onClick={() => start.mutate()} disabled={start.isPending}><ShieldCheck size={16} /> Ativar verificação em duas etapas</Button>
    </div>
  );
}
