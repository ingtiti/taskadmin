// Acceso a D1. Cada escritura se hace en un batch (transacción) junto con su registro en historial.
import { HttpError } from './errores.js';

const hist = (env, quien, accion, entidad, id, detalle = '') =>
  env.DB.prepare('INSERT INTO historial (quien, accion, entidad, entidad_id, detalle) VALUES (?,?,?,?,?)')
    .bind(quien, accion, entidad, id, typeof detalle === 'string' ? detalle : JSON.stringify(detalle));

export async function cargarEstado(env) {
  const r = await env.DB.batch([
    env.DB.prepare('SELECT id, nombre, contacto, inicio, notas FROM empresas ORDER BY nombre COLLATE NOCASE'),
    env.DB.prepare('SELECT id, nombre, email, perfil, lider, activo FROM personal ORDER BY lider DESC, nombre COLLATE NOCASE'),
    env.DB.prepare('SELECT persona_id, empresa_id FROM personal_empresas'),
    env.DB.prepare('SELECT id, titulo, empresa_id, inicio, fecha, prioridad, estado, descripcion, origen, completada_en FROM tareas'),
    env.DB.prepare('SELECT tarea_id, persona_id FROM tarea_responsables'),
    env.DB.prepare('SELECT fecha, hora, origen, enviados, fallidos, nota FROM envios ORDER BY id DESC LIMIT 1'),
    env.DB.prepare('SELECT empresa_id, COUNT(*) AS n FROM empresa_archivos GROUP BY empresa_id'),
    env.DB.prepare('SELECT id, nombre, clave FROM perfiles ORDER BY nombre COLLATE NOCASE'),
    env.DB.prepare(`SELECT n.empresa_id, COUNT(*) AS n, MAX(n.creada) AS ultima,
      (SELECT texto FROM empresa_notas x WHERE x.empresa_id = n.empresa_id ORDER BY x.creada DESC LIMIT 1) AS texto,
      (SELECT autor_nombre FROM empresa_notas x WHERE x.empresa_id = n.empresa_id ORDER BY x.creada DESC LIMIT 1) AS autor
      FROM empresa_notas n GROUP BY n.empresa_id`),
    env.DB.prepare('SELECT empresa_id, COUNT(*) AS n FROM minutas GROUP BY empresa_id'),
  ]);
  const [E, P, PE, T, TR, EN, EA, PF, NO, MI] = r.map((x) => x.results);
  const archivosDe = Object.fromEntries(EA.map((x) => [x.empresa_id, x.n]));
  const notasDe = Object.fromEntries(NO.map((x) => [x.empresa_id, x]));
  const minutasDe = Object.fromEntries(MI.map((x) => [x.empresa_id, x.n]));
  const empsDe = {}, respDe = {};
  for (const x of PE) (empsDe[x.persona_id] ||= []).push(x.empresa_id);
  for (const x of TR) (respDe[x.tarea_id] ||= []).push(x.persona_id);
  return {
    empresas: E.map(({ notas, ...e }) => {
      const n = notasDe[e.id];
      return { ...e, archivos: archivosDe[e.id] || 0, minutas: minutasDe[e.id] || 0, notas: n ? n.n : 0,
        ultimaNota: n ? { texto: String(n.texto || '').slice(0, 280), autor: n.autor, creada: n.ultima } : null };
    }),
    personal: P.map((p) => ({ ...p, lider: !!p.lider, activo: !!p.activo, empresas: empsDe[p.id] || [] })),
    tareas: T.map((t) => ({
      id: t.id, titulo: t.titulo, empresaId: t.empresa_id, inicio: t.inicio, fecha: t.fecha, prioridad: t.prioridad,
      estado: t.estado, descripcion: t.descripcion, origen: t.origen, completadaEn: t.completada_en, responsables: respDe[t.id] || [],
    })),
    envio: EN[0] || null,
    perfiles: PF,
  };
}

