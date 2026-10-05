import { Dialog, DialogPanel, Menu as HMenu, MenuButton, MenuItem, MenuItems, Transition, TransitionChild } from '@headlessui/react';
import {
  Archive,
  Award,
  BarChart3,
  Bell,
  ChevronDown,
  Download,
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  GraduationCap,
  Home,
  LayoutGrid,
  ScanLine,
  LogOut,
  Megaphone,
  Menu,
  LifeBuoy,
  ScrollText,
  type LucideIcon,
  Settings,
  Sparkles,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Fragment, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { cn } from '../lib/cn';
import { can, type ModuleKey } from '../lib/permissions';
import { planUnreadCounts, unreadNoticeCount } from '../lib/queries';
import { suporte } from '../lib/suporte';
import { useSupportLive } from '../lib/useSupportLive';
import { ROLE_LABEL } from '../lib/types';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { Logo } from './Logo';
import { IosInstallHelp, useInstall } from './PwaPrompts';

type NavItem = { label: string; to: string; icon: ReactNode; module: ModuleKey };

const groups: { title?: string; items: NavItem[] }[] = [
  { items: [{ label: 'Início', to: '/', icon: <Home size={18} />, module: 'dashboard' }] },
  {
    title: 'Pedagógico',
    items: [
      { label: 'Chamadas', to: '/chamadas', icon: <ClipboardCheck size={18} />, module: 'chamadas' },
      { label: 'Notas', to: '/notas', icon: <Award size={18} />, module: 'notas' },
      { label: 'Central de Avaliações', to: '/avaliacoes', icon: <ClipboardList size={18} />, module: 'notas' },
      { label: 'Provas e correção', to: '/provas', icon: <ScanLine size={18} />, module: 'notas' },
      { label: 'Planejamento', to: '/planejamento', icon: <BookOpen size={18} />, module: 'planejamentos' },
      { label: 'IA', to: '/ia', icon: <Sparkles size={18} />, module: 'ia' },
      { label: 'Relatórios', to: '/relatorios', icon: <BarChart3 size={18} />, module: 'relatorios' },
    ],
  },
  {
    title: 'Comunicação',
    items: [
      { label: 'Avisos', to: '/avisos', icon: <Megaphone size={18} />, module: 'avisos' },
      { label: 'Calendário', to: '/calendario', icon: <CalendarDays size={18} />, module: 'calendario' },
    ],
  },
  {
    title: 'Cadastros',
    items: [
      { label: 'Turmas', to: '/turmas', icon: <GraduationCap size={18} />, module: 'turmas' },
      { label: 'Alunos', to: '/alunos', icon: <Users size={18} />, module: 'alunos' },
      { label: 'Equipe', to: '/equipe', icon: <UserCog size={18} />, module: 'equipe' },
      { label: 'Ano letivo', to: '/ano-letivo', icon: <Archive size={18} />, module: 'anoletivo' },
    ],
  },
  { title: 'Conta', items: [{ label: 'Suporte', to: '/suporte', icon: <LifeBuoy size={18} />, module: 'suporte' }, { label: 'Configurações', to: '/configuracoes', icon: <Settings size={18} />, module: 'configuracoes' }] },
];

const linkCls = ({ isActive }: { isActive: boolean }) =>
  cn(
    'group flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
    isActive ? 'bg-brand text-neutral-950 font-semibold' : 'text-neutral-400 hover:bg-white/[0.06] hover:text-white',
  );

const Badge = ({ n }: { n: number }) => (
  <span className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-neutral-950 group-[.bg-brand]:bg-neutral-950 group-[.bg-brand]:text-brand">
    {n > 9 ? '9+' : n}
  </span>
);

function BaseSwitcher() {
  const { organizations, activeOrgId, switchOrg, isSuperadmin } = useAuth();
  const options = organizations.filter((o) => o.active || isSuperadmin);
  if (isSuperadmin || options.length <= 1) return null;
  return (
    <div className="px-3 pb-3">
      <select
        value={activeOrgId ?? ''}
        onChange={(e) => switchOrg(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-sm font-medium text-white outline-none focus:border-brand"
        aria-label="Trocar de base"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id} className="text-neutral-900">
            {o.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, profile, role, activeBase, isSuperadmin, switchOrg, signOut } = useAuth();
  const navigate = useNavigate();
  const name = profile?.full_name || user?.email || 'Usuário';
  const avatar = profile?.avatar_url;
  const inBase = !!activeBase;

  const { data: unread = 0 } = useQuery({
    queryKey: ['notices-unread', user?.id],
    queryFn: () => unreadNoticeCount(),
    enabled: !!user && inBase,
    refetchInterval: 60_000,
  });
  const { data: planUnreadMap = {} } = useQuery({
    queryKey: ['plan-unread'],
    queryFn: planUnreadCounts,
    enabled: !!user && inBase,
    refetchInterval: 60_000,
    retry: false,
  });
  const planUnread = Object.values(planUnreadMap).reduce((a, b) => a + b, 0);
  const adminUnread = useAdminSupportUnread();
  const { data: supUnread = 0 } = useQuery({ queryKey: ['support-unread'], queryFn: suporte.unread, enabled: !!user && inBase && !isSuperadmin, refetchInterval: 60_000 });

  const visibleGroups = inBase
    ? groups.map((g) => ({ ...g, items: g.items.filter((it) => can(role, it.module) && !(isSuperadmin && it.to === '/suporte')) })).filter((g) => g.items.length > 0)
    : [];

  async function leaveBase() {
    await switchOrg(null);
    onNavigate?.();
    navigate('/admin');
  }

  return (
    <div className="flex h-full flex-col bg-neutral-950 text-white">
      <div className="px-5 pb-4 pt-5">
        <Logo variant="dark" compact height={36} />
      </div>

      {isSuperadmin && !inBase ? (
        <div className="px-3 pb-3">
          <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">Administrador</p>
          {ADMIN_NAV.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} onClick={onNavigate} className={linkCls}>
              <it.icon size={18} />
              <span>{it.label}</span>
              {it.to === '/admin/suporte' && adminUnread > 0 ? <Badge n={adminUnread} /> : null}
            </NavLink>
          ))}
        </div>
      ) : null}
      {isSuperadmin ? (
        <div className="px-3 pb-3">
          {inBase ? (
            <div className="mt-3 rounded-lg border border-brand/40 bg-brand/10 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand">Modo suporte</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-white">{activeBase?.name}</p>
              <button onClick={leaveBase} className="mt-2 text-xs font-semibold text-neutral-300 underline-offset-2 hover:text-white hover:underline">
                Voltar ao painel do administrador
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {activeBase ? (
            <div className="flex items-center gap-2.5 px-5 pb-3">
              {activeBase.logo_url ? (
                <img src={activeBase.logo_url} alt="" className="h-8 w-8 shrink-0 rounded-md bg-white object-contain p-0.5" />
              ) : null}
              <p className="min-w-0 truncate text-sm font-semibold text-neutral-200">{activeBase.name}</p>
            </div>
          ) : null}
          <BaseSwitcher />
        </>
      )}

      <nav className="flex-1 overflow-y-auto border-t border-white/[0.06] px-3 py-4">
        {visibleGroups.map((group, i) => (
          <div key={i} className="mb-5">
            {group.title ? (
              <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">{group.title}</p>
            ) : null}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'} onClick={onNavigate} className={linkCls}>
                  {item.icon}
                  <span>{item.label}</span>
                  {item.to === '/avisos' && unread > 0 ? <Badge n={unread} /> : null}
                  {item.to === '/planejamento' && planUnread > 0 ? <Badge n={planUnread} /> : null}
                  {item.to === '/suporte' && supUnread > 0 ? <Badge n={supUnread} /> : null}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.06] p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          {avatar ? (
            <img src={avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <div className="grid h-9 w-9 place-items-center rounded-full bg-brand text-sm font-bold uppercase text-neutral-950">{name.slice(0, 1)}</div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{name}</p>
            <p className="truncate text-xs text-neutral-500">{isSuperadmin ? 'Administrador' : role ? ROLE_LABEL[role] : user?.email}</p>
          </div>
          <button
            onClick={() => signOut()}
            className="grid h-9 w-9 place-items-center rounded-lg text-neutral-400 hover:bg-white/[0.06] hover:text-white"
            aria-label="Sair"
            title="Sair"
          >
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------- Desktop: cabeçalho + barra de menu ------------------------- */
function useCounts() {
  const { user, activeBase } = useAuth();
  const inBase = !!activeBase;
  const { data: unread = 0 } = useQuery({ queryKey: ['notices-unread', user?.id], queryFn: () => unreadNoticeCount(), enabled: !!user && inBase, refetchInterval: 60_000 });
  const { data: planMap = {} } = useQuery({ queryKey: ['plan-unread'], queryFn: planUnreadCounts, enabled: !!user && inBase, refetchInterval: 60_000, retry: false });
  return { unread, planUnread: Object.values(planMap).reduce((a, b) => a + b, 0) };
}

/** Conversas do suporte aguardando o administrador (só roda para ele, fora de uma escola). */
function useAdminSupportUnread() {
  const { isSuperadmin, activeBase } = useAuth();
  return useQuery({ queryKey: ['support-admin-unread'], queryFn: suporte.admin.unread, enabled: isSuperadmin && !activeBase, refetchInterval: 30_000 }).data ?? 0;
}

function TopHeader({ onMenu }: { onMenu: () => void }) {
  const { user, profile, role, activeBase, isSuperadmin, switchOrg, signOut } = useAuth();
  const navigate = useNavigate();
  const { unread } = useCounts();
  const { canPrompt, ios, install } = useInstall();
  const [iosHelp, setIosHelp] = useState(false);
  const name = profile?.full_name || user?.email || 'Usuário';
  const first = name.split(' ')[0];
  return (
    <div className="border-b border-border bg-card">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-2 px-3 sm:gap-4 sm:px-6">
        <button
          onClick={onMenu}
          className="grid lg:hidden h-10 w-10 shrink-0 place-items-center rounded-lg text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/40"
          aria-label="Abrir menu"
          title="Menu"
        >
          <Menu size={21} />
        </button>
        <NavLink to={activeBase ? '/' : '/admin'} className="shrink-0" aria-label="Início">
          <Logo compact height={28} />
        </NavLink>
        {activeBase ? (
          <div className="hidden min-w-0 items-center gap-3 border-l border-border pl-5 md:flex">
            {activeBase.logo_url ? (
              <img src={activeBase.logo_url} alt="" className="h-9 w-9 shrink-0 rounded-lg bg-white object-contain p-0.5 ring-1 ring-border" />
            ) : (
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-neutral-950 text-sm font-bold text-white">{activeBase.name.slice(0, 1).toUpperCase()}</span>
            )}
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-foreground">{activeBase.name}</p>
              <p className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Ano letivo {new Date().getFullYear()}</p>
            </div>
            {isSuperadmin ? (
              <button
                onClick={async () => {
                  await switchOrg(null);
                  navigate('/admin');
                }}
                className="shrink-0 rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-semibold text-foreground transition hover:bg-neutral-200"
                title="Sair do modo suporte"
              >
                ← Painel do administrador
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {!isSuperadmin ? (
            <div className="hidden md:block">
              <HeaderBaseSwitcher />
            </div>
          ) : null}
          {activeBase ? (
            <NavLink to="/avisos" className="relative grid h-10 w-10 place-items-center rounded-full text-neutral-700 ring-1 ring-inset ring-border transition hover:bg-muted hover:text-foreground" aria-label="Avisos" title="Avisos">
              <Bell size={18} />
              {unread ? (
                <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>
              ) : null}
            </NavLink>
          ) : null}
          <HMenu as="div" className="relative">
            <MenuButton className="ml-1 flex items-center gap-3 rounded-full border border-transparent py-1 pl-3 pr-2 transition hover:border-border hover:bg-muted/60 data-[open]:border-border data-[open]:bg-muted/60">
              <span className="hidden text-right leading-tight lg:block">
                <span className="block max-w-[11rem] truncate text-sm font-semibold text-foreground">{name.split(' ').slice(0, 2).join(' ')}</span>
                <span className="block text-[11px] font-medium text-muted-foreground">{isSuperadmin ? 'Administrador' : role ? ROLE_LABEL[role] : ''}</span>
              </span>
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover ring-1 ring-border" />
              ) : (
                <span className="grid h-9 w-9 place-items-center rounded-full bg-neutral-950 text-sm font-bold uppercase text-white">{first.slice(0, 1)}</span>
              )}
              <ChevronDown size={14} className="text-muted-foreground" />
            </MenuButton>
            <MenuItems anchor="bottom end" className="z-50 mt-1 w-56 rounded-xl border border-border bg-card p-1 text-sm shadow-lift focus:outline-none [--anchor-gap:6px]">
              <div className="px-3 py-2">
                <p className="truncate font-semibold text-foreground">{name}</p>
                <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
              </div>
              {isSuperadmin && activeBase ? (
                <MenuItem>
                  <button
                    onClick={async () => {
                      await switchOrg(null);
                      navigate('/admin');
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left data-[focus]:bg-muted"
                  >
                    <LayoutGrid size={15} /> Painel do administrador
                  </button>
                </MenuItem>
              ) : null}
              {activeBase ? (
                <MenuItem>
                  <NavLink to="/configuracoes" className="flex items-center gap-2.5 rounded-lg px-3 py-2 data-[focus]:bg-muted">
                    <Settings size={15} /> Configurações
                  </NavLink>
                </MenuItem>
              ) : null}
              {activeBase && !isSuperadmin ? (
                <MenuItem>
                  <NavLink to="/suporte" className="flex items-center gap-2.5 rounded-lg px-3 py-2 data-[focus]:bg-muted">
                    <LifeBuoy size={15} /> Suporte
                  </NavLink>
                </MenuItem>
              ) : null}
              {canPrompt || ios ? (
                <MenuItem>
                  <button onClick={() => (canPrompt ? void install() : setIosHelp(true))} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left data-[focus]:bg-muted">
                    <Download size={15} /> Instalar app
                  </button>
                </MenuItem>
              ) : null}
              <MenuItem>
                <button onClick={() => signOut()} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-red-600 data-[focus]:bg-red-50">
                  <LogOut size={15} /> Sair
                </button>
              </MenuItem>
            </MenuItems>
          </HMenu>
        </div>
      </div>
      {iosHelp ? <IosInstallHelp onClose={() => setIosHelp(false)} /> : null}
    </div>
  );
}

function HeaderBaseSwitcher() {
  const { organizations, activeOrgId, switchOrg } = useAuth();
  const options = organizations.filter((o) => o.active);
  if (options.length <= 1) return null;
  return (
    <select
      value={activeOrgId ?? ''}
      onChange={(e) => switchOrg(e.target.value)}
      className="h-9 max-w-[14rem] rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus:border-neutral-900"
      aria-label="Trocar de base"
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

/** Menu do administrador (só aparece fora de uma escola). */
const ADMIN_NAV: { to: string; label: string; end: boolean; icon: LucideIcon }[] = [
  { to: '/admin', label: 'Visão geral', end: true, icon: LayoutGrid },
  { to: '/admin/escolas', label: 'Escolas', end: false, icon: Building2 },
  { to: '/admin/suporte', label: 'Atendimento', end: false, icon: LifeBuoy },
  { to: '/admin/usuarios', label: 'Usuários', end: false, icon: UserCog },
  { to: '/admin/logs', label: 'Logs', end: false, icon: ScrollText },
];

const topCls = (active: boolean) =>
  cn(
    'relative flex h-12 items-center gap-2 px-3.5 text-sm font-medium transition outline-none',
    active ? 'text-brand after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-brand' : 'text-neutral-300 hover:text-white',
  );

/** Grupo do menu: abre ao passar o mouse (e ao clicar/tocar), fecha ao sair, com Esc ou ao escolher um item. */
function HoverGroup({ title, active, count, children }: { title: string; active: boolean; count: number; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = () => {
    clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 140); // tolera o mouse cruzando o vão entre o botão e a lista
  };
  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={hide} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)} className={cn(topCls(active), open && 'text-white')}>
        {title}
        {count ? <span className="grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] font-bold text-neutral-950">{count > 9 ? '9+' : count}</span> : null}
        <ChevronDown size={14} className={cn('opacity-60 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <div role="menu" className="absolute left-0 top-full z-50 w-64 animate-fade-in rounded-xl border border-border bg-card p-1.5 text-sm shadow-lift">
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

function TopNav() {
  const { role, activeBase, isSuperadmin } = useAuth();
  const { pathname } = useLocation();
  const { unread, planUnread } = useCounts();
  const adminUnread = useAdminSupportUnread();
  const inBase = !!activeBase;
  const badge = (to: string) => (to === '/avisos' ? unread : to === '/planejamento' ? planUnread : 0);
  const visible = inBase
    ? groups
        .filter((g) => g.title !== 'Conta')
        .map((g) => ({ ...g, items: g.items.filter((it) => can(role, it.module)) }))
        .filter((g) => g.items.length > 0)
    : [];
  const isActive = (to: string) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));

  return (
    <nav className="bg-neutral-950">
      <div className="mx-auto flex max-w-[1440px] items-center justify-center gap-1 px-6">
        {isSuperadmin && !inBase
          ? ADMIN_NAV.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive: a }) => topCls(a)}>
                <it.icon size={16} /> {it.label}
                {it.to === '/admin/suporte' && adminUnread > 0 ? <span className="ml-1 grid h-4 min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{adminUnread}</span> : null}
              </NavLink>
            ))
          : null}
        {visible.map((g) => {
          if (!g.title || g.items.length === 1) {
            return g.items.map((it) => (
              <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive: a }) => topCls(a)}>
                {it.icon} {it.label}
              </NavLink>
            ));
          }
          const active = g.items.some((it) => isActive(it.to));
          const count = g.items.reduce((n, it) => n + badge(it.to), 0);
          return (
            <HoverGroup key={g.title} title={g.title!} active={active} count={count}>
              {(close) =>
                g.items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    onClick={close}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none',
                      isActive(it.to) ? 'bg-muted font-semibold text-foreground' : 'text-foreground',
                    )}
                  >
                    <span className="text-muted-foreground">{it.icon}</span>
                    <span className="flex-1">{it.label}</span>
                    {badge(it.to) ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-neutral-950">{badge(it.to)}</span> : null}
                  </NavLink>
                ))
              }
            </HoverGroup>
          );
        })}
      </div>
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { isSuperadmin, activeBase } = useAuth();
  useSupportLive(isSuperadmin || !!activeBase);
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Cabeçalho branco com menu sanduíche (todas as telas) + barra de menu escura (desktop) */}
      <div className="sticky top-0 z-40 bg-card pt-[env(safe-area-inset-top)] shadow-sm">
        <TopHeader onMenu={() => setOpen(true)} />
        <div className="hidden lg:block">
          <TopNav />
        </div>
      </div>

      <Transition show={open} as={Fragment}>
        <Dialog className="relative z-50" onClose={() => setOpen(false)}>
          <TransitionChild as={Fragment} enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100" leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0">
            <div className="fixed inset-0 bg-black/60" />
          </TransitionChild>
          <div className="fixed inset-0 flex">
            <TransitionChild
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="-translate-x-full"
              enterTo="translate-x-0"
              leave="ease-in duration-150"
              leaveFrom="translate-x-0"
              leaveTo="-translate-x-full"
            >
              <DialogPanel className="relative w-72 max-w-[84vw]">
                <button
                  onClick={() => setOpen(false)}
                  className="absolute right-3 top-4 z-10 grid h-9 w-9 place-items-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white"
                  aria-label="Fechar menu"
                >
                  <X size={18} />
                </button>
                <SidebarContent onNavigate={() => setOpen(false)} />
              </DialogPanel>
            </TransitionChild>
          </div>
        </Dialog>
      </Transition>

      <div>
        {!online ? (
          <div className="no-print bg-brand px-4 py-2 text-center text-sm font-semibold text-neutral-950">
            Você está sem internet. As alterações só serão salvas quando a conexão voltar.
          </div>
        ) : null}
        <main className={pathname === '/ia' ? 'w-full' : 'mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8'}>
          <div key={pathname} className="animate-fade-up">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
