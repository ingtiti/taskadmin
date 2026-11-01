-- Archivos de cada empresa. El contenido vive en R2 (binding ARCHIVOS); aquí solo sus datos.
CREATE TABLE empresa_archivos (
  id          TEXT PRIMARY KEY,
  empresa_id  TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  clave       TEXT NOT NULL,                       -- llave del objeto en R2
  nombre      TEXT NOT NULL,                       -- nombre original del archivo
  tipo        TEXT NOT NULL DEFAULT 'application/octet-stream',
  tamano      INTEGER NOT NULL DEFAULT 0,          -- bytes
  descripcion TEXT NOT NULL DEFAULT '' CHECK (length(descripcion) <= 150),
  subido_por  TEXT NOT NULL DEFAULT '',
  creado      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX empresa_archivos_empresa ON empresa_archivos (empresa_id, creado);
