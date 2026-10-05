-- Protocolo de atendimento: SC-AAAA-NNNN (sequencial por ano).
ALTER TABLE support_threads ADD COLUMN protocol TEXT;
UPDATE support_threads SET protocol = 'SC-' || substr(created_at, 1, 4) || '-' || printf('%04d',
  (SELECT COUNT(*) FROM support_threads x
    WHERE substr(x.created_at, 1, 4) = substr(support_threads.created_at, 1, 4)
      AND (x.created_at < support_threads.created_at OR (x.created_at = support_threads.created_at AND x.id <= support_threads.id))));
CREATE UNIQUE INDEX IF NOT EXISTS idx_support_protocol ON support_threads (protocol);
