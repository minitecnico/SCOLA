-- Provas com gabarito e correção automática pela câmera.
-- A folha de respostas impressa traz um QR code "S1:<code>:<aluno>" que identifica
-- a prova (code) e o aluno (8 primeiros caracteres do id, ou 0 = folha avulsa).
CREATE TABLE exams (
  id          TEXT PRIMARY KEY,
  base_id     TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  class_id    TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  code        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  exam_date   TEXT,
  questions   INTEGER NOT NULL,
  choices     INTEGER NOT NULL DEFAULT 5,
  answer_key  TEXT NOT NULL DEFAULT '[]',   -- ["A","C","X",...]  X = questão anulada (vale para todos)
  points      REAL NOT NULL DEFAULT 10,     -- valor total da prova
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT
);
CREATE INDEX idx_exams_base ON exams(base_id, class_id);

-- Respostas marcadas por aluno. A nota é calculada na hora a partir do gabarito,
-- então corrigir o gabarito (ou anular uma questão) recalcula tudo sozinho.
CREATE TABLE exam_answers (
  exam_id     TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  student_id  TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  base_id     TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  answers     TEXT NOT NULL,                -- ["A","","*",...]  "" em branco · "*" mais de uma marcada
  source      TEXT NOT NULL DEFAULT 'camera',
  checked_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (exam_id, student_id)
);
