// Configuración de correo y calendarios (tabla `configuracion`, fila única).
import { cifrar, descifrar } from './cifrado.js';
import { HttpError } from './errores.js';

export const SEGURIDAD = ['ssl', 'starttls', 'ninguna'];
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i;
export const esEmail = (s) => typeof s === 'string' && s.length <= 254 && EMAIL.test(s);

/** Lee la configuración. Con `secretos` incluye los valores descifrados (solo para uso interno del Worker). */
export async function leerConfig(env, { secretos = false } = {}) {
  const r = await env.DB.prepare('SELECT * FROM configuracion WHERE id = 1').first();
  if (!r) throw new HttpError(500, 'Falta la fila de configuración: aplica las migraciones de D1.');
  const c = {
    modoCorreo: r.modo_correo,
    nombreRemitente: r.nombre_remitente,
    emailAdmin: r.email_admin,
    graphTenant: r.graph_tenant, graphClientId: r.graph_client_id, graphBuzon: r.graph_buzon,
    graphTieneSecreto: !!r.graph_secret_cifrado,
    exchangeCalendario: !!r.exchange_calendario, exchangeTeams: !!r.exchange_teams,
    smtpHost: r.smtp_host, smtpPuerto: r.smtp_puerto, smtpSeguridad: r.smtp_seguridad, smtpUsuario: r.smtp_usuario, smtpEmail: r.smtp_email,
    smtpTienePassword: !!r.smtp_password_cifrado,
    googleActivo: !!r.google_activo, googleClientId: r.google_client_id, googleTieneSecreto: !!r.google_secret_cifrado,
    googleConectado: !!r.google_refresh_cifrado, googleCuenta: r.google_cuenta, googleCalendario: r.google_calendario || 'primary',
    lugar: r.lugar, mensajeExtra: r.mensaje_extra,
    ultimaPrueba: r.ultima_prueba, ultimaPruebaDetalle: r.ultima_prueba_detalle,
    actualizada: r.actualizada, actualizadaPor: r.actualizada_por,
  };
  if (secretos) {
    c.graphSecreto = await descifrar(env, r.graph_secret_cifrado);
    c.smtpPassword = await descifrar(env, r.smtp_password_cifrado);
    c.googleSecreto = await descifrar(env, r.google_secret_cifrado);
    c.googleRefresh = await descifrar(env, r.google_refresh_cifrado);
  }
  return c;
}

/** Correo desde el que se envía, según el modo. */
export const remitente = (c) => ({ name: c.nombreRemitente || 'Asesorías', email: c.modoCorreo === 'graph' ? c.graphBuzon : (c.smtpEmail || c.smtpUsuario) });

const txt = (v, max, campo, requerido = false) => {
  const s = String(v ?? '').trim();
  if (requerido && !s) throw new HttpError(400, `${campo} es obligatorio.`);
  if (s.length > max) throw new HttpError(400, `${campo}: máximo ${max} caracteres.`);
  return s;
};
const correo = (v, campo, requerido = false) => {
  const s = txt(v, 254, campo, requerido).toLowerCase();
  if (s && !esEmail(s)) throw new HttpError(400, `${campo}: escribe un correo válido.`);
  return s;
};
const host = (v, campo) => {
  const s = txt(v, 200, campo).toLowerCase();
  if (s && !/^[a-z0-9.-]+$/.test(s)) throw new HttpError(400, `${campo}: escribe solo el nombre del servidor (ej. mail.ejemplo.com).`);
  return s;
};

