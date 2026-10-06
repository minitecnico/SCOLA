-- Acesso moderno: convite por link (sem senha provisória), entrar com Google, verificação em duas etapas (TOTP).
-- Conta convidada ainda sem senha guarda password_hash = '!' (nenhuma senha confere com isso).
ALTER TABLE users ADD COLUMN google_sub TEXT;                      -- identificador estável da conta Google
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;
ALTER TABLE users ADD COLUMN totp_secret TEXT;                     -- cifrado (AES-GCM)
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_backup TEXT;                     -- JSON: hashes dos códigos de recuperação
ALTER TABLE users ADD COLUMN totp_last INTEGER;                    -- último passo de 30 s aceito (impede reutilizar o código)

-- Os links de redefinição e de convite usam a mesma tabela.
ALTER TABLE password_resets ADD COLUMN kind TEXT NOT NULL DEFAULT 'reset';   -- reset | invite
ALTER TABLE password_resets ADD COLUMN base_id TEXT;                          -- convite: a escola

-- Segundo passo do login (senha certa, falta o código do aplicativo). Vale 5 minutos e 5 tentativas.
CREATE TABLE IF NOT EXISTS login_challenges (
  id TEXT PRIMARY KEY,                                              -- hash do código entregue ao navegador
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remember INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
