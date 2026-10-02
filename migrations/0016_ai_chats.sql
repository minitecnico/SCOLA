-- Conversas da página "IA" (cada pessoa vê só as suas).
CREATE TABLE IF NOT EXISTS ai_chats (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_id TEXT,
  title TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_chats_user ON ai_chats (user_id, updated_at DESC);
