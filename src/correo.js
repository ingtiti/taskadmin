// Cuenta de correo de envío: se configura desde la app como en cualquier cliente de correo
// (SMTP para enviar, IMAP para probar el acceso y guardar copia en Enviados).
// La contraseña se guarda cifrada (AES-GCM) con el secreto CLAVE_CORREO y nunca se devuelve al navegador.
import { WorkerMailer, LogLevel } from 'worker-mailer';
import { Imap, carpetaEnviados } from './imap.js';
import { construirMensaje } from './mime.js';
import { HttpError } from './errores.js';

export const SEGURIDAD = ['ssl', 'starttls', 'ninguna'];

const toB64 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function clave(env) {
  if (!env.CLAVE_CORREO) throw new HttpError(500, 'Falta el secreto CLAVE_CORREO en Cloudflare. Revisa el paso 3 del README.');
  let raw;
  try { raw = fromB64(env.CLAVE_CORREO.trim()); } catch { raw = null; }
  if (!raw || raw.length !== 32) throw new HttpError(500, 'CLAVE_CORREO debe ser una clave de 32 bytes en base64 (openssl rand -base64 32).');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function cifrar(env, txt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await clave(env), new TextEncoder().encode(txt)));
  return toB64(iv) + '.' + toB64(ct);
}
async function descifrar(env, s) {
  const [iv, ct] = s.split('.');
  const k = await clave(env);
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, k, fromB64(ct)));
  } catch {
    throw new HttpError(500, 'No se pudo leer la contraseña guardada (¿cambió CLAVE_CORREO?). Vuelve a capturarla en Correo.');
  }
}

/** Configuración de la cuenta. Con `conPassword` incluye la contraseña descifrada (solo para uso interno). */
export async function leerCuenta(env, { conPassword = false } = {}) {
  const r = await env.DB.prepare('SELECT * FROM cuenta_correo WHERE id = 1').first();
  if (!r) return null;
  const c = {
    email: r.email, nombre: r.nombre, usuario: r.usuario, proveedor: r.proveedor,
    smtpHost: r.smtp_host, smtpPuerto: r.smtp_puerto, smtpSeguridad: r.smtp_seguridad,
    imapHost: r.imap_host, imapPuerto: r.imap_puerto, imapSeguridad: r.imap_seguridad,
    guardarCopia: !!r.guardar_copia, carpetaEnviados: r.carpeta_enviados,
    tienePassword: !!r.password_cifrado,
    prueba: r.ultima_prueba ? { fecha: r.ultima_prueba, ok: !!r.ultima_prueba_ok, detalle: r.ultima_prueba_detalle } : null,
    actualizada: r.actualizada, actualizadaPor: r.actualizada_por,
  };
  if (conPassword && r.password_cifrado) c.password = await descifrar(env, r.password_cifrado);
  return c;
}

export const cuentaCompleta = (c) => !!(c && c.email && c.usuario && c.smtpHost && c.smtpPuerto && c.tienePassword);

export async function guardarCuenta(env, d, quien) {
  const sets = ['email=?', 'nombre=?', 'usuario=?', 'proveedor=?', 'smtp_host=?', 'smtp_puerto=?', 'smtp_seguridad=?',
    'imap_host=?', 'imap_puerto=?', 'imap_seguridad=?', 'guardar_copia=?', 'carpeta_enviados=?', "actualizada=datetime('now')", 'actualizada_por=?'];
  const vals = [d.email, d.nombre, d.usuario, d.proveedor, d.smtpHost, d.smtpPuerto, d.smtpSeguridad,
    d.imapHost, d.imapPuerto, d.imapSeguridad, d.guardarCopia ? 1 : 0, d.carpetaEnviados, quien];
  if (d.password) { sets.push('password_cifrado=?'); vals.push(await cifrar(env, d.password)); }
  const { password, ...sinPassword } = d;
  await env.DB.batch([
    env.DB.prepare(`UPDATE cuenta_correo SET ${sets.join(', ')} WHERE id = 1`).bind(...vals),
    env.DB.prepare('INSERT INTO historial (quien, accion, entidad, entidad_id, detalle) VALUES (?,?,?,?,?)')
      .bind(quien, password ? 'editar (con contraseña nueva)' : 'editar', 'cuenta_correo', '1', JSON.stringify(sinPassword)),
  ]);
}

function opcionesSmtp(c) {
  return {
    host: c.smtpHost,
    port: Number(c.smtpPuerto),
    secure: c.smtpSeguridad === 'ssl',
    startTls: c.smtpSeguridad === 'starttls',
    credentials: { username: c.usuario, password: c.password },
    authType: ['plain', 'login'],
    name: c.email.split('@').pop(),
    logLevel: LogLevel.WARN,
    socketTimeoutMs: 20000,
    responseTimeoutMs: 20000,
  };
}

