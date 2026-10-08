import React from "react";
import { holidayKindLabel } from "../../lib/holidays";
import type { CalendarHoliday, CalBuilderEvent as CalEvent, CalCategory as Category } from "../../lib/types";
import { holidayColor, readableText } from "../../lib/calendarColors";

import { DOW, MONTHS_PT, WEEKDAY, chipLabel, daysInMonthFor, isoOf, pad2 } from "./dates";

/** Um compromisso (evento ou feriado) dentro de um mês, pronto para listar. */
export type Entry = {
  key: string;
  days: number[];
  title: string;
  label: string;
  color: string;
  categoryId?: string;
  holiday?: boolean;
  endISO: string;
  weekday: string | null; // só para compromissos de 1 dia
};

/** Compromissos do mês em ordem de data (feriados e eventos juntos). */
export function monthEntries(
  year: number,
  month: number,
  events: CalEvent[],
  holidays: CalendarHoliday[],
  catById: Record<string, Category>
): Entry[] {
  const wd = (day: number) => WEEKDAY[new Date(year, month, day).getDay()];
  const out: Entry[] = [];
  holidays.forEach((h) => {
    if (+h.date.slice(0, 4) !== year || +h.date.slice(5, 7) - 1 !== month) return;
    const day = +h.date.slice(8, 10);
    out.push({
      key: `h-${h.id}`,
      days: [day],
      title: h.generic ? "Feriado municipal" : h.title,
      label: holidayKindLabel(h) + (h.generic ? " · confirme o nome" : ""),
      color: holidayColor(h.scope),
      holiday: true,
      endISO: h.date,
      weekday: wd(day),
    });
  });
  events.forEach((ev) => {
    const days = daysInMonthFor(ev, year, month);
    const cat = catById[ev.categoryId];
    if (!days.length || !cat) return;
    out.push({
      key: ev.id,
      days,
      title: ev.title,
      label: cat.label,
      color: cat.color,
      categoryId: ev.categoryId,
      endISO: ev.end ?? ev.start,
      weekday: days.length === 1 ? wd(days[0]) : null,
    });
  });
  return out.sort((a, b) => a.days[0] - b.days[0] || Number(!!b.holiday) - Number(!!a.holiday));
}

export function EntryRow({ e, on, past }: { e: Entry; on: boolean; past: boolean }) {
  return (
    <div className={`cb-ev ${on ? "" : "dim"} ${past ? "past" : ""}`}>
      <span className="cb-date" style={{ background: e.color, color: readableText(e.color) }}>
        {chipLabel(e.days)}
        {e.weekday ? <small>{e.weekday}</small> : null}
      </span>
      <span className="cb-txt">
        {e.title}
        <small>
          <i style={{ background: e.color }} />
          {e.label}
        </small>
      </span>
    </div>
  );
}

export function MonthCard({
  year, month, events, holidays, catById, active, letivos, today, onDayClick,
}: {
  year: number; month: number; events: CalEvent[]; holidays: CalendarHoliday[];
  catById: Record<string, Category>; active: Set<string>; letivos?: number; today: string;
  onDayClick?: (iso: string) => void;
}) {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = segunda
  const nDays = new Date(year, month + 1, 0).getDate();
  const isCurrentMonth = today.startsWith(`${year}-${pad2(month + 1)}`);

  const entries = monthEntries(year, month, events, holidays, catById);
  const byDay: Record<number, Entry[]> = {};
  entries.forEach((e) => e.days.forEach((day) => (byDay[day] = byDay[day] || []).push(e)));

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(<div key={`e${i}`} className="cb-cell empty" />);
  for (let day = 1; day <= nDays; day++) {
    const iso = isoOf(year, month, day);
    const list = byDay[day] || [];
    const visible = list.filter((e) => e.holiday || (e.categoryId && active.has(e.categoryId)));
    const isHoliday = list.some((e) => e.holiday);
    const isToday = iso === today;
    const weekend = (firstDow + day - 1) % 7 >= 5;
    // Dia com compromisso = quadrado sólido na cor da categoria; se houver mais de um, faixas coloridas embaixo.
    const colors = [...new Set(visible.map((e) => e.color))];
    const primary = (visible.find((e) => !e.holiday) ?? visible[0])?.color;
    const className = [
      "cb-cell",
      visible.length ? "has" : "",
      isHoliday ? "holiday" : "",
      weekend ? "weekend" : "",
      isToday ? "today" : "",
      list.length > 0 && visible.length === 0 ? "dim" : "",
      onDayClick ? "clickable" : "",
    ].join(" ");
    const style = primary ? { background: primary, color: readableText(primary) } : undefined;
    const tip = list.length ? list.map((e) => e.title).join(" · ") : undefined;
    const content = (
      <>
        {day}
        {colors.length > 1 && (
          <span className="cb-stripes">
            {colors.slice(0, 4).map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
        )}
      </>
    );
    cells.push(
      onDayClick ? (
        <button key={day} type="button" className={className} style={style} title={tip ?? "Adicionar evento neste dia"} onClick={() => onDayClick(iso)}>
          {content}
        </button>
      ) : (
        <div key={day} className={className} style={style} title={tip}>
          {content}
        </div>
      )
    );
  }

  return (
    <section className={`cb-month ${isCurrentMonth ? "current" : ""}`}>
      <div className="cb-month-head">
        <h2>{MONTHS_PT[month]}</h2>
        <span className="cb-month-tags">
          {isCurrentMonth ? <span className="cb-badge now">Mês atual</span> : null}
          {letivos ? <span className="cb-badge">{letivos} dias letivos</span> : null}
        </span>
      </div>
      <div className="cb-cal">
        <div className="cb-dow">
          {DOW.map((s, i) => <span key={i} className={i >= 5 ? "weekend" : ""}>{s}</span>)}
        </div>
        <div className="cb-grid">{cells}</div>
      </div>
      <div className="cb-events">
        {entries.length === 0 && <p className="cb-empty">Sem eventos neste mês.</p>}
        {entries.map((e) => (
          <EntryRow key={e.key} e={e} on={!!e.holiday || (!!e.categoryId && active.has(e.categoryId))} past={e.endISO < today} />
        ))}
      </div>
    </section>
  );
}

/** Visão em lista: todos os compromissos do período em ordem de data, um mês após o outro. */
export function AgendaView({
  year, months, events, holidays, catById, active, letivosByMonth, today,
}: {
  year: number; months: number[]; events: CalEvent[]; holidays: CalendarHoliday[];
  catById: Record<string, Category>; active: Set<string>; letivosByMonth: Record<number, number>; today: string;
}) {
  const groups = months
    .map((m) => ({
      m,
      entries: monthEntries(year, m, events, holidays, catById).filter((e) => e.holiday || (e.categoryId && active.has(e.categoryId))),
    }))
    .filter((g) => g.entries.length > 0);

  if (groups.length === 0) {
    return <p className="cb-agenda-empty">Nenhum compromisso neste período com os filtros atuais.</p>;
  }
  return (
    <div className="cb-agenda">
      {groups.map((g) => (
        <section className="cb-agenda-month" key={g.m}>
          <div className="cb-agenda-head">
            <h2>{MONTHS_PT[g.m]}</h2>
            <span className="cb-agenda-meta">
              {g.entries.length} compromisso(s)
              {letivosByMonth[g.m] ? ` · ${letivosByMonth[g.m]} dias letivos` : ""}
            </span>
          </div>
          <div className="cb-agenda-list">
            {g.entries.map((e) => (
              <EntryRow key={e.key} e={e} on past={e.endISO < today} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
