import type { ReactNode } from 'react';
import { waLink } from '../lib/phone';

/** Link para conversar no WhatsApp; some sozinho quando o telefone não é válido. */
export function WhatsAppLink({ phone, text, className, children }: { phone: string | null | undefined; text?: string; className?: string; children: ReactNode }) {
  const href = waLink(phone, text);
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}
