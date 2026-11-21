-- Bitácora de notas por empresa: cada nota guarda quién la capturó y cuándo (lo pone el servidor).
CREATE TABLE empresa_notas (
  id           TEXT PRIMARY KEY,
  empresa_id   TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  texto        TEXT NOT NULL CHECK (length(texto) <= 2000),
  autor_email  TEXT NOT NULL DEFAULT '',
  autor_nombre TEXT NOT NULL DEFAULT '',
  creada       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX empresa_notas_empresa ON empresa_notas (empresa_id, creada);

-- Las notas que ya existían (campo único empresas.notas) pasan a la bitácora como primera nota.
INSERT INTO empresa_notas (id, empresa_id, texto, autor_email, autor_nombre, creada)
  SELECT lower(hex(randomblob(16))), id, substr(notas, 1, 2000), '', 'Notas anteriores', actualizada
  FROM empresas WHERE trim(notas) <> '';

-- Minutas de reunión por empresa. Sus archivos adjuntos viven en empresa_archivos con minuta_id.
CREATE TABLE minutas (
  id              TEXT PRIMARY KEY,
  empresa_id      TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  fecha           TEXT NOT NULL,                     -- fecha de la reunión (YYYY-MM-DD)
  titulo          TEXT NOT NULL,
  asistentes      TEXT NOT NULL DEFAULT '',
  contenido       TEXT NOT NULL DEFAULT '',          -- acuerdos, temas, pendientes
  creada_por      TEXT NOT NULL DEFAULT '',
  creada          TEXT NOT NULL DEFAULT (datetime('now')),
  actualizada     TEXT NOT NULL DEFAULT (datetime('now')),
  actualizada_por TEXT NOT NULL DEFAULT ''
);
CREATE INDEX minutas_empresa ON minutas (empresa_id, fecha);

ALTER TABLE empresa_archivos ADD COLUMN minuta_id TEXT;
CREATE INDEX empresa_archivos_minuta ON empresa_archivos (minuta_id);
