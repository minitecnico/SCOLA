import { rpc } from './api';

/** Suporte nativo: a escola conversa com o administrador do SCOLA (servidor: worker/handlers/suporte.ts). */
export type SupportThread = {
  id: string; base_id: string; user_id: string; subject: string; status: 'aberta' | 'resolvida'; last_from: 'escola' | 'suporte';
  last_preview: string; unread_admin: number; unread_user: number; created_at: string; updated_at: string;
};
export type SupportMessage = { id: string; thread_id: string; author_id: string; from_admin: number; body: string; created_at: string; author_name: string | null };
export type SupportFilter = 'atender' | 'respondidas' | 'resolvidas' | 'todas';
export type AdminThread = SupportThread & { base_name: string; user_name: string | null; user_email: string };
export type AdminThreadDetail = SupportThread & { base_name: string; base_city: string | null; base_plan: string; base_active: number; students: number; user_name: string | null; user_email: string; user_phone: string | null; user_role: string | null };

export const suporte = {
  list: () => rpc<SupportThread[]>('listSupportThreads'),
  unread: () => rpc<number>('supportUnreadCount'),
  get: (id: string) => rpc<{ thread: SupportThread; messages: SupportMessage[] }>('getSupportThread', id),
  create: (input: { subject: string; body: string }) => rpc<{ id: string }>('createSupportThread', input),
  reply: (id: string, body: string) => rpc<null>('replySupport', id, body),
  resolve: (id: string) => rpc<null>('resolveSupport', id),
  admin: {
    list: (input: { filter: SupportFilter; q?: string }) =>
      rpc<{ threads: AdminThread[]; counts: { atender: number; respondidas: number; resolvidas: number; nao_lidas: number } }>('listSupportAdmin', input),
    unread: () => rpc<number>('supportUnreadAdmin'),
    get: (id: string) => rpc<{ thread: AdminThreadDetail; messages: SupportMessage[] }>('getSupportThreadAdmin', id),
    reply: (id: string, body: string, resolve?: boolean) => rpc<null>('replySupportAdmin', id, body, resolve),
    setStatus: (id: string, status: 'aberta' | 'resolvida') => rpc<null>('setSupportStatus', id, status),
  },
};
