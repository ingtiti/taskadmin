// Envío de correos: Exchange Online por Microsoft Graph (recomendado) o un servidor Exchange por SMTP.
import { WorkerMailer, LogLevel } from 'worker-mailer';
import { enviarGraph, probarGraph } from './graph.js';
import { remitente } from './config.js';
import { b64Texto } from './cifrado.js';

function opcionesSmtp(c) {
  return {
    host: c.smtpHost, port: Number(c.smtpPuerto),
    secure: c.smtpSeguridad === 'ssl', startTls: c.smtpSeguridad === 'starttls',
    credentials: { username: c.smtpUsuario, password: c.smtpPassword },
    authType: ['plain', 'login'],
    logLevel: LogLevel.WARN, socketTimeoutMs: 20000, responseTimeoutMs: 20000,
  };
}

export function explicar(e) {
  const m = String(e && e.message || e);
  if (/^(Microsoft|Exchange|Google|Faltan|El servidor SMTP)/.test(m)) return m.slice(0, 300);
  if (/\b535\b|authentication|auth.*fail|invalid login/i.test(m)) return `El servidor rechazó el usuario o la contraseña. (${m.slice(0, 160)})`;
  if (/timeout|ECONN|closed|connect/i.test(m)) return `No se pudo conectar; revisa servidor, puerto y seguridad. (${m.slice(0, 160)})`;
  return m.slice(0, 300);
}

/**
 * Envía varios mensajes. Devuelve un arreglo con { ok, error } por mensaje, en el mismo orden.
 * @param {{to:{email,name}, subject, html, text, adjuntos?:{nombre,tipo,contenido}[]}[]} mensajes
 */
export async function enviarCorreos(c, mensajes) {
  if (c.modoCorreo === 'graph') {
    return Promise.all(mensajes.map((m) => enviarGraph(c, m).then(() => ({ ok: true }), (e) => ({ ok: false, error: explicar(e) }))));
  }
  if (!c.smtpHost || !c.smtpUsuario || !c.smtpPassword) return mensajes.map(() => ({ ok: false, error: 'El servidor SMTP no está configurado.' }));
  let mailer;
  try { mailer = await WorkerMailer.connect(opcionesSmtp(c)); }
  catch (e) { return mensajes.map(() => ({ ok: false, error: explicar(e) })); }
  const res = [];
  for (const m of mensajes) {
    try {
      await mailer.send({
        from: remitente(c), to: m.to, subject: m.subject, html: m.html, text: m.text,
        attachments: (m.adjuntos || []).map((a) => ({ filename: a.nombre, mimeType: a.tipo, content: b64Texto(a.contenido) })),
      });
      res.push({ ok: true });
    } catch (e) { res.push({ ok: false, error: explicar(e) }); }
  }
  try { await mailer.close(); } catch {}
  return res;
}

/** Prueba la conexión del modo activo (no envía nada). */
export async function probarCorreo(c) {
  if (c.modoCorreo === 'graph') return probarGraph(c);
  const mailer = await WorkerMailer.connect(opcionesSmtp(c));
  await mailer.close();
  return `Inicio de sesión SMTP correcto en ${c.smtpHost}:${c.smtpPuerto}.`;
}
