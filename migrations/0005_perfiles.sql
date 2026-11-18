-- Perfiles editables desde la app (módulo Perfiles).
-- `clave` liga el perfil con su papel en el plan de trabajo de 6 meses (src/plan.js),
-- así un perfil puede cambiar de nombre sin perder sus actividades del plan.
CREATE TABLE perfiles (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  clave       TEXT,                                -- pm | cm | dg | tm | ad; NULL = sin actividades del plan
  creado      TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX perfiles_nombre_unico ON perfiles (lower(nombre));
CREATE UNIQUE INDEX perfiles_clave_unica ON perfiles (clave) WHERE clave IS NOT NULL;

INSERT INTO perfiles (id, nombre, clave) VALUES
  ('admin', 'Admin', NULL),
  ('pm', 'Project manager', 'pm'),
  ('cm', 'Community manager', 'cm'),
  ('dg', 'Diseñador gráfico', 'dg'),
  ('tm', 'Telemarketer', 'tm'),
  ('ad', 'Analista de datos', 'ad');

-- personal.perfil tenía la lista fija en un CHECK. SQLite no permite quitarlo, así que se reconstruye la tabla.
-- Al borrar la tabla vieja, D1 borra en cascada sus filas en personal_empresas y tarea_responsables:
-- se respaldan antes y se restauran al final.
CREATE TABLE _resp_personal_empresas AS SELECT persona_id, empresa_id FROM personal_empresas;
CREATE TABLE _resp_tarea_responsables AS SELECT tarea_id, persona_id FROM tarea_responsables;

CREATE TABLE personal_nueva (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  email       TEXT NOT NULL DEFAULT '',
  perfil      TEXT NOT NULL,                       -- nombre del perfil (tabla perfiles)
  lider       INTEGER NOT NULL DEFAULT 0,
  activo      INTEGER NOT NULL DEFAULT 1,
  creada      TEXT NOT NULL DEFAULT (datetime('now')),
  actualizada TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO personal_nueva (id, nombre, email, perfil, lider, activo, creada, actualizada)
  SELECT id, nombre, email, perfil, lider, activo, creada, actualizada FROM personal;
DROP TABLE personal;
ALTER TABLE personal_nueva RENAME TO personal;
CREATE UNIQUE INDEX personal_email_unico ON personal (lower(email)) WHERE email <> '';

INSERT OR IGNORE INTO personal_empresas (persona_id, empresa_id) SELECT persona_id, empresa_id FROM _resp_personal_empresas;
INSERT OR IGNORE INTO tarea_responsables (tarea_id, persona_id) SELECT tarea_id, persona_id FROM _resp_tarea_responsables;
DROP TABLE _resp_personal_empresas;
DROP TABLE _resp_tarea_responsables;
