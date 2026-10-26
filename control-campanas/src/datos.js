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
  ]);
  const [E, P, PE, T, TR, EN] = r.map((x) => x.results);
  const empsDe = {}, respDe = {};
  for (const x of PE) (empsDe[x.persona_id] ||= []).push(x.empresa_id);
  for (const x of TR) (respDe[x.tarea_id] ||= []).push(x.persona_id);
  return {
    empresas: E,
    personal: P.map((p) => ({ ...p, lider: !!p.lider, activo: !!p.activo, empresas: empsDe[p.id] || [] })),
    tareas: T.map((t) => ({
      id: t.id, titulo: t.titulo, empresaId: t.empresa_id, inicio: t.inicio, fecha: t.fecha, prioridad: t.prioridad,
      estado: t.estado, descripcion: t.descripcion, origen: t.origen, completadaEn: t.completada_en, responsables: respDe[t.id] || [],
    })),
    envio: EN[0] || null,
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
    ? env.DB.prepare('INSERT INTO empresas (id, nombre, contacto, inicio, notas) VALUES (?,?,?,?,?)').bind(id, d.nombre, d.contacto, d.inicio, d.notas)
    : env.DB.prepare("UPDATE empresas SET nombre=?, contacto=?, inicio=?, notas=?, actualizada=datetime('now') WHERE id=?").bind(d.nombre, d.contacto, d.inicio, d.notas, id);
  const [r] = await correr(env, [s, hist(env, quien, nueva ? 'crear' : 'editar', 'empresa', id, d)]);
  if (!r.meta.changes) throw new HttpError(404, 'La empresa ya no existe.');
}

export async function borrarEmpresa(env, id, quien) {
  const r = await env.DB.batch([
    env.DB.prepare('DELETE FROM tarea_responsables WHERE tarea_id IN (SELECT id FROM tareas WHERE empresa_id = ?)').bind(id),
    env.DB.prepare('DELETE FROM tareas WHERE empresa_id = ?').bind(id),
    env.DB.prepare('DELETE FROM personal_empresas WHERE empresa_id = ?').bind(id),
    env.DB.prepare('DELETE FROM empresas WHERE id = ?').bind(id),
    hist(env, quien, 'eliminar', 'empresa', id),
  ]);
  if (!r[3].meta.changes) throw new HttpError(404, 'La empresa ya no existe.');
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
