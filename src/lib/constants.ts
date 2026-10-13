/**
 * Constantes compartilhadas do SCOLA (navegador e worker).
 * Só valores que se repetiam em vários arquivos. Regras de negócio ficam onde moram
 * (notas e anos letivos em types.ts, limites de arquivo em fileSecurity.ts, cores em calendarColors.ts).
 * Este arquivo não importa nada, então qualquer lado pode usá-lo.
 */

/* ---- Idioma e fuso ---- */
export const LOCALE = 'pt-BR';
export const TIMEZONE = 'America/Sao_Paulo';

/* ---- Tempo (em milissegundos) ---- */
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/* ---- Tamanho de arquivo (em bytes) ---- */
export const KB = 1024;
export const MB = 1024 * KB;
/** Leitura de arquivo no navegador (IA e importações). */
export const MAX_READ_FILE_SIZE = 25 * MB;

/* ---- Calendário em português ---- */
export const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
] as const;
export const MONTHS_LOWER: string[] = MONTHS.map((m) => m.toLowerCase());
export const MONTHS_ABBR = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** Dias da semana na ordem de Date.getDay() (domingo = 0). */
export const WEEKDAYS_ABBR = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const WEEKDAYS_ABBR_CAP: string[] = WEEKDAYS_ABBR.map((d) => d[0].toUpperCase() + d.slice(1));
/** Mesmos dias, começando na segunda (calendário e mapa de calor). */
export const WEEKDAYS_ABBR_CAP_MON: string[] = [...WEEKDAYS_ABBR_CAP.slice(1), WEEKDAYS_ABBR_CAP[0]];

/* ---- Arquivos ---- */
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'heic', 'heif', 'avif'];

/* ---- Armazenamento local (localStorage), chaves usadas em mais de um lugar ---- */
export const STORAGE = {
  attendanceClassId: 'scola:attendance:classId',
  notasClassId: 'scola:notas:classId',
} as const;

/* ---- Janela de impressão (ids dos elementos temporários) ---- */
export const PRINT_ROOT_ID = 'scola-print';
export const PRINT_STYLE_ID = 'scola-print-style';
