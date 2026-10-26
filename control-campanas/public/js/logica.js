// Lógica compartida entre el navegador y el Worker: fechas, semáforo y orden del día.
// El Worker la importa al compilar (esbuild), así ambos calculan exactamente lo mismo.

export const PERFILES = ['Admin', 'Project manager', 'Community manager', 'Diseñador gráfico', 'Telemarketer', 'Analista de datos'];
export const ESTADOS = ['Pendiente', 'En proceso', 'Completada'];
export const PRIORIDADES = ['Alta', 'Media', 'Baja'];

export const SEM = {
  late: { label: 'Vencida', desc: 'Fecha compromiso ya pasó' },
  risk: { label: 'Vence en 1 día', desc: 'Vence hoy o mañana' },
  warn: { label: 'Vence en 3 días', desc: 'Faltan 2 o 3 días' },
  ok: { label: 'En tiempo', desc: 'Más de 3 días' },
  done: { label: 'Completadas', desc: 'Cerradas' },
};
export const SEM_ORDER = ['late', 'risk', 'warn', 'ok', 'done'];
export const TITULOS_ORDEN = {
  late: 'Vencidas: atender primero',
  risk: 'Vencen hoy o mañana',
  warn: 'Vencen en 2 o 3 días',
  ok: 'En curso y en tiempo',
};

const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIA = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Fecha de hoy (YYYY-MM-DD) en Ciudad de México, sin importar dónde corra el código. */
export function hoyCDMX(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function horaCDMX(d = new Date()) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

export function dnum(s) { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 864e5; }
export function addDays(s, n) { return new Date((dnum(s) + n) * 864e5).toISOString().slice(0, 10); }
/** Si la fecha cae en sábado o domingo, la mueve al viernes anterior. */
export function habil(s) { const w = new Date(dnum(s) * 864e5).getUTCDay(); return w === 6 ? addDays(s, -1) : w === 0 ? addDays(s, -2) : s; }
export function fmt(s) { if (!s) return '—'; const t = new Date(dnum(s) * 864e5); return `${DIA[t.getUTCDay()]} ${t.getUTCDate()} ${MES[t.getUTCMonth()]}`; }
export function fmtLargo(s) { const t = new Date(dnum(s) * 864e5); return `${DIA[t.getUTCDay()]} ${t.getUTCDate()} de ${MES_LARGO[t.getUTCMonth()]} ${t.getUTCFullYear()}`; }

export function dias(t, hoy) { return t.fecha ? dnum(t.fecha) - dnum(hoy) : null; }

/** Semáforo: done | late (vencida) | risk (hoy o mañana) | warn (2–3 días) | ok (más de 3 días). */
export function sem(t, hoy) {
  if (t.estado === 'Completada') return 'done';
  const d = dias(t, hoy);
  if (d === null) return 'ok';
  if (d < 0) return 'late';
  if (d <= 1) return 'risk';
  if (d <= 3) return 'warn';
  return 'ok';
}

export function rel(t, hoy) {
  if (t.estado === 'Completada') return t.completadaEn ? 'Cerrada ' + fmt(t.completadaEn) : 'Cerrada';
  const d = dias(t, hoy);
  if (d === null) return 'Sin fecha';
  if (d < 0) return `Venció hace ${-d} ${d === -1 ? 'día' : 'días'}`;
  if (d === 0) return 'Vence hoy';
  if (d === 1) return 'Vence mañana';
  return `Faltan ${d} días`;
}

export const byFecha = (a, b) => (a.fecha || '9999').localeCompare(b.fecha || '9999') || String(a.titulo).localeCompare(String(b.titulo));

/** Actividades abiertas de una persona que ya iniciaron, agrupadas por semáforo. */
export function ordenDe(tareas, personaId, hoy) {
  const ts = tareas.filter((t) => t.estado !== 'Completada' && (t.responsables || []).includes(personaId) && (!t.inicio || t.inicio <= hoy));
  return ['late', 'risk', 'warn', 'ok'].map((k) => [k, ts.filter((t) => sem(t, hoy) === k).sort(byFecha)]);
}