export async function quienSoy(env, email) {
  const p = await env.DB.prepare('SELECT id, nombre, lider FROM personal WHERE lower(email) = ? AND activo = 1').bind(email).first();
  const admins = String(env.ADMIN_EMAILS || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
  const esAdmin = admins.includes(email);
  return { email, personaId: p ? p.id : null, nombre: p ? p.nombre : '', registrado: !!p || esAdmin, esLider: (!!p && !!p.lider) || esAdmin };
}

export async function existe(env, tabla, id) {
  if (!['empresas', 'personal', 'tareas'].includes(tabla)) throw new Error('tabla');
  return !!(await env.DB.prepare(`SELECT 1 FROM ${tabla} WHERE id = ?`).bind(id).first());
}

async function correr(env, stmts) {
  try {
    return await env.DB.batch(stmts);
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw new HttpError(409, 'Ese correo ya está registrado con otra persona.');
    throw e;
  }
}

/* ---------- empresas ---------- */
export async function guardarEmpresa(env, id, d, quien, nueva) {
  const s = nueva
    ? env.DB.prepare('INSERT INTO empresas (id, nombre, contacto, inicio) VALUES (?,?,?,?)').bind(id, d.nombre, d.contacto, d.inicio)
    : env.DB.prepare("UPDATE empresas SET nombre=?, contacto=?, inicio=?, actualizada=datetime('now') WHERE id=?").bind(d.nombre, d.contacto, d.inicio, id);
  const [r] = await correr(env, [s, hist(env, quien, nueva ? 'crear' : 'editar', 'empresa', id, d)]);
  if (!r.meta.changes) throw new HttpError(404, 'La empresa ya no existe.');
}

export async function borrarEmpresa(env, id, quien) {
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM tarea_responsables WHERE tarea_id IN (SELECT id FROM tareas WHERE empresa_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM tareas WHERE empresa_id = ?').bind(id),
    env.DB.prepare('DELETE FROM personal_empresas WHERE empresa_id = ?').bind(id),
    env.DB.prepare('DELETE FROM empresa_archivos WHERE empresa_id = ?').bind(id),
    env.DB.prepare('DELETE FROM empresa_notas WHERE empresa_id = ?').bind(id),
    env.DB.prepare('DELETE FROM minutas WHERE empresa_id = ?').bind(id),
    env.DB.prepare('DELETE FROM empresas WHERE id = ?').bind(id),
    hist(env, quien, 'eliminar', 'empresa', id),
  ]);
  if (!r[6].meta.changes) throw new HttpError(404, 'La empresa ya no existe.');
}

/* ---------- archivos de empresa (metadatos; el contenido está en R2) ---------- */
const colsArchivo = 'a.id, a.empresa_id, a.nombre, a.tipo, a.tamano, a.descripcion, a.subido_por, a.creado, a.minuta_id';
const mapArchivo = (a) => ({ id: a.id, empresaId: a.empresa_id, nombre: a.nombre, tipo: a.tipo, tamano: a.tamano, descripcion: a.descripcion, subidoPor: a.subido_por, creado: a.creado, minutaId: a.minuta_id || null, minutaTitulo: a.minuta_titulo || null });

/** Todos los archivos, o solo los de una empresa. Incluye los adjuntos de minutas con el título de su minuta. */
export async function listarArchivos(env, empresaId = null) {
  const sql = `SELECT ${colsArchivo}, m.titulo AS minuta_titulo FROM empresa_archivos a LEFT JOIN minutas m ON m.id = a.minuta_id
    ${empresaId ? 'WHERE a.empresa_id = ?' : ''} ORDER BY a.creado DESC, a.nombre COLLATE NOCASE`;
  const st = env.DB.prepare(sql);
  const r = await (empresaId ? st.bind(empresaId) : st).all();
  return r.results.map(mapArchivo);
}

export async function clavesArchivosEmpresa(env, empresaId) {
  const r = await env.DB.prepare('SELECT clave FROM empresa_archivos WHERE empresa_id = ?').bind(empresaId).all();
  return r.results.map((x) => x.clave);
}

export async function leerArchivo(env, id) {
  const a = await env.DB.prepare(`SELECT ${colsArchivo}, a.clave FROM empresa_archivos a WHERE a.id = ?`).bind(id).first();
  return a ? { ...mapArchivo(a), clave: a.clave } : null;
}

export async function crearArchivo(env, a, quien) {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO empresa_archivos (id, empresa_id, clave, nombre, tipo, tamano, descripcion, subido_por, minuta_id) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(a.id, a.empresaId, a.clave, a.nombre, a.tipo, a.tamano, a.descripcion, quien, a.minutaId || null),
    hist(env, quien, 'subir archivo', 'empresa', a.empresaId, { archivo: a.id, nombre: a.nombre, tamano: a.tamano, descripcion: a.descripcion, minuta: a.minutaId || undefined }),
  ]);
}

