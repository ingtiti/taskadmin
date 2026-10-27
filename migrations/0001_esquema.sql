-- Esquema inicial: empresas, personal, actividades con varios responsables, envíos e historial.

CREATE TABLE empresas (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  contacto    TEXT NOT NULL DEFAULT '',
  inicio      TEXT NOT NULL DEFAULT '',          -- fecha de arranque (YYYY-MM-DD)
  notas       TEXT NOT NULL DEFAULT '',
  creada      TEXT NOT NULL DEFAULT (datetime('now')),
  actualizada TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE personal (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  email       TEXT NOT NULL DEFAULT '',
  perfil      TEXT NOT NULL CHECK (perfil IN ('Admin','Project manager','Community manager','Diseñador gráfico','Telemarketer','Analista de datos')),
  lider       INTEGER NOT NULL DEFAULT 0,
  activo      INTEGER NOT NULL DEFAULT 1,
  creada      TEXT NOT NULL DEFAULT (datetime('now')),
  actualizada TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX personal_email_unico ON personal (lower(email)) WHERE email <> '';

-- Empresas asignadas a cada persona (sin filas = participa en todas)
CREATE TABLE personal_empresas (
  persona_id TEXT NOT NULL REFERENCES personal(id) ON DELETE CASCADE,
  empresa_id TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  PRIMARY KEY (persona_id, empresa_id)
);

CREATE TABLE tareas (
  id              TEXT PRIMARY KEY,
  titulo          TEXT NOT NULL,
  empresa_id      TEXT NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  inicio          TEXT NOT NULL DEFAULT '',      -- opcional: desde cuándo aparece en la orden del día
  fecha           TEXT NOT NULL,                 -- fecha compromiso
  prioridad       TEXT NOT NULL DEFAULT 'Media' CHECK (prioridad IN ('Alta','Media','Baja')),
  estado          TEXT NOT NULL DEFAULT 'Pendiente' CHECK (estado IN ('Pendiente','En proceso','Completada')),
  descripcion     TEXT NOT NULL DEFAULT '',
  origen          TEXT NOT NULL DEFAULT 'manual', -- manual | plan
  completada_en   TEXT,
  creada          TEXT NOT NULL DEFAULT (datetime('now')),
  actualizada     TEXT NOT NULL DEFAULT (datetime('now')),
  actualizada_por TEXT NOT NULL DEFAULT ''
);
CREATE INDEX tareas_empresa ON tareas (empresa_id);
CREATE INDEX tareas_fecha ON tareas (fecha);

-- Varios responsables por actividad
CREATE TABLE tarea_responsables (
  tarea_id   TEXT NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL REFERENCES personal(id) ON DELETE CASCADE,
  PRIMARY KEY (tarea_id, persona_id)
);
CREATE INDEX tarea_responsables_persona ON tarea_responsables (persona_id);

-- Registro de cada envío de la orden del día
CREATE TABLE envios (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha     TEXT NOT NULL,
  hora      TEXT NOT NULL,
  origen    TEXT NOT NULL,                       -- cron | manual
  enviados  INTEGER NOT NULL DEFAULT 0,
  fallidos  INTEGER NOT NULL DEFAULT 0,
  nota      TEXT NOT NULL DEFAULT '',
  creado    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Quién cambió qué en los datos
CREATE TABLE historial (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cuando     TEXT NOT NULL DEFAULT (datetime('now')),
  quien      TEXT NOT NULL,
  accion     TEXT NOT NULL,
  entidad    TEXT NOT NULL,
  entidad_id TEXT NOT NULL,
  detalle    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX historial_entidad ON historial (entidad, entidad_id);
