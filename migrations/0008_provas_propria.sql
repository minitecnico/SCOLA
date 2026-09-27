-- Tipo de folha da prova:
--   'propria' = a prova da própria escola (modelo dela); o SCOLA gera só o QR
--               (da prova ou etiqueta por aluno) e o professor corrige tocando nas erradas.
--   'scola'   = folha de respostas do SCOLA, lida automaticamente pela câmera.
ALTER TABLE exams ADD COLUMN sheet TEXT NOT NULL DEFAULT 'scola';
