// Panel de administración: publicar espacios, ver/cancelar reservas y configurar correo y calendarios.
import { api, esc, claveDia, hora, fechaDeClave, hoyEn, cuadriculaMes, nombreMes } from './comun.js';

const $ = (id) => document.getElementById(id);
const st = { zona: 'America/Mexico_City', anio: 0, mes: 0, horas: new Set(['09:00', '10:00', '11:00', '12:00', '16:00', '17:00']), cfg: null, reservas: [] };
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function aviso(html, tipo = 'ok') {
  const m = $('mensaje');
  m.className = `aviso ${tipo}`;
  m.innerHTML = html;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  clearTimeout(aviso.t);
  if (tipo === 'ok') aviso.t = setTimeout(() => m.classList.add('oculto'), 8000);
}
const mayus = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ── Pestañas ─────────────────────────────────────────────
function abrirTab(nombre) {
  document.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === nombre)));
  document.querySelectorAll('[role=tabpanel]').forEach((p) => p.classList.toggle('oculto', p.id !== `tab-${nombre}`));
  history.replaceState(null, '', `${location.pathname}${location.search}#${nombre}`);
  if (nombre === 'reservas') cargarReservas();
  if (nombre === 'configuracion') cargarConfig();
  if (nombre === 'historial') cargarHistorial();
}

// ── Publicar espacios ────────────────────────────────────
function pintarSelectores() {
  $('e-dias').innerHTML = DIAS.map((d, i) => `<label><input type="checkbox" value="${(i + 1) % 7}" ${i < 5 ? 'checked' : ''}><span>${d}</span></label>`).join('');
  pintarHoras();
}
function pintarHoras() {
  const base = new Set(Array.from({ length: 15 }, (_, i) => `${String(i + 7).padStart(2, '0')}:00`));
  st.horas.forEach((h) => base.add(h));
  $('e-horas').innerHTML = [...base].sort().map((h) => `<label><input type="checkbox" value="${h}" ${st.horas.has(h) ? 'checked' : ''}><span>${h}</span></label>`).join('');
  contar();
}
function inicios() {
  const desde = $('e-desde').value, hasta = $('e-hasta').value;
  if (!desde || !hasta || hasta < desde) return [];
  const dias = new Set([...$('e-dias').querySelectorAll('input:checked')].map((i) => Number(i.value)));
  const horas = [...$('e-horas').querySelectorAll('input:checked')].map((i) => i.value);
  const out = [];
  for (let d = new Date(desde + 'T12:00:00Z'); d.toISOString().slice(0, 10) <= hasta && out.length <= 600; d.setUTCDate(d.getUTCDate() + 1)) {
    if (!dias.has(d.getUTCDay())) continue;
    for (const h of horas) out.push(`${d.toISOString().slice(0, 10)}T${h}`);
  }
  return out;
}
function contar() {
  const n = inicios().length;
  $('e-conteo').textContent = n ? `Se publicarán hasta ${n} espacio${n > 1 ? 's' : ''} de 1 hora.` : 'Elige fechas, días y horas.';
  $('e-publicar').disabled = !n || n > 500;
  if (n > 500) $('e-conteo').textContent = `Son ${n} espacios; el máximo por operación es 500. Reduce el rango.`;
}
async function publicar(ev) {
  ev.preventDefault();
  const lista = inicios();
  if (!lista.length) return;
  $('e-publicar').disabled = true;
  try {
    const r = await api('/api/admin/espacios', { method: 'POST', body: { inicios: lista } });
    const extra = [r.repetidos ? `${r.repetidos} ya existían o se traslapaban` : '', r.invalidos ? `${r.invalidos} eran de hoy o ya pasaron` : ''].filter(Boolean).join(' y ');
    aviso(`Se publicaron <strong>${r.creados}</strong> espacios.${extra ? ` (${extra}, se omitieron).` : ''}`);
    const [a, m] = $('e-desde').value.split('-').map(Number);
    st.anio = a; st.mes = m - 1;
    cargarEspacios();
  } catch (e) { aviso(esc(e.message), 'error'); }
  contar();
}

