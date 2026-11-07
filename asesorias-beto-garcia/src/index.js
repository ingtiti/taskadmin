// Calendario de Asesorías Beto García — Worker principal (API).
//   /api/publico/*  → calendario público (sin inicio de sesión)
//   /api/admin/*    → panel del administrador (protegido por Cloudflare Access + lista ADMIN_EMAILS)
import { verificarAcceso } from './auth.js';
import { HttpError } from './errores.js';
import { leerConfig, validarConfig, guardarConfig, esEmail } from './config.js';
import { procesarReserva, cancelarReserva } from './reservas.js';
import { enviarCorreos, probarCorreo, explicar } from './correo.js';
import { probarGraph } from './graph.js';
import { urlAutorizacion, urlRetorno, completarConexion, probarGoogle } from './google.js';
import { correoPrueba, NOMBRE_APP } from './plantillas.js';
import { localAUtc, inicioDeManana } from './tiempo.js';

const HORA = 3600_000;
const zona = (env) => env.ZONA_HORARIA || 'America/Mexico_City';
const num = (v, def) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : def);

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
});

async function cuerpo(req) {
  if (!(req.headers.get('content-type') || '').includes('application/json')) throw new HttpError(415, 'Se esperaba JSON.');
  const t = await req.text();
  if (t.length > 100_000) throw new HttpError(413, 'Solicitud demasiado grande.');
  try { return JSON.parse(t || '{}'); } catch { throw new HttpError(400, 'JSON inválido.'); }
}

/** Rango de fechas ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (máx. 100 días) → límites en UTC. */
function rango(url, env) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const d = url.searchParams.get('desde'), h = url.searchParams.get('hasta');
  if (!re.test(d || '') || !re.test(h || '')) throw new HttpError(400, 'Indica desde y hasta (AAAA-MM-DD).');
  const ini = localAUtc(`${d}T00:00`, zona(env)), fin = localAUtc(`${h}T23:59`, zona(env));
  if (!ini || !fin || fin < ini || fin - ini > 100 * 24 * HORA) throw new HttpError(400, 'Rango de fechas inválido.');
  return [ini.toISOString(), new Date(fin.getTime() + 60_000).toISOString()];
}

async function turnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return;
  if (!token) throw new HttpError(400, 'Confirma que no eres un robot.');
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip || '' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new HttpError(400, 'No se pudo verificar que no eres un robot. Intenta de nuevo.');
}

// ───────────────────────────── API pública ─────────────────────────────

