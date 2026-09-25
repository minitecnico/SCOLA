import { useAuth } from '../auth/AuthProvider';
import { TeamManager } from '../components/TeamManager';
import { PageHeader } from '../components/ui';

export function EquipePage() {
  const { activeOrgId } = useAuth();
  return (
    <>
      <PageHeader title="Equipe" subtitle="Quem acessa esta escola: gestão, professores e secretaria." />
      {activeOrgId ? <TeamManager baseId={activeOrgId} /> : null}
    </>
  );
}
