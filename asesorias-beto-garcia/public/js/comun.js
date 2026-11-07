// Utilidades compartidas: fechas en la zona horaria del asesor, llamadas a la API y escape de HTML.
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function api(ruta, opciones = {}) {
  const r = await fetch(ruta, {
    ...opciones,
    headers: { ...(opciones.body ? { 'Content-Type': 'application/json' } : {}), ...(opciones.headers || {}) },
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
    credentials: 'same-origin',
  });
  let j = {};
  try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(j.error || `Error ${r.status}`); e.status = r.status; throw e; }
  return j;
}

/** Clave AAAA-MM-DD de un instante en la zona dada. */
export const claveDia = (iso, zona) => new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
export const hora = (iso, zona) => new Intl.DateTimeFormat('es-MX', { timeZone: zona, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
export const fechaLarga = (iso, zona) => new Intl.DateTimeFormat('es-MX', { timeZone: zona, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
/** Fecha larga a partir de una clave AAAA-MM-DD (sin depender de la zona del navegador). */
export const fechaDeClave = (k) => new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(k + 'T12:00:00Z'));
export const nombreZona = (zona) => zona === 'America/Mexico_City' ? 'hora del centro de México' : zona.replace(/_/g, ' ');
export const hoyEn = (zona) => claveDia(new Date().toISOString(), zona);

/** Días (claves) de la cuadrícula de un mes: empieza en lunes. */
export function cuadriculaMes(anio, mes) {
  const primero = new Date(Date.UTC(anio, mes, 1));
  const dow = (primero.getUTCDay() + 6) % 7;
  const dias = [];
  const total = Math.ceil((dow + new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate()) / 7) * 7;
  for (let i = 0; i < total; i++) {
    const d = new Date(Date.UTC(anio, mes, 1 - dow + i));
    dias.push({ clave: d.toISOString().slice(0, 10), num: d.getUTCDate(), fuera: d.getUTCMonth() !== mes });
  }
  return dias;
}
export const nombreMes = (anio, mes) => new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(Date.UTC(anio, mes, 15)));
