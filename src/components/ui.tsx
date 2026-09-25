import { Dialog, DialogPanel, DialogTitle, Menu, MenuButton, MenuItem, MenuItems, Transition, TransitionChild } from '@headlessui/react';
import { Archive, ArrowLeft, Check, CheckSquare, ChevronDown, Lock, MoreVertical, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { Fragment, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '../lib/cn';
import { TONE, type Tone } from '../lib/tone';

/* --------------------------------- Botões -------------------------------------- */
type Variant = 'primary' | 'ghost' | 'danger' | 'soft';
const variants: Record<Variant, string> = {
  // Ação principal: preto sólido, sóbrio
  primary: 'bg-neutral-900 text-white shadow-glow hover:bg-black active:scale-[.98]',
  // Destaque suave em amarelo
  soft: 'bg-brand/15 text-neutral-900 ring-1 ring-inset ring-brand/50 hover:bg-brand/30 active:scale-[.98]',
  ghost: 'bg-card text-foreground ring-1 ring-inset ring-border shadow-soft hover:bg-muted active:scale-[.98]',
  danger: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-100 hover:bg-red-100 active:scale-[.98]',
};

export function Button({
  variant = 'primary',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* --------------------------------- Campos -------------------------------------- */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-neutral-700">{label}</span>
      {children}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-brand/40',
        className,
      )}
      {...props}
    />
  );
}

/** Caixa de busca padrão (ícone + input), usada em listas e tabelas. */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Buscar…',
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={cn('flex items-center gap-2 rounded-lg border border-input bg-card px-3.5 py-2.5 focus-within:border-neutral-900 focus-within:ring-2 focus-within:ring-brand/40', className)}>
      <Search size={18} className="shrink-0 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-sm outline-none"
      />
    </label>
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'w-full rounded-lg border border-input bg-card px-3.5 py-2.5 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-brand/40',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/* -------------------------------- Cabeçalho ------------------------------------ */
export function PageHeader({
  title,
  subtitle,
  action,
  back = true,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  back?: boolean;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const showBack = back && pathname !== '/'; // no Início não mostra voltar

  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {showBack ? (
          <button
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
            aria-label="Voltar"
            title="Voltar"
          >
            <ArrowLeft size={20} />
          </button>
        ) : null}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold tracking-tight text-foreground">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm font-medium text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ------------------------- Controle segmentado (abas/filtros) ----------------- */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex flex-wrap rounded-lg bg-card p-1 ring-1 ring-inset ring-border', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-sm font-semibold transition-all duration-150',
            value === o.value ? 'bg-neutral-900 text-white shadow-soft' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button onClick={onClick}>
      <Plus size={18} /> {label}
    </Button>
  );
}

/* ---------------------------------- Cartões ------------------------------------ */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-5 shadow-card', className)}>{children}</div>
  );
}

/* -------------------------------- Carregando ---------------------------------- */
export function Loading({ label = 'Carregando…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-2 py-8 text-sm font-semibold text-muted-foreground', className)}>
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-neutral-900" />
      {label}
    </div>
  );
}

/* ----------------------------- Título de seção -------------------------------- */
export function SectionTitle({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-2 flex items-center justify-between gap-2', className)}>
      <h2 className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">{children}</h2>
      {action}
    </div>
  );
}

