// Conversión entre hora local (zona del asesor) y UTC sin dependencias externas.

function partes(fecha, zona) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(f.formatToParts(fecha).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Diferencia (ms) entre la hora local de `zona` y UTC en el instante dado. */
function desfase(ms, zona) {
  const p = partes(new Date(ms), zona);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** '2026-11-10T09:00' (hora local de `zona`) → Date en UTC. */
export function localAUtc(local, zona) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const supuesto = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let ms = supuesto - desfase(supuesto, zona);
  ms = supuesto - desfase(ms, zona); // segunda pasada por si cae en cambio de horario
  const d = new Date(ms);
  const p = partes(d, zona);
  // Descarta horas que no existen en la zona (salto de horario de verano).
  if (p.y !== +m[1] || p.m !== +m[2] || p.d !== +m[3] || p.h !== +m[4] || p.mi !== +m[5]) return null;
  return d;
}

/** Texto amigable en español: "martes 10 de noviembre de 2026" y "9:00 a 10:00 h". */
export function textoFecha(iso, zona) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: zona, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}
export function textoHora(iso, zona) {
  return new Intl.DateTimeFormat('es-MX', { timeZone: zona, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}
export function textoRango(inicio, fin, zona) {
  return `${textoFecha(inicio, zona)}, de ${textoHora(inicio, zona)} a ${textoHora(fin, zona)} h`;
}

/** Inicio (00:00) del día de mañana en `zona`, como Date en UTC. Solo se puede reservar desde ese instante. */
export function inicioDeManana(zona, ahora = new Date()) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
  const d = new Date(hoy + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return localAUtc(`${d.toISOString().slice(0, 10)}T00:00`, zona) || new Date(ahora.getTime() + 24 * 3600_000);
}
