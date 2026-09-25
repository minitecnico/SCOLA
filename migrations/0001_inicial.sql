-- SCOLA — esquema do banco (Cloudflare D1 / SQLite)
-- Uma "base" = um cliente (escola ou professor). Todo dado escolar carrega base_id.
-- Datas: TEXT ISO (yyyy-mm-dd ou ISO completo). Booleanos: INTEGER 0/1. JSON: TEXT.


-- Bases (clientes). Os dados da escola (logo, diretor, endereço) ficam aqui.
CREATE TABLE bases (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  cnpj         TEXT,
  city         TEXT,
  address      TEXT,
  phone        TEXT,
  director     TEXT,
  inep         TEXT,
  logo_url     TEXT,                      -- data URL comprimida
  plan         TEXT NOT NULL DEFAULT 'ativo',  -- teste | ativo
  max_students INTEGER,                   -- limite do plano (NULL = sem limite)
  active       INTEGER NOT NULL DEFAULT 1,
  notes        TEXT,                      -- anotações internas do administrador
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Usuários (login por e-mail e senha). is_admin = você (administrador da plataforma).
CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash  TEXT NOT NULL,
  full_name      TEXT,
  phone          TEXT,
  avatar_url     TEXT,
  is_admin       INTEGER NOT NULL DEFAULT 0,
  must_change_pw INTEGER NOT NULL DEFAULT 0,
  active_base_id TEXT REFERENCES bases(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at  TEXT
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,               -- SHA-256 do token do cookie
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_failures (
  email TEXT NOT NULL COLLATE NOCASE,
  at    TEXT NOT NULL
);
CREATE INDEX idx_login_failures ON login_failures(email, at);

-- Vínculo usuário ↔ base com papel: gestor | professor | secretaria
CREATE TABLE memberships (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('gestor','professor','secretaria')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (user_id, base_id)
);
CREATE INDEX idx_memberships_base ON memberships(base_id);

-- Cadastros ---------------------------------------------------------------------
CREATE TABLE classes (
  id         TEXT PRIMARY KEY,
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  shift      TEXT DEFAULT 'Manhã',
  year       INTEGER,
  does_exams INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_classes_base ON classes(base_id);

CREATE TABLE students (
  id             TEXT PRIMARY KEY,
  base_id        TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  class_id       TEXT REFERENCES classes(id) ON DELETE SET NULL,
  full_name      TEXT NOT NULL,
  registration   TEXT,
  guardian_name  TEXT,
  guardian_phone TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_students_base ON students(base_id);
CREATE INDEX idx_students_class ON students(class_id);
CREATE UNIQUE INDEX uq_students_registration ON students(base_id, registration) WHERE registration IS NOT NULL AND registration <> '';

-- Chamadas ------------------------------------------------------------------------
CREATE TABLE attendance_sessions (
  id           TEXT PRIMARY KEY,
  base_id      TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  class_id     TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  session_date TEXT NOT NULL,
  note         TEXT,
  exam_mode    INTEGER NOT NULL DEFAULT 0,
  deleted_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT,
  UNIQUE (class_id, session_date)
);
CREATE INDEX idx_att_sessions_base ON attendance_sessions(base_id, session_date);

CREATE TABLE attendance_records (
  session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('present','absent','late','justified')),
  note       TEXT,
  PRIMARY KEY (session_id, student_id)
);
CREATE INDEX idx_att_records_student ON attendance_records(student_id);

-- Notas por trimestre (composição da base + lançamento por aluno) ----------------
CREATE TABLE grade_terms (
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  year       INTEGER NOT NULL,
  term       INTEGER NOT NULL,
  activities TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT,
  PRIMARY KEY (base_id, year, term)
);

CREATE TABLE term_grades (
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  year       INTEGER NOT NULL,
  term       INTEGER NOT NULL,
  scores     TEXT NOT NULL DEFAULT '{}',
  observacao TEXT,
  updated_at TEXT,
  PRIMARY KEY (student_id, year, term)
);
CREATE INDEX idx_term_grades_lookup ON term_grades(class_id, year, term);

-- Central de Avaliações (por turma) ------------------------------------------------
CREATE TABLE evaluation_terms (
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  year       INTEGER NOT NULL,
  term       INTEGER NOT NULL,
  activities TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT,
  PRIMARY KEY (class_id, year, term)
);

CREATE TABLE evaluation_grades (
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  year       INTEGER NOT NULL,
  term       INTEGER NOT NULL,
  marks      TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT,
  PRIMARY KEY (class_id, student_id, year, term)
);

-- Relatórios compartilhados por link público (/r/:id) -----------------------------
CREATE TABLE shared_reports (
  id         TEXT PRIMARY KEY,
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Avisos ----------------------------------------------------------------------------
CREATE TABLE notices (
  id          TEXT PRIMARY KEY,
  base_id     TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  audience    TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','role','user')),
  target_role TEXT,
  target_user TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_notices_base ON notices(base_id, created_at);

CREATE TABLE notice_reads (
  notice_id TEXT NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (notice_id, user_id)
);

-- Arquivos (anexos de avisos, planejamentos e documentos). O conteúdo fica no KV. --
CREATE TABLE files (
  id         TEXT PRIMARY KEY,
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('notice','plan')),
  owner_id   TEXT NOT NULL,
  name       TEXT NOT NULL,
  mime       TEXT,
  size       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_files_owner ON files(owner_type, owner_id);

-- Calendários (construtor visual; vários por base) --------------------------------
CREATE TABLE calendars (
  id              TEXT PRIMARY KEY,
  base_id         TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  title           TEXT NOT NULL DEFAULT 'Calendário',
  data            TEXT NOT NULL DEFAULT '{}',
  editors         TEXT NOT NULL DEFAULT '[]',
  version         INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT,
  created_by_name TEXT,
  updated_by      TEXT,
  updated_by_name TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT
);
CREATE INDEX idx_calendars_base ON calendars(base_id);

-- Planejamento ------------------------------------------------------------------------
CREATE TABLE lesson_plans (
  id          TEXT PRIMARY KEY,
  base_id     TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id    TEXT REFERENCES classes(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  week_start  TEXT,
  content     TEXT NOT NULL DEFAULT '',
  plan_data   TEXT,
  status      TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','enviado','aprovado','devolvido')),
  feedback    TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_lesson_plans_base ON lesson_plans(base_id, status);
CREATE INDEX idx_lesson_plans_author ON lesson_plans(author_id);

CREATE TABLE lesson_plan_messages (
  id         TEXT PRIMARY KEY,
  plan_id    TEXT NOT NULL REFERENCES lesson_plans(id) ON DELETE CASCADE,
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_plan_messages_plan ON lesson_plan_messages(plan_id, created_at);

CREATE TABLE plan_reads (
  plan_id      TEXT NOT NULL REFERENCES lesson_plans(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (plan_id, user_id)
);

-- Central de documentos de planejamento (o arquivo fica em files/KV com o mesmo id)
CREATE TABLE plan_docs (
  id          TEXT PRIMARY KEY,
  base_id     TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  author_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  segment     TEXT NOT NULL,
  term        INTEGER,
  class_id    TEXT REFERENCES classes(id) ON DELETE SET NULL,
  turma_label TEXT,
  name        TEXT NOT NULL,
  mime        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_plan_docs_base ON plan_docs(base_id, segment);

-- Arquivos a apagar do KV (processados aos poucos pela rotina agendada) -------------
CREATE TABLE kv_trash (
  id TEXT PRIMARY KEY
);
