import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { downloadTemplate, parseSheet, type ColumnDef, type ImportResult, type ParseResult } from '../lib/importSheet';
import { Button, Modal } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  columns: ColumnDef[];
  templateFileName: string;
  importFn: (rows: Record<string, string>[]) => Promise<number | ImportResult>;
  onDone?: () => void;
  /** Conteúdo opcional acima do upload (ex.: escolher escola/turma). */
  contextSlot?: ReactNode;
  /** Quando false, bloqueia o upload (falta escolher contexto). */
  ready?: boolean;
  notReadyHint?: string;
}

export function ImportModal({
  open,
  onClose,
  title,
  columns,
  templateFileName,
  importFn,
  onDone,
  contextSlot,
  ready = true,
  notReadyHint,
}: Props) {
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<ImportResult | null>(null);
  const [dragging, setDragging] = useState(false);

  function reset() {
    setParsed(null);
    setFileName('');
    setError('');
    setDone(null);
    setDragging(false);
  }
  function close() {
    reset();
    onClose();
  }

  async function handleFile(file: File) {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.name);
    if (!ok) {
      setError('Formato inválido. Use .xlsx, .xls ou .csv.');
      return;
    }
    setError('');
    setDone(null);
    setFileName(file.name);
    try {
      setParsed(await parseSheet(file, columns));
    } catch (err) {
      setParsed(null);
      setError((err as Error)?.message?.startsWith('Planilha') || (err as Error)?.message?.startsWith('Arquivo') ? (err as Error).message : 'Não consegui ler o arquivo. Use o modelo (.xlsx ou .csv).');
    }
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) void handleFile(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }

  async function runImport() {
    if (!parsed?.rows.length) return;
    setBusy(true);
    setError('');
    try {
      const r = await importFn(parsed.rows);
      const result: ImportResult = typeof r === 'number' ? { created: r } : r;
      setDone(result);
      onDone?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const dups = done?.duplicates ?? [];

  return (
    <Modal open={open} onClose={close} title={title}>
      {done !== null ? (
        <div className="py-2 text-center">
          <CheckCircle2 size={48} className="mx-auto text-emerald-600" />
          <p className="mt-3 text-lg font-black text-foreground">{done.created} cadastrado(s)!</p>
          {done.note ? <p className="mt-1 text-sm text-muted-foreground">{done.note}</p> : null}
          {dups.length ? (
            <div className="mt-4 rounded-xl bg-amber-50 p-3 text-left">
              <p className="flex items-center gap-2 text-sm font-bold text-amber-800">
                <AlertTriangle size={16} /> {dups.length} já cadastrado(s) — ignorado(s):
              </p>
              <div className="mt-2 max-h-40 overflow-y-auto text-xs text-amber-700">
                {dups.map((d, i) => (
                  <p key={i}>• {d}</p>
                ))}
              </div>
            </div>
          ) : null}
          <Button className="mt-5" onClick={close}>
            Concluir
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl bg-muted p-4">
            <p className="text-sm font-medium text-muted-foreground">
              Baixe o modelo, preencha uma linha por aluno a partir da linha 3 (a linha 2 é só exemplo e é ignorada) e envie o arquivo.
            </p>
            <Button variant="ghost" className="mt-3" onClick={() => downloadTemplate(templateFileName, columns)}>
              <Download size={18} /> Baixar planilha modelo
            </Button>
          </div>

          {contextSlot}

          {!ready ? (
            <p className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-700">{notReadyHint}</p>
          ) : (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition ${
                dragging ? 'border-emerald-500 bg-emerald-50' : 'border-border hover:border-emerald-400 hover:bg-emerald-50/40'
              }`}
            >
              <Upload size={24} className={dragging ? 'text-emerald-600' : 'text-muted-foreground'} />
              <span className="text-sm font-bold text-foreground">
                {dragging ? 'Solte o arquivo aqui' : fileName || 'Clique ou arraste a planilha aqui'}
              </span>
              <span className="text-xs text-muted-foreground">.xlsx ou .csv</span>
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onInputChange} />
            </label>
          )}

          {parsed ? <ParsedSummary parsed={parsed} columns={columns} /> : null}

          {error ? <p className="text-sm font-semibold text-red-600">{error}</p> : null}

          <div className="mt-1 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={close}>
              Cancelar
            </Button>
            <Button onClick={runImport} disabled={busy || !parsed?.rows.length}>
              {busy ? 'Importando…' : `Importar ${parsed?.rows.length || ''}`.trim()}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ParsedSummary({ parsed, columns }: { parsed: ParseResult; columns: ColumnDef[] }) {
  const { rows, errors, onlyExample, unknownHeaders = [] } = parsed;
  const shown = columns.filter((c) => rows.some((r) => r[c.key]));
  if (onlyExample) {
    return (
      <div className="rounded-xl bg-orange-50 p-4 text-sm text-orange-900 ring-1 ring-inset ring-orange-200">
        <p className="flex items-center gap-2 font-bold">
          <AlertTriangle size={16} /> A planilha só tem a linha de exemplo
        </p>
        <p className="mt-1">
          A linha "{columns.map((c) => c.example).filter(Boolean).slice(0, 2).join(' · ')}" é do modelo e não é importada. Preencha seus alunos nas linhas de baixo (ou
          substitua o exemplo) e envie de novo.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border">
      <p className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-bold text-foreground">
        <FileSpreadsheet size={16} />
        {rows.length ? `${rows.length} linha(s) prontas para importar` : 'Nenhuma linha válida encontrada'}
      </p>
      {rows.length ? (
        <div className="max-h-48 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-muted text-muted-foreground">
              <tr>
                {shown.map((c) => (
                  <th key={c.key} className="whitespace-nowrap px-3 py-2 font-semibold">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.slice(0, 8).map((r, i) => (
                <tr key={i}>
                  {shown.map((c) => (
                    <td key={c.key} className="whitespace-nowrap px-3 py-1.5 text-foreground">
                      {r[c.key] || <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 8 ? <p className="px-3 py-2 text-xs text-muted-foreground">+ {rows.length - 8} linha(s)</p> : null}
        </div>
      ) : null}
      {errors.length || (!rows.length && unknownHeaders.length) ? (
        <div className="space-y-1 border-t border-border px-4 py-3 text-xs text-red-700">
          {errors.slice(0, 20).map((e, i) => (
            <p key={i}>{e}</p>
          ))}
          {errors.length > 20 ? <p>+ {errors.length - 20} erro(s)</p> : null}
          {!rows.length && unknownHeaders.length ? (
            <p>
              Colunas não reconhecidas: {unknownHeaders.join(', ')}. Use os cabeçalhos do modelo: {columns.map((c) => c.label).join(', ')}.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
