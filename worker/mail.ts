import type { Env } from './db';

/**
 * E-mail transacional (convite, recuperação de senha) por API de um provedor com plano gratuito:
 *  - Resend (3.000/mês; precisa de um domínio verificado para enviar a qualquer pessoa), ou
 *  - Brevo (300/dia; basta confirmar o endereço remetente).
 * Sem nenhum configurado, tudo continua funcionando: o convite sai como link para copiar/WhatsApp.
 */
export const mailProvider = (env: Env): 'resend' | 'brevo' | null =>
  !env.MAIL_FROM ? null : env.RESEND_API_KEY ? 'resend' : env.BREVO_API_KEY ? 'brevo' : null;
export const mailReady = (env: Env) => !!mailProvider(env);

const parseFrom = (from: string) => {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return { name: m?.[1]?.replace(/^"|"$/g, '') || 'SCOLA', email: (m?.[2] ?? from).trim() };
};

export async function sendMail(env: Env, m: { to: string; subject: string; html: string; text: string }) {
  const provider = mailProvider(env);
  if (!provider) throw new Error('E-mail não configurado.');
  const from = parseFrom(env.MAIL_FROM!);
  const res =
    provider === 'resend'
      ? await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: `${from.name} <${from.email}>`, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
        })
      : await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': env.BREVO_API_KEY!, 'Content-Type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sender: from, to: [{ email: m.to }], subject: m.subject, htmlContent: m.html, textContent: m.text }),
        });
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}
