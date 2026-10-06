import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { listClasses, listSchools } from './queries';

/**
 * Consultas compartilhadas por várias telas, com UMA chave de cache (por base):
 * a turma carregada no Início é reaproveitada em Chamadas, Notas, Alunos… e trocar de base nunca mostra dados da anterior.
 * `enabled` espera a base estar pronta, quando a tela precisa.
 */
export function useClasses(enabled = true) {
  const { activeOrgId } = useAuth();
  return useQuery({ queryKey: ['classes', activeOrgId], queryFn: listClasses, enabled });
}

export function useSchools(enabled = true) {
  const { activeOrgId } = useAuth();
  return useQuery({ queryKey: ['schools', activeOrgId], queryFn: listSchools, enabled });
}
