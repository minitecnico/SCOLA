-- Subpastas: parent_id aponta para a pasta de cima (NULL = primeiro nível).
ALTER TABLE plan_folders ADD COLUMN parent_id TEXT REFERENCES plan_folders(id) ON DELETE SET NULL;
CREATE INDEX idx_plan_folders_parent ON plan_folders(parent_id);
