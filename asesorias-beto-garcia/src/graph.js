// Exchange Online / Microsoft 365 mediante Microsoft Graph (flujo client credentials de una app registrada en Entra ID).
// Permisos de aplicación necesarios (con consentimiento de administrador): Mail.Send y Calendars.ReadWrite.
import { b64Texto } from './cifrado.js';

let cache = { clave: '', token: '', vence: 0 };

async function token(c) {
  const clave = `${c.graphTenant}|${c.graphClientId}`;
  if (cache.clave === clave && cache.token && Date.now() < cache.vence) return cache.token;
  if (!c.graphTenant || !c.graphClientId || !c.graphSecreto) throw new Error('Faltan Tenant ID, Client ID o Client secret de Microsoft.');
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.graphTenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.graphClientId, client_secret: c.graphSecreto, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Microsoft rechazó las credenciales: ${j.error_description?.split('\r\n')[0] || j.error || r.status}`);
  cache = { clave, token: j.access_token, vence: Date.now() + (j.expires_in - 120) * 1000 };
  return cache.token;
}

async function graph(c, metodo, ruta, cuerpo) {
  if (!c.graphBuzon) throw new Error('Falta el buzón de Exchange.');
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(c.graphBuzon)}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${await token(c)}`, 'Content-Type': 'application/json' },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  if (r.status === 202 || r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = j.error?.message || r.status;
    if (r.status === 403) throw new Error(`Exchange negó el permiso (${m}). Revisa que la app tenga Mail.Send y Calendars.ReadWrite con consentimiento de administrador.`);
    throw new Error(`Exchange respondió ${r.status}: ${m}`);
  }
  return j;
}

/** Prueba: obtiene token y lee el buzón (sin enviar nada). */
export async function probarGraph(c) {
  cache.vence = 0;
  await token(c);
  return `Credenciales correctas para ${c.graphBuzon}.`;
}

/** @param {{to:{email,name}, subject, html, adjuntos?:{nombre,tipo,contenido}[]}} m */
export async function enviarGraph(c, m) {
  await graph(c, 'POST', '/sendMail', {
    message: {
      subject: m.subject,
      body: { contentType: 'HTML', content: m.html },
      toRecipients: [{ emailAddress: { address: m.to.email, name: m.to.name || m.to.email } }],
      attachments: (m.adjuntos || []).map((a) => ({
        '@odata.type': '#microsoft.graph.fileAttachment', name: a.nombre, contentType: a.tipo, contentBytes: b64Texto(a.contenido),
      })),
    },
    saveToSentItems: true,
  });
}

/** Crea el evento en el calendario de Exchange. Devuelve { id, enlace } (enlace de Teams si se pidió). */
export async function crearEventoGraph(c, { titulo, html, inicio, fin, lugar, teams }) {
  const utc = (iso) => ({ dateTime: new Date(iso).toISOString().replace('Z', ''), timeZone: 'UTC' });
  const ev = await graph(c, 'POST', '/events', {
    subject: titulo,
    body: { contentType: 'HTML', content: html },
    start: utc(inicio), end: utc(fin),
    location: lugar ? { displayName: lugar } : undefined,
    showAs: 'busy', isReminderOn: true, reminderMinutesBeforeStart: 30,
    categories: ['Asesorías'],
    ...(teams ? { isOnlineMeeting: true, onlineMeetingProvider: 'teamsForBusiness' } : {}),
  });
  return { id: ev.id, enlace: ev.onlineMeeting?.joinUrl || '' };
}

export async function borrarEventoGraph(c, id) {
  await graph(c, 'DELETE', `/events/${encodeURIComponent(id)}`);
}
