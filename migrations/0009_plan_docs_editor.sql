-- Editor de documentos e planilhas no Planejamento (sem Google).
--   kind: 'file' (arquivo enviado), 'doc' (documento editável), 'sheet' (planilha editável).
--   O conteúdo editável fica no KV em c:<id>; f:<id> guarda sempre o .docx/.xlsx
--   atualizado (para baixar, visualizar e "baixar todos").
--   lock_by/lock_until: "em edição por Fulano" (evita duas pessoas sobrescreverem).
ALTER TABLE plan_docs ADD COLUMN kind TEXT NOT NULL DEFAULT 'file';
ALTER TABLE plan_docs ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plan_docs ADD COLUMN updated_at TEXT;
ALTER TABLE plan_docs ADD COLUMN updated_by TEXT;
ALTER TABLE plan_docs ADD COLUMN lock_by TEXT;
ALTER TABLE plan_docs ADD COLUMN lock_until TEXT;
ALTER TABLE plan_docs ADD COLUMN size INTEGER;

-- Histórico: uma cópia do conteúdo a cada sessão de edição (conteúdo no KV em v:<id>).
CREATE TABLE plan_doc_versions (
  id         TEXT PRIMARY KEY,
  doc_id     TEXT NOT NULL REFERENCES plan_docs(id) ON DELETE CASCADE,
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  author_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_plan_doc_versions ON plan_doc_versions(doc_id, created_at);
