const MB = 1024 * 1024;

export const MAX_SHEET_FILE_SIZE = 5 * MB;
export const MAX_UPLOAD_FILE_SIZE = 20 * MB;
export const MAX_IMPORT_ROWS = 5000;

// Bloqueamos só executáveis/scripts perigosos; todo o resto é aceito
// (Office, PDF, imagens, áudio, vídeo, zip, formatos Apple…). Suporte amplo.
const BLOCKED_UPLOAD_EXT = new Set([
  'exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'jar',
  'js', 'jse', 'vbs', 'vbe', 'ps1', 'psm1', 'sh', 'app', 'apk',
  'dll', 'sys', 'reg', 'lnk', 'hta', 'wsf', 'wsh', 'gadget',
]);

export function fileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

export function assertSpreadsheetFile(file: File): void {
  const ext = fileExtension(file.name);
  if (!['xlsx', 'xls', 'csv'].includes(ext)) throw new Error('Formato inválido. Use .xlsx, .xls ou .csv.');
  if (file.size > MAX_SHEET_FILE_SIZE) throw new Error('Arquivo muito grande. Use planilhas de até 5 MB.');
}

export function assertCalendarImportFile(file: File): void {
  const ext = fileExtension(file.name);
  if (!['xlsx', 'xls', 'csv', 'ics'].includes(ext)) throw new Error('Formato inválido. Use .xlsx, .xls, .csv ou .ics.');
  if (file.size > MAX_SHEET_FILE_SIZE) throw new Error('Arquivo muito grande. Use arquivos de até 5 MB.');
}

export function assertUploadFile(file: File): void {
  const ext = fileExtension(file.name);
  if (BLOCKED_UPLOAD_EXT.has(ext)) throw new Error('Por segurança, arquivos executáveis não são aceitos.');
  if (file.size > MAX_UPLOAD_FILE_SIZE) throw new Error('Arquivo muito grande. Envie arquivos de até 20 MB.');
}

export function assertImportRowLimit(total: number): void {
  if (total > MAX_IMPORT_ROWS) throw new Error(`Planilha muito grande. Importe no máximo ${MAX_IMPORT_ROWS} linhas por vez.`);
}
