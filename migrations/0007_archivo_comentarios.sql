-- Comentarios sobre cada archivo (se ven junto a la vista previa). Autor y fecha los pone el servidor.
CREATE TABLE archivo_comentarios (
  id           TEXT PRIMARY KEY,
  archivo_id   TEXT NOT NULL REFERENCES empresa_archivos(id) ON DELETE CASCADE,
  texto        TEXT NOT NULL CHECK (length(texto) <= 2000),
  autor_email  TEXT NOT NULL DEFAULT '',
  autor_nombre TEXT NOT NULL DEFAULT '',
  creado       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX archivo_comentarios_archivo ON archivo_comentarios (archivo_id, creado);
