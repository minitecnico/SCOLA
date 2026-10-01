-- Menos linhas lidas no D1 (plano gratuito: 5 milhões de leituras/dia).
-- 1) Índice de chamadas "cobrindo" as consultas por base/data (data, excluída, turma e id ficam no próprio índice).
DROP INDEX IF EXISTS idx_att_sessions_base;
CREATE INDEX idx_att_sessions_base ON attendance_sessions(base_id, session_date, deleted_at, class_id, id);
-- 2) Lixeira de chamadas (lista só as excluídas; o índice é minúsculo).
CREATE INDEX idx_att_sessions_trash ON attendance_sessions(base_id, deleted_at) WHERE deleted_at IS NOT NULL;
-- 3) Cache das agregações pesadas (frequência do ano, alertas, visão do ano letivo). Zerado a cada gravação da base.
CREATE TABLE query_cache (
  key        TEXT PRIMARY KEY,
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  value      TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_query_cache_base ON query_cache(base_id);
