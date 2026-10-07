import { DateInput } from "../DateInput";
import type { CalBuilderEvent as CalEvent, CalCategory as Category, CalendarBuilderData as CalendarData, CalPeriod as Period } from "../../lib/types";
import { MONTHS_PT } from "./dates";
import { Field, Section } from "./EditorBits";

/* Seções do painel "Editar calendário": cada uma recebe só os dados e as ações de que precisa. */

export function EventsSection({
  events, categories, query, newEventId, onQuery, onAdd, onUpdate, onRemove,
}: {
  events: CalEvent[];
  categories: Category[];
  query: string;
  newEventId: string | null;
  onQuery: (q: string) => void;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<CalEvent>) => void;
  onRemove: (id: string) => void;
}) {
  const catColor = Object.fromEntries(categories.map((c) => [c.id, c.color]));
  const q = query.trim().toLowerCase();
  const sorted = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const shownEvents = q ? sorted.filter((e) => e.title.toLowerCase().includes(q)) : sorted;
  return (
    <Section title="Eventos" count={events.length} defaultOpen>
      <div className="cb-section-tools">
        <button className="cb-add" onClick={onAdd}>+ Evento</button>
        <p className="cb-help cb-grow">Dica: clique em um dia do calendário para criar o evento já com a data.</p>
      </div>
      {events.length > 6 ? (
        <input
          className="cb-input cb-search"
          type="search"
          placeholder="Buscar evento…"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          aria-label="Buscar evento"
        />
      ) : null}
      {events.length === 0 ? <p className="cb-help">Nenhum evento ainda.</p> : null}
      {q && shownEvents.length === 0 ? <p className="cb-help">Nenhum evento encontrado para “{query}”.</p> : null}
      <div className="cb-event-list">
      {shownEvents.map((ev) => (
        <div className="cb-event" key={ev.id} style={{ borderLeftColor: catColor[ev.categoryId] ?? "#ccc" }}>
          <input
            className="cb-input"
            value={ev.title}
            placeholder="Título do evento"
            autoFocus={ev.id === newEventId}
            onFocus={(e) => ev.id === newEventId && e.currentTarget.select()}
            onChange={(e) => onUpdate(ev.id, { title: e.target.value })}
          />
          <div className="cb-event-grid">
            <select className="cb-input cb-span2" value={ev.categoryId} onChange={(e) => onUpdate(ev.id, { categoryId: e.target.value })} aria-label="Categoria">
              {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <DateInput value={ev.start} onChange={(v) => v && onUpdate(ev.id, { start: v })} aria-label="Data de início" />
            <DateInput value={ev.end ?? ""} min={ev.start} placeholder="fim (opcional)" onChange={(v) => onUpdate(ev.id, { end: v || undefined })} aria-label="Data de término" />
          </div>
          <button className="cb-del" onClick={() => onRemove(ev.id)}>Remover evento</button>
        </div>
      ))}
      </div>
    </Section>
  );
}

export function CategoriesSection({
  categories, counts, onAdd, onUpdate, onRemove,
}: {
  categories: Category[];
  counts: Record<string, number>;
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Category>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Section title="Categorias" count={categories.length} defaultOpen>
      <div className="cb-section-tools">
        <button className="cb-add" onClick={onAdd}>+ Categoria</button>
        <p className="cb-help cb-grow">Escolha uma cor para cada tipo de evento.</p>
      </div>
      {categories.map((c) => (
        <div className="cb-row" key={c.id}>
          <input
            type="color"
            className="cb-color"
            value={c.color}
            onChange={(e) => onUpdate(c.id, { color: e.target.value })}
            aria-label={`Cor de ${c.label}`}
          />
          <input
            className="cb-input cb-grow"
            value={c.label}
            onChange={(e) => onUpdate(c.id, { label: e.target.value })}
            aria-label="Nome da categoria"
          />
          <span className="cb-count" title="Eventos nesta categoria">{counts[c.id] || 0}</span>
          <button className="cb-del" onClick={() => onRemove(c.id)} aria-label={`Remover ${c.label}`}>×</button>
        </div>
      ))}
    </Section>
  );
}

export function PeriodsSection({
  periods, onAdd, onUpdate, onRemove,
}: {
  periods: Period[];
  onAdd: () => void;
  onUpdate: (id: string, patch: Partial<Period>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Section title="Períodos / Trimestres" count={periods.length}>
      <div className="cb-section-tools">
        <button className="cb-add" onClick={onAdd}>+ Período</button>
        <p className="cb-help cb-grow">Cada período vira uma aba acima do calendário.</p>
      </div>
      {periods.map((p) => (
        <div className="cb-prow" key={p.id}>
          <input
            className="cb-input cb-grow"
            value={p.label}
            onChange={(e) => onUpdate(p.id, { label: e.target.value })}
            aria-label="Nome do período"
          />
          <select className="cb-input cb-mini" value={p.startMonth} onChange={(e) => onUpdate(p.id, { startMonth: Number(e.target.value) })} aria-label="Mês inicial">
            {MONTHS_PT.map((m, i) => <option key={i} value={i}>{m.slice(0, 3)}</option>)}
          </select>
          <span className="cb-to">→</span>
          <select className="cb-input cb-mini" value={p.endMonth} onChange={(e) => onUpdate(p.id, { endMonth: Number(e.target.value) })} aria-label="Mês final">
            {MONTHS_PT.map((m, i) => <option key={i} value={i}>{m.slice(0, 3)}</option>)}
          </select>
          <button className="cb-del" onClick={() => onRemove(p.id)} aria-label={`Remover ${p.label}`}>×</button>
        </div>
      ))}
    </Section>
  );
}

export function LetivosSection({
  byMonth, total, onChange, onSuggest,
}: {
  byMonth: Record<number, number>;
  total: number;
  onChange: (month: number, raw: string) => void;
  onSuggest: () => void;
}) {
  return (
    <Section title="Dias letivos" count={total || undefined}>
      <p className="cb-help">Quantos dias de aula há em cada mês. O mínimo legal é de 200 dias letivos no ano.</p>
      <div className="cb-letivos">
        {MONTHS_PT.map((name, i) => (
          <label key={i} className="cb-lt">
            <span>{name.slice(0, 3)}</span>
            <input
              className="cb-input"
              type="number"
              inputMode="numeric"
              min={0}
              max={31}
              value={byMonth[i] ?? ""}
              onChange={(e) => onChange(i, e.target.value)}
            />
          </label>
        ))}
      </div>
      <p className={`cb-lt-total ${total >= 200 ? "ok" : ""}`}>
        Total no ano: <strong>{total}</strong> de 200 dias
      </p>
      <button className="cb-add" onClick={onSuggest}>Sugerir a partir do calendário</button>
      <p className="cb-help cb-mt">Conta de segunda a sexta, descontando feriados e eventos de recesso/férias. Ajuste à mão o que for diferente.</p>
    </Section>
  );
}

export function HolidaysSection({
  year, holidayCount, city, cityShort, cityStatus, canSetCity, onAdd, onChangeCity,
}: {
  year: number;
  holidayCount: number;
  city?: string;
  cityShort: string;
  cityStatus?: string;
  canSetCity: boolean;
  onAdd: () => void;
  onChangeCity: () => void;
}) {
  return (
    <Section title="Feriados" count={holidayCount || undefined}>
      <p className="cb-help">
        Os feriados nacionais{city ? `, do estado e de ${cityShort}` : ""} de {year} já aparecem no calendário.
        Para deixá-los fixos e editáveis, adicione como eventos na categoria “Feriado”.
      </p>
      <button className="cb-add" onClick={onAdd}>+ Adicionar feriados de {year}</button>
      {cityStatus === "ok" ? (
        <p className="cb-help cb-mt">
          Feriados locais para <b>{city}</b>. {canSetCity ? <button className="cb-link" onClick={() => onChangeCity()}>Alterar cidade</button> : null}
        </p>
      ) : canSetCity ? (
        <p className="cb-help cb-mt">
          Quer ver também os feriados do estado e do município? <button className="cb-link" onClick={() => onChangeCity()}>Definir a cidade da escola</button>
        </p>
      ) : null}
    </Section>
  );
}

export function IdentitySection({ data, onChange }: { data: CalendarData; onChange: (patch: Partial<CalendarData>) => void }) {
  return (
    <Section title="Identificação e rodapé">
      <Field label="Escola">
        <input className="cb-input" value={data.school} onChange={(e) => onChange({ school: e.target.value })} />
      </Field>
      <Field label="Título do calendário">
        <input className="cb-input" value={data.title} onChange={(e) => onChange({ title: e.target.value })} />
      </Field>
      <Field label="Ano letivo">
        <input
          className="cb-input"
          type="number"
          value={data.year}
          onChange={(e) => onChange({ year: Number(e.target.value) })}
        />
      </Field>
      <Field label="Observações (aparecem no rodapé)">
        <textarea className="cb-input cb-area" rows={3} value={data.notes} onChange={(e) => onChange({ notes: e.target.value })} />
      </Field>
    </Section>
  );
}
