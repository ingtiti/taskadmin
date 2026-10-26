// Verifica el token que Cloudflare Access agrega a cada petición (encabezado Cf-Access-Jwt-Assertion).
// Sin un token válido, la API responde 401 aunque alguien llegue al Worker por otra ruta.
import { HttpError } from './errores.js';

let cache = { keys: null, at: 0 };

const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const leerJson = (s) => JSON.parse(new TextDecoder().decode(b64u(s)));

async function llaves(team, forzar = false) {
  if (!forzar && cache.keys && Date.now() - cache.at < 3600_000) return cache.keys;
  const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new HttpError(503, 'No se pudo validar la sesión. Intenta de nuevo.');
  cache = { keys: (await r.json()).keys || [], at: Date.now() };
  return cache.keys;
}

/** Devuelve el correo (en minúsculas) de quien hace la petición. */
export async function verificarAcceso(req, env) {
  // Solo para desarrollo local: ENTORNO y DEV_USER_EMAIL viven en .dev.vars, que nunca se sube ni se publica.
  // No los configures como variables o secretos en Cloudflare.
  if (env.ENTORNO === 'desarrollo' && env.DEV_USER_EMAIL) return env.DEV_USER_EMAIL.toLowerCase();

  const team = env.ACCESS_TEAM_DOMAIN;
  const aud = env.ACCESS_AUD;
  const token = req.headers.get('cf-access-jwt-assertion');
  if (!token || !team || !aud || team.includes('REEMPLAZAR') || aud.includes('REEMPLAZAR')) {
    throw new HttpError(401, 'Acceso no autorizado.');
  }
  const partes = token.split('.');
  if (partes.length !== 3) throw new HttpError(401, 'Sesión inválida.');
  const [h, p, s] = partes;
  let header, payload;
  try { header = leerJson(h); payload = leerJson(p); } catch { throw new HttpError(401, 'Sesión inválida.'); }
  if (header.alg !== 'RS256') throw new HttpError(401, 'Sesión inválida.');

  let jwk = (await llaves(team)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await llaves(team, true)).find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'Sesión inválida.');

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(`${h}.${p}`));
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const ahora = Date.now() / 1000;
  if (!ok || !auds.includes(aud) || payload.iss !== `https://${team}` || !(payload.exp > ahora) || (payload.nbf && payload.nbf > ahora + 60) || !payload.email) {
    throw new HttpError(401, 'Tu sesión expiró. Recarga la página.');
  }
  return String(payload.email).toLowerCase();
}
