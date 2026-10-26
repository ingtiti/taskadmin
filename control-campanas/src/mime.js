// Arma el mensaje completo (RFC 5322 / MIME) para guardar la copia en la carpeta de Enviados vía IMAP.

const enc = new TextEncoder();

function b64(s) {
  const bytes = enc.encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const palabra = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);
const direccion = (a) => (a.name ? `${/^[\x20-\x7e]*$/.test(a.name) ? '"' + a.name.replace(/["\\]/g, '') + '"' : palabra(a.name)} <${a.email}>` : a.email);
const lineas = (s) => b64(s).replace(/.{1,76}/g, '$&\r\n');

export function construirMensaje({ from, to, subject, text, html, fecha = new Date() }) {
  const limite = '=_cc_' + crypto.randomUUID().replace(/-/g, '');
  const dominio = from.email.split('@').pop();
  return [
    `From: ${direccion(from)}`,
    `To: ${direccion(to)}`,
    `Subject: ${palabra(subject)}`,
    `Date: ${fecha.toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${dominio}>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${limite}"`,
    '',
    `--${limite}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    lineas(text),
    `--${limite}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    lineas(html),
    `--${limite}--`,
    '',
  ].join('\r\n');
}