// ── Espacios publicados (vista por mes) ──────────────────
async function cargarEspacios() {
  const dias = cuadriculaMes(st.anio, st.mes).filter((d) => !d.fuera);
  $('a-titulo-mes').textContent = mayus(nombreMes(st.anio, st.mes));
  $('a-lista').innerHTML = '<p class="vacio">Cargando…</p>';
  try {
    const { espacios } = await api(`/api/admin/espacios?desde=${dias[0].clave}&hasta=${dias[dias.length - 1].clave}`);
    if (!espacios.length) { $('a-lista').innerHTML = '<p class="vacio">No hay espacios publicados este mes.</p>'; return; }
    const grupos = new Map();
    for (const e of espacios) { const k = claveDia(e.inicio, st.zona); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(e); }
    const ahora = Date.now();
    $('a-lista').innerHTML = [...grupos].map(([k, l]) => `<div class="lista-dia"><h4>${esc(fechaDeClave(k))}</h4>${l.map((e) => {
      const pasado = Date.parse(e.fin) < ahora;
      return `<div class="renglon">
        <span class="hora">${hora(e.inicio, st.zona)} – ${hora(e.fin, st.zona)}</span>
        <span class="etiqueta ${e.estado}">${e.estado === 'disponible' ? 'Disponible' : 'Ocupado'}</span>
        <span class="quien">${e.nombre ? `${esc(e.nombre)} · <a href="mailto:${esc(e.email)}">${esc(e.email)}</a>` : pasado ? 'Ya pasó' : ''}</span>
        ${e.reserva_id ? `<button class="btn chico peligro" data-cancelar="${e.reserva_id}">Cancelar cita</button>` : `<button class="btn chico" data-borrar="${e.id}" ${pasado ? 'disabled' : ''}>Eliminar</button>`}
      </div>`;
    }).join('')}</div>`).join('');
  } catch (e) { $('a-lista').innerHTML = `<div class="aviso error">${esc(e.message)}</div>`; }
}
async function borrarEspacio(id, boton) {
  if (!confirm('¿Eliminar este espacio? Dejará de verse en el calendario público.')) return;
  boton.disabled = true;
  try { await api(`/api/admin/espacios/${id}`, { method: 'DELETE' }); cargarEspacios(); }
  catch (e) { aviso(esc(e.message), 'error'); boton.disabled = false; }
}
function moverMes(d) {
  const f = new Date(Date.UTC(st.anio, st.mes + d, 1));
  st.anio = f.getUTCFullYear(); st.mes = f.getUTCMonth();
  cargarEspacios();
}

