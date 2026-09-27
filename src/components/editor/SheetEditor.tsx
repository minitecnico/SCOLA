import { api, type Sheet } from '@fortune-sheet/core';
import { Workbook, type WorkbookInstance } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import { forwardRef, useImperativeHandle, useRef } from 'react';

/**
 * Planilha (tipo Sheets) — FortuneSheet, código aberto, roda no navegador:
 * várias abas, fórmulas, formatação, mesclar células, congelar, filtrar e classificar.
 */
export type SheetData = Sheet[];

export interface SheetEditorHandle {
  /** Conteúdo compacto para salvar (só as células preenchidas). */
  getContent: () => SheetData;
  /** Arquivo .xlsx da planilha atual. */
  toXlsx: () => Promise<Blob>;
}

export const blankSheets = (): SheetData => [{ name: 'Planilha1', celldata: [], order: 0, status: 1 } as Sheet];

/** .xlsx → abas do editor (mantém fórmulas, estilos, bordas, mesclagens e larguras). */
export async function xlsxToSheets(buffer: ArrayBuffer, name = 'planilha.xlsx'): Promise<SheetData> {
  const { transformExcelToFortune } = await import('@corbe30/fortune-excel');
  let sheets: SheetData = [];
  await transformExcelToFortune(new File([buffer], name.replace(/\.(xls|ods)$/i, '.xlsx')), (s: SheetData) => (sheets = s), () => {}, null);
  if (!sheets.length) return blankSheets();
  // O conversor devolve campos de controle como texto ("0", "1"): sem aba ativa a grade não aparece.
  const num = (v: unknown, d?: number) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
  return sheets.map((sh, i) => {
    const x = sh as Sheet & Record<string, unknown>;
    return {
      ...x,
      status: i === 0 ? 1 : 0,
      order: i,
      hide: num(x.hide, 0),
      zoomRatio: num(x.zoomRatio, 1) || 1,
      showGridLines: num(x.showGridLines, 1),
      defaultColWidth: num(x.defaultColWidth),
      defaultRowHeight: num(x.defaultRowHeight),
    } as Sheet;
  });
}

/** Tabela simples (CSV, ODS convertido, etc.) → uma aba. */
export function gridToSheets(grid: unknown[][], name = 'Planilha1'): SheetData {
  const celldata = grid.flatMap((row, r) =>
    row
      .map((v, c) => ({ r, c, v }))
      .filter((x) => x.v !== '' && x.v != null)
      .map(({ r, c, v }) => {
        const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
        const isNum = typeof v === 'number' || (/^-?[\d.]+(,\d+)?$/.test(String(v).trim()) && !Number.isNaN(n));
        return { r, c, v: isNum ? { v: n, m: String(v), ct: { fa: 'General', t: 'n' } } : { v: String(v), m: String(v), ct: { fa: 'General', t: 'g' } } };
      }),
  );
  return [{ name, celldata, order: 0, status: 1 } as unknown as Sheet];
}

export const SheetEditor = forwardRef<SheetEditorHandle, { initial: SheetData; editable: boolean; onChange: () => void }>(function SheetEditor(
  { initial, editable, onChange },
  ref,
) {
  const wb = useRef<WorkbookInstance>(null);
  const last = useRef<string | null>(null);

  // Só o que é conteúdo (células, formatação, abas) conta como edição — selecionar,
  // rolar ou dar zoom não. Assim o salvamento automático só roda quando algo mudou.
  const VOLATILE = new Set(['luckysheet_select_save', 'luckysheet_selection_range', 'zoomRatio', 'scrollLeft', 'scrollTop', 'status', 'jfgird_select_save', 'visibledatarow', 'visibledatacolumn', 'ch_width', 'rh_height']);
  const snapshot = () =>
    JSON.stringify(
      (wb.current?.getAllSheets() ?? []).map((sh) => Object.fromEntries(Object.entries(sh).filter(([k]) => !VOLATILE.has(k) && k !== 'celldata'))),
    );

  useImperativeHandle(ref, () => ({
    getContent: () =>
      (wb.current?.getAllSheets() ?? []).map((s) => {
        const { data, ...rest } = s as Sheet & { data?: unknown };
        return { ...rest, celldata: api.dataToCelldata(data as never) } as Sheet;
      }),
    toXlsx: async () => {
      const { transformFortuneToExcel } = await import('@corbe30/fortune-excel');
      return transformFortuneToExcel(wb, 'xlsx' as Parameters<typeof transformFortuneToExcel>[1], false);
    },
  }));

  return (
    <div className="scola-sheet relative min-h-0 flex-1">
      <Workbook
        ref={wb}
        data={initial}
        lang="pt"
        currency="R$"
        allowEdit={editable}
        showToolbar={editable}
        onChange={() => {
          const now = snapshot();
          // A primeira chamada é a própria carga da planilha: só registra o ponto de partida.
          if (last.current === null || now === last.current) {
            last.current = now;
            return;
          }
          last.current = now;
          onChange();
        }}
      />
    </div>
  );
});
