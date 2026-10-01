-- Assistente: itens além dos arquivos (avisos, calendários, planejamentos, provas) indexados no Vectorize.
-- hash = impressão digital do conteúdo + visibilidade; mudou o hash, reindexa.
CREATE TABLE rag_items (
  id         TEXT PRIMARY KEY,           -- '<tipo>:<id>'
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  hash       TEXT NOT NULL,
  chunks     INTEGER NOT NULL DEFAULT 0,
  indexed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_rag_items_base ON rag_items(base_id);
-- Os vetores dos documentos ganharam metadados de visibilidade: reindexar todos.
UPDATE plan_docs SET rag_at = NULL, rag_chunks = NULL;
