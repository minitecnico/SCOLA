import { fail, first, run, type Env } from './db';

/**
 * Integração com o Google (OAuth 2.0, fluxo de servidor). Cada usuário conecta a própria conta;
 * o Worker guarda só o refresh token (cifrado) e troca por access tokens curtos quando precisa.
 *
 * Escopo `drive.file`: o SCOLA só enxerga os arquivos que ele mesmo criou (ou que o usuário abriu
 * pelo SCOLA). É um escopo "não sensível": não exige verificação do app pelo Google.
 * Escopo `gmail.send` (sensível): só ENVIAR e-mails pela conta do próprio usuário (professor → coordenação), sem ler a caixa de entrada.
 * Para criar Docs/Sheets/Slides, ative no Google Cloud as APIs: Google Drive, Docs, Sheets e Slides.
 */
export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/gmail.send'];

export const googleConfigured = (env: Env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_TOKEN_KEY);

export const redirectUri = (reqUrl: string) => `${new URL(reqUrl).origin}/api/google/callback`;

/* ------------------------------- Cifra do refresh token ------------------------------- */
const enc = new TextEncoder();
const b64 = (buf: Uint8Array) => btoa(String.fromCharCode(...buf));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function aesKey(env: Env) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(env.GOOGLE_TOKEN_KEY || ''));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealToken(env: Env, token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), enc.encode(token)));
  return `${b64(iv)}.${b64(ct)}`;
}

async function openToken(env: Env, sealed: string) {
  const [iv, ct] = sealed.split('.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(env), unb64(ct));
  return new TextDecoder().decode(pt);
}

/* ------------------------------------- OAuth ------------------------------------------ */
export function authUrl(env: Env, reqUrl: string, state: string) {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri(reqUrl), response_type: 'code', scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope: string; id_token?: string };

async function tokenRequest(params: Record<string, string>) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params),
  });
  const j = (await r.json().catch(() => ({}))) as TokenResponse & { error?: string };
  return { ok: r.ok, j };
}

export async function exchangeCode(env: Env, reqUrl: string, code: string) {
  const { ok, j } = await tokenRequest({
    code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri(reqUrl), grant_type: 'authorization_code',
  });
  if (!ok || !j.refresh_token) fail('O Google não concluiu a conexão. Tente de novo.');
  // O id_token vem direto do Google (HTTPS) na troca do código: basta ler o e-mail do payload.
  let email = '';
  try {
    email = String(JSON.parse(atob(j.id_token!.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || '');
  } catch {
    /* sem e-mail: segue com vazio */
  }
  return { refreshToken: j.refresh_token!, scopes: j.scope, email };
}

/** Access token novo (válido ~1 h) para o usuário. Conta revogada/expirada → apaga a conexão e pede para reconectar. */
export async function accessTokenFor(env: Env, userId: string) {
  const acc = await first<{ refresh_token: string }>(env.DB, 'SELECT refresh_token FROM google_accounts WHERE user_id = ?', userId);
  if (!acc) fail('Conecte sua conta do Google primeiro.', 409);
  const { ok, j } = await tokenRequest({
    refresh_token: await openToken(env, acc!.refresh_token), client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, grant_type: 'refresh_token',
  });
  if (!ok) {
    if (j.error === 'invalid_grant') await run(env.DB, 'DELETE FROM google_accounts WHERE user_id = ?', userId);
    fail('A conexão com o Google expirou. Conecte de novo.', 409);
  }
  return j.access_token;
}

/** Chamada autenticada às APIs do Google (Drive, Docs, Sheets, Slides). */
export async function googleFetch(env: Env, userId: string, url: string, init: RequestInit = {}) {
  const token = await accessTokenFor(env, userId);
  const r = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    console.error('google', r.status, url, await r.text().catch(() => ''));
    fail(r.status === 404 ? 'Arquivo não encontrado no Google (apagado ou sem acesso).' : 'O Google recusou a operação. Tente de novo.', r.status === 404 ? 404 : 502);
  }
  return r;
}

export async function revokeAndForget(env: Env, userId: string) {
  const acc = await first<{ refresh_token: string }>(env.DB, 'SELECT refresh_token FROM google_accounts WHERE user_id = ?', userId);
  if (acc) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: await openToken(env, acc.refresh_token) }),
      });
    } catch {
      /* se não der para revogar, ainda assim esquece localmente */
    }
  }
  await run(env.DB, 'DELETE FROM google_accounts WHERE user_id = ?', userId);
}
