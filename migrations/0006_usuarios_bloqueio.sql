-- Bloqueio de acesso pelo administrador: a conta continua existindo (com todo o histórico),
-- mas não entra mais e as sessões abertas deixam de valer na hora.
ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
