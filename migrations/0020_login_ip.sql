-- Limite de tentativas de login também por endereço (evita testar a mesma senha em muitos e-mails).
ALTER TABLE login_failures ADD COLUMN ip TEXT;
CREATE INDEX IF NOT EXISTS idx_login_failures_ip ON login_failures (ip, at);
