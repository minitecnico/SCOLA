import type { AppRole } from './types';

/**
 * Quem vê cada módulo. Três papéis fixos por base — simples de explicar ao cliente.
 * O servidor valida as mesmas regras (worker/handlers); aqui é só para o menu e as rotas.
 */
export type ModuleKey =
  | 'dashboard'
  | 'chamadas'
  | 'notas'
  | 'relatorios'
  | 'calendario'
  | 'turmas'
  | 'alunos'
  | 'equipe'
  | 'configuracoes'
  | 'avisos'
  | 'planejamentos'
  | 'anoletivo';

const ACCESS: Record<ModuleKey, AppRole[]> = {
  dashboard: ['gestor', 'professor', 'secretaria'],
  chamadas: ['gestor', 'professor'],
  notas: ['gestor', 'professor'],
  relatorios: ['gestor', 'professor', 'secretaria'],
  calendario: ['gestor', 'professor', 'secretaria'],
  turmas: ['gestor', 'secretaria'],
  alunos: ['gestor', 'secretaria'],
  equipe: ['gestor'],
  configuracoes: ['gestor', 'professor', 'secretaria'],
  avisos: ['gestor', 'professor', 'secretaria'],
  planejamentos: ['gestor', 'professor'],
  anoletivo: ['gestor'],
};

/** O papel pode acessar o módulo? O administrador (superadmin) pode tudo. */
export function can(role: AppRole | null, module: ModuleKey): boolean {
  if (role === 'superadmin') return true;
  if (!role) return false;
  return ACCESS[module].includes(role);
}

const isManager = (role: AppRole | null) => role === 'superadmin' || role === 'gestor';

/** Quem gerencia a base (limpar notas, equipe…). */
export const canManageOrg = isManager;
/** Quem dispara avisos. */
export const canSendNotice = (role: AppRole | null) => isManager(role) || role === 'secretaria';
/** Quem cria calendários. */
export const canManageCalendar = isManager;
/** Quem revisa (aprova/devolve) planejamentos. */
export const canReviewPlan = isManager;
