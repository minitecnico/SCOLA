import type { Context, Hono } from 'hono';
import { EMAIL_RE, hashPassword, iterationsFor, validatePassword, type UserRow } from './auth';
import { deviceOf } from './audit';
import { all, fail, first, now, run, uid, type Env } from './db';
import { bestMatch, MATCH_SURE } from './match';

/**
 * Telas públicas: pedir cadastro e pedir nova senha. Nada vira conta sozinho:
 *  - cadastro → o administrador analisa e aprova (a pessoa entra com a senha que escolheu aqui);
 *  - nova senha → quem conhece a pessoa (coordenação da escola ou administrador) confirma que é ela.
 * A senha escolhida fica só como hash, dentro do pedido, até alguém aprovar.
 */
type App = Hono<{ Bindings: Env; Variables: { user: UserRow } }>;
type C = Context<{ Bindings: Env; Variables: { user: UserRow } }>;

const ROLES = ['professor', 'gestor', 'secretaria'];
const ip = (c: C) => c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Limite por endereço: devolve false quando passou do máximo na janela. */
async function allow(db: D1Database, key: string, max: number, windowMin: number): Promise<boolean> {
  const since = new Date(Date.now() - windowMin * 60_000).toISOString();
  const row = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM rate_limits WHERE key = ? AND at > ?', key, since);
  if ((row?.n ?? 0) >= max) return false;
  await run(db, 'INSERT INTO rate_limits (key, at) VALUES (?, ?)', key, now());
  if (Math.random() < 0.05) await run(db, 'DELETE FROM rate_limits WHERE at < ?', new Date(Date.now() - 86400_000).toISOString()).catch(() => null);
  return true;
}

export function signupRoutes(app: App) {
  /** "Essa escola existe?": mostra a escola parecida enquanto a pessoa digita (tolera erro de digitação e pontuação). */
  app.post('/api/signup/match', async (c) => {
    const body = await c.req.json<{ institution?: string }>().catch(() => ({}) as { institution?: string });
    if (!(await allow(c.env.DB, `match:${ip(c)}`, 60, 60))) fail('Muitas consultas. Aguarde alguns minutos.', 429);
    const bases = await all<{ id: string; name: string }>(c.env.DB, 'SELECT id, name FROM bases WHERE active = 1');
    const m = bestMatch(clean(body.institution, 120), bases);
    return c.json({ match: m ? { name: m.base.name, sure: m.score >= MATCH_SURE } : null });
  });

  /** Pedido de cadastro. A resposta é sempre a mesma (ninguém descobre quem já tem conta). */
  app.post('/api/signup/request', async (c) => {
    const b = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
    if (clean(b.website, 50)) return c.json({ ok: true }); // campo-isca: robô
    const db = c.env.DB;
    const full_name = clean(b.full_name, 120);
    const email = clean(b.email, 160).toLowerCase();
    const phone = clean(b.phone, 20);
    const institution = clean(b.institution, 120);
    const role = ROLES.includes(String(b.role)) ? String(b.role) : 'professor';
    const city = clean(b.city, 80);
    const note = clean(b.note, 500);
    if (full_name.split(' ').filter((p) => p.length > 1).length < 2) fail('Informe seu nome completo.');
    if (!EMAIL_RE.test(email)) fail('Informe um e-mail válido.');
    if (phone.replace(/\D/g, '').length < 10) fail('Informe um telefone com DDD.');
    if (institution.length < 3) fail('Informe o nome da instituição de ensino.');
    if (b.accepted !== true) fail('Aceite os Termos de Uso e a Política de Privacidade para continuar.');
    validatePassword(String(b.password ?? ''));
    if (!(await allow(db, `signup:${ip(c)}`, 5, 60))) fail('Muitos pedidos deste aparelho. Tente de novo mais tarde.', 429);

    const bases = await all<{ id: string; name: string }>(db, 'SELECT id, name FROM bases WHERE active = 1');
    const m = b.noMatch === true ? null : bestMatch(institution, bases);
    const existing = await first<{ id: string; is_admin: number }>(db, 'SELECT id, is_admin FROM users WHERE email = ?', email);
    if (existing?.is_admin) return c.json({ ok: true });
    const hash = await hashPassword(String(b.password), iterationsFor(c.env));
    const pending = await first<{ id: string }>(db, "SELECT id FROM access_requests WHERE email = ? AND kind = 'cadastro' AND status = 'pendente'", email);
    const dev = deviceOf(c.req.header('user-agent'));
    if (pending) {
      // Mesmo e-mail pedindo de novo: atualiza o pedido em aberto em vez de duplicar.
      await run(db, 'UPDATE access_requests SET full_name = ?, phone = ?, institution = ?, role = ?, city = ?, note = ?, password_hash = ?, match_base_id = ?, match_score = ?, user_id = ?, ip = ?, device = ?, created_at = ? WHERE id = ?',
        full_name, phone, institution, role, city || null, note || null, hash, m?.base.id ?? null, m?.score ?? null, existing?.id ?? null, ip(c), dev, now(), pending.id);
    } else {
      await run(db, 'INSERT INTO access_requests (id, kind, full_name, email, phone, institution, role, city, note, password_hash, match_base_id, match_score, user_id, ip, device, created_at) VALUES (?, \'cadastro\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        uid(), full_name, email, phone, institution, role, city || null, note || null, hash, m?.base.id ?? null, m?.score ?? null, existing?.id ?? null, ip(c), dev, now());
    }
    return c.json({ ok: true });
  });

  /** "Esqueci minha senha": a pessoa já escolhe a senha nova; ela só vale quando a coordenação confirmar que foi ela. */
  app.post('/api/signup/reset', async (c) => {
    const b = await c.req.json<{ email?: string; password?: string }>().catch(() => ({}) as { email?: string; password?: string });
    const db = c.env.DB;
    const email = clean(b.email, 160).toLowerCase();
    if (!EMAIL_RE.test(email)) fail('Informe um e-mail válido.');
    validatePassword(String(b.password ?? ''));
    if (!(await allow(db, `reset:${ip(c)}`, 5, 60))) fail('Muitos pedidos deste aparelho. Tente de novo mais tarde.', 429);
    const user = await first<{ id: string; full_name: string | null; phone: string | null; is_admin: number; disabled: number }>(db, 'SELECT id, full_name, phone, is_admin, disabled FROM users WHERE email = ?', email);
    // Mesma resposta exista ou não a conta. O administrador do sistema não usa esta tela.
    if (!user || user.disabled || user.is_admin) return c.json({ ok: true });
    const hash = await hashPassword(String(b.password), iterationsFor(c.env));
    const dev = deviceOf(c.req.header('user-agent'));
    const open = await first<{ id: string }>(db, "SELECT id FROM access_requests WHERE user_id = ? AND kind = 'senha' AND status = 'pendente'", user.id);
    if (open) await run(db, 'UPDATE access_requests SET password_hash = ?, ip = ?, device = ?, created_at = ? WHERE id = ?', hash, ip(c), dev, now(), open.id);
    else await run(db, "INSERT INTO access_requests (id, kind, full_name, email, phone, password_hash, user_id, ip, device, created_at) VALUES (?, 'senha', ?, ?, ?, ?, ?, ?, ?, ?)", uid(), user.full_name, email, user.phone, hash, user.id, ip(c), dev, now());
    return c.json({ ok: true });
  });
}
