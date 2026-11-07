// Correos HTML (con versión de texto) para el asesorado y para el administrador.
import { textoFecha, textoHora } from './tiempo.js';

export const NOMBRE_APP = 'Calendario de Asesorías Beto García';
const nombreReunion = (url) => (/meet\.google\.com/.test(url) ? 'Google Meet' : /teams\.microsoft/.test(url) ? 'Microsoft Teams' : 'Reunión');
const e = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function marco(titulo, cuerpo, appUrl) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f6fb;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1d2433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e3e7f0">
<tr><td style="background:#0f2a5c;color:#ffffff;padding:20px 28px;font-size:18px;font-weight:600">${e(NOMBRE_APP)}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:22px;color:#0f2a5c">${e(titulo)}</h1>
${cuerpo}
</td></tr>
<tr><td style="padding:16px 28px;background:#f8f9fc;color:#6b7385;font-size:12px;border-top:1px solid #e3e7f0">
Desarrollado por Titiapps y Claude${appUrl ? ` · <a href="${e(appUrl)}" style="color:#6b7385">${e(appUrl.replace(/^https?:\/\//, ''))}</a>` : ''}
</td></tr></table></td></tr></table></body></html>`;
}

function tarjeta(r, zona, c) {
  const fila = (k, v) => `<tr><td style="padding:6px 0;color:#6b7385;width:110px;vertical-align:top">${k}</td><td style="padding:6px 0;font-weight:600">${v}</td></tr>`;
  const fecha = textoFecha(r.inicio, zona);
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#eef3ff;border-radius:10px;padding:14px 18px;margin:8px 0 18px">
${fila('Fecha', e(fecha.charAt(0).toUpperCase() + fecha.slice(1)))}
${fila('Horario', `${textoHora(r.inicio, zona)} a ${textoHora(r.fin, zona)} h (${e(zona.replace('_', ' '))})`)}
${fila('Asesorado', e(r.nombre))}
${fila('Correo', e(r.email))}
${r.enlace ? fila(nombreReunion(r.enlace), `<a href="${e(r.enlace)}" style="display:inline-block;background:#1a56db;color:#ffffff;text-decoration:none;padding:8px 14px;border-radius:8px">Unirse a la videollamada</a><br><span style="font-weight:400;font-size:13px;color:#5b6478">${e(r.enlace)}</span>`) : ''}
${c.lugar ? fila('Lugar', /^https?:\/\//.test(c.lugar) ? `<a href="${e(c.lugar)}" style="color:#1a56db">${e(c.lugar)}</a>` : e(c.lugar)) : ''}
</table>`;
}

function textoPlano(lineas) { return lineas.filter((l) => l !== null).join('\n'); }

export function correoAsesorado(r, c, zona, appUrl) {
  const p = (s) => `<p style="margin:0 0 12px;line-height:1.5">${s}</p>`;
  const html = marco('¡Tu asesoría está confirmada!',
    p(`Hola ${e(r.nombre)}, gracias por reservar una sesión de asesoría personalizada de emprendimiento.`) +
    tarjeta(r, zona, c) +
    (c.mensajeExtra ? p(e(c.mensajeExtra).replace(/\n/g, '<br>')) : '') +
    p('Adjuntamos la invitación (.ics) para que la agregues a tu calendario. Si necesitas cambiar o cancelar la cita, responde a este correo.') +
    p(`Saludos,<br><strong>${e(c.nombreRemitente)}</strong>`), appUrl);
  const text = textoPlano([
    `Hola ${r.nombre}, tu asesoría está confirmada.`, '',
    `Fecha: ${textoFecha(r.inicio, zona)}`, `Horario: ${textoHora(r.inicio, zona)} a ${textoHora(r.fin, zona)} h (${zona})`,
    r.enlace ? `${nombreReunion(r.enlace)}: ${r.enlace}` : null, c.lugar ? `Lugar: ${c.lugar}` : null, '',
    c.mensajeExtra || null, 'Si necesitas cambiar o cancelar la cita, responde a este correo.', '', c.nombreRemitente,
  ]);
  return { subject: `Asesoría confirmada: ${textoFecha(r.inicio, zona)}, ${textoHora(r.inicio, zona)} h`, html, text };
}

export function correoAdmin(r, c, zona, appUrl, avisos = []) {
  const html = marco('Nueva asesoría reservada',
    `<p style="margin:0 0 12px">${e(r.nombre)} reservó un espacio. El horario ya aparece como <strong>Ocupado</strong> en el calendario público.</p>` +
    tarjeta(r, zona, c) +
    (avisos.length ? `<p style="margin:0 0 12px;color:#b42318"><strong>Atención:</strong> ${avisos.map(e).join('<br>')}</p>` : '') +
    (appUrl ? `<p style="margin:0"><a href="${e(appUrl)}/admin/" style="color:#1a56db">Abrir el panel de administración</a></p>` : ''), appUrl);
  const text = textoPlano([
    `Nueva asesoría reservada por ${r.nombre} <${r.email}>.`,
    `Fecha: ${textoFecha(r.inicio, zona)}, ${textoHora(r.inicio, zona)} a ${textoHora(r.fin, zona)} h`,
    r.enlace ? `${nombreReunion(r.enlace)}: ${r.enlace}` : null, ...avisos,
  ]);
  return { subject: `Nueva asesoría: ${r.nombre} · ${textoFecha(r.inicio, zona)}, ${textoHora(r.inicio, zona)} h`, html, text };
}

export function correoCancelacion(r, c, zona, appUrl) {
  const html = marco('Tu asesoría fue cancelada',
    `<p style="margin:0 0 12px;line-height:1.5">Hola ${e(r.nombre)}, te informamos que la siguiente asesoría fue cancelada:</p>` +
    tarjeta({ ...r, enlace: '' }, zona, { ...c, lugar: '' }) +
    `<p style="margin:0 0 12px;line-height:1.5">Puedes elegir un nuevo horario en el calendario${appUrl ? `: <a href="${e(appUrl)}" style="color:#1a56db">${e(appUrl.replace(/^https?:\/\//, ''))}</a>` : ''}.</p>` +
    `<p style="margin:0">Saludos,<br><strong>${e(c.nombreRemitente)}</strong></p>`, appUrl);
  const text = `Hola ${r.nombre}, tu asesoría del ${textoFecha(r.inicio, zona)} a las ${textoHora(r.inicio, zona)} h fue cancelada.${appUrl ? ` Elige un nuevo horario en ${appUrl}` : ''}\n\n${c.nombreRemitente}`;
  return { subject: `Asesoría cancelada: ${textoFecha(r.inicio, zona)}, ${textoHora(r.inicio, zona)} h`, html, text };
}

export function correoPrueba(c, appUrl) {
  return {
    subject: 'Prueba de correo · Calendario de Asesorías',
    html: marco('Correo de prueba', '<p style="margin:0">Si lees esto, la configuración de correo funciona correctamente.</p>', appUrl),
    text: 'Si lees esto, la configuración de correo funciona correctamente.',
  };
}
