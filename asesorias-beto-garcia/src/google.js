// Réplica de cada cita en Google Calendar (Gmail) con OAuth 2.0: el administrador conecta su cuenta una sola vez
// y el Worker guarda el refresh token cifrado.
import { cifrar } from './cifrado.js';

export const ALCANCES = 'openid email https://www.googleapis.com/auth/calendar.events';
let cache = { refresh: '', token: '', vence: 0 };

export const urlRetorno = (env, url) => `${(env.APP_URL || url.origin).replace(/\/$/, '')}/api/admin/google/callback`;

export function urlAutorizacion(c, retorno, estado) {
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: c.googleClientId, redirect_uri: retorno, response_type: 'code', scope: ALCANCES,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: estado,
  });
}

/** Cambia el código de autorización por tokens y guarda el refresh token cifrado. */
export async function completarConexion(env, c, codigo, retorno, quien) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: codigo, client_id: c.googleClientId, client_secret: c.googleSecreto, redirect_uri: retorno, grant_type: 'authorization_code' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google rechazó la conexión: ${j.error_description || j.error || r.status}`);
  if (!j.refresh_token) throw new Error('Google no entregó un refresh token. Quita el acceso de la app en myaccount.google.com/permissions y vuelve a conectar.');
  let cuenta = '';
  try { cuenta = JSON.parse(atob(j.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email || ''; } catch {}
  await env.DB.batch([
    env.DB.prepare('UPDATE configuracion SET google_refresh_cifrado = ?, google_cuenta = ?, google_activo = 1 WHERE id = 1').bind(await cifrar(env, j.refresh_token), cuenta),
    env.DB.prepare('INSERT INTO historial (quien, accion, detalle) VALUES (?,?,?)').bind(quien, 'conectar Google Calendar', cuenta),
  ]);
  cache = { refresh: '', token: '', vence: 0 };
  return cuenta;
}

async function token(c) {
  if (cache.refresh === c.googleRefresh && Date.now() < cache.vence) return cache.token;
  if (!c.googleClientId || !c.googleSecreto || !c.googleRefresh) throw new Error('Google Calendar no está conectado.');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.googleClientId, client_secret: c.googleSecreto, refresh_token: c.googleRefresh, grant_type: 'refresh_token' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === 'invalid_grant') throw new Error('Google revocó o venció el acceso. Vuelve a conectar Google Calendar en Configuración.');
    throw new Error(`Google respondió ${r.status}: ${j.error_description || j.error || ''}`);
  }
  cache = { refresh: c.googleRefresh, token: j.access_token, vence: Date.now() + (j.expires_in - 120) * 1000 };
  return cache.token;
}

async function api(c, metodo, ruta, cuerpo) {
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.googleCalendario || 'primary')}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${await token(c)}`, 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (r.status === 204 || r.status === 410) return null; // 410 = el evento ya no existe
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Calendar respondió ${r.status}: ${j.error?.message || ''}`);
  return j;
}

export async function probarGoogle(c) {
  const r = await api(c, 'GET', '/events?maxResults=1');
  return `Conectado a ${c.googleCuenta || 'Google'} (calendario "${r?.summary || c.googleCalendario}").`;
}

export async function crearEventoGoogle(c, { titulo, descripcion, inicio, fin, lugar }) {
  const ev = await api(c, 'POST', '/events', {
    summary: titulo, description: descripcion, location: lugar || undefined,
    start: { dateTime: new Date(inicio).toISOString() }, end: { dateTime: new Date(fin).toISOString() },
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
  });
  return ev.id;
}

export async function borrarEventoGoogle(c, id) {
  await api(c, 'DELETE', `/events/${encodeURIComponent(id)}`);
}
