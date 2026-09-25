-- Central de logs do administrador: quem fez o quê, onde e quando.
-- Nomes (base, alvo) ficam gravados no momento da ação, para o histórico continuar
-- legível mesmo depois que a turma/aluno/base for excluída. Retenção: 180 dias (cron).
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         TEXT NOT NULL,
  base_id    TEXT,
  base_name  TEXT,
  user_id    TEXT,
  user_email TEXT,
  role       TEXT,
  action     TEXT NOT NULL,
  category   TEXT NOT NULL,
  summary    TEXT NOT NULL,
  target     TEXT,
  status     TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','erro','negado')),
  detail     TEXT,
  ip         TEXT,
  device     TEXT
);
CREATE INDEX idx_audit_at ON audit_log(at);
CREATE INDEX idx_audit_base ON audit_log(base_id, at);
CREATE INDEX idx_audit_user ON audit_log(user_email, at);
CREATE INDEX idx_audit_status ON audit_log(status, at);
