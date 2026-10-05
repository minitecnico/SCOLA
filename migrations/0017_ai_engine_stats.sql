-- Saúde de cada motor/modelo de IA (taxa de acerto, latência, falhas seguidas e descanso).
CREATE TABLE IF NOT EXISTS ai_engine_stats (
  engine_id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL DEFAULT 0,
  fail INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  ewma_ms REAL,
  last_error TEXT,
  last_ok_at TEXT,
  last_fail_at TEXT,
  rest_until INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
