import type { Ctx } from './auth';
import { first, run } from './db';

/**
 * Cache das consultas pesadas no próprio D1 (a Cache API não funciona em workers.dev e o KV grátis só aceita
 * 1.000 gravações por dia). Ler a linha do cache custa 1 leitura; a agregação custa milhares.
 * Vale 5 minutos e é apagado quando qualquer gravação acontece na base (ver /api/rpc em index.ts).
 */
const TTL_MS = 5 * 60_000;

export async function cached<T>(ctx: Ctx, name: string, args: unknown[], compute: () => Promise<T>): Promise<T> {
  if (!ctx.baseId) return compute();
  const key = `${ctx.baseId}|${name}|${ctx.role}|${JSON.stringify(args)}`;
  // Se a tabela do cache não existir (migração pendente) ou o D1 falhar, calcula direto: o cache nunca derruba a tela.
  const hit = await first<{ value: string }>(ctx.db, 'SELECT value FROM query_cache WHERE key = ? AND expires_at > ?', key, new Date().toISOString()).catch(() => null);
  if (hit) {
    try {
      return JSON.parse(hit.value) as T;
    } catch {
      /* linha corrompida: recalcula */
    }
  }
  const value = await compute();
  const json = JSON.stringify(value ?? null);
  if (json.length < 900_000) {
    await run(ctx.db, 'INSERT OR REPLACE INTO query_cache (key, base_id, value, expires_at) VALUES (?, ?, ?, ?)', key, ctx.baseId, json, new Date(Date.now() + TTL_MS).toISOString()).catch(() => null);
  }
  return value;
}

export const clearBaseCache = (db: D1Database, baseId: string) => run(db, 'DELETE FROM query_cache WHERE base_id = ?', baseId);
