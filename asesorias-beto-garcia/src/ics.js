// Archivo .ics (iCalendar) que acompaña al correo de confirmación para agregar la cita a cualquier calendario.

const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const fmt = (iso) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// Las líneas de iCalendar no deben pasar de 75 octetos.
function doblar(linea) {
  const bytes = new TextEncoder().encode(linea);
  if (bytes.length <= 75) return linea;
  const out = [];
  let actual = '', largo = 0;
  for (const ch of linea) {
    const n = new TextEncoder().encode(ch).length;
    if (largo + n > (out.length ? 74 : 75)) { out.push(actual); actual = ''; largo = 0; }
    actual += ch; largo += n;
  }
  out.push(actual);
  return out.join('\r\n ');
}

export function crearIcs({ uid, inicio, fin, titulo, descripcion, lugar, url, organizador, metodo = 'PUBLISH', cancelado = false }) {
  const l = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Titiapps//Calendario de Asesorias Beto Garcia//ES', 'CALSCALE:GREGORIAN', `METHOD:${metodo}`,
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${fmt(new Date().toISOString())}`,
    `DTSTART:${fmt(inicio)}`,
    `DTEND:${fmt(fin)}`,
    `SUMMARY:${esc(titulo)}`,
    `DESCRIPTION:${esc(descripcion)}`,
    lugar ? `LOCATION:${esc(lugar)}` : null,
    url ? `URL:${url}` : null,
    url && /meet\.google\.com/.test(url) ? `X-GOOGLE-CONFERENCE:${url}` : null,
    organizador ? `ORGANIZER;CN=${esc(organizador.nombre)}:mailto:${organizador.email}` : null,
    `STATUS:${cancelado ? 'CANCELLED' : 'CONFIRMED'}`,
    cancelado ? 'SEQUENCE:1' : 'SEQUENCE:0',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Recordatorio de asesoría', 'TRIGGER:-PT30M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return l.map(doblar).join('\r\n') + '\r\n';
}
