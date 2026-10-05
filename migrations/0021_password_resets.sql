-- Recuperação de senha por e-mail: link de uso único, válido por 1 hora (só o hash do código fica no banco).
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_password_resets_ip ON password_resets (ip, created_at);
