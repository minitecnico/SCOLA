-- Encerramento do ano letivo.
-- Turma arquivada: some do dia a dia (chamada, notas, provas) e fica só para consulta.
-- class_rosters guarda quem estava na turma ao arquivar: o aluno pode ir para a turma
-- do ano seguinte e os relatórios/boletins do ano antigo continuam completos.
ALTER TABLE classes ADD COLUMN archived_at TEXT;

CREATE TABLE class_rosters (
  class_id   TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  base_id    TEXT NOT NULL REFERENCES bases(id) ON DELETE CASCADE,
  PRIMARY KEY (class_id, student_id)
);
CREATE INDEX idx_class_rosters_student ON class_rosters(student_id);
