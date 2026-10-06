import { useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { readableText } from "../../lib/calendarColors";

export type FilterChip = {
  id: string;
  label: string;
  color: string;
  /** Quantos compromissos a categoria tem no período que está na tela. */
  count: number;
  on: boolean;
  title?: string;
  onToggle: () => void;
};

/**
 * Legenda + filtro do calendário. Mostra só o que existe no período (com a contagem dele);
 * o resto fica a um toque em "sem eventos". No celular, os botões rolam numa linha só.
 */
export function CalendarFilters({ chips, onSetAll }: { chips: FilterChip[]; onSetAll: (on: boolean) => void }) {
  const [showEmpty, setShowEmpty] = useState(false);
  const emptyCount = chips.filter((c) => c.count === 0).length;
  const shown = showEmpty ? chips : chips.filter((c) => c.count > 0);
  const allOn = chips.every((c) => c.on);

  return (
    <div className="cb-filters" role="group" aria-label="Filtrar por categoria">
      <span className="cb-hint">Mostrar:</span>
      <div className="cb-filters-row">
        {shown.map((c) => (
          <button
            key={c.id}
            type="button"
            className="cb-chip"
            aria-pressed={c.on}
            title={c.title}
            onClick={c.onToggle}
            style={{ "--chip": c.color, "--chip-ink": readableText(c.color) } as CSSProperties}
          >
            {c.on ? <Check size={13} strokeWidth={3} aria-hidden /> : <span className="cb-cdot" aria-hidden />}
            {c.label}
            <span className="cb-chip-n">{c.count}</span>
          </button>
        ))}
      </div>
      <div className="cb-filters-tools">
        {emptyCount > 0 ? (
          <button type="button" className="cb-link" aria-expanded={showEmpty} onClick={() => setShowEmpty((v) => !v)}>
            {showEmpty ? "Ocultar sem eventos" : `+${emptyCount} sem eventos`}
          </button>
        ) : null}
        <button type="button" className="cb-link" onClick={() => onSetAll(!allOn)}>
          {allOn ? "Desmarcar todas" : "Marcar todas"}
        </button>
      </div>
    </div>
  );
}
