-- Suporte nativo (escola <-> administrador): conversas e mensagens.
CREATE TABLE IF NOT EXISTS support_threads (
  id TEXT PRIMARY KEY,
  base_id TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberta',      -- aberta | resolvida
  last_from TEXT NOT NULL DEFAULT 'escola',   -- escola | suporte
  last_preview TEXT NOT NULL DEFAULT '',
  unread_admin INTEGER NOT NULL DEFAULT 0,
  unread_user INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_threads_user ON support_threads (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_threads_status ON support_threads (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_admin INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages (thread_id, created_at);
