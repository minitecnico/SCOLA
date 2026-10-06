-- Acesso simplificado: sem verificação em duas etapas própria (o Google já cobre quem entra por ele).
DROP TABLE IF EXISTS login_challenges;
ALTER TABLE users DROP COLUMN totp_secret;
ALTER TABLE users DROP COLUMN totp_enabled;
ALTER TABLE users DROP COLUMN totp_backup;
ALTER TABLE users DROP COLUMN totp_last;
