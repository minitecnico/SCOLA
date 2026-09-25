import { Dialog, DialogPanel, Transition, TransitionChild } from '@headlessui/react';
import {
  Award,
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  GraduationCap,
  Home,
  LayoutGrid,
  LogOut,
  Megaphone,
  Menu,
  Settings,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Fragment, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { cn } from '../lib/cn';
import { can, type ModuleKey } from '../lib/permissions';
import { planUnreadCounts, unreadNoticeCount } from '../lib/queries';
import { ROLE_LABEL } from '../lib/types';
import { useOnlineStatus } from '../lib/useOnlineStatus';
import { Logo } from './Logo';

type NavItem = { label: string; to: string; icon: ReactNode; module: ModuleKey };

const groups: { title?: string; items: NavItem[] }[] = [
  { items: [{ label: 'Início', to: '/', icon: <Home size={18} />, module: 'dashboard' }] },
  {
    title: 'Pedagógico',
    items: [
      { label: 'Chamadas', to: '/chamadas', icon: <ClipboardCheck size={18} />, module: 'chamadas' },
      { label: 'Notas', to: '/notas', icon: <Award size={18} />, module: 'notas' },
      { label: 'Central de Avaliações', to: '/avaliacoes', icon: <ClipboardList size={18} />, module: 'notas' },
      { label: 'Planejamento', to: '/planejamento', icon: <BookOpen size={18} />, module: 'planejamentos' },
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
    ],
  },
  { title: 'Conta', items: [{ label: 'Configurações', to: '/configuracoes', icon: <Settings size={18} />, module: 'configuracoes' }] },
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

  const visibleGroups = inBase
    ? groups.map((g) => ({ ...g, items: g.items.filter((it) => can(role, it.module)) })).filter((g) => g.items.length > 0)
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

      {isSuperadmin ? (
        <div className="px-3 pb-3">
          <NavLink to="/admin" end onClick={onNavigate} className={linkCls}>
            <LayoutGrid size={18} />
            <span>Painel do administrador</span>
          </NavLink>
          {inBase ? (
            <div className="mt-3 rounded-lg border border-brand/40 bg-brand/10 p-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-brand">Modo suporte</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-white">{activeBase?.name}</p>
              <button onClick={leaveBase} className="mt-2 text-xs font-semibold text-neutral-300 underline-offset-2 hover:text-white hover:underline">
                Sair desta base
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

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const online = useOnlineStatus();
  const [open, setOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 hidden w-72 lg:block">
        <SidebarContent />
      </aside>

      <Transition show={open} as={Fragment}>
        <Dialog className="relative z-50 lg:hidden" onClose={() => setOpen(false)}>
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

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/10 bg-neutral-950 px-4 py-3 text-white lg:hidden">
          <button onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-lg bg-white/[0.06]" aria-label="Abrir menu">
            <Menu size={20} />
          </button>
          <Logo variant="dark" compact />
        </header>
        {!online ? (
          <div className="no-print bg-brand px-4 py-2 text-center text-sm font-semibold text-neutral-950">
            Você está sem internet. As alterações só serão salvas quando a conexão voltar.
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
          <div key={pathname} className="animate-fade-up">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
