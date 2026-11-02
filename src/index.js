// Control de Campañas LinkedIn — Worker principal.
// Sirve la app (public/), la API (/api/*) sobre D1 y el envío diario de la orden del día (cron).
import { HttpError } from './errores.js';
import { verificarAcceso } from './auth.js';
import * as datos from './datos.js';
import { planBase, asignar } from './plan.js';
import { correoOrden, enviarOrdenes } from './orden.js';
import { leerCuenta, guardarCuenta, probarCuenta, cuentaCompleta, SEGURIDAD } from './correo.js';
import { PERFILES, ESTADOS, PRIORIDADES, hoyCDMX, addDays, habil } from '../public/js/logica.js';

const json = (d, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

/* ---------- validación ---------- */
const txt = (v, max, campo, req = false) => {
  v = String(v ?? '').trim();
  if (req && !v) throw new HttpError(400, `Falta ${campo}.`);
  if (v.length > max) throw new HttpError(400, `${campo} es demasiado largo (máximo ${max} caracteres).`);
  return v;
};
const fecha = (v, campo, req = false) => {
  v = String(v ?? '').trim();
  if (!v && !req) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new HttpError(400, `${campo}: fecha no válida.`);
  return v;
};
const uno = (v, lista, campo) => { if (!lista.includes(v)) throw new HttpError(400, `${campo} no válido.`); return v; };
const ids = (v) => (Array.isArray(v) ? [...new Set(v.map(String))].filter((x) => /^[\w-]{1,64}$/.test(x)).slice(0, 50) : []);

function valEmpresa(b) {
  return { nombre: txt(b.nombre, 120, 'el nombre', true), contacto: txt(b.contacto, 120, 'Contacto'), inicio: fecha(b.inicio, 'Fecha de arranque'), notas: txt(b.notas, 2000, 'Notas') };
}
function valPersona(b) {
  const email = txt(b.email, 160, 'Correo').toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'El correo no parece válido.');
  return { nombre: txt(b.nombre, 120, 'el nombre', true), email, perfil: uno(b.perfil, PERFILES, 'Perfil'), lider: !!b.lider, activo: b.activo !== false, empresas: ids(b.empresas) };
}
async function valTarea(env, b) {
  const d = {
    titulo: txt(b.titulo, 200, 'la actividad', true),
    empresaId: txt(b.empresaId, 64, 'la empresa', true),
    inicio: fecha(b.inicio, 'Fecha de inicio'),
    fecha: fecha(b.fecha, 'Fecha compromiso', true),
    prioridad: uno(b.prioridad || 'Media', PRIORIDADES, 'Prioridad'),
    estado: uno(b.estado || 'Pendiente', ESTADOS, 'Estado'),
    descripcion: txt(b.descripcion, 4000, 'Descripción'),
    responsables: ids(b.responsables),
    hoy: hoyCDMX(),
  };
  if (!d.responsables.length) throw new HttpError(400, 'Asigna al menos un responsable.');
  if (d.inicio && d.inicio > d.fecha) throw new HttpError(400, 'La fecha de inicio no puede ser posterior a la fecha compromiso.');
  if (!(await datos.existe(env, 'empresas', d.empresaId))) throw new HttpError(400, 'La empresa no existe.');
  return d;
}

const PROVEEDORES = ['fatcow', 'google', 'microsoft', 'zoho', 'hostinger', 'godaddy', 'cpanel', 'personalizado'];
const host = (v, campo, req = false) => {
  v = txt(v, 200, campo, req).toLowerCase();
  if (v && !/^[a-z0-9.-]+$/.test(v)) throw new HttpError(400, `${campo}: escribe solo el nombre del servidor (ej. smtp.ejemplo.com).`);
  return v;
};
const puerto = (v, campo) => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 65535 || n === 25) throw new HttpError(400, `${campo}: puerto no válido (Cloudflare no permite el 25; usa 465 o 587).`); return n; };
function valCuenta(b) {
  const email = txt(b.email, 160, 'el correo', true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'El correo no parece válido.');
  const password = String(b.password ?? '');
  if (password.length > 500) throw new HttpError(400, 'La contraseña es demasiado larga.');
  return {
    email, nombre: txt(b.nombre, 120, 'Nombre del remitente') || 'Control de Campañas TiTi', usuario: txt(b.usuario, 160, 'el usuario') || email,
    proveedor: PROVEEDORES.includes(b.proveedor) ? b.proveedor : 'personalizado', password,
    smtpHost: host(b.smtpHost, 'Servidor SMTP', true), smtpPuerto: puerto(b.smtpPuerto, 'Puerto SMTP'), smtpSeguridad: uno(b.smtpSeguridad, SEGURIDAD, 'Seguridad SMTP'),
    imapHost: host(b.imapHost, 'Servidor IMAP'), imapPuerto: puerto(b.imapPuerto || 993, 'Puerto IMAP'), imapSeguridad: uno(b.imapSeguridad || 'ssl', SEGURIDAD, 'Seguridad IMAP'),
    guardarCopia: !!b.guardarCopia, carpetaEnviados: txt(b.carpetaEnviados, 200, 'Carpeta de enviados'),
  };
}

