/** Mensagem de erro de envio de arquivo, sem jargão técnico. */
export function translateStorageError(message: string): string {
  return message || 'Não foi possível enviar o arquivo. Tente novamente.';
}

/** Nome de arquivo seguro para caminho de Storage (sem acentos/espaços/caracteres especiais). */
export function safeFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^\w.\-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(-120); // evita caminhos absurdamente longos
}

/** Dispara o download de um único arquivo a partir de um Blob. */
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Baixa vários anexos de uma vez. Com 2+ arquivos, empacota tudo num único .zip
 * (lazy import do jszip — não pesa o bundle inicial). Com 1 arquivo, baixa direto.
 */
export async function downloadAllAttachments(
  files: { name: string; url?: string }[],
  zipName = 'anexos',
): Promise<void> {
  const valid = files.filter((f) => f.url);
  if (!valid.length) throw new Error('Nenhum arquivo disponível para baixar.');

  if (valid.length === 1) {
    const f = valid[0];
    const res = await fetch(f.url as string);
    if (!res.ok) throw new Error('Não foi possível baixar o arquivo.');
    triggerDownload(await res.blob(), f.name);
    return;
  }

  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();
  await Promise.all(
    valid.map(async (f) => {
      const res = await fetch(f.url as string);
      if (!res.ok) return;
      // evita nomes repetidos dentro do zip
      let name = f.name || 'arquivo';
      let i = 1;
      while (used.has(name)) {
        const dot = f.name.lastIndexOf('.');
        name = dot > 0 ? `${f.name.slice(0, dot)} (${i})${f.name.slice(dot)}` : `${f.name} (${i})`;
        i++;
      }
      used.add(name);
      zip.file(name, await res.blob());
    }),
  );
  const blob = await zip.generateAsync({ type: 'blob' });
  triggerDownload(blob, `${zipName}.zip`);
}
