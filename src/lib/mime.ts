/** Monta um e-mail (RFC 822) com anexos no navegador; o Worker só repassa ao Gmail. */
const utf8b64 = (s: string) => {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
};
const wrap = (b64: string) => b64.replace(/.{76}/g, '$&\r\n');
const word = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${utf8b64(s)}?=`);

const blobB64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
    fr.onerror = () => reject(new Error('Não consegui ler o anexo.'));
    fr.readAsDataURL(blob);
  });

export const isEmail = (s: string) => /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(s);

export async function buildMime(m: { to: string[]; subject: string; text: string; files: { name: string; blob: Blob }[] }): Promise<Blob> {
  const boundary = `scola_${crypto.randomUUID().replace(/-/g, '')}`;
  const parts: BlobPart[] = [
    `To: ${m.to.join(', ')}\r\nSubject: ${word(m.subject)}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`,
    `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(utf8b64(m.text))}\r\n`,
  ];
  for (const f of m.files) {
    const name = word(f.name).replace(/"/g, '');
    parts.push(
      `--${boundary}\r\nContent-Type: ${f.blob.type || 'application/octet-stream'}; name="${name}"\r\nContent-Disposition: attachment; filename="${name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap(await blobB64(f.blob))}\r\n`,
    );
  }
  parts.push(`--${boundary}--\r\n`);
  return new Blob(parts, { type: 'message/rfc822' });
}
