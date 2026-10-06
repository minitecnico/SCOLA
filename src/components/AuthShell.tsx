import type { ReactNode } from 'react';
import { Logo, LogoMark } from './Logo';

/** Moldura das telas públicas (entrar, cadastrar, nova senha): painel institucional à esquerda, formulário à direita. */
export function AuthShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[1.1fr_1fr]">
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
      <main className="flex items-start justify-center px-5 py-10 sm:px-10 lg:items-center">
        <div className={wide ? 'w-full max-w-md' : 'w-full max-w-sm'}>
          <div className="mb-8 lg:hidden">
            <Logo compact height={36} />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

export const authField = 'flex items-center gap-2 rounded-lg border border-neutral-300 px-3.5 focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-neutral-900/15';
export const authPrimary = 'flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-950 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:opacity-60';
