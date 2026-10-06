-- Cadastro por solicitação (o administrador aprova) e "esqueci minha senha" aprovado por quem conhece a pessoa.
-- O login com Google deixa de existir.
DROP INDEX IF EXISTS idx_users_google_sub;
ALTER TABLE users DROP COLUMN google_sub;

CREATE TABLE access_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'cadastro',        -- cadastro | senha
  status TEXT NOT NULL DEFAULT 'pendente',      -- pendente | aprovado | recusado
  full_name TEXT,
  email TEXT NOT NULL COLLATE NOCASE,
  phone TEXT,
  institution TEXT,                             -- como a pessoa digitou
  role TEXT,                                    -- função pretendida: professor | gestor | secretaria
  city TEXT,
  note TEXT,
  password_hash TEXT NOT NULL,                  -- a senha que a pessoa escolheu (só o hash); vale quando aprovado
  match_base_id TEXT REFERENCES bases(id) ON DELETE SET NULL,   -- escola reconhecida pelo sistema
  match_score INTEGER,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,          -- já existe conta com esse e-mail
  ip TEXT,
  device TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,
  decision_note TEXT
);
CREATE INDEX idx_access_requests_status ON access_requests (status, created_at);
CREATE INDEX idx_access_requests_email ON access_requests (email, kind, status);

-- Limite de pedidos por endereço (anti-spam das telas públicas).
CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX idx_rate_limits ON rate_limits (key, at);
