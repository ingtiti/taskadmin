// Plan de trabajo de la propuesta (6 meses). Cada fila: [actividad, día de inicio, día compromiso, perfiles, prioridad],
// con los días contados desde la fecha de arranque de la empresa.

const PM = 'Project manager', CM = 'Community manager', DG = 'Diseñador gráfico', TM = 'Telemarketer', AD = 'Analista de datos';

export function planBase() {
  const L = [
    ['Kickoff con el cliente: producto, objetivos y beneficio a ofrecer', 0, 2, [PM], 'Alta'],
    ['Definir criterios de calificación de contactos (A, B, C)', 1, 3, [PM, TM], 'Media'],
    ['Confirmar persona autorizada para aprobar contenidos', 0, 3, [PM], 'Alta'],
    ['Recibir accesos al perfil y confirmar autorización para campañas', 0, 4, [PM, CM], 'Alta'],
    ['Profesionalización del perfil de LinkedIn', 2, 7, [CM, DG], 'Alta'],
    ['Activar Sales Navigator y armar las primeras listas de prospectos', 3, 10, [AD], 'Media'],
    ['Calendario editorial del mes 1', 3, 8, [CM], 'Alta'],
    ['Diseño de piezas del mes 1', 5, 11, [DG], 'Alta'],
    ['Configurar campañas y formulario de captura en LinkedIn', 8, 13, [CM], 'Media'],
    ['Aprobación del contenido del mes 1 (máximo 2 días)', 11, 13, [PM], 'Alta'],
    ['Programar publicaciones del mes 1', 13, 14, [CM], 'Media'],
  ];
  for (let m = 1; m <= 6; m++) {
    const ini = m === 1 ? 14 : (m - 1) * 30, fin = m * 30;
    L.push([`Captura y calificación de contactos · mes ${m}`, ini, fin, [TM, CM], 'Media']);
    L.push([`Prospección con Sales Navigator y fuentes públicas · mes ${m}`, ini, fin, [AD], 'Media']);
    L.push([`Reporte mensual de resultados · mes ${m}`, fin - 2, fin + 2, [PM, AD], 'Media']);
    if (m < 6) {
      L.push([`Calendario y piezas del mes ${m + 1}`, fin - 14, fin - 5, [CM, DG], 'Media']);
      L.push([`Aprobación del contenido del mes ${m + 1} (máximo 2 días)`, fin - 5, fin - 3, [PM], 'Media']);
      L.push([`Programar publicaciones del mes ${m + 1}`, fin - 3, fin - 1, [CM], 'Media']);
    }
  }
  return L;
}

/** Personas activas de la empresa con alguno de esos perfiles; si no hay, los líderes globales. */
export function asignar(personal, perfiles, empresaId) {
  const act = personal.filter((p) => p.activo && (!p.empresas.length || p.empresas.includes(empresaId)));
  const r = act.filter((p) => perfiles.includes(p.perfil)).map((p) => p.id);
  return r.length ? r : act.filter((p) => p.lider).map((p) => p.id);
}
