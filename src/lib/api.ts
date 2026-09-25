/**
 * Cliente da API do SCOLA (Cloudflare Worker). A sessão é um cookie HttpOnly,
 * então o front nunca manipula token. Toda escrita leva o cabeçalho x-scola (proteção CSRF).
 */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Disparado quando a sessão expira — o AuthProvider escuta e volta para o login. */
export const SESSION_EXPIRED = 'scola:sessao-expirada';

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED));
    throw new ApiError(res.status, body?.error || 'Falha de comunicação com o servidor.');
  }
  return body as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'Sem conexão com a internet.');
  }
  return handle<T>(res);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-scola': '1' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com a internet.');
  }
  return handle<T>(res);
}

/** Chama uma operação do servidor pelo nome: rpc('listClasses'), rpc('saveClass', dados). */
export async function rpc<T = unknown>(name: string, ...args: unknown[]): Promise<T> {
  const r = await apiPost<{ data: T }>(`/api/rpc/${name}`, { args });
  return r.data;
}

/** Envio de arquivo (multipart). */
export async function upload(path: string, file: File, fields: Record<string, string | number | null | undefined>) {
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(fields)) if (v != null) form.append(k, String(v));
  let res: Response;
  try {
    res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'x-scola': '1' }, body: form });
  } catch {
    throw new ApiError(0, 'Falha de conexão ao enviar o arquivo. Verifique a internet e tente novamente.');
  }
  return handle<{ data: { id: string } }>(res);
}