// ── Reservas ─────────────────────────────────────────────
const marca = (valor, texto, info) => {
  const clase = valor === null || valor === undefined ? 'na' : valor ? 'bien' : 'mal';
  const signo = clase === 'bien' ? '✓' : clase === 'mal' ? '✕' : '–';
  return `<span class="etiqueta ${clase}" title="${esc(info || '')}">${signo} ${texto}</span>`;
};
async function cargarReservas() {
  const filtro = $('r-filtro').value;
  $('r-lista').innerHTML = '<p class="vacio">Cargando…</p>';
  try {
    const { reservas } = await api(`/api/admin/reservas?filtro=${filtro}`);
    st.reservas = reservas;
    if (!reservas.length) { $('r-lista').innerHTML = '<p class="vacio">No hay reservas en esta vista.</p>'; return; }
    $('r-lista').innerHTML = reservas.map((r) => {
      const err = r.integraciones || {};
      const fallas = Object.keys(err).length;
      return `<div class="lista-dia"><h4>${esc(mayus(fechaDeClave(claveDia(r.inicio, st.zona))))} · ${hora(r.inicio, st.zona)} – ${hora(r.fin, st.zona)} h</h4>
      <div class="renglon">
        <span class="quien"><strong style="color:var(--texto)">${esc(r.nombre)}</strong><br><a href="mailto:${esc(r.email)}">${esc(r.email)}</a>${r.enlace_reunion ? ` · <a href="${esc(r.enlace_reunion)}" target="_blank" rel="noopener">${/meet\.google\.com/.test(r.enlace_reunion) ? 'Google Meet' : /teams\.microsoft/.test(r.enlace_reunion) ? 'Microsoft Teams' : 'Videollamada'}</a>` : ''}</span>
        ${r.estado === 'confirmada' ? `<span class="estado-int">
          ${marca(r.correo_asesorado === null ? null : r.correo_asesorado === 1, 'Correo asesorado', err.correo_asesorado)}
          ${marca(r.correo_admin === null ? null : r.correo_admin === 1, 'Correo para ti', err.correo_admin)}
          ${marca(r.en_exchange ? true : err.exchange ? false : null, 'Exchange', err.exchange)}
          ${marca(r.en_google ? true : err.google ? false : null, 'Google', err.google)}
        </span>` : `<span class="etiqueta na">Cancelada ${esc((r.cancelada || '').slice(0, 16))} UTC</span>`}
        ${r.estado === 'confirmada' && (fallas || r.correo_asesorado === null) ? `<button class="btn chico" data-reintentar="${r.id}">Reintentar</button>` : ''}
        ${r.estado === 'confirmada' && filtro === 'proximas' ? `<button class="btn chico peligro" data-cancelar="${r.id}">Cancelar</button>` : ''}
      </div>
      ${fallas ? `<div class="renglon" style="color:var(--alerta);font-size:.85rem">${Object.entries(err).map(([k, v]) => `<div><strong>${esc(k)}:</strong> ${esc(v)}</div>`).join('')}</div>` : ''}
      </div>`;
    }).join('');
  } catch (e) { $('r-lista').innerHTML = `<div class="aviso error">${esc(e.message)}</div>`; }
}
async function reintentar(id, boton) {
  boton.disabled = true; boton.textContent = 'Reintentando…';
  try {
    const r = await api(`/api/admin/reservas/${id}/reintentar`, { method: 'POST', body: {} });
    aviso(r.ok ? 'Todo quedó correcto.' : 'Algunos pasos siguen fallando; revisa el detalle.', r.ok ? 'ok' : 'alerta');
  } catch (e) { aviso(esc(e.message), 'error'); }
  cargarReservas();
}
let cancelarId = null;
async function abrirCancelar(id) {
  cancelarId = id;
  let r = st.reservas.find((x) => x.id === id);
  if (!r) { try { r = (await api('/api/admin/reservas?filtro=proximas')).reservas.find((x) => x.id === id); } catch {} }
  $('dc-resumen').innerHTML = r ? `<strong>${esc(r.nombre)}</strong> · ${esc(r.email)}<br>${esc(mayus(fechaDeClave(claveDia(r.inicio, st.zona))))}, ${hora(r.inicio, st.zona)} h` : `Reserva #${id}`;
  $('dlg-cancelar').showModal();
}
async function confirmarCancelar(ev) {
  ev.preventDefault();
  $('dc-confirmar').disabled = true;
  try {
    const r = await api(`/api/admin/reservas/${cancelarId}/cancelar`, { method: 'POST', body: { liberar: $('dc-liberar').checked, avisar: $('dc-avisar').checked } });
    $('dlg-cancelar').close();
    aviso(`Reserva cancelada.${r.avisos?.length ? ` Avisos: ${r.avisos.map(esc).join(' · ')}` : ''}`, r.avisos?.length ? 'alerta' : 'ok');
    cargarReservas(); cargarEspacios();
  } catch (e) { aviso(esc(e.message), 'error'); }
  $('dc-confirmar').disabled = false;
}

// ── Configuración ────────────────────────────────────────
const CAMPOS = ['nombreRemitente', 'emailAdmin', 'lugar', 'mensajeExtra', 'graphTenant', 'graphClientId', 'graphBuzon', 'smtpHost', 'smtpPuerto', 'smtpSeguridad', 'smtpUsuario', 'smtpEmail', 'googleClientId', 'googleCalendario'];
const CHECKS = ['exchangeCalendario', 'googleActivo'];
const SECRETOS = { graphSecreto: 'graphTieneSecreto', smtpPassword: 'smtpTienePassword', googleSecreto: 'googleTieneSecreto' };

