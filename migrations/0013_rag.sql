-- Assistente (RAG): quantos trechos de cada documento estão no índice vetorial e quando foi indexado.
-- Os vetores moram no Vectorize (índice scola-rag), com id "<doc_id>:<n>" e metadados base_id/doc_id/texto.
ALTER TABLE plan_docs ADD COLUMN rag_chunks INTEGER;
ALTER TABLE plan_docs ADD COLUMN rag_at TEXT;