async function apiPublica(req, env, ctx, url, ruta) {
  if (ruta === 'config' && req.method === 'GET') {
    return json({ nombre: NOMBRE_APP, zona: zona(env), turnstile: env.TURNSTILE_SITEKEY || '' });
  }

  if (ruta === 'espacios' && req.method === 'GET') {
    const [ini, fin] = rango(url, env);
    const { results } = await env.DB.prepare('SELECT id, inicio, fin, estado FROM espacios WHERE inicio >= ? AND inicio < ? ORDER BY inicio')
      .bind(ini, fin).all();
    // Hoy y el pasado no se pueden reservar: solo de mañana en adelante.
    const limite = inicioDeManana(zona(env)).getTime();
    // Solo se publica id, horario y estado: nunca datos de quien reservó.
    return json({ espacios: results.map((e) => ({ ...e, estado: e.estado === 'disponible' && Date.parse(e.inicio) < limite ? 'cerrado' : e.estado })) });
  }

  if (ruta === 'reservas' && req.method === 'POST') {
    const b = await cuerpo(req);
    const ip = req.headers.get('cf-connecting-ip') || '';
    const espacioId = Number(b.espacioId);
    const nombre = String(b.nombre || '').trim().replace(/\s+/g, ' ');
    const email = String(b.email || '').trim().toLowerCase();
    if (!Number.isInteger(espacioId) || espacioId < 1) throw new HttpError(400, 'Selecciona un horario.');
    if (nombre.length < 5 || nombre.length > 120 || !/\s/.test(nombre) || /[<>]/.test(nombre)) throw new HttpError(400, 'Escribe tu nombre completo (nombre y apellido).');
    if (!esEmail(email)) throw new HttpError(400, 'Escribe un correo electrónico válido.');
    await turnstile(env, b.turnstile, ip);

    const maximo = num(env.MAX_RESERVAS_POR_EMAIL, 2);
    if (maximo > 0) {
      const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM reservas WHERE email = ? AND estado = 'confirmada' AND inicio > ?")
        .bind(email, new Date().toISOString()).first();
      if (n >= maximo) throw new HttpError(429, `Ya tienes ${n} asesoría(s) próximas reservadas con este correo. Si necesitas otra, escríbenos.`);
    }

    // Bloqueo atómico: solo un asesorado puede pasar el espacio de "disponible" a "ocupado".
    const limite = inicioDeManana(zona(env)).toISOString();
    const upd = await env.DB.prepare("UPDATE espacios SET estado = 'ocupado' WHERE id = ? AND estado = 'disponible' AND inicio >= ?")
      .bind(espacioId, limite).run();
    if (upd.meta.changes !== 1) throw new HttpError(409, 'Este horario ya fue ocupado o ya no se puede reservar (solo se aceptan citas de mañana en adelante). Elige otro, por favor.');

    let reserva;
    try {
      reserva = await env.DB.prepare(`INSERT INTO reservas (espacio_id, inicio, fin, nombre, email, ip)
        SELECT id, inicio, fin, ?, ?, ? FROM espacios WHERE id = ? RETURNING id, inicio, fin`).bind(nombre, email, ip, espacioId).first();
    } catch (e) {
      await env.DB.prepare("UPDATE espacios SET estado = 'disponible' WHERE id = ?").bind(espacioId).run();
      console.error('Insertar reserva', e.message);
      throw new HttpError(409, 'No se pudo registrar la reserva. Intenta con otro horario.');
    }
    // Correos y calendarios se procesan en segundo plano para responder rápido.
    ctx.waitUntil(procesarReserva(env, reserva.id).catch((e) => console.error('procesarReserva', e)));
    return json({ ok: true, reserva: { inicio: reserva.inicio, fin: reserva.fin, nombre, email } }, 201);
  }
  throw new HttpError(404, 'Ruta no encontrada.');
}

// ───────────────────────────── API del administrador ─────────────────────────────

async function admin(req, env) {
  const email = await verificarAcceso(req, env);
  const permitidos = String(env.ADMIN_EMAILS || '').toLowerCase().split(/[,\s]+/).filter(Boolean);
  if (!permitidos.includes(email)) throw new HttpError(403, `La cuenta ${email} no es administradora de este calendario.`);
  return email;
}

const log = (env, quien, accion, detalle) => env.DB.prepare('INSERT INTO historial (quien, accion, detalle) VALUES (?,?,?)').bind(quien, accion, detalle ?? null);

