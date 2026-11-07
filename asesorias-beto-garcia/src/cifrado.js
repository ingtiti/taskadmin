// Cifrado AES-GCM de los secretos guardados en D1 (contraseñas, client secrets, refresh token).
// La clave vive solo en el secreto CLAVE_CIFRADO del Worker y los valores nunca se devuelven al navegador.
import { HttpError } from './errores.js';

export const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64Texto = (txt) => toB64(new TextEncoder().encode(txt));

async function clave(env) {
  if (!env.CLAVE_CIFRADO) throw new HttpError(500, 'Falta el secreto CLAVE_CIFRADO en Cloudflare (paso 4 del README).');
  let raw;
  try { raw = fromB64(env.CLAVE_CIFRADO.trim()); } catch { raw = null; }
  if (!raw || raw.length !== 32) throw new HttpError(500, 'CLAVE_CIFRADO debe ser una clave de 32 bytes en base64 (openssl rand -base64 32).');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function cifrar(env, txt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await clave(env), new TextEncoder().encode(txt)));
  return toB64(iv) + '.' + toB64(ct);
}

export async function descifrar(env, s) {
  if (!s) return '';
  const [iv, ct] = s.split('.');
  const k = await clave(env);
  try {
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, k, fromB64(ct)));
  } catch {
    throw new HttpError(500, 'No se pudo leer un secreto guardado (¿cambió CLAVE_CIFRADO?). Vuelve a capturarlo en Configuración.');
  }
}
