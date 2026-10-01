-- Integração com o Google (Docs, Sheets, Slides) via OAuth — cada usuário conecta a própria conta.
-- O refresh token fica CIFRADO (AES-GCM, chave no segredo GOOGLE_TOKEN_KEY); nunca em texto puro.
CREATE TABLE google_accounts (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  google_email  TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  scopes        TEXT NOT NULL,
  connected_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Documento do planejamento que mora no Google: id do arquivo no Drive e tipo (document | spreadsheet | presentation).
-- Conta dona do arquivo = author_id. NULL = documento do próprio SCOLA / arquivo enviado.
ALTER TABLE plan_docs ADD COLUMN google_id TEXT;
ALTER TABLE plan_docs ADD COLUMN google_kind TEXT;
