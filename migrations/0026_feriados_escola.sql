-- Feriados e pontos facultativos cadastrados pela própria escola (Dia do Professor, aniversário da cidade, recessos…).
-- Complementam a fonte aberta, que não cobre todas as cidades. yearly = 1: repete na mesma data todo ano.
CREATE TABLE school_holidays (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  date TEXT NOT NULL,                 -- AAAA-MM-DD (data original)
  title TEXT NOT NULL,
  yearly INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_school_holidays_base ON school_holidays(base_id);