/** Convierte los errores técnicos del servidor en un mensaje entendible (conserva el detalle). */
export function explicar(e) {
  const m = String(e && e.message || e);
  if (/\b535\b|authentication|auth.*fail|invalid login|credentials/i.test(m)) return `El servidor rechazó el usuario o la contraseña. Si la cuenta tiene verificación en dos pasos, usa una contraseña de aplicación. (${m.slice(0, 160)})`;
  if (/timeout|connect|ECONN|closed/i.test(m)) return `No hubo respuesta o no se pudo conectar; revisa el servidor, el puerto, la seguridad y la contraseña. (${m.slice(0, 160)})`;
  return m.slice(0, 240);
}

/** Prueba SMTP (inicio de sesión) e IMAP (inicio de sesión y carpetas). No envía nada. */
export async function probarCuenta(env, quien) {
  const c = await leerCuenta(env, { conPassword: true });
  if (!c || !c.password) throw new HttpError(400, 'Captura y guarda primero la contraseña de la cuenta.');
  const res = { smtp: { ok: false, detalle: '' }, imap: { ok: false, detalle: '', carpetas: [], enviados: '' } };

  try {
    const mailer = await WorkerMailer.connect(opcionesSmtp(c));
    await mailer.close();
    res.smtp = { ok: true, detalle: `Inicio de sesión correcto en ${c.smtpHost}:${c.smtpPuerto}.` };
  } catch (e) { res.smtp.detalle = explicar(e); }

  if (c.imapHost) {
    let im;
    try {
      im = await Imap.abrir({ host: c.imapHost, puerto: Number(c.imapPuerto), seguridad: c.imapSeguridad });
      await im.login(c.usuario, c.password);
      const carpetas = await im.carpetas();
      const enviados = carpetaEnviados(carpetas);
      res.imap = { ok: true, detalle: `Inicio de sesión correcto en ${c.imapHost}:${c.imapPuerto}; ${carpetas.length} carpetas.`, carpetas, enviados };
      if (!c.carpetaEnviados && enviados) {
        await env.DB.prepare('UPDATE cuenta_correo SET carpeta_enviados = ? WHERE id = 1').bind(enviados).run();
      }
    } catch (e) { res.imap.detalle = explicar(e); }
    finally { if (im) await im.cerrar(); }
  } else {
    res.imap.detalle = 'Sin servidor IMAP configurado.';
  }

  const ok = res.smtp.ok && (res.imap.ok || !c.imapHost);
  const detalle = `SMTP: ${res.smtp.ok ? 'correcto' : res.smtp.detalle} · IMAP: ${res.imap.ok ? 'correcto' : res.imap.detalle}`;
  await env.DB.prepare("UPDATE cuenta_correo SET ultima_prueba = datetime('now'), ultima_prueba_ok = ?, ultima_prueba_detalle = ? WHERE id = 1")
    .bind(ok ? 1 : 0, detalle.slice(0, 600)).run();
  return res;
}

/**
 * Envía varios correos con una sola sesión SMTP y, si está activado, guarda copia en Enviados vía IMAP.
 * @param {{to:{email:string,name:string}, subject:string, html:string, text:string}[]} mensajes
 */
export async function enviarCorreos(env, mensajes) {
  const c = await leerCuenta(env, { conPassword: true });
  if (!cuentaCompleta(c)) return { enviados: 0, fallidos: [], error: 'La cuenta de correo no está configurada.' };
  if (!mensajes.length) return { enviados: 0, fallidos: [] };

  let mailer;
  try { mailer = await WorkerMailer.connect(opcionesSmtp(c)); }
  catch (e) { return { enviados: 0, fallidos: [], error: explicar(e) }; }

  const de = { name: c.nombre || c.email, email: c.email };
  const ok = [], fallidos = [];
  for (const m of mensajes) {
    try {
      await mailer.send({ from: de, to: m.to, subject: m.subject, html: m.html, text: m.text });
      ok.push(m);
    } catch (e) {
      console.error('SMTP', m.to.email, e.message);
      fallidos.push(`${m.to.name || m.to.email} (${explicar(e).slice(0, 80)})`);
    }
  }
  try { await mailer.close(); } catch {}

  let copia = null;
  if (c.guardarCopia && c.imapHost && ok.length) {
    let im;
    try {
      im = await Imap.abrir({ host: c.imapHost, puerto: Number(c.imapPuerto), seguridad: c.imapSeguridad });
      await im.login(c.usuario, c.password);
      const carpeta = c.carpetaEnviados || carpetaEnviados(await im.carpetas());
      if (!carpeta) throw new Error('no se encontró la carpeta de Enviados');
      for (const m of ok) await im.guardar(carpeta, construirMensaje({ from: de, to: m.to, subject: m.subject, text: m.text, html: m.html }));
      copia = { ok: true };
    } catch (e) {
      console.error('IMAP', e.message);
      copia = { ok: false, detalle: explicar(e) };
    } finally { if (im) await im.cerrar(); }
  }
  return { enviados: ok.length, fallidos, copia };
}