export async function borrarArchivo(env, a, quien) {
  const [r] = await env.DB.batch([
    env.DB.prepare('DELETE FROM empresa_archivos WHERE id = ?').bind(a.id),
    hist(env, quien, 'eliminar archivo', 'empresa', a.empresaId, { archivo: a.id, nombre: a.nombre }),
  ]);
  if (!r.meta.changes) throw new HttpError(404, 'El archivo ya no existe.');
}

/* ---------- notas de empresa (bitácora) ---------- */
const mapNota = (n) => ({ id: n.id, empresaId: n.empresa_id, texto: n.texto, autorEmail: n.autor_email, autorNombre: n.autor_nombre, creada: n.creada });

export async function listarNotas(env, empresaId) {
  const r = await env.DB.prepare('SELECT * FROM empresa_notas WHERE empresa_id = ? ORDER BY creada DESC, rowid DESC').bind(empresaId).all();
  return r.results.map(mapNota);
}

export async function leerNota(env, id) {
  const n = await env.DB.prepare('SELECT * FROM empresa_notas WHERE id = ?').bind(id).first();
  return n ? mapNota(n) : null;
}

export async function crearNota(env, n, yo) {
  await env.DB.batch([
    env.DB.prepare('INSERT INTO empresa_notas (id, empresa_id, texto, autor_email, autor_nombre) VALUES (?,?,?,?,?)')
      .bind(n.id, n.empresaId, n.texto, yo.email, yo.nombre || yo.email),
    hist(env, yo.email, 'agregar nota', 'empresa', n.empresaId, { nota: n.id }),
  ]);
}

export async function borrarNota(env, n, quien) {
  const [r] = await env.DB.batch([
    env.DB.prepare('DELETE FROM empresa_notas WHERE id = ?').bind(n.id),
    hist(env, quien, 'eliminar nota', 'empresa', n.empresaId, { nota: n.id, texto: n.texto.slice(0, 200), autor: n.autorEmail }),
  ]);
  if (!r.meta.changes) throw new HttpError(404, 'La nota ya no existe.');
}

/* ---------- minutas de reunión ---------- */
const mapMinuta = (m) => ({ id: m.id, empresaId: m.empresa_id, fecha: m.fecha, titulo: m.titulo, asistentes: m.asistentes, contenido: m.contenido,
  creadaPor: m.creada_por, creada: m.creada, actualizada: m.actualizada, actualizadaPor: m.actualizada_por });

export async function listarMinutas(env, empresaId = null) {
  const st = env.DB.prepare(`SELECT * FROM minutas ${empresaId ? 'WHERE empresa_id = ?' : ''} ORDER BY fecha DESC, creada DESC`);
  const r = await (empresaId ? st.bind(empresaId) : st).all();
  return r.results.map(mapMinuta);
}

export async function leerMinuta(env, id) {
  const m = await env.DB.prepare('SELECT * FROM minutas WHERE id = ?').bind(id).first();
  return m ? mapMinuta(m) : null;
}

export async function guardarMinuta(env, id, d, quien, nueva) {
  const s = nueva
    ? env.DB.prepare('INSERT INTO minutas (id, empresa_id, fecha, titulo, asistentes, contenido, creada_por, actualizada_por) VALUES (?,?,?,?,?,?,?,?)')
        .bind(id, d.empresaId, d.fecha, d.titulo, d.asistentes, d.contenido, quien, quien)
    : env.DB.prepare("UPDATE minutas SET empresa_id=?, fecha=?, titulo=?, asistentes=?, contenido=?, actualizada=datetime('now'), actualizada_por=? WHERE id=?")
        .bind(d.empresaId, d.fecha, d.titulo, d.asistentes, d.contenido, quien, id);
  const stmts = [s];
  // Los adjuntos siguen a su minuta si cambia de empresa.
  if (!nueva) stmts.push(env.DB.prepare('UPDATE empresa_archivos SET empresa_id = ? WHERE minuta_id = ?').bind(d.empresaId, id));
  stmts.push(hist(env, quien, nueva ? 'crear' : 'editar', 'minuta', id, { empresa: d.empresaId, fecha: d.fecha, titulo: d.titulo }));
  const [r] = await env.DB.batch(stmts);
  if (!r.meta.changes) throw new HttpError(404, 'La minuta ya no existe.');
}

