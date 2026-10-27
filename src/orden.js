// Orden del día: arma el correo de cada persona y lo envía desde la cuenta configurada en Correo.
import { ordenDe, TITULOS_ORDEN, fmt, rel, esc, hoyCDMX, horaCDMX } from '../public/js/logica.js';
import { cargarEstado, registrarEnvio } from './datos.js';
import { enviarCorreos } from './correo.js';

const COLOR = { late: '#8A1717', risk: '#CF3F27', warn: '#B27A00', ok: '#23824F' };
const FONDO = { late: '#F2D6D6', risk: '#FBE2DC', warn: '#FBF0D3', ok: '#E1F2E8' };

export function correoOrden(est, per, hoy, env) {
  const grupos = ordenDe(est.tareas, per.id, hoy).filter((g) => g[1].length);
  const total = grupos.reduce((a, g) => a + g[1].length, 0);
  const nombreEmp = (id) => (est.empresas.find((e) => e.id === id) || {}).nombre || '';
  const primerNombre = String(per.nombre).split(' ')[0];
  const asunto = `Orden del día · ${fmt(hoy)} · ${per.nombre}`;
  const url = env.APP_URL || '';
  const intro = total
    ? `Tienes <b>${total}</b> ${total === 1 ? 'actividad abierta' : 'actividades abiertas'} para hoy.`
    : 'No tienes actividades abiertas para hoy.';

  const bloques = grupos.map(([k, lista]) => `
    <tr><td style="padding:16px 0 6px;font:700 12px Arial,sans-serif;letter-spacing:.05em;text-transform:uppercase;color:${COLOR[k]}">${TITULOS_ORDEN[k]} (${lista.length})</td></tr>
    ${lista.map((t) => `<tr><td style="padding:8px 12px;border-left:4px solid ${COLOR[k]};background:${FONDO[k]};font:14px Arial,sans-serif;color:#15202C">
      <b>${esc(t.titulo)}</b>${t.prioridad === 'Alta' ? ' <span style="color:#CF3F27;font-weight:700">· Prioridad alta</span>' : ''}<br>
      <span style="color:#5A6879;font-size:13px">${esc(nombreEmp(t.empresaId))} · ${fmt(t.fecha)} · ${rel(t, hoy)}</span></td></tr>
      <tr><td style="height:6px"></td></tr>`).join('')}`).join('');

  const html = `<!doctype html><html><body style="margin:0;background:#F3F5F8">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F8;padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#FFFFFF;border:1px solid #D7DEE7;border-radius:12px;padding:24px">
    <tr><td style="font:700 18px Arial,sans-serif;color:#1F4E79">Orden del día</td></tr>
    <tr><td style="padding:4px 0 12px;font:13px Arial,sans-serif;color:#5A6879">${fmt(hoy)} · Control de Campañas LinkedIn</td></tr>
    <tr><td style="font:15px Arial,sans-serif;color:#15202C">Buenos días, ${esc(primerNombre)}. ${intro}</td></tr>
    ${bloques}
    ${url ? `<tr><td style="padding-top:18px"><a href="${esc(url)}" style="display:inline-block;background:#1F4E79;color:#FFFFFF;text-decoration:none;font:700 14px Arial,sans-serif;padding:10px 16px;border-radius:8px">Actualizar mis actividades</a></td></tr>` : ''}
  </table></td></tr></table></body></html>`;

  const text = [
    `Buenos días, ${primerNombre}. ${total ? `Tienes ${total} ${total === 1 ? 'actividad abierta' : 'actividades abiertas'} para hoy.` : 'No tienes actividades abiertas para hoy.'}`,
    ...grupos.map(([k, lista]) => `\n${TITULOS_ORDEN[k].toUpperCase()} (${lista.length})\n` +
      lista.map((t) => `- ${t.titulo} · ${nombreEmp(t.empresaId)} · ${fmt(t.fecha)} · ${rel(t, hoy)}${t.prioridad === 'Alta' ? ' · Prioridad alta' : ''}`).join('\n')),
    url ? `\nActualiza tus actividades: ${url}` : '',
  ].join('\n');

  return { para: per.email, asunto, html, text, total };
}

/** Envía la orden del día a todo el personal activo con correo (o solo a una persona). */
export async function enviarOrdenes(env, { soloPersonaId = null, origen = 'cron' } = {}) {
  const est = await cargarEstado(env);
  const hoy = hoyCDMX();
  const activos = est.personal.filter((p) => p.activo && (!soloPersonaId || p.id === soloPersonaId));
  const sinCorreo = activos.filter((p) => !p.email).map((p) => p.nombre);
  const mensajes = activos.filter((p) => p.email).map((p) => {
    const c = correoOrden(est, p, hoy, env);
    return { to: { email: p.email, name: p.nombre }, subject: c.asunto, html: c.html, text: c.text };
  });
  const r = await enviarCorreos(env, mensajes);
  const nota = [
    r.error ? `No se envió: ${r.error}` : '',
    sinCorreo.length ? `Sin correo: ${sinCorreo.join(', ')}` : '',
    r.fallidos.length ? `Fallidos: ${r.fallidos.join(', ')}` : '',
    r.copia && !r.copia.ok ? `Sin copia en Enviados: ${r.copia.detalle}` : '',
    origen === 'manual' ? 'Envío manual' : '',
  ].filter(Boolean).join(' · ');
  const res = { fecha: hoy, hora: horaCDMX(), origen, enviados: r.enviados, fallidos: r.error ? mensajes.length : r.fallidos.length, nota: nota.slice(0, 1000) };
  await registrarEnvio(env, res);
  return res;
}
