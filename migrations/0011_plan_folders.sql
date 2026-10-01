-- Pastas da central de planejamento (por segmento; opcionalmente ligadas a uma turma).
-- Apagar a pasta NÃO apaga os arquivos: eles voltam para a raiz.
CREATE TABLE plan_folders (
  id         TEXT PRIMARY KEY,
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  author_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  segment    TEXT NOT NULL,
  name       TEXT NOT NULL,
  class_id   TEXT REFERENCES classes(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_plan_folders_base ON plan_folders(base_id, segment);
ALTER TABLE plan_docs ADD COLUMN folder_id TEXT REFERENCES plan_folders(id) ON DELETE SET NULL;
CREATE INDEX idx_plan_docs_folder ON plan_docs(folder_id);