/** Borra la minuta y los datos de sus adjuntos; devuelve las llaves de R2 para borrarlas después. */
export async function borrarMinuta(env, m, quien) {
  const claves = (await env.DB.prepare('SELECT clave FROM empresa_archivos WHERE minuta_id = ?').bind(m.id).all()).results.map((x) => x.clave);
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM empresa_archivos WHERE minuta_id = ?').bind(m.id),
    env.DB.prepare('DELETE FROM minutas WHERE id = ?').bind(m.id),
    hist(env, quien, 'eliminar', 'minuta', m.id, { titulo: m.titulo, adjuntos: claves.length }),
  ]);
  if (!r[1].meta.changes) throw new HttpError(404, 'La minuta ya no existe.');
  return claves;
}

/* ---------- perfiles ---------- */
export async function existePerfil(env, nombre) {
  return !!(await env.DB.prepare('SELECT 1 FROM perfiles WHERE nombre = ?').bind(nombre).first());
}

async function correrPerfil(env, stmts) {
  try {
    return await env.DB.batch(stmts);
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw new HttpError(409, 'Ya existe un perfil con ese nombre.');
    throw e;
  }
}

export async function crearPerfil(env, id, nombre, quien) {
  await correrPerfil(env, [
    env.DB.prepare('INSERT INTO perfiles (id, nombre) VALUES (?,?)').bind(id, nombre),
    hist(env, quien, 'crear', 'perfil', id, nombre),
  ]);
}

/** Cambia el nombre del perfil y de todas las personas que lo tienen, en una sola transacción. */
export async function renombrarPerfil(env, id, nombre, quien) {
  const actual = await env.DB.prepare('SELECT nombre FROM perfiles WHERE id = ?').bind(id).first();
  if (!actual) throw new HttpError(404, 'El perfil ya no existe.');
  if (actual.nombre === nombre) return;
  await correrPerfil(env, [
    env.DB.prepare("UPDATE perfiles SET nombre=?, actualizado=datetime('now') WHERE id=?").bind(nombre, id),
    env.DB.prepare("UPDATE personal SET perfil=?, actualizada=datetime('now') WHERE perfil=?").bind(nombre, actual.nombre),
    hist(env, quien, 'editar', 'perfil', id, { antes: actual.nombre, ahora: nombre }),
  ]);
}

export async function borrarPerfil(env, id, quien) {
  const actual = await env.DB.prepare('SELECT nombre FROM perfiles WHERE id = ?').bind(id).first();
  if (!actual) throw new HttpError(404, 'El perfil ya no existe.');
  const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM personal WHERE perfil = ?').bind(actual.nombre).first();
  if (n) throw new HttpError(409, `No se puede eliminar: ${n === 1 ? '1 persona tiene' : `${n} personas tienen`} el perfil ${actual.nombre}. ${n === 1 ? 'Cámbiala' : 'Cámbialas'} de perfil primero.`);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM perfiles WHERE id = ?').bind(id),
    hist(env, quien, 'eliminar', 'perfil', id, actual.nombre),
  ]);
}

/* ---------- personal ---------- */
export async function guardarPersona(env, id, d, quien, nueva) {
  const s = nueva
    ? env.DB.prepare('INSERT INTO personal (id, nombre, email, perfil, lider, activo) VALUES (?,?,?,?,?,?)').bind(id, d.nombre, d.email, d.perfil, d.lider ? 1 : 0, d.activo ? 1 : 0)
    : env.DB.prepare("UPDATE personal SET nombre=?, email=?, perfil=?, lider=?, activo=?, actualizada=datetime('now') WHERE id=?").bind(d.nombre, d.email, d.perfil, d.lider ? 1 : 0, d.activo ? 1 : 0, id);
  const stmts = [s, env.DB.prepare('DELETE FROM personal_empresas WHERE persona_id = ?').bind(id)];
  for (const e of d.empresas) stmts.push(env.DB.prepare('INSERT INTO personal_empresas (persona_id, empresa_id) SELECT ?, id FROM empresas WHERE id = ?').bind(id, e));
  stmts.push(hist(env, quien, nueva ? 'crear' : 'editar', 'persona', id, d));
  const [r] = await correr(env, stmts);
  if (!r.meta.changes) throw new HttpError(404, 'La persona ya no existe.');
}

