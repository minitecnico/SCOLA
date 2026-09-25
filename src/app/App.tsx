import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { AppShell } from '../components/AppShell';
import { FeedbackHost } from '../components/Feedback';
import { PwaPrompts } from '../components/PwaPrompts';
import { Loading } from '../components/ui';
import { can, type ModuleKey } from '../lib/permissions';
import { BlockedGate, ChangePasswordGate } from '../pages/AccountGates';
import { AttendancePage } from '../pages/AttendancePage';
import { DashboardPage } from '../pages/DashboardPage';
import { LoginPage } from '../pages/LoginPage';

// Telas maiores carregam sob demanda — a chamada (uso diário do professor) abre rápido.
const lazyPage = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const NotasPage = lazyPage(() => import('../pages/NotasPage'), 'NotasPage');
const EvaluationsPage = lazyPage(() => import('../pages/EvaluationsPage'), 'EvaluationsPage');
const PlanejamentoPage = lazyPage(() => import('../pages/PlanejamentoPage'), 'PlanejamentoPage');
const ReportsPage = lazyPage(() => import('../pages/ReportsPage'), 'ReportsPage');
const AvisosPage = lazyPage(() => import('../pages/AvisosPage'), 'AvisosPage');
const CalendarPage = lazyPage(() => import('../pages/CalendarPage'), 'CalendarPage');
const ClassesPage = lazyPage(() => import('../pages/ClassesPage'), 'ClassesPage');
const StudentsPage = lazyPage(() => import('../pages/StudentsPage'), 'StudentsPage');
const EquipePage = lazyPage(() => import('../pages/EquipePage'), 'EquipePage');
const SettingsPage = lazyPage(() => import('../pages/SettingsPage'), 'SettingsPage');
const DownloadPlanPage = lazyPage(() => import('../pages/DownloadPlanPage'), 'DownloadPlanPage');
const SharedReportPage = lazyPage(() => import('../pages/SharedReportPage'), 'SharedReportPage');
const AdminPage = lazyPage(() => import('../pages/admin/AdminPage'), 'AdminPage');
const LogsPage = lazyPage(() => import('../pages/admin/LogsPage'), 'LogsPage');
const UsersPage = lazyPage(() => import('../pages/admin/UsersPage'), 'UsersPage');
const ProvasPage = lazyPage(() => import('../pages/ProvasPage'), 'ProvasPage');
const ProvaDetailPage = lazyPage(() => import('../pages/ProvaDetailPage'), 'ProvaDetailPage');

const qc = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 30_000, retry: 1 } },
});

function Spinner() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-border border-t-neutral-900" />
    </div>
  );
}

function Gate({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { role } = useAuth();
  if (!can(role, module)) return <Navigate to="/" replace />;
  return children;
}

function Protected() {
  const { session, loading, isSuperadmin, activeOrgId, mustChangePassword, suspended } = useAuth();

  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <ChangePasswordGate />;
  if (!isSuperadmin && !activeOrgId) return <BlockedGate suspended={suspended} />;

  // Administrador fora de uma base: só o painel de administração.
  const adminHome = isSuperadmin && !activeOrgId;

  return (
    <AppShell>
      <Suspense fallback={<Loading />}>
        <Routes>
          {isSuperadmin ? <Route path="/admin" element={<AdminPage />} /> : null}
          {isSuperadmin ? <Route path="/admin/logs" element={<LogsPage />} /> : null}
          {isSuperadmin ? <Route path="/admin/usuarios" element={<UsersPage />} /> : null}
          {adminHome ? (
            <Route path="*" element={<Navigate to="/admin" replace />} />
          ) : (
            <>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/chamadas" element={<Gate module="chamadas"><AttendancePage /></Gate>} />
              <Route path="/notas" element={<Gate module="notas"><NotasPage /></Gate>} />
              <Route path="/avaliacoes" element={<Gate module="notas"><EvaluationsPage /></Gate>} />
              <Route path="/provas" element={<Gate module="notas"><ProvasPage /></Gate>} />
              <Route path="/corrigir" element={<Gate module="notas"><ProvasPage /></Gate>} />
              <Route path="/provas/:id" element={<Gate module="notas"><ProvaDetailPage /></Gate>} />
              <Route path="/planejamento" element={<Gate module="planejamentos"><PlanejamentoPage /></Gate>} />
              <Route path="/relatorios" element={<Gate module="relatorios"><ReportsPage /></Gate>} />
              <Route path="/avisos" element={<Gate module="avisos"><AvisosPage /></Gate>} />
              <Route path="/calendario" element={<Gate module="calendario"><CalendarPage /></Gate>} />
              <Route path="/turmas" element={<Gate module="turmas"><ClassesPage /></Gate>} />
              <Route path="/alunos" element={<Gate module="alunos"><StudentsPage /></Gate>} />
              <Route path="/equipe" element={<Gate module="equipe"><EquipePage /></Gate>} />
              <Route path="/configuracoes" element={<SettingsPage />} />
              <Route path="/baixar/:id" element={<DownloadPlanPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
      </Suspense>
    </AppShell>
  );
}

function Root() {
  const { session, loading } = useAuth();
  return (
    <Routes>
      <Route path="/r/:id" element={<Suspense fallback={<Spinner />}><SharedReportPage /></Suspense>} />
      <Route path="/login" element={loading ? <Spinner /> : session ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/*" element={<Protected />} />
    </Routes>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <BrowserRouter>
          <Root />
        </BrowserRouter>
        <FeedbackHost />
        <PwaPrompts />
      </AuthProvider>
    </QueryClientProvider>
  );
}