export function validarConfig(b) {
  const modo = b.modoCorreo === 'smtp' ? 'smtp' : 'graph';
  const puerto = Number(b.smtpPuerto || 587);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535 || puerto === 25) throw new HttpError(400, 'Puerto SMTP inválido (Cloudflare no permite el 25; usa 587 o 465).');
  const seguridad = SEGURIDAD.includes(b.smtpSeguridad) ? b.smtpSeguridad : 'starttls';
  const tenant = txt(b.graphTenant, 100, 'Tenant ID');
  if (tenant && !/^[a-z0-9.-]+$/i.test(tenant)) throw new HttpError(400, 'Tenant ID: usa el ID (GUID) o el dominio del directorio.');
  const cal = txt(b.googleCalendario, 200, 'Calendario de Google') || 'primary';
  return {
    modoCorreo: modo,
    nombreRemitente: txt(b.nombreRemitente, 80, 'Nombre del remitente', true),
    emailAdmin: correo(b.emailAdmin, 'Correo donde recibes los avisos', true),
    graphTenant: tenant,
    graphClientId: txt(b.graphClientId, 100, 'Client ID'),
    graphSecreto: txt(b.graphSecreto, 500, 'Client secret'),
    graphBuzon: correo(b.graphBuzon, 'Buzón de Exchange'),
    exchangeCalendario: !!b.exchangeCalendario,
    exchangeTeams: !!b.exchangeTeams,
    smtpHost: host(b.smtpHost, 'Servidor SMTP'),
    smtpPuerto: puerto,
    smtpSeguridad: seguridad,
    smtpUsuario: txt(b.smtpUsuario, 254, 'Usuario SMTP'),
    smtpPassword: txt(b.smtpPassword, 500, 'Contraseña SMTP'),
    smtpEmail: correo(b.smtpEmail, 'Correo remitente SMTP'),
    googleActivo: !!b.googleActivo,
    googleClientId: txt(b.googleClientId, 200, 'Google Client ID'),
    googleSecreto: txt(b.googleSecreto, 500, 'Google Client secret'),
    googleCalendario: cal,
    lugar: txt(b.lugar, 300, 'Lugar o enlace'),
    mensajeExtra: txt(b.mensajeExtra, 1000, 'Mensaje adicional'),
  };
}

export async function guardarConfig(env, d, quien) {
  const sets = ['modo_correo=?', 'nombre_remitente=?', 'email_admin=?', 'graph_tenant=?', 'graph_client_id=?', 'graph_buzon=?',
    'exchange_calendario=?', 'exchange_teams=?', 'smtp_host=?', 'smtp_puerto=?', 'smtp_seguridad=?', 'smtp_usuario=?', 'smtp_email=?',
    'google_activo=?', 'google_client_id=?', 'google_calendario=?', 'lugar=?', 'mensaje_extra=?', "actualizada=datetime('now')", 'actualizada_por=?'];
  const vals = [d.modoCorreo, d.nombreRemitente, d.emailAdmin, d.graphTenant, d.graphClientId, d.graphBuzon,
    d.exchangeCalendario ? 1 : 0, d.exchangeTeams ? 1 : 0, d.smtpHost, d.smtpPuerto, d.smtpSeguridad, d.smtpUsuario, d.smtpEmail,
    d.googleActivo ? 1 : 0, d.googleClientId, d.googleCalendario, d.lugar, d.mensajeExtra, quien];
  const nuevos = [];
  if (d.graphSecreto) { sets.push('graph_secret_cifrado=?'); vals.push(await cifrar(env, d.graphSecreto)); nuevos.push('client secret de Microsoft'); }
  if (d.smtpPassword) { sets.push('smtp_password_cifrado=?'); vals.push(await cifrar(env, d.smtpPassword)); nuevos.push('contraseña SMTP'); }
  if (d.googleSecreto) { sets.push('google_secret_cifrado=?'); vals.push(await cifrar(env, d.googleSecreto)); nuevos.push('client secret de Google'); }
  await env.DB.batch([
    env.DB.prepare(`UPDATE configuracion SET ${sets.join(', ')} WHERE id = 1`).bind(...vals),
    env.DB.prepare('INSERT INTO historial (quien, accion, detalle) VALUES (?,?,?)')
      .bind(quien, 'editar configuración', nuevos.length ? `Secretos actualizados: ${nuevos.join(', ')}` : null),
  ]);
}
