// Importação por planilha — template + leitura de .xlsx/.csv.
// xlsx é carregado sob demanda (dynamic import) para não pesar no bundle inicial.
import { assertImportRowLimit, assertSpreadsheetFile } from './fileSecurity';

export interface ColumnDef {
  key: string;
  label: string;
  example: string;
  required?: boolean;
}

/** Planilha única e inteligente: cada linha cria escola + turma + aluno conforme preenchido. */
export const CADASTRO_COLUMNS: ColumnDef[] = [
  { key: 'class', label: 'Turma', example: '5º ano A', required: true },
  { key: 'shift', label: 'Turno', example: 'Manhã' },
  { key: 'year', label: 'Ano', example: '2026' },
  { key: 'student', label: 'Aluno', example: 'Maria de Souza' },
  { key: 'registration', label: 'Matrícula', example: '2026001' },
  { key: 'guardian', label: 'Responsável', example: 'João de Souza' },
  { key: 'phone', label: 'Telefone', example: '(62) 90000-0000' },
];

/** Gera e baixa a planilha modelo: uma aba só, com cabeçalho + 1 linha de exemplo. */
export async function downloadTemplate(fileName: string, columns: ColumnDef[]) {
  const XLSX = await import('xlsx');
  const headers = columns.map((c) => c.label);
  const ws = XLSX.utils.aoa_to_sheet([headers, columns.map((c) => c.example)]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Cadastro');
  XLSX.writeFile(wb, fileName);
}

/** Exporta uma matriz (primeira linha = cabeçalho) para .xlsx. */
export async function downloadXlsx(fileName: string, aoa: (string | number | null)[][], sheetName = 'Relatório') {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
}

export interface ParseResult {
  rows: Record<string, string>[];
  errors: string[];
  /** A planilha só tinha a linha de exemplo do modelo (nada a importar). */
  onlyExample?: boolean;
  /** Colunas da planilha que não foram reconhecidas (ajuda a achar cabeçalho errado). */
  unknownHeaders?: string[];
}

export interface ImportResult {
  created: number;
  note?: string;
  duplicates?: string[];
}

/** Outros nomes de cabeçalho aceitos (sem acento, minúsculo). */
const ALIASES: Record<string, string[]> = {
  class: ['turma', 'classe', 'serie', 'serie/turma', 'ano/turma'],
  shift: ['turno', 'periodo'],
  year: ['ano', 'ano letivo'],
  student: ['aluno', 'aluna', 'nome', 'nome do aluno', 'nome completo', 'estudante', 'aluno(a)'],
  registration: ['matricula', 'n matricula', 'numero da matricula', 'ra', 'codigo'],
  guardian: ['responsavel', 'nome do responsavel', 'responsavel legal', 'mae', 'pai', 'mae/pai'],
  phone: ['telefone', 'celular', 'whatsapp', 'telefone do responsavel', 'contato', 'fone'],
};

/**
 * Lê o arquivo (aba com mais dados), acha a linha de cabeçalho (mesmo com título acima),
 * mapeia pelas colunas/sinônimos e ignora a linha de exemplo do modelo.
 * CSV: aceita UTF-8 ou o padrão do Excel brasileiro (Windows-1252), com ; ou ,.
 */
export async function parseSheet(file: File, columns: ColumnDef[]): Promise<ParseResult> {
  assertSpreadsheetFile(file);
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  let wb;
  if (/\.csv$/i.test(file.name)) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      text = new TextDecoder('windows-1252').decode(buffer);
    }
    wb = XLSX.read(text.replace(/^\uFEFF/, ''), { type: 'string', raw: true });
  } else {
    wb = XLSX.read(buffer, { type: 'array' });
  }

  const labelToKey: Record<string, string> = {};
  const exampleByKey: Record<string, string> = {};
  columns.forEach((c) => {
    labelToKey[norm(c.label)] = c.key;
    (ALIASES[c.key] ?? []).forEach((a) => (labelToKey[norm(a)] ??= c.key));
    exampleByKey[c.key] = norm(c.example);
  });

  // Aba com mais linhas; cabeçalho = primeira linha (entre as 10 primeiras) que reconhece alguma coluna.
  let grid: string[][] = [];
  for (const name of wb.SheetNames) {
    const g = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, defval: '', raw: false, blankrows: true });
    if (g.length > grid.length) grid = g;
  }
  assertImportRowLimit(grid.length);
  const headerIdx = Math.max(0, grid.slice(0, 10).findIndex((r) => r.some((c) => labelToKey[norm(c)])));
  const header = (grid[headerIdx] ?? []).map((h) => String(h ?? ''));
  const keys = header.map((h) => labelToKey[norm(h)]);
  const unknownHeaders = header.filter((h, i) => h.trim() && !keys[i]);

  const rows: Record<string, string>[] = [];
  const errors: string[] = [];
  let examples = 0;

  grid.slice(headerIdx + 1).forEach((r, i) => {
    const obj: Record<string, string> = {};
    keys.forEach((k, j) => {
      if (k && !obj[k]) obj[k] = String(r[j] ?? '').trim();
    });
    if (!Object.values(obj).some((v) => v)) return;
    // Linha de exemplo do modelo (todos os valores iguais aos do exemplo).
    const filled = Object.keys(obj).filter((k) => obj[k]);
    if (filled.every((k) => norm(obj[k]) === exampleByKey[k])) {
      examples++;
      return;
    }
    const line = headerIdx + i + 2;
    const missing = columns.filter((c) => c.required && !obj[c.key]).map((c) => c.label);
    if (missing.length) errors.push(`Linha ${line}: falta ${missing.join(', ')}`);
    else rows.push(obj);
  });

  return { rows, errors, onlyExample: examples > 0 && !rows.length && !errors.length, unknownHeaders };
}

function norm(s: string) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[º°ª.:]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}
