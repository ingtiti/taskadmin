-- Enlace de la sesión: 'meet' (Google Meet, por omisión), 'teams' (Microsoft Teams) o 'ninguno'.
ALTER TABLE configuracion ADD COLUMN reunion TEXT NOT NULL DEFAULT 'meet' CHECK (reunion IN ('meet', 'teams', 'ninguno'));
UPDATE configuracion SET reunion = 'teams' WHERE exchange_teams = 1;