async function apiAdmin(req, env, ctx, url, ruta) {
  const quien = await admin(req, env);
  const m = req.method;
  let p;

  if (ruta === 'yo' && m === 'GET') return json({ email: quien, zona: zona(env), appUrl: env.APP_URL || url.origin });

  // Espacios
  if (ruta === 'espacios' && m === 'GET') {
    const [ini, fin] = rango(url, env);
    const { results } = await env.DB.prepare(`SELECT e.id, e.inicio, e.fin, e.estado, r.id AS reserva_id, r.nombre, r.email
      FROM espacios e LEFT JOIN reservas r ON r.espacio_id = e.id AND r.estado = 'confirmada'
      WHERE e.inicio >= ? AND e.inicio < ? ORDER BY e.inicio`).bind(ini, fin).all();
    return json({ espacios: results });
  }
  if (ruta === 'espacios' && m === 'POST') {
    const b = await cuerpo(req);
    const lista = Array.isArray(b.inicios) ? [...new Set(b.inicios.map(String))] : [];
    if (!lista.length) throw new HttpError(400, 'Elige al menos una fecha y una hora.');
    if (lista.length > 500) throw new HttpError(400, 'Máximo 500 espacios por operación.');
    // Como nadie puede reservar para hoy, solo se publican espacios de mañana en adelante.
    const desde = inicioDeManana(zona(env)).getTime();
    const validos = [], invalidos = [];
    for (const l of lista) {
      const d = localAUtc(l, zona(env));
      if (!d || d.getTime() < desde || d.getUTCMinutes() % 15) invalidos.push(l);
      else validos.push(d);
    }
    let creados = 0;
    // Evita traslapes: un espacio nuevo no puede empezar dentro de la hora de otro existente.
    for (let i = 0; i < validos.length; i += 50) {
      const lote = validos.slice(i, i + 50).map((d) => env.DB.prepare(`INSERT INTO espacios (inicio, fin, creado_por)
        SELECT ?1, ?2, ?3 WHERE NOT EXISTS (SELECT 1 FROM espacios WHERE inicio < ?2 AND fin > ?1)`)
        .bind(d.toISOString(), new Date(d.getTime() + HORA).toISOString(), quien));
      const res = await env.DB.batch(lote);
      creados += res.reduce((s, r) => s + (r.meta.changes || 0), 0);
    }
    await log(env, quien, 'crear espacios', `${creados} creados`).run();
    return json({ creados, repetidos: validos.length - creados, invalidos: invalidos.length }, 201);
  }
  if ((p = /^espacios\/(\d+)$/.exec(ruta)) && m === 'DELETE') {
    const id = Number(p[1]);
    const activa = await env.DB.prepare("SELECT id FROM reservas WHERE espacio_id = ? AND estado = 'confirmada'").bind(id).first();
    if (activa) throw new HttpError(409, 'Este espacio tiene una reserva. Cancélala primero desde Reservas.');
    const e = await env.DB.prepare('SELECT inicio FROM espacios WHERE id = ?').bind(id).first();
    if (!e) throw new HttpError(404, 'El espacio no existe.');
    // Las reservas canceladas de este espacio se conservan (espacio_id queda en NULL).
    await env.DB.batch([env.DB.prepare('DELETE FROM espacios WHERE id = ?').bind(id), log(env, quien, 'eliminar espacio', e.inicio)]);
    return json({ ok: true });
  }

  // Reservas
  if (ruta === 'reservas' && m === 'GET') {
    const filtro = url.searchParams.get('filtro') || 'proximas';
    const ahora = new Date().toISOString();
    const where = {
      proximas: ["estado = 'confirmada' AND fin > ?", 'inicio ASC'],
      pasadas: ["estado = 'confirmada' AND fin <= ?", 'inicio DESC'],
      canceladas: ["estado = 'cancelada' AND ? IS NOT NULL", 'inicio DESC'],
    }[filtro];
    if (!where) throw new HttpError(400, 'Filtro inválido.');
    const { results } = await env.DB.prepare(`SELECT id, inicio, fin, nombre, email, estado, creada, cancelada, correo_asesorado, correo_admin,
      evento_exchange IS NOT NULL AS en_exchange, evento_google IS NOT NULL AS en_google, enlace_reunion, integraciones
      FROM reservas WHERE ${where[0]} ORDER BY ${where[1]} LIMIT 300`).bind(ahora).all();
    return json({ reservas: results.map((r) => ({ ...r, integraciones: r.integraciones ? JSON.parse(r.integraciones) : null })) });
  }
  if ((p = /^reservas\/(\d+)\/cancelar$/.exec(ruta)) && m === 'POST') {
    const b = await cuerpo(req);
    const res = await cancelarReserva(env, Number(p[1]), { liberar: b.liberar !== false, avisar: b.avisar !== false }, quien);
    if (!res.ok) throw new HttpError(409, res.error);
    return json(res);
  }
  if ((p = /^reservas\/(\d+)\/reintentar$/.exec(ruta)) && m === 'POST') {
    const errores = await procesarReserva(env, Number(p[1]));
    if (errores === null) throw new HttpError(404, 'La reserva no existe o está cancelada.');
    return json({ ok: !Object.keys(errores).length, errores });
  }

  // Configuración de correo y calendarios
  if (ruta === 'configuracion' && m === 'GET') {
    return json({ config: await leerConfig(env), retornoGoogle: urlRetorno(env, url), tieneClave: !!env.CLAVE_CIFRADO });
  }
  if (ruta === 'configuracion' && m === 'PUT') {
    await guardarConfig(env, validarConfig(await cuerpo(req)), quien);
    return json({ config: await leerConfig(env) });
  }
  if (ruta === 'configuracion/probar' && m === 'POST') {
    const b = await cuerpo(req);
    const c = await leerConfig(env, { secretos: true });
    const paso = async (fn) => { try { return { ok: true, detalle: await fn() }; } catch (e) { return { ok: false, detalle: explicar(e) }; } };
    const res = { correo: await paso(() => probarCorreo(c)) };
    if (c.exchangeCalendario && (c.modoCorreo === 'smtp' || !res.correo.ok)) res.exchange = await paso(() => probarGraph(c));
    if (c.googleActivo) res.google = await paso(() => probarGoogle(c));
    if (b.enviar && res.correo.ok) {
      const [r] = await enviarCorreos(c, [{ to: { email: c.emailAdmin, name: c.nombreRemitente }, ...correoPrueba(c, env.APP_URL) }]);
      res.envio = r.ok ? { ok: true, detalle: `Correo de prueba enviado a ${c.emailAdmin}.` } : { ok: false, detalle: r.error };
    }
    const resumen = Object.entries(res).map(([k, v]) => `${k}: ${v.ok ? 'correcto' : v.detalle}`).join(' · ');
    await env.DB.prepare("UPDATE configuracion SET ultima_prueba = datetime('now'), ultima_prueba_detalle = ? WHERE id = 1").bind(resumen.slice(0, 800)).run();
    return json(res);
  }

  // Conexión con Google Calendar (OAuth)
  if (ruta === 'google/conectar' && m === 'GET') {
    const c = await leerConfig(env, { secretos: true });
    if (!c.googleClientId || !c.googleSecreto) throw new HttpError(400, 'Guarda primero el Client ID y el Client secret de Google.');
    const estado = crypto.randomUUID();
    return new Response(null, {
      status: 302,
      headers: {
        Location: urlAutorizacion(c, urlRetorno(env, url), estado),
        'Set-Cookie': `g_estado=${estado}; Path=/api/admin/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      },
    });
  }
  if (ruta === 'google/callback' && m === 'GET') {
    const volver = (q) => new Response(null, { status: 302, headers: { Location: `/admin/?${q}#configuracion`, 'Set-Cookie': 'g_estado=; Path=/api/admin/google; Max-Age=0' } });
    const cookie = /(?:^|;\s*)g_estado=([\w-]+)/.exec(req.headers.get('cookie') || '');
    if (url.searchParams.get('error')) return volver('google=cancelado');
    if (!cookie || cookie[1] !== url.searchParams.get('state')) return volver('google=estado');
    try {
      const c = await leerConfig(env, { secretos: true });
      const cuenta = await completarConexion(env, c, url.searchParams.get('code') || '', urlRetorno(env, url), quien);
      return volver(`google=ok&cuenta=${encodeURIComponent(cuenta)}`);
    } catch (e) {
      console.error('Google OAuth', e.message);
      return volver(`google=error&detalle=${encodeURIComponent(String(e.message).slice(0, 200))}`);
    }
  }
  if (ruta === 'google/desconectar' && m === 'POST') {
    await env.DB.batch([
      env.DB.prepare("UPDATE configuracion SET google_refresh_cifrado = NULL, google_cuenta = '', google_activo = 0 WHERE id = 1"),
      log(env, quien, 'desconectar Google Calendar'),
    ]);
    return json({ ok: true });
  }

  if (ruta === 'historial' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT fecha, quien, accion, detalle FROM historial ORDER BY id DESC LIMIT 200').all();
    return json({ historial: results });
  }
  throw new HttpError(404, 'Ruta no encontrada.');
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/publico/')) return await apiPublica(req, env, ctx, url, url.pathname.slice(13));
      if (url.pathname.startsWith('/api/admin/')) return await apiAdmin(req, env, ctx, url, url.pathname.slice(11));
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'Ruta no encontrada.');
      return env.ASSETS.fetch(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Ocurrió un error inesperado. Intenta de nuevo.' }, 500);
    }
  },

  // Red de seguridad (cada 10 min): procesa reservas cuyo envío de correos/eventos nunca terminó.
  async scheduled(evento, env) {
    const { results } = await env.DB.prepare(`SELECT id FROM reservas WHERE estado = 'confirmada' AND correo_asesorado IS NULL
      AND creada < datetime('now', '-2 minutes') AND fin > ? ORDER BY id LIMIT 10`).bind(new Date().toISOString()).all();
    for (const r of results) await procesarReserva(env, r.id).catch((e) => console.error('cron procesarReserva', r.id, e));
  },
};