function modoVisible() {
  const smtp = $('c-modo-smtp').checked;
  $('c-sec-smtp').classList.toggle('oculto', !smtp);
}
async function cargarConfig() {
  try {
    const { config: c, retornoGoogle, tieneClave } = await api('/api/admin/configuracion');
    st.cfg = c;
    $('c-sin-clave').classList.toggle('oculto', tieneClave);
    CAMPOS.forEach((k) => { $(`c-${k}`).value = c[k] ?? ''; });
    CHECKS.forEach((k) => { $(`c-${k}`).checked = !!c[k]; });
    Object.entries(SECRETOS).forEach(([k, tiene]) => {
      $(`c-${k}`).value = '';
      $(`c-${k}`).placeholder = c[tiene] ? '•••••••• (guardado)' : '';
      $(`c-${k}-estado`).textContent = c[tiene] ? 'Guardado. Escribe uno nuevo solo si quieres reemplazarlo.' : 'Sin capturar.';
    });
    $(c.modoCorreo === 'smtp' ? 'c-modo-smtp' : 'c-modo-graph').checked = true;
    $(`c-reunion-${c.reunion || 'meet'}`).checked = true;
    $('c-aviso-meet').classList.toggle('oculto', !(c.reunion === 'meet' && !c.googleConectado));
    modoVisible();
    $('c-retorno').textContent = retornoGoogle;
    $('c-google-estado').className = `etiqueta ${c.googleConectado ? 'bien' : 'na'}`;
    $('c-google-estado').textContent = c.googleConectado ? `Conectado: ${c.googleCuenta || 'cuenta de Google'}` : 'Sin conectar';
    $('c-google-desconectar').classList.toggle('oculto', !c.googleConectado);
    $('c-google-conectar').textContent = c.googleConectado ? 'Reconectar' : 'Conectar con Google';
    $('c-ultima').textContent = c.ultimaPrueba ? `Última prueba (${c.ultimaPrueba} UTC): ${c.ultimaPruebaDetalle}` : '';
  } catch (e) { aviso(esc(e.message), 'error'); }
}
async function guardarConfig() {
  const b = { modoCorreo: $('c-modo-smtp').checked ? 'smtp' : 'graph', reunion: document.querySelector('input[name=reunion]:checked')?.value || 'meet' };
  CAMPOS.forEach((k) => { b[k] = $(`c-${k}`).value; });
  CHECKS.forEach((k) => { b[k] = $(`c-${k}`).checked; });
  Object.keys(SECRETOS).forEach((k) => { b[k] = $(`c-${k}`).value; });
  b.smtpPuerto = Number(b.smtpPuerto || 587);
  await api('/api/admin/configuracion', { method: 'PUT', body: b });
  await cargarConfig();
}
async function probar(enviar, boton) {
  const texto = boton.textContent;
  boton.disabled = true; boton.textContent = 'Probando…';
  const res = $('c-resultado');
  try {
    await guardarConfig();
    const r = await api('/api/admin/configuracion/probar', { method: 'POST', body: { enviar } });
    const nombres = { correo: 'Correo', exchange: 'Calendario de Exchange', google: 'Google Calendar', envio: 'Correo de prueba' };
    const todoOk = Object.values(r).every((x) => x.ok);
    res.className = `aviso ${todoOk ? 'ok' : 'error'}`;
    res.innerHTML = `<ul class="resultado-prueba" style="margin:0;padding-left:18px">${Object.entries(r).map(([k, v]) => `<li><strong>${nombres[k] || k}:</strong> ${v.ok ? '✓ ' : '✕ '}${esc(v.detalle)}</li>`).join('')}</ul>`;
    cargarConfig();
  } catch (e) { res.className = 'aviso error'; res.textContent = e.message; }
  boton.disabled = false; boton.textContent = texto;
}

// ── Historial ────────────────────────────────────────────
async function cargarHistorial() {
  try {
    const { historial } = await api('/api/admin/historial');
    $('h-lista').innerHTML = historial.length ? historial.map((h) => `<tr><td>${esc(h.fecha)}</td><td>${esc(h.quien)}</td><td>${esc(h.accion)}</td><td>${esc(h.detalle || '')}</td></tr>`).join('') : '<tr><td colspan="4" class="vacio">Sin movimientos.</td></tr>';
  } catch (e) { $('h-lista').innerHTML = `<tr><td colspan="4">${esc(e.message)}</td></tr>`; }
}

