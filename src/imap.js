// Cliente IMAP mínimo sobre los sockets TCP de Cloudflare Workers.
// Solo lo necesario: iniciar sesión, listar carpetas y guardar una copia del correo enviado (APPEND).
import { connect } from 'cloudflare:sockets';

const enc = new TextEncoder();
const TIEMPO_MS = 20000;

const conTiempo = (p, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), TIEMPO_MS))]);
/** Cadena entre comillas para IMAP (escapa \ y "). */
const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/** Decodifica nombres de carpeta en UTF-7 modificado (RFC 3501), p. ej. "Elementos enviados" con acentos. */
export function decodificarCarpeta(s) {
  return s.replace(/&([^-]*)-/g, (_, b) => {
    if (!b) return '&';
    const bin = atob(b.replace(/,/g, '/').padEnd(Math.ceil(b.length / 4) * 4, '='));
    let out = '';
    for (let i = 0; i + 1 < bin.length; i += 2) out += String.fromCharCode((bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1));
    return out;
  });
}

export class Imap {
  /** @param {{host:string, puerto:number, seguridad:'ssl'|'starttls'|'ninguna'}} c */
  static async abrir(c) {
    const im = new Imap();
    im.n = 0;
    const modo = c.seguridad === 'ssl' ? 'on' : c.seguridad === 'starttls' ? 'starttls' : 'off';
    im.socket = connect({ hostname: c.host, port: c.puerto }, { secureTransport: modo, allowHalfOpen: false });
    im._preparar();
    await conTiempo(im.socket.opened, `No se pudo conectar a ${c.host}:${c.puerto}.`);
    const saludo = await im._linea();
    if (!/^\* (OK|PREAUTH)/i.test(saludo)) throw new Error('Respuesta inesperada del servidor IMAP: ' + saludo.slice(0, 120));
    if (c.seguridad === 'starttls') {
      await im.comando('STARTTLS');
      im.reader.releaseLock();
      im.writer.releaseLock();
      im.socket = im.socket.startTls();
      im._preparar();
    }
    return im;
  }

  _preparar() {
    this.reader = this.socket.readable.getReader();
    this.writer = this.socket.writable.getWriter();
    this.dec = new TextDecoder();
    this.buf = '';
  }

  async _leerMas() {
    const { value, done } = await conTiempo(this.reader.read(), 'El servidor IMAP no respondió a tiempo.');
    if (done) throw new Error('El servidor IMAP cerró la conexión.');
    this.buf += this.dec.decode(value, { stream: true });
  }

  async _linea() {
    while (!this.buf.includes('\r\n')) await this._leerMas();
    const i = this.buf.indexOf('\r\n');
    let l = this.buf.slice(0, i);
    this.buf = this.buf.slice(i + 2);
    // Literal {n}: los siguientes n caracteres forman parte de la respuesta.
    const m = l.match(/\{(\d+)\}$/);
    if (m) {
      const n = Number(m[1]);
      while (this.buf.length < n) await this._leerMas();
      l += this.buf.slice(0, n);
      this.buf = this.buf.slice(n);
      l += await this._linea();
    }
    return l;
  }

  async _escribir(s) { await this.writer.write(typeof s === 'string' ? enc.encode(s) : s); }

  /** Ejecuta un comando y devuelve las respuestas sin etiqueta. Si `literal` viene, se envía como {n}. */
  async comando(cmd, literal) {
    const tag = 'C' + ++this.n;
    if (literal !== undefined) {
      const bytes = enc.encode(literal);
      await this._escribir(`${tag} ${cmd} {${bytes.length}}\r\n`);
      for (;;) {
        const l = await this._linea();
        if (l.startsWith('+')) break;
        if (l.startsWith(tag + ' ')) throw new Error(l.slice(tag.length + 1));
      }
      await this._escribir(bytes);
      await this._escribir('\r\n');
    } else {
      await this._escribir(`${tag} ${cmd}\r\n`);
    }
    const sinEtiqueta = [];
    for (;;) {
      const l = await this._linea();
      if (l.startsWith(tag + ' ')) {
        const r = l.slice(tag.length + 1);
        if (/^OK/i.test(r)) return sinEtiqueta;
        throw new Error(r.replace(/^(NO|BAD)\s*/i, ''));
      }
      sinEtiqueta.push(l);
    }
  }

  async login(usuario, password) {
    try { await this.comando(`LOGIN ${q(usuario)} ${q(password)}`); }
    catch (e) { throw new Error('IMAP rechazó el usuario o la contraseña: ' + e.message); }
  }

  /** Carpetas del buzón: [{valor, nombre, enviados}] */
  async carpetas() {
    const r = await this.comando('LIST "" "*"');
    const out = [];
    for (const l of r) {
      const m = l.match(/^\* LIST \(([^)]*)\) (?:"(?:[^"\\]|\\.)*"|NIL) (.+)$/i);
      if (!m) continue;
      let valor = m[2].trim();
      if (valor.startsWith('"')) valor = valor.slice(1, -1).replace(/\\(.)/g, '$1');
      if (/\\Noselect/i.test(m[1])) continue;
      out.push({ valor, nombre: decodificarCarpeta(valor), enviados: /\\Sent/i.test(m[1]) });
    }
    return out;
  }

  async guardar(carpeta, mensaje) {
    await this.comando(`APPEND ${q(carpeta)} (\\Seen)`, mensaje);
  }

  async cerrar() {
    try { await conTiempo(this.comando('LOGOUT'), 'logout'); } catch {}
    try { await this.socket.close(); } catch {}
  }
}

/** Elige la carpeta de enviados: la marcada como \Sent o una con nombre conocido. */
export function carpetaEnviados(lista) {
  const marcada = lista.find((c) => c.enviados);
  if (marcada) return marcada.valor;
  const nombres = ['sent', 'sent items', 'sent messages', 'enviados', 'elementos enviados', 'inbox.sent', '[gmail]/sent mail', '[gmail]/enviados'];
  const hit = lista.find((c) => nombres.includes(c.nombre.toLowerCase()));
  return hit ? hit.valor : '';
}