/* ------------------------------- Cartão de KPI -------------------------------- */
export function StatCard({
  icon,
  value,
  label,
  sub,
  to,
  highlight,
}: {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  sub?: string;
  to?: string;
  highlight?: boolean;
}) {
  // Widget de KPI: rótulo em cima, número grande, ícone com gradiente à direita.
  const inner = (
    <Card className={cn('p-5', to && 'transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift', highlight && 'border-brand bg-brand/10')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-extrabold leading-none tracking-tight text-foreground tabular-nums">{value}</p>
        </div>
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand text-neutral-900">{icon}</div>
      </div>
      {sub ? <p className="mt-3 text-xs font-bold text-emerald-600">{sub}</p> : null}
    </Card>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

export function EmptyState({ icon, title, hint, action }: { icon: ReactNode; title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="animate-scale-in rounded-2xl border border-dashed border-border bg-card p-10 text-center shadow-soft">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-xl bg-brand text-neutral-900">{icon}</div>
      <h3 className="text-lg font-bold text-foreground">{title}</h3>
      {hint ? <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/* -------------------------- Seleção múltipla (modo) ---------------------------- */

/** Botão de cabeçalho que entra/sai do modo de seleção. */
export function SelectModeButton({ active, onEnable, onCancel }: { active: boolean; onEnable: () => void; onCancel: () => void }) {
  return active ? (
    <Button variant="ghost" onClick={onCancel}>
      <X size={18} /> Cancelar
    </Button>
  ) : (
    <Button variant="ghost" onClick={onEnable}>
      <CheckSquare size={18} /> Selecionar
    </Button>
  );
}

/** Barra flutuante de ações da seleção (só aparece no modo de seleção). */
export function SelectionBar({
  active,
  count,
  allSelected,
  onToggleAll,
  onDelete,
  onCancel,
  busy,
}: {
  active: boolean;
  count: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onDelete: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  if (!active) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 p-3 shadow-[0_-8px_30px_rgba(15,23,42,.10)] backdrop-blur lg:pl-72">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-1">
        <button onClick={onToggleAll} className="flex shrink-0 items-center gap-2 text-sm font-bold text-muted-foreground">
          <span className={cn('grid h-5 w-5 place-items-center rounded border', allSelected ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-border')}>
            {allSelected ? <Check size={14} /> : null}
          </span>
          Todos
        </button>
        <span className="text-sm font-black text-foreground">{count} selecionado(s)</span>
        <button onClick={onCancel} className="ml-auto hidden text-sm font-bold text-muted-foreground hover:text-foreground sm:block">
          Cancelar
        </button>
        <Button variant="danger" className="ml-auto sm:ml-0" onClick={onDelete} disabled={!count || busy}>
          <Trash2 size={16} /> {busy ? 'Excluindo…' : count ? `Excluir (${count})` : 'Excluir'}
        </Button>
      </div>
    </div>
  );
}

/** Checkbox quadrado padronizado para seleção em listas. */
export function CheckBox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      className="h-5 w-5 shrink-0 cursor-pointer rounded border-border text-emerald-600 focus:ring-emerald-500"
    />
  );
}

/* --------------------------- Menu de ações da linha ---------------------------- */
export function ActionsMenu({ onEdit, onArchive, onDelete }: { onEdit: () => void; onArchive?: () => void; onDelete: () => void }) {
  return (
    <Menu as="div" className="relative shrink-0">
      <MenuButton
        className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-muted-foreground hover:bg-muted"
        aria-label="Ações"
        onClick={(e) => e.stopPropagation()}
      >
        <MoreVertical size={18} />
      </MenuButton>
      <MenuItems
        anchor="bottom end"
        className="z-50 w-44 rounded-xl border border-border bg-card p-1 text-sm shadow-soft focus:outline-none"
      >
        <MenuItem>
          <button
            onClick={onEdit}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 font-bold text-foreground data-[focus]:bg-muted"
          >
            <Pencil size={16} /> Editar
          </button>
        </MenuItem>
        {onArchive ? (
          <MenuItem>
            <button
              onClick={onArchive}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 font-bold text-amber-700 data-[focus]:bg-amber-50"
            >
              <Archive size={16} /> Arquivar
            </button>
          </MenuItem>
        ) : null}
        <MenuItem>
          <button
            onClick={onDelete}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 font-bold text-red-600 data-[focus]:bg-red-50"
          >
            <Trash2 size={16} /> Excluir
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  );
}

/* ---------------------------------- Modal -------------------------------------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  size = 'lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  size?: 'lg' | 'xl';
}) {
  const maxW = size === 'xl' ? 'max-w-3xl' : 'max-w-lg';
  return (
    <Transition show={open} as={Fragment}>
      <Dialog className="relative z-50" onClose={onClose}>
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/60 backdrop-blur-[2px]" />
        </TransitionChild>
        <div className="fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="translate-y-full opacity-0 sm:translate-y-4"
            enterTo="translate-y-0 opacity-100"
            leave="ease-in duration-150"
            leaveFrom="translate-y-0 opacity-100"
            leaveTo="translate-y-full opacity-0 sm:translate-y-4"
          >
            <DialogPanel className={cn('flex max-h-[90vh] w-full flex-col rounded-t-2xl bg-card shadow-lift sm:rounded-2xl', maxW)}>
              <div className="flex items-center justify-between border-b border-border p-5">
                <DialogTitle className="text-lg font-bold text-foreground">{title}</DialogTitle>
                <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-muted-foreground hover:bg-muted" aria-label="Fechar">
                  <X size={18} />
                </button>
              </div>
              <div className="overflow-y-auto p-5">{children}</div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}

/* =============================================================================
 * Padrões de tela (filtros, resumo, situação, ações, rodapé de salvar).
 * Toda tela operacional usa estes blocos — mesma ordem, mesmo espaçamento:
 *   PageHeader → FilterBar → Notice (se houver) → StatGrid → conteúdo → ActionFooter
 * ========================================================================== */

/** Barra de filtros: um único cartão com os campos lado a lado (quebra no celular). */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-4 grid grid-cols-2 gap-x-3 gap-y-3 rounded-xl border border-border bg-card p-3 shadow-soft sm:p-4 lg:flex lg:flex-wrap lg:items-end', className)}>
      {children}
    </div>
  );
}

/** Campo da barra de filtros. `wide` ocupa a linha inteira no celular; `grow` estica no desktop. */
export function FilterField({
  label,
  children,
  wide,
  grow,
  className,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  grow?: boolean;
  className?: string;
}) {
  return (
    <label className={cn('block min-w-0', wide && 'col-span-2 lg:col-span-1', grow ? 'lg:min-w-[14rem] lg:flex-1' : 'lg:w-auto lg:min-w-[10rem]', className)}>
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Classes de um campo compacto (select/input/date) dentro da FilterBar. */
export const fieldCls =
  'h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none transition focus:border-neutral-900 focus:ring-2 focus:ring-brand/40 disabled:bg-muted disabled:text-muted-foreground';

/** Controle segmentado compacto, com a mesma altura dos campos (para filtros). */
export function SegmentedField<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex h-10 w-full rounded-lg border border-input bg-muted/60 p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[13px] font-semibold transition',
            value === o.value ? 'bg-neutral-900 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Cartão de resumo com cor de significado (verde / laranja / vermelho / neutro). */
export function StatTile({ label, value, tone = 'none', hint }: { label: string; value: ReactNode; tone?: Tone; hint?: ReactNode }) {
  const t = TONE[tone];
  return (
    <div className={cn('rounded-xl border bg-card px-3.5 py-3', tone === 'none' ? 'border-border' : t.border)}>
      <div className="flex items-center gap-1.5">
        {tone !== 'none' ? <span className={cn('h-2 w-2 shrink-0 rounded-full', t.dot)} /> : null}
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</p>
      </div>
      <p className={cn('mt-1 text-2xl font-extrabold leading-none tracking-tight tabular-nums', tone === 'none' ? 'text-foreground' : t.text)}>{value}</p>
      {hint ? <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function StatGrid({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 }) {
  return <div className={cn('mb-4 grid grid-cols-2 gap-2 sm:gap-3', cols === 3 ? 'grid-cols-3' : 'sm:grid-cols-4')}>{children}</div>;
}

/** Selo de situação (Presente, Falta, Aprovado, Recuperação…). */
export function StatusBadge({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', TONE[tone].soft, className)}>
      {children}
    </span>
  );
}

/** Aviso em linha (bloqueio, modo prova…). */
export function Notice({ tone = 'none', icon, children, aside }: { tone?: Tone; icon?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className={cn('mb-4 flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-sm ring-1 ring-inset', TONE[tone].soft)}>
      {icon ?? <Lock size={15} />}
      <span className="min-w-0 flex-1">{children}</span>
      {aside ? <span className="shrink-0 text-xs opacity-80">{aside}</span> : null}
    </div>
  );
}

export type MenuAction = { label: string; icon?: ReactNode; onClick: () => void; danger?: boolean; hidden?: boolean; hint?: string };

/** Botão com menu suspenso — agrupa ações secundárias (evita fileiras de botões soltos). */
export function DropdownMenu({
  label,
  icon,
  items,
  variant = 'ghost',
  align = 'end',
  iconOnly,
}: {
  label: string;
  icon?: ReactNode;
  items: MenuAction[];
  variant?: 'ghost' | 'primary';
  align?: 'start' | 'end';
  iconOnly?: boolean;
}) {
  const visible = items.filter((i) => !i.hidden);
  if (!visible.length) return null;
  return (
    <Menu as="div" className="relative">
      <MenuButton
        aria-label={label}
        title={iconOnly ? label : undefined}
        className={cn(
          'inline-flex h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
          iconOnly ? 'w-10' : 'px-3.5',
          variant === 'primary' ? 'bg-neutral-900 text-white hover:bg-black' : 'bg-card text-foreground ring-1 ring-inset ring-border hover:bg-muted',
        )}
      >
        {icon}
        {iconOnly ? null : (
          <>
            <span>{label}</span>
            <ChevronDown size={15} className="opacity-60" />
          </>
        )}
      </MenuButton>
      <MenuItems
        anchor={align === 'end' ? 'bottom end' : 'bottom start'}
        className="z-50 mt-1 w-64 rounded-xl border border-border bg-card p-1 text-sm shadow-lift focus:outline-none [--anchor-gap:4px]"
      >
        {visible.map((it) => (
          <MenuItem key={it.label}>
            <button
              onClick={it.onClick}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left',
                it.danger ? 'text-red-600 data-[focus]:bg-red-50' : 'text-foreground data-[focus]:bg-muted',
              )}
            >
              <span className="mt-0.5 shrink-0 opacity-80">{it.icon}</span>
              <span className="min-w-0">
                <span className="block font-medium">{it.label}</span>
                {it.hint ? <span className="block text-xs text-muted-foreground">{it.hint}</span> : null}
              </span>
            </button>
          </MenuItem>
        ))}
      </MenuItems>
    </Menu>
  );
}

/** Rodapé fixo de salvar (chamada, notas, avaliações): status à esquerda, ações à direita. */
export function ActionFooter({ title, detail, children, error }: { title: ReactNode; detail?: ReactNode; children: ReactNode; error?: string | null }) {
  return (
    <footer className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-4 py-3 backdrop-blur lg:pl-72">
      <div className="mx-auto flex max-w-6xl items-center gap-2 sm:gap-3 lg:px-6">
        <div className="hidden min-w-0 flex-1 sm:block">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          {detail ? <p className="truncate text-xs text-muted-foreground">{detail}</p> : null}
        </div>
        <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">{children}</div>
      </div>
      {error ? <p className="mx-auto mt-2 max-w-6xl text-sm font-medium text-red-600 lg:px-6">{error}</p> : null}
    </footer>
  );
}

/** Botões padrão do rodapé (altos, fáceis de tocar). */
export function FooterButton({
  kind = 'primary',
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'secondary' }) {
  return (
    <button
      className={cn(
        'inline-flex h-12 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold transition disabled:opacity-60',
        kind === 'primary' ? 'flex-1 bg-neutral-900 text-white hover:bg-black sm:flex-none sm:px-7' : 'text-muted-foreground ring-1 ring-inset ring-border hover:bg-muted',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
