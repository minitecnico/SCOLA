-- Localidade da escola (UF + código IBGE do município): base dos feriados estaduais e municipais do calendário.
ALTER TABLE bases ADD COLUMN uf TEXT;
ALTER TABLE bases ADD COLUMN ibge_code TEXT;
