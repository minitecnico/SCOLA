import { NavLink } from 'react-router-dom';
import { cn } from '../lib/cn';

const TABS = [
  { to: '/admin', label: 'Bases', end: true },
  { to: '/admin/usuarios', label: 'Usuários', end: false },
  { to: '/admin/logs', label: 'Logs', end: false },
];

/** Abas do painel do administrador: Bases, Usuários e Logs ficam juntos. */
export function AdminTabs() {
  return (
    <div className="mb-4 inline-flex rounded-lg bg-card p-1 ring-1 ring-inset ring-border">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            cn('rounded-md px-4 py-1.5 text-sm font-semibold transition', isActive ? 'bg-neutral-950 text-white' : 'text-muted-foreground hover:text-foreground')
          }
        >
          {t.label}
        </NavLink>
      ))}
    </div>
  );
}
