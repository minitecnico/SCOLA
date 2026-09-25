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
}

export interface ImportResult {
  created: number;
  note?: string;
  duplicates?: string[];
}

/** Lê o arquivo (aba com mais dados), mapeia pelas colunas e ignora a linha de exemplo. */
export async function parseSheet(file: File, columns: ColumnDef[]): Promise<ParseResult> {
  assertSpreadsheetFile(file);
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });

  // Escolhe a aba que tiver mais linhas (robusto a Modelo/Exemplo, nomes de aba, etc.)
  let raw: Record<string, unknown>[] = [];
  for (const name of wb.SheetNames) {
    const j = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: '' });
    if (j.length > raw.length) raw = j;
  }
  assertImportRowLimit(raw.length);

  const labelToKey: Record<string, string> = {};
  const exampleByKey: Record<string, string> = {};
  columns.forEach((c) => {
    labelToKey[norm(c.label)] = c.key;
    exampleByKey[c.key] = norm(c.example);
  });

  const rows: Record<string, string>[] = [];
  const errors: string[] = [];

  raw.forEach((r, i) => {
    const obj: Record<string, string> = {};
    Object.entries(r).forEach(([label, val]) => {
      const key = labelToKey[norm(label)];
      if (key) obj[key] = String(val ?? '').trim();
    });
    // ignora linhas vazias
    if (!Object.values(obj).some((v) => v)) return;
    // ignora a linha de exemplo do modelo (todos os valores iguais aos exemplos)
    const filled = Object.keys(obj).filter((k) => obj[k]);
    if (filled.length > 0 && filled.every((k) => norm(obj[k]) === exampleByKey[k])) return;

    const missing = columns.filter((c) => c.required && !obj[c.key]).map((c) => c.label);
    if (missing.length) errors.push(`Linha ${i + 2}: faltando ${missing.join(', ')}`);
    else rows.push(obj);
  });

  return { rows, errors };
}

function norm(s: string) {
  return String(s).toLowerCase().trim();
}
