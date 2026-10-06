/** Verificação em duas etapas (TOTP, RFC 6238): o mesmo padrão do Google Authenticator, Microsoft Authenticator, Authy etc. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const enc = new TextEncoder();

export function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return (bits.match(/.{5}/g) ?? []).map((c) => B32[parseInt(c, 2)]).join('');
}

function fromBase32(s: string): Uint8Array {
  let bits = '';
  for (const ch of s.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  return out;
}

async function code(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', fromBase32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setUint32(4, counter);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[19] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/** Confere o código (aceita 30 s para trás e para frente, por causa do relógio do celular). Devolve o passo usado ou null. */
export async function verifyTotp(secret: string, input: string, lastStep?: number | null): Promise<number | null> {
  const typed = input.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const step = Math.floor(Date.now() / 30_000);
  for (const s of [step, step - 1, step + 1]) {
    if (lastStep != null && s <= lastStep) continue; // código já usado
    if ((await code(secret, s)) === typed) return s;
  }
  return null;
}

export const otpauthUrl = (secret: string, email: string) =>
  `otpauth://totp/SCOLA:${encodeURIComponent(email)}?secret=${secret}&issuer=SCOLA&algorithm=SHA1&digits=6&period=30`;

/* Códigos de recuperação (uso único) para quem perder o celular. */
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
export const newBackupCodes = (n = 8) =>
  Array.from({ length: n }, () => {
    const b = crypto.getRandomValues(new Uint8Array(10));
    const s = Array.from(b, (x) => ALPHA[x % ALPHA.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
export const normBackup = (c: string) => c.replace(/[\s-]/g, '').toLowerCase();
export async function hashBackup(c: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(normBackup(c)));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}