/* ---------- archivos de empresa ---------- */
// Workers acepta cuerpos de hasta 100 MB en los planes Free y Pro (200 MB en Business).
const MAX_ARCHIVO = 100 * 1024 * 1024;
const MAX_DESC_ARCHIVO = 150;
function r2(env) {
  if (!env.ARCHIVOS) throw new HttpError(503, 'El almacenamiento de archivos (R2) no está configurado.');
  return env.ARCHIVOS;
}
function valArchivo(req, url) {
  const nombre = String(url.searchParams.get('nombre') ?? '').replace(/[\u0000-\u001f\u007f\\/]/g, '').trim();
  if (!nombre) throw new HttpError(400, 'Falta el nombre del archivo.');
  if (nombre.length > 200) throw new HttpError(400, 'El nombre del archivo es demasiado largo (máximo 200 caracteres).');
  const descripcion = String(url.searchParams.get('descripcion') ?? '').trim();
  if (!descripcion) throw new HttpError(400, 'Escribe una descripción del archivo.');
  if (descripcion.length > MAX_DESC_ARCHIVO) throw new HttpError(400, `La descripción admite hasta ${MAX_DESC_ARCHIVO} caracteres.`);
  const tamano = Number(req.headers.get('content-length'));
  if (!Number.isInteger(tamano) || tamano <= 0) throw new HttpError(400, 'El archivo está vacío.');
  if (tamano > MAX_ARCHIVO) throw new HttpError(413, `El archivo pesa más de ${MAX_ARCHIVO / 1024 / 1024} MB.`);
  const tipo = String(req.headers.get('content-type') || '').slice(0, 120) || 'application/octet-stream';
  return { nombre, descripcion, tamano, tipo: /^[\w.+-]+\/[\w.+-]+$/.test(tipo) ? tipo : 'application/octet-stream' };
}
// Siempre como descarga y en "sandbox", para que un HTML o SVG subido nunca se ejecute dentro de la app.
const disposicion = (n) => `attachment; filename="${n.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(n)}`;

async function body(req) {
  try { return (await req.json()) || {}; } catch { throw new HttpError(400, 'Solicitud no válida.'); }
}
const lider = (yo) => { if (!yo.esLider) throw new HttpError(403, 'Solo los líderes globales pueden hacer esto.'); };
const registrado = (yo) => { if (!yo.registrado) throw new HttpError(403, 'Tu correo no está dado de alta en el personal.'); };