export async function borrarPersona(env, id, quien) {
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM tarea_responsables WHERE persona_id = ?').bind(id),
    env.DB.prepare('DELETE FROM personal_empresas WHERE persona_id = ?').bind(id),
    env.DB.prepare('DELETE FROM personal WHERE id = ?').bind(id),
    hist(env, quien, 'eliminar', 'persona', id),
  ]);
  if (!r[2].meta.changes) throw new HttpError(404, 'La persona ya no existe.');
}

/* ---------- tareas ---------- */
function stmtsResponsables(env, id, responsables) {
  const s = [env.DB.prepare('DELETE FROM tarea_responsables WHERE tarea_id = ?').bind(id)];
  for (const p of responsables) s.push(env.DB.prepare('INSERT INTO tarea_responsables (tarea_id, persona_id) SELECT ?, id FROM personal WHERE id = ?').bind(id, p));
  return s;
}

export async function guardarTarea(env, id, d, quien, nueva) {
  const completada = d.estado === 'Completada';
  const s = nueva
    ? env.DB.prepare('INSERT INTO tareas (id, titulo, empresa_id, inicio, fecha, prioridad, estado, descripcion, origen, completada_en, actualizada_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
        .bind(id, d.titulo, d.empresaId, d.inicio, d.fecha, d.prioridad, d.estado, d.descripcion, d.origen || 'manual', completada ? d.hoy : null, quien)
    : env.DB.prepare(`UPDATE tareas SET titulo=?, empresa_id=?, inicio=?, fecha=?, prioridad=?, estado=?, descripcion=?,
        completada_en = CASE WHEN ? = 'Completada' THEN COALESCE(completada_en, ?) ELSE NULL END,
        actualizada=datetime('now'), actualizada_por=? WHERE id=?`)
        .bind(d.titulo, d.empresaId, d.inicio, d.fecha, d.prioridad, d.estado, d.descripcion, d.estado, d.hoy, quien, id);
  const [r] = await correr(env, [s, ...stmtsResponsables(env, id, d.responsables), hist(env, quien, nueva ? 'crear' : 'editar', 'tarea', id, d)]);
  if (!r.meta.changes) throw new HttpError(404, 'La actividad ya no existe.');
}

export async function responsablesDe(env, id) {
  const r = await env.DB.prepare('SELECT persona_id FROM tarea_responsables WHERE tarea_id = ?').bind(id).all();
  return r.results.map((x) => x.persona_id);
}

export async function cambiarEstado(env, id, estado, hoy, quien) {
  const [r] = await env.DB.batch([
    env.DB.prepare(`UPDATE tareas SET estado=?, completada_en = CASE WHEN ? = 'Completada' THEN ? ELSE NULL END,
      actualizada=datetime('now'), actualizada_por=? WHERE id=?`).bind(estado, estado, hoy, quien, id),
    hist(env, quien, 'estado', 'tarea', id, estado),
  ]);
  if (!r.meta.changes) throw new HttpError(404, 'La actividad ya no existe.');
}

export async function borrarTarea(env, id, quien) {
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM tarea_responsables WHERE tarea_id = ?').bind(id),
    env.DB.prepare('DELETE FROM tareas WHERE id = ?').bind(id),
    hist(env, quien, 'eliminar', 'tarea', id),
  ]);
  if (!r[1].meta.changes) throw new HttpError(404, 'La actividad ya no existe.');
}

/** Crea todas las actividades del plan en una sola transacción. */
export async function crearPlan(env, empresaId, tareas, quien) {
  const stmts = [];
  for (const t of tareas) {
    const id = crypto.randomUUID();
    stmts.push(env.DB.prepare('INSERT INTO tareas (id, titulo, empresa_id, inicio, fecha, prioridad, estado, origen, actualizada_por) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(id, t.titulo, empresaId, t.inicio, t.fecha, t.prioridad, 'Pendiente', 'plan', quien));
    for (const p of t.responsables) stmts.push(env.DB.prepare('INSERT INTO tarea_responsables (tarea_id, persona_id) VALUES (?,?)').bind(id, p));
  }
  stmts.push(hist(env, quien, 'cargar plan', 'empresa', empresaId, `${tareas.length} actividades`));
  await env.DB.batch(stmts);
}

export async function registrarEnvio(env, e) {
  await env.DB.prepare('INSERT INTO envios (fecha, hora, origen, enviados, fallidos, nota) VALUES (?,?,?,?,?,?)')
    .bind(e.fecha, e.hora, e.origen, e.enviados, e.fallidos, e.nota).run();
}
