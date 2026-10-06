import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Loading } from './ui';

/**
 * Lista de conversas + painel da conversa aberta (suporte da escola e atendimento do administrador).
 * No celular mostra uma coisa por vez: a lista, ou a conversa com o botão de voltar.
 * `className` define só o tamanho (altura e largura da lista).
 */
export function ThreadSplit({ className, hasSelection, list, pane }: { className: string; hasSelection: boolean; list: ReactNode; pane: ReactNode }) {
  return (
    <div className={cn('grid overflow-hidden rounded-xl border border-border bg-card', className)}>
      <ul className={cn('divide-y divide-border overflow-y-auto', hasSelection && 'hidden md:block')}>{list}</ul>
      <div className={cn('flex min-h-0 flex-col border-border md:border-l', !hasSelection && 'hidden md:flex')}>{pane}</div>
    </div>
  );
}

export function ThreadRow({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <li>
      <button onClick={onClick} className={cn('w-full px-4 py-3 text-left hover:bg-muted/60', active && 'bg-muted')}>
        {children}
      </button>
    </li>
  );
}

/** Estado vazio do painel: carregando a conversa escolhida ou convite para escolher uma. */
export function PanePlaceholder({ selected, hint }: { selected: boolean; hint: string }) {
  return <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">{selected ? <Loading /> : hint}</div>;
}

/** Linha do topo da conversa: voltar (celular), assunto, protocolo e a ação principal. */
export function ThreadHeader({ subject, protocol, onBack, action }: { subject: string; protocol: string; onBack: () => void; action: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={onBack} className="grid h-9 w-9 place-items-center rounded-lg hover:bg-muted md:hidden" aria-label="Voltar">
        <ArrowLeft size={18} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{subject}</p>
        <p className="font-mono text-[11px] text-muted-foreground">Protocolo {protocol}</p>
      </div>
      {action}
    </div>
  );
}
