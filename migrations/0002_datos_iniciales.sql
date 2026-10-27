-- Líderes globales y primera empresa. Completa los correos de Jeanette y Estefanía desde la app.
INSERT INTO personal (id, nombre, email, perfil, lider, activo) VALUES
  ('beto-garcia', 'Beto García', 'beto.garcia@titi-apps.com', 'Admin', 1, 1),
  ('jeanette',    'Jeanette',    '',                          'Admin', 1, 1),
  ('estefania',   'Estefanía',   '',                          'Admin', 1, 1);

INSERT INTO empresas (id, nombre, contacto, inicio, notas) VALUES
  ('markkibox', 'MarkkiBox', 'Laura Polanco', '', 'Generación y calificación de contactos en LinkedIn, 6 meses.');
