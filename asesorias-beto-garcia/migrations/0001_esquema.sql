-- Calendario de Asesorías Beto García: esquema inicial.
-- Las fechas se guardan en UTC con formato ISO 8601 (2026-11-10T15:00:00.000Z).

-- Espacios de 1 hora que publica el administrador.
CREATE TABLE espacios (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  inicio    TEXT NOT NULL UNIQUE,
  fin       TEXT NOT NULL,
  estado    TEXT NOT NULL DEFAULT 'disponible' CHECK (estado IN ('disponible', 'ocupado')),
  creado    TEXT NOT NULL DEFAULT (datetime('now')),
  creado_por TEXT
);
CREATE INDEX ix_espacios_inicio ON espacios (inicio);

-- Solicitudes de cita de los asesorados.
CREATE TABLE reservas (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  espacio_id         INTEGER REFERENCES espacios (id) ON DELETE SET NULL,
  inicio             TEXT NOT NULL,
  fin                TEXT NOT NULL,
  nombre             TEXT NOT NULL,
  email              TEXT NOT NULL,
  estado             TEXT NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('confirmada', 'cancelada')),
  creada             TEXT NOT NULL DEFAULT (datetime('now')),
  cancelada          TEXT,
  ip                 TEXT,
  -- Resultado de cada integración: NULL = pendiente, 1 = correcto, 0 = falló.
  correo_asesorado   INTEGER,
  correo_admin       INTEGER,
  evento_exchange    TEXT,
  evento_google      TEXT,
  enlace_reunion     TEXT,
  integraciones      TEXT
);
-- Un espacio solo puede tener una reserva confirmada a la vez (bloqueo a nivel base de datos).
CREATE UNIQUE INDEX ux_reserva_activa ON reservas (espacio_id) WHERE estado = 'confirmada';
CREATE INDEX ix_reservas_email ON reservas (email);

-- Configuración de correo y calendarios (una sola fila). Los secretos van cifrados con AES-GCM (CLAVE_CIFRADO).
CREATE TABLE configuracion (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  modo_correo            TEXT NOT NULL DEFAULT 'graph' CHECK (modo_correo IN ('graph', 'smtp')),
  nombre_remitente       TEXT NOT NULL DEFAULT 'Beto García · Asesorías',
  email_admin            TEXT NOT NULL DEFAULT '',
  -- Exchange Online / Microsoft 365 (Microsoft Graph)
  graph_tenant           TEXT NOT NULL DEFAULT '',
  graph_client_id        TEXT NOT NULL DEFAULT '',
  graph_secret_cifrado   TEXT,
  graph_buzon            TEXT NOT NULL DEFAULT '',
  exchange_calendario    INTEGER NOT NULL DEFAULT 1,
  exchange_teams         INTEGER NOT NULL DEFAULT 0,
  -- Exchange por SMTP (Exchange Server local u otro servidor)
  smtp_host              TEXT NOT NULL DEFAULT '',
  smtp_puerto            INTEGER NOT NULL DEFAULT 587,
  smtp_seguridad         TEXT NOT NULL DEFAULT 'starttls' CHECK (smtp_seguridad IN ('ssl', 'starttls', 'ninguna')),
  smtp_usuario           TEXT NOT NULL DEFAULT '',
  smtp_password_cifrado  TEXT,
  smtp_email             TEXT NOT NULL DEFAULT '',
  -- Google Calendar (réplica en Gmail)
  google_activo          INTEGER NOT NULL DEFAULT 0,
  google_client_id       TEXT NOT NULL DEFAULT '',
  google_secret_cifrado  TEXT,
  google_refresh_cifrado TEXT,
  google_cuenta          TEXT NOT NULL DEFAULT '',
  google_calendario      TEXT NOT NULL DEFAULT 'primary',
  -- Datos de la sesión
  lugar                  TEXT NOT NULL DEFAULT '',
  mensaje_extra          TEXT NOT NULL DEFAULT '',
  ultima_prueba          TEXT,
  ultima_prueba_detalle  TEXT,
  actualizada            TEXT,
  actualizada_por        TEXT
);
INSERT INTO configuracion (id, email_admin, graph_buzon) VALUES (1, 'beto.garcia@titi-apps.com', 'beto.garcia@titi-apps.com');

-- Bitácora de cambios del administrador y de las reservas.
CREATE TABLE historial (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha   TEXT NOT NULL DEFAULT (datetime('now')),
  quien   TEXT NOT NULL,
  accion  TEXT NOT NULL,
  detalle TEXT
);
