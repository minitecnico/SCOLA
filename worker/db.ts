/**
 * Helpers finos sobre o D1. Regras do plano gratuito do Cloudflare:
 *  - no máximo 50 subrequests por requisição (cada query conta) → operações em
 *    lote usam UMA query com json_each(?) em vez de uma query por linha;
 *  - no máximo 100 parâmetros por query → listas de ids vão como JSON (inList).
 */
export type Env = {
  DB: D1Database;
  FILES: KVNamespace;
  ASSETS: Fetcher;
  PBKDF2_ITER?: string;
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const fail = (message: string, status = 400): never => {
  throw new HttpError(status, message);
};

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

type Param = string | number | null | undefined | boolean;
const norm = (p: Param[]) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

export async function all<T = Record<string, unknown>>(db: D1Database, sql: string, ...params: Param[]): Promise<T[]> {
  const res = await db.prepare(sql).bind(...norm(params)).all<T>();
  return res.results ?? [];
}

export async function first<T = Record<string, unknown>>(db: D1Database, sql: string, ...params: Param[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...norm(params)).first<T>()) ?? null;
}

export async function run(db: D1Database, sql: string, ...params: Param[]): Promise<D1Result> {
  return db.prepare(sql).bind(...norm(params)).run();
}

export const stmt = (db: D1Database, sql: string, ...params: Param[]) => db.prepare(sql).bind(...norm(params));

/** Fragmento `IN (SELECT value FROM json_each(?))` — passe JSON.stringify(ids) como parâmetro. */
export const inList = '(SELECT value FROM json_each(?))';

export const json = (v: unknown) => JSON.stringify(v ?? null);
export function parse<T>(v: unknown, fallback: T): T {
  if (v == null || v === '') return fallback;
  if (typeof v !== 'string') return v as T;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

/** Converte colunas 0/1 do SQLite para boolean. */
export function bools<T extends Record<string, unknown>>(row: T, ...keys: string[]): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) if (k in out && out[k] != null) out[k] = !!out[k];
  return out as T;
}