/* ---------- rutas ---------- */
async function api(req, env, url) {
  const email = await verificarAcceso(req, env);
  const yo = await datos.quienSoy(env, email);
  const m = req.method;
  const p = url.pathname.replace(/\/+$/, '');
  let r;

  if (m === 'GET' && p === '/api/estado') {
    const c = await leerCuenta(env);
    return json({ ...(await datos.cargarEstado(env)), yo, hoy: hoyCDMX(), correo: c ? { email: c.email, configurada: cuentaCompleta(c), prueba: c.prueba } : null });
  }

  // Cuenta de correo de envío (solo líderes)
  if (p === '/api/correo') {
    lider(yo);
    if (m === 'GET') return json(await leerCuenta(env));
    if (m === 'PUT') { await guardarCuenta(env, valCuenta(await body(req)), email); return json(await leerCuenta(env)); }
  }
  if (m === 'POST' && p === '/api/correo/probar') { lider(yo); return json(await probarCuenta(env, email)); }

  // Orden del día
  if (m === 'GET' && (r = p.match(/^\/api\/orden\/([\w-]+)$/))) {
    const est = await datos.cargarEstado(env);
    const per = est.personal.find((x) => x.id === r[1]);
    if (!per) throw new HttpError(404, 'Persona no encontrada.');
    return json(correoOrden(est, per, hoyCDMX(), env));
  }
  if (m === 'POST' && p === '/api/orden/enviar') {
    lider(yo);
    const b = await body(req);
    return json(await enviarOrdenes(env, { soloPersonaId: b.personaId ? String(b.personaId) : null, origen: 'manual' }));
  }

  // Empresas
  if (m === 'POST' && p === '/api/empresas') {
    lider(yo);
    const id = crypto.randomUUID();
    await datos.guardarEmpresa(env, id, valEmpresa(await body(req)), email, true);
    return json({ id }, 201);
  }
  if ((r = p.match(/^\/api\/empresas\/([\w-]+)\/plan$/)) && m === 'POST') {
    lider(yo);
    const est = await datos.cargarEstado(env);
    const e = est.empresas.find((x) => x.id === r[1]);
    if (!e) throw new HttpError(404, 'La empresa no existe.');
    if (!e.inicio) throw new HttpError(400, 'Registra primero la fecha de arranque de la empresa.');
    const lista = planBase().map(([titulo, si, fi, perfiles, prioridad]) => ({
      titulo, prioridad, inicio: habil(addDays(e.inicio, si)), fecha: habil(addDays(e.inicio, fi)), responsables: asignar(est.personal, perfiles, e.id),
    }));
    await datos.crearPlan(env, e.id, lista, email);
    return json({ creadas: lista.length }, 201);
  }
  if ((r = p.match(/^\/api\/empresas\/([\w-]+)\/archivos$/))) {
    const empresaId = r[1];
    if (m === 'GET') return json(await datos.listarArchivos(env, empresaId));
    if (m === 'POST') {
      registrado(yo);
      const bucket = r2(env);
      if (!(await datos.existe(env, 'empresas', empresaId))) throw new HttpError(404, 'La empresa no existe.');
      const a = valArchivo(req, url);
      const id = crypto.randomUUID(), clave = `empresas/${empresaId}/${id}`;
      await bucket.put(clave, req.body, { httpMetadata: { contentType: a.tipo }, customMetadata: { empresaId, subidoPor: email } });
      try { await datos.crearArchivo(env, { id, empresaId, clave, ...a }, email); }
      catch (e) { await bucket.delete(clave); throw e; }
      return json({ id }, 201);
    }
  }
  if ((r = p.match(/^\/api\/archivos\/([\w-]+)$/))) {
    const a = await datos.leerArchivo(env, r[1]);
    if (!a) throw new HttpError(404, 'El archivo ya no existe.');
    if (m === 'GET') {
      const obj = await r2(env).get(a.clave);
      if (!obj) throw new HttpError(404, 'El archivo ya no está en el almacenamiento.');
      return new Response(obj.body, { headers: {
        'content-type': a.tipo, 'content-length': String(obj.size), 'content-disposition': disposicion(a.nombre),
        'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox', 'cache-control': 'private, no-store',
      } });
    }
    if (m === 'DELETE') {
      // Lo borra un líder global o quien lo subió.
      if (!yo.esLider && a.subidoPor !== email) throw new HttpError(403, 'Solo quien subió el archivo o un líder global puede eliminarlo.');
      await datos.borrarArchivo(env, a, email);
      await r2(env).delete(a.clave);
      return json({ ok: true });
    }
  }
  if ((r = p.match(/^\/api\/empresas\/([\w-]+)$/))) {
    lider(yo);
    if (m === 'PUT') { await datos.guardarEmpresa(env, r[1], valEmpresa(await body(req)), email, false); return json({ ok: true }); }
    if (m === 'DELETE') {
      const claves = await datos.clavesArchivosEmpresa(env, r[1]);
      await datos.borrarEmpresa(env, r[1], email);
      for (let i = 0; i < claves.length; i += 1000) await r2(env).delete(claves.slice(i, i + 1000));
      return json({ ok: true });
    }
  }

  // Personal
  if (m === 'POST' && p === '/api/personal') {
    lider(yo);
    const id = crypto.randomUUID();
    await datos.guardarPersona(env, id, valPersona(await body(req)), email, true);
    return json({ id }, 201);
  }
  if ((r = p.match(/^\/api\/personal\/([\w-]+)$/))) {
    lider(yo);
    if (m === 'PUT') { await datos.guardarPersona(env, r[1], valPersona(await body(req)), email, false); return json({ ok: true }); }
    if (m === 'DELETE') { await datos.borrarPersona(env, r[1], email); return json({ ok: true }); }
  }

  // Actividades
  if (m === 'POST' && p === '/api/tareas') {
    registrado(yo);
    const id = crypto.randomUUID();
    await datos.guardarTarea(env, id, await valTarea(env, await body(req)), email, true);
    return json({ id }, 201);
  }
  if ((r = p.match(/^\/api\/tareas\/([\w-]+)\/estado$/)) && m === 'PATCH') {
    registrado(yo);
    if (!yo.esLider && !(await datos.responsablesDe(env, r[1])).includes(yo.personaId)) {
      throw new HttpError(403, 'Solo los responsables de la actividad o un líder global pueden cambiar su estado.');
    }
    const b = await body(req);
    await datos.cambiarEstado(env, r[1], uno(b.estado, ESTADOS, 'Estado'), hoyCDMX(), email);
    return json({ ok: true });
  }
  if ((r = p.match(/^\/api\/tareas\/([\w-]+)$/))) {
    if (m === 'PUT') { registrado(yo); await datos.guardarTarea(env, r[1], await valTarea(env, await body(req)), email, false); return json({ ok: true }); }
    if (m === 'DELETE') { lider(yo); await datos.borrarTarea(env, r[1], email); return json({ ok: true }); }
  }

  throw new HttpError(404, 'Ruta no encontrada.');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await api(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Ocurrió un error en el servidor. Intenta de nuevo.' }, 500);
    }
  },

  // Cron: 14:00 UTC = 8:00 en Ciudad de México (sin horario de verano desde 2022), de lunes a viernes.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(enviarOrdenes(env, { origen: 'cron' }).then((r) => console.log('Orden del día enviada', JSON.stringify(r))));
  },
};