// ── Inicio ───────────────────────────────────────────────
async function iniciar() {
  try {
    const yo = await api('/api/admin/yo');
    st.zona = yo.zona;
    $('yo').textContent = yo.email;
  } catch (e) {
    document.querySelector('main .contenedor').innerHTML = `<div class="aviso error"><strong>Sin acceso.</strong> ${esc(e.message)}</div>`;
    return;
  }
  const hoy = hoyEn(st.zona);
  const [a, m] = hoy.split('-').map(Number);
  st.anio = a; st.mes = m - 1;
  // Las citas solo se pueden reservar de mañana en adelante, así que se publica desde mañana.
  const man = new Date(hoy + 'T12:00:00Z'); man.setUTCDate(man.getUTCDate() + 1);
  const manana = man.toISOString().slice(0, 10);
  $('e-desde').value = manana;
  $('e-desde').min = manana;
  const fin = new Date(manana + 'T12:00:00Z'); fin.setUTCDate(fin.getUTCDate() + 13);
  $('e-hasta').value = fin.toISOString().slice(0, 10);
  $('e-hasta').min = manana;
  pintarSelectores();

  document.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => abrirTab(b.dataset.tab)));
  $('form-espacios').addEventListener('input', contar);
  $('form-espacios').addEventListener('change', (ev) => {
    if (ev.target.closest('#e-horas')) ev.target.checked ? st.horas.add(ev.target.value) : st.horas.delete(ev.target.value);
    contar();
  });
  $('form-espacios').addEventListener('submit', publicar);
  $('e-agregar-hora').addEventListener('click', () => {
    const m = /^(\d{1,2}):(\d{2})$/.exec($('e-hora-extra').value.trim());
    if (!m || +m[1] > 23 || !['00', '15', '30', '45'].includes(m[2])) return aviso('Escribe la hora como HH:MM en múltiplos de 15 minutos (ej. 16:30).', 'error');
    st.horas.add(`${m[1].padStart(2, '0')}:${m[2]}`);
    $('e-hora-extra').value = '';
    pintarHoras();
  });
  $('a-mes-ant').addEventListener('click', () => moverMes(-1));
  $('a-mes-sig').addEventListener('click', () => moverMes(1));
  document.body.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-borrar],[data-cancelar],[data-reintentar],[data-cerrar]');
    if (!b) return;
    if (b.dataset.borrar) borrarEspacio(Number(b.dataset.borrar), b);
    else if (b.dataset.cancelar) abrirCancelar(Number(b.dataset.cancelar));
    else if (b.dataset.reintentar) reintentar(Number(b.dataset.reintentar), b);
    else b.closest('dialog')?.close();
  });
  $('form-cancelar').addEventListener('submit', confirmarCancelar);
  $('r-filtro').addEventListener('change', cargarReservas);
  $('c-modo-graph').addEventListener('change', modoVisible);
  $('c-modo-smtp').addEventListener('change', modoVisible);
  $('form-cfg').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await guardarConfig(); aviso('Configuración guardada.'); } catch (e) { aviso(esc(e.message), 'error'); }
  });
  $('c-probar').addEventListener('click', (ev) => probar(false, ev.currentTarget));
  $('c-enviar-prueba').addEventListener('click', (ev) => probar(true, ev.currentTarget));
  $('c-google-conectar').addEventListener('click', (ev) => {
    if (!st.cfg?.googleClientId || !st.cfg?.googleTieneSecreto) { ev.preventDefault(); aviso('Captura y guarda primero el Client ID y el Client secret de Google.', 'error'); }
  });
  $('c-google-desconectar').addEventListener('click', async () => {
    if (!confirm('¿Desconectar Google Calendar? Las nuevas citas dejarán de replicarse.')) return;
    try { await api('/api/admin/google/desconectar', { method: 'POST', body: {} }); cargarConfig(); } catch (e) { aviso(esc(e.message), 'error'); }
  });

  // Resultado del regreso desde Google (OAuth).
  const q = new URLSearchParams(location.search);
  if (q.get('google')) {
    const g = q.get('google');
    const textos = { ok: `Google Calendar conectado${q.get('cuenta') ? ` con <strong>${esc(q.get('cuenta'))}</strong>` : ''}.`, cancelado: 'Cancelaste la conexión con Google.', estado: 'La conexión con Google expiró; vuelve a intentarlo.', error: `No se pudo conectar Google: ${esc(q.get('detalle') || '')}` };
    aviso(textos[g] || 'Respuesta desconocida de Google.', g === 'ok' ? 'ok' : 'error');
    history.replaceState(null, '', `${location.pathname}#configuracion`);
  }
  cargarEspacios();
  abrirTab(['espacios', 'reservas', 'configuracion', 'historial'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'espacios');
}

iniciar();
