-- Versión 2: los correos salen de una cuenta normal (SMTP + IMAP) configurada desde la app.
CREATE TABLE cuenta_correo (
  id                    INTEGER PRIMARY KEY CHECK (id = 1),
  email                 TEXT NOT NULL DEFAULT '',
  nombre                TEXT NOT NULL DEFAULT 'Control de Campañas TiTi',
  usuario               TEXT NOT NULL DEFAULT '',
  password_cifrado      TEXT NOT NULL DEFAULT '',   -- AES-GCM con el secreto CLAVE_CORREO
  proveedor             TEXT NOT NULL DEFAULT 'personalizado',
  smtp_host             TEXT NOT NULL DEFAULT '',
  smtp_puerto           INTEGER NOT NULL DEFAULT 465,
  smtp_seguridad        TEXT NOT NULL DEFAULT 'ssl' CHECK (smtp_seguridad IN ('ssl','starttls','ninguna')),
  imap_host             TEXT NOT NULL DEFAULT '',
  imap_puerto           INTEGER NOT NULL DEFAULT 993,
  imap_seguridad        TEXT NOT NULL DEFAULT 'ssl' CHECK (imap_seguridad IN ('ssl','starttls','ninguna')),
  guardar_copia         INTEGER NOT NULL DEFAULT 1,
  carpeta_enviados      TEXT NOT NULL DEFAULT '',
  ultima_prueba         TEXT NOT NULL DEFAULT '',
  ultima_prueba_ok      INTEGER NOT NULL DEFAULT 0,
  ultima_prueba_detalle TEXT NOT NULL DEFAULT '',
  actualizada           TEXT NOT NULL DEFAULT (datetime('now')),
  actualizada_por       TEXT NOT NULL DEFAULT ''
);

-- titi-apps.com está en FatCow (hoy Network Solutions): servidores oficiales para cuentas de FatCow.
INSERT INTO cuenta_correo (id, email, usuario, proveedor, smtp_host, smtp_puerto, smtp_seguridad, imap_host, imap_puerto, imap_seguridad, guardar_copia)
VALUES (1, 'tdsynnex@titi-apps.com', 'tdsynnex@titi-apps.com', 'fatcow', 'smtp.fatcow.com', 465, 'ssl', 'imap.fatcow.com', 993, 'ssl', 1);
