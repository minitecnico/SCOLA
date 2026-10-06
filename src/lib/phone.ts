/** Telefone brasileiro só com dígitos e DDI 55 ("" se for curto demais para ser um telefone). */
export function normalizePhone(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 10) return '';
  return digits.length <= 11 ? `55${digits}` : digits;
}

/** Link do WhatsApp para um número (com mensagem pronta, se houver); null se o número não for válido. */
export function waLink(phone: string | null | undefined, text?: string): string | null {
  const number = normalizePhone(phone);
  if (!number) return null;
  return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

/** Link do WhatsApp sem destinatário: a pessoa escolhe o contato. */
export const waShareLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
