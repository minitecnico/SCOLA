-- Lançamento automático no diário: a prova guarda para qual coluna de Notas
-- (ano, trimestre e atividade) vão as notas. A cada folha corrigida, a nota do
-- aluno é gravada lá na hora; se o gabarito mudar, todas são recalculadas.
ALTER TABLE exams ADD COLUMN grade_year INTEGER;
ALTER TABLE exams ADD COLUMN grade_term INTEGER;
ALTER TABLE exams ADD COLUMN grade_key TEXT;
