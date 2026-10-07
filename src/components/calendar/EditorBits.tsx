import React from "react";
import { ChevronDown } from "lucide-react";


/* --------------------------- Subcomponentes ------------------------------ */
/** Seção recolhível do editor — a coordenação abre só o que está usando. */
export function Section({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="cb-section" open={defaultOpen}>
      <summary className="cb-section-head">
        <h3>{title}</h3>
        {count !== undefined ? <span className="cb-count">{count}</span> : null}
        <ChevronDown size={16} className="cb-chev" aria-hidden />
      </summary>
      <div className="cb-section-body">{children}</div>
    </details>
  );
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="cb-field">
      <span>{label}</span>
      {children}
    </label>
  );
}


/** Um compromisso (evento ou feriado) dentro de um mês, pronto para listar. */
