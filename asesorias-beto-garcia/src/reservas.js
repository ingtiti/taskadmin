// Lo que pasa después de reservar o cancelar: evento en Exchange, réplica en Google Calendar y correos.
// Cada paso guarda su resultado en la reserva para poder reintentar desde el panel solo lo que falló.
import { leerConfig, remitente } from './config.js';
import { crearEventoGraph, borrarEventoGraph } from './graph.js';
import { crearEventoGoogle, borrarEventoGoogle } from './google.js';
import { enviarCorreos } from './correo.js';
import { correoAsesorado, correoAdmin, correoCancelacion } from './plantillas.js';
import { crearIcs } from './ics.js';
import { textoRango } from './tiempo.js';

const zonaDe = (env) => env.ZONA_HORARIA || 'America/Mexico_City';
const appUrl = (env) => (env.APP_URL || '').replace(/\/$/, '');
const graphListo = (c) => !!(c.graphTenant && c.graphClientId && c.graphSecreto && c.graphBuzon);
const googleListo = (c) => !!(c.googleClientId && c.googleSecreto && c.googleRefresh);
const tipoReunion = (url) => (/meet\.google\.com/.test(url) ? 'Google Meet' : /teams\.microsoft/.test(url) ? 'Microsoft Teams' : 'Reunión');

function detalle(r, c, zona) {
  return [
    `Asesoría personalizada de emprendimiento con ${r.nombre}`,
    `Correo: ${r.email}`,
    `Horario: ${textoRango(r.inicio, r.fin, zona)}`,
    r.enlace_reunion ? `${tipoReunion(r.enlace_reunion)}: ${r.enlace_reunion}` : null,
    c.lugar ? `Lugar: ${c.lugar}` : null,
    'Reservada desde el Calendario de Asesorías Beto García.',
  ].filter(Boolean).join('\n');
}

export async function procesarReserva(env, id) {
  const r = await env.DB.prepare('SELECT * FROM reservas WHERE id = ?').bind(id).first();
  if (!r || r.estado !== 'confirmada') return null;
  const c = await leerConfig(env, { secretos: true });
  const zona = zonaDe(env);
  const errores = {};
  const titulo = `Asesoría: ${r.nombre}`;

  // 1) Google Calendar (Gmail): réplica de la cita y, si se eligió, la videollamada de Google Meet.
  //    Va primero para que el enlace de Meet quede en el evento de Exchange, en los correos y en el .ics.
  const quiereMeet = c.reunion === 'meet';
  if (!r.evento_google && (c.googleActivo || quiereMeet)) {
    if (googleListo(c)) {
      try {
        const ev = await crearEventoGoogle(c, {
          titulo, descripcion: detalle(r, c, zona), inicio: r.inicio, fin: r.fin, lugar: c.lugar,
          meet: quiereMeet, invitado: { email: r.email, nombre: r.nombre }, solicitud: `asesoria-${r.id}-${crypto.randomUUID()}`,
        });
        r.evento_google = ev.id;
        if (ev.enlace) r.enlace_reunion = ev.enlace;
        else if (quiereMeet) errores.meet = 'Google no devolvió el enlace de Meet. Revisa que tu cuenta de Google tenga Meet habilitado.';
      } catch (e) { errores.google = String(e.message).slice(0, 300); }
    } else {
      errores.google = quiereMeet
        ? 'Para generar el enlace de Google Meet conecta Google Calendar en Correo y calendarios.'
        : 'Google Calendar está activado pero no conectado.';
    }
  }

  // 2) Evento en el calendario de Exchange (o reunión de Teams, si se eligió Teams).
  if (!r.evento_exchange && c.exchangeCalendario) {
    if (graphListo(c)) {
      try {
        const ev = await crearEventoGraph(c, {
          titulo, html: detalle(r, c, zona).replace(/\n/g, '<br>'), inicio: r.inicio, fin: r.fin,
          lugar: r.enlace_reunion || c.lugar, teams: c.reunion === 'teams',
        });
        r.evento_exchange = ev.id;
        if (ev.enlace && !r.enlace_reunion) r.enlace_reunion = ev.enlace;
      } catch (e) { errores.exchange = String(e.message).slice(0, 300); }
    } else {
      errores.exchange = 'Faltan las credenciales de Microsoft Graph para crear el evento en Exchange.';
    }
  }

  // 3) Correos de confirmación (asesorado y administrador) con invitación .ics.
  const datos = { ...r, enlace: r.enlace_reunion };
  const ics = crearIcs({
    uid: `asesoria-${r.id}@${new URL(appUrl(env) || 'https://asesorias.local').hostname}`,
    inicio: r.inicio, fin: r.fin, titulo: `Asesoría de emprendimiento con ${c.nombreRemitente}`,
    descripcion: detalle(r, c, zona), lugar: r.enlace_reunion || c.lugar, url: r.enlace_reunion, organizador: { nombre: c.nombreRemitente, email: remitente(c).email },
  });
  const adjuntos = [{ nombre: 'asesoria.ics', tipo: 'text/calendar', contenido: ics }];
  const pendientes = [];
  // Si se pidió Google Meet y falló, la confirmación al asesorado espera al reintento automático (cada 10 min)
  // para que llegue con el enlace; pasados 30 minutos se envía de todos modos, sin enlace.
  const minutos = (Date.now() - Date.parse(String(r.creada).replace(' ', 'T') + 'Z')) / 60000;
  const esperarMeet = r.correo_asesorado !== 1 && c.reunion === 'meet' && !r.enlace_reunion && minutos < 30;
  if (esperarMeet) errores.correo_asesorado = 'En espera del enlace de Google Meet; se reintenta automáticamente cada 10 minutos.';
  if (r.correo_asesorado !== 1 && !esperarMeet) pendientes.push(['asesorado', { to: { email: r.email, name: r.nombre }, adjuntos, ...correoAsesorado(datos, c, zona, appUrl(env)) }]);
  if (r.correo_admin !== 1 && c.emailAdmin) {
    const avisos = Object.values(errores);
    pendientes.push(['admin', { to: { email: c.emailAdmin, name: c.nombreRemitente }, adjuntos, ...correoAdmin(datos, c, zona, appUrl(env), avisos) }]);
  }
  if (pendientes.length) {
    const res = await enviarCorreos(c, pendientes.map((p) => p[1]));
    pendientes.forEach(([quien], i) => {
      r[`correo_${quien}`] = res[i].ok ? 1 : 0;
      if (!res[i].ok) errores[`correo_${quien}`] = res[i].error;
    });
  }

  await env.DB.prepare(`UPDATE reservas SET evento_exchange = ?, evento_google = ?, enlace_reunion = ?, correo_asesorado = ?, correo_admin = ?, integraciones = ? WHERE id = ?`)
    .bind(r.evento_exchange, r.evento_google, r.enlace_reunion, r.correo_asesorado, r.correo_admin, Object.keys(errores).length ? JSON.stringify(errores) : null, id).run();
  if (Object.keys(errores).length) console.error('Reserva', id, errores);
  return errores;
}

