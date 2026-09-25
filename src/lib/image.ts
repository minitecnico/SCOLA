// Converte uma imagem em data URL base64 leve (redimensiona + comprime),
// para guardar direto no banco sem precisar de storage externo.

export async function fileToCompressedDataUrl(file: File, maxSize = 256, quality = 0.85, forceJpeg = false): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem.');

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Falha ao ler a imagem.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Imagem inválida.'));
    i.src = dataUrl;
  });

  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível processar a imagem.');
  ctx.drawImage(img, 0, 0, w, h);

  // PNG preserva transparência (logos). Fotos de perfil forçam JPEG (mais leve).
  const hasAlpha = !forceJpeg && (file.type === 'image/png' || file.type === 'image/webp');
  const out = hasAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', quality);

  // Trava de segurança: evita estourar o tamanho da linha no banco.
  if (out.length > 700_000) throw new Error('Imagem muito grande. Use uma logo menor.');
  return out;
}
