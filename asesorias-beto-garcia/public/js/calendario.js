// Calendario público: muestra los espacios Disponibles/Ocupados y abre el formulario de reserva.
import { api, esc, claveDia, hora, fechaDeClave, nombreZona, hoyEn, cuadriculaMes, nombreMes } from './comun.js';

const $ = (id) => document.getElementById(id);
const estado = { zona: 'America/Mexico_City', anio: 0, mes: 0, porDia: new Map(), diaSel: null, espacioSel: null, turnstile: '', widget: null, hoy: '' };

function aviso(texto, tipo = 'ok') {
  const m = $('mensaje');
  m.className = `aviso ${tipo}`;
  m.innerHTML = texto;
  m.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function cargarMes() {
  const dias = cuadriculaMes(estado.anio, estado.mes);
  const mes = nombreMes(estado.anio, estado.mes);
  $('titulo-mes').textContent = mes.charAt(0).toUpperCase() + mes.slice(1);
  const desde = dias[0].clave, hasta = dias[dias.length - 1].clave;
  $('mes').setAttribute('aria-busy', 'true');
  try {
    const { espacios } = await api(`/api/publico/espacios?desde=${desde}&hasta=${hasta}`);
    estado.porDia = new Map();
    for (const e of espacios) {
      const k = claveDia(e.inicio, estado.zona);
      if (!estado.porDia.has(k)) estado.porDia.set(k, []);
      estado.porDia.get(k).push(e);
    }
  } catch (e) {
    aviso(`No se pudo cargar el calendario: ${esc(e.message)}`, 'error');
  }
  $('mes').removeAttribute('aria-busy');
  pintarMes(dias);
  if (estado.diaSel) pintarDia(estado.diaSel);
}

function pintarMes(dias) {
  $('mes').innerHTML = dias.map((d) => {
    if (d.fuera) return '<div class="dia fuera" aria-hidden="true"></div>';
    const lista = estado.porDia.get(d.clave) || [];
    const disp = lista.filter((e) => e.estado === 'disponible').length;
    const ocup = lista.length - disp;
    const pasado = d.clave < estado.hoy;
    const clases = ['dia', pasado ? 'pasado' : '', d.clave === estado.hoy ? 'hoy' : '', disp && !pasado ? 'con-disp' : '', !disp && ocup && !pasado ? 'solo-ocup' : '', d.clave === estado.diaSel ? 'sel' : ''].join(' ');
    const marca = pasado ? '' : disp ? `${disp} disponible${disp > 1 ? 's' : ''}` : ocup ? 'Ocupado' : '';
    const clic = lista.length && !pasado;
    const etiqueta = `${fechaDeClave(d.clave)}${marca ? ', ' + marca : ''}`;
    return `<button type="button" class="${clases}" data-dia="${d.clave}" ${clic ? '' : 'disabled'} aria-label="${esc(etiqueta)}" role="gridcell">
      <span class="num">${d.num}</span><span class="marca">${marca}</span></button>`;
  }).join('');
}

function pintarDia(clave) {
  estado.diaSel = clave;
  document.querySelectorAll('.dia.sel').forEach((b) => b.classList.remove('sel'));
  document.querySelector(`.dia[data-dia="${clave}"]`)?.classList.add('sel');
  $('titulo-dia').textContent = fechaDeClave(clave);
  const lista = estado.porDia.get(clave) || [];
  if (!lista.length) { $('horarios').innerHTML = '<p class="vacio">No hay horarios publicados para este día.</p>'; return; }
  $('horarios').innerHTML = `<div class="chips">${lista.map((e) => {
    const rango = `${hora(e.inicio, estado.zona)} – ${hora(e.fin, estado.zona)}`;
    const texto = e.estado === 'disponible' ? 'Disponible' : e.estado === 'ocupado' ? 'Ocupado' : 'No disponible';
    return `<button type="button" class="chip ${e.estado}" data-id="${e.id}" ${e.estado === 'disponible' ? '' : 'disabled'} aria-label="${rango}, ${texto}">
      <strong>${rango}</strong><small>${texto}</small></button>`;
  }).join('')}</div>`;
}

function abrirFormulario(id) {
  const e = (estado.porDia.get(estado.diaSel) || []).find((x) => x.id === id);
  if (!e || e.estado !== 'disponible') return;
  estado.espacioSel = e;
  $('f-fecha').value = fechaDeClave(estado.diaSel).replace(/^./, (c) => c.toUpperCase());
  $('f-hora').value = `${hora(e.inicio, estado.zona)} a ${hora(e.fin, estado.zona)} h`;
  $('f-error').classList.add('oculto');
  $('enviar').disabled = false;
  $('enviar').textContent = 'Confirmar reserva';
  $('dlg').showModal();
  if (estado.turnstile && window.turnstile) {
    if (estado.widget !== null) window.turnstile.reset(estado.widget);
    else estado.widget = window.turnstile.render('#turnstile', { sitekey: estado.turnstile, language: 'es' });
  }
  setTimeout(() => $('f-nombre').focus(), 50);
}

function errorForm(msg) { const el = $('f-error'); el.textContent = msg; el.classList.remove('oculto'); }

async function enviar(ev) {
  ev.preventDefault();
  const nombre = $('f-nombre').value.trim().replace(/\s+/g, ' ');
  const email = $('f-email').value.trim();
  if (nombre.length < 5 || !nombre.includes(' ')) return errorForm('Escribe tu nombre completo (nombre y apellido).');
  if (!$('f-email').checkValidity() || !email) return errorForm('Escribe un correo electrónico válido.');
  const token = estado.turnstile && window.turnstile ? window.turnstile.getResponse(estado.widget) : '';
  if (estado.turnstile && !token) return errorForm('Confirma que no eres un robot.');
  $('enviar').disabled = true;
  $('enviar').textContent = 'Reservando…';
  try {
    const { reserva } = await api('/api/publico/reservas', { method: 'POST', body: { espacioId: estado.espacioSel.id, nombre, email, turnstile: token } });
    const fecha = $('f-fecha').value.replace(/^./, (c) => c.toLowerCase());
    $('dlg').close();
    $('form').reset();
    aviso(`<strong>¡Listo, ${esc(nombre.split(' ')[0])}!</strong> Tu asesoría quedó reservada para el ${esc(fecha)} de ${esc(hora(reserva.inicio, estado.zona))} a ${esc(hora(reserva.fin, estado.zona))} h. En unos minutos recibirás la confirmación en <strong>${esc(email)}</strong> (revisa también tu carpeta de spam).`);
    await cargarMes();
  } catch (e) {
    errorForm(e.message);
    $('enviar').disabled = false;
    $('enviar').textContent = 'Confirmar reserva';
    if (e.status === 409) cargarMes();
    if (estado.widget !== null && window.turnstile) window.turnstile.reset(estado.widget);
  }
}

function moverMes(delta) {
  const d = new Date(Date.UTC(estado.anio, estado.mes + delta, 1));
  estado.anio = d.getUTCFullYear(); estado.mes = d.getUTCMonth();
  estado.diaSel = null;
  $('titulo-dia').textContent = 'Elige un día';
  $('horarios').innerHTML = '<p class="vacio">Selecciona en el calendario un día marcado en verde para ver los horarios disponibles.</p>';
  cargarMes();
}

async function iniciar() {
  try {
    const cfg = await api('/api/publico/config');
    estado.zona = cfg.zona; estado.turnstile = cfg.turnstile;
    if (cfg.turnstile) {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; document.head.appendChild(s);
    }
  } catch {}
  estado.hoy = hoyEn(estado.zona);
  const [a, m] = estado.hoy.split('-').map(Number);
  estado.anio = a; estado.mes = m - 1;
  $('zona').textContent = `Horarios en ${nombreZona(estado.zona)}. Cada sesión dura 1 hora.`;

  $('mes-ant').addEventListener('click', () => moverMes(-1));
  $('mes-sig').addEventListener('click', () => moverMes(1));
  $('mes').addEventListener('click', (ev) => { const b = ev.target.closest('.dia[data-dia]'); if (b && !b.disabled) pintarDia(b.dataset.dia); });
  $('horarios').addEventListener('click', (ev) => { const b = ev.target.closest('.chip.disponible'); if (b) abrirFormulario(Number(b.dataset.id)); });
  $('form').addEventListener('submit', enviar);
  $('cerrar').addEventListener('click', () => $('dlg').close());
  $('cancelar').addEventListener('click', () => $('dlg').close());
  await cargarMes();
  // Abre el primer día con espacios disponibles del mes para que se vea algo de inmediato.
  const primero = [...estado.porDia.entries()].find(([k, l]) => k >= estado.hoy && l.some((e) => e.estado === 'disponible'));
  if (primero) pintarDia(primero[0]);
  // Refresca cada minuto para reflejar espacios que otros acaban de ocupar.
  setInterval(() => { if (!$('dlg').open && document.visibilityState === 'visible') cargarMes(); }, 60_000);
}

iniciar();