/** Cancela la reserva, borra los eventos y (opcional) libera el espacio y avisa al asesorado. */
export async function cancelarReserva(env, id, { liberar = true, avisar = true } = {}, quien) {
  const r = await env.DB.prepare('SELECT * FROM reservas WHERE id = ?').bind(id).first();
  if (!r || r.estado !== 'confirmada') return { ok: false, error: 'La reserva no existe o ya estaba cancelada.' };
  await env.DB.batch([
    env.DB.prepare("UPDATE reservas SET estado = 'cancelada', cancelada = datetime('now') WHERE id = ?").bind(id),
    ...(liberar ? [env.DB.prepare("UPDATE espacios SET estado = 'disponible' WHERE id = ?").bind(r.espacio_id)] : []),
    env.DB.prepare('INSERT INTO historial (quien, accion, detalle) VALUES (?,?,?)')
      .bind(quien, 'cancelar reserva', `#${id} ${r.nombre} <${r.email}> ${r.inicio}${liberar ? ' (espacio liberado)' : ' (espacio sigue ocupado)'}`),
  ]);

  const c = await leerConfig(env, { secretos: true });
  const zona = zonaDe(env);
  const avisos = [];
  if (r.evento_exchange && graphListo(c)) { try { await borrarEventoGraph(c, r.evento_exchange); } catch (e) { avisos.push(`Exchange: ${e.message}`); } }
  if (r.evento_google && c.googleRefresh) { try { await borrarEventoGoogle(c, r.evento_google); } catch (e) { avisos.push(`Google: ${e.message}`); } }
  if (avisar) {
    const ics = crearIcs({
      uid: `asesoria-${r.id}@${new URL(appUrl(env) || 'https://asesorias.local').hostname}`, inicio: r.inicio, fin: r.fin,
      titulo: `Asesoría de emprendimiento con ${c.nombreRemitente}`, descripcion: 'Cita cancelada', metodo: 'CANCEL', cancelado: true,
      organizador: { nombre: c.nombreRemitente, email: remitente(c).email },
    });
    const [res] = await enviarCorreos(c, [{ to: { email: r.email, name: r.nombre }, adjuntos: [{ nombre: 'cancelacion.ics', tipo: 'text/calendar', contenido: ics }], ...correoCancelacion(r, c, zona, appUrl(env)) }]);
    if (!res.ok) avisos.push(`Correo: ${res.error}`);
  }
  return { ok: true, avisos };
}
