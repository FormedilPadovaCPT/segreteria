/* ══════════════════════════════════════════════════════════════════════════
   UN FILE .ZIP SENZA LIBRERIE                                   (14/10/2026)
   Per il pacchetto del corso (corsi-fascicolo.js): tutto il fascicolo in un
   file solo, da tenere su Drive e da copiare sul server della scuola.
   Metodo «stored» (nessuna compressione): i PDF sono già compressi, e un
   archivio senza compressione si apre con qualunque programma, oggi e fra
   dieci anni. Nomi in UTF-8 (bit 11), CRC-32 di ogni file. Funzioni pure:
   girano uguali nel browser e in Node (test/fascicolo-pacchetto.test.mjs).
   ══════════════════════════════════════════════════════════════════════════ */

let TAB = null;
function tabella() {
  if (TAB) return TAB;
  TAB = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    TAB[n] = c >>> 0;
  }
  return TAB;
}

export function crc32(byte) {
  const t = tabella();
  let c = 0xFFFFFFFF;
  for (let i = 0; i < byte.length; i++) c = t[(c ^ byte[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* data e ora nel formato MS-DOS dello zip (ora locale) */
function dos(d) {
  const ora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const data = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { ora, data };
}

/* file: [{ nome: 'cartella/file.pdf', byte: Uint8Array }] → Uint8Array dello zip */
export function creaZip(file, quando = new Date()) {
  const enc = new TextEncoder();
  const { ora, data } = dos(quando);
  const locali = [], centrali = [];
  let offset = 0;
  const visti = new Set();
  for (const f of file) {
    const nome = String(f.nome).replace(/\\/g, '/').replace(/^\/+/, '');
    if (!nome || visti.has(nome.toLowerCase())) throw new Error(`nome ripetuto o vuoto nel pacchetto: ${nome}`);
    visti.add(nome.toLowerCase());
    const n = enc.encode(nome);
    const b = f.byte instanceof Uint8Array ? f.byte : new Uint8Array(f.byte);
    const crc = crc32(b);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, ora, true); h.setUint16(12, data, true); h.setUint32(14, crc, true);
    h.setUint32(18, b.length, true); h.setUint32(22, b.length, true); h.setUint16(26, n.length, true); h.setUint16(28, 0, true);
    locali.push(new Uint8Array(h.buffer), n, b);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, ora, true); c.setUint16(14, data, true); c.setUint32(16, crc, true);
    c.setUint32(20, b.length, true); c.setUint32(24, b.length, true); c.setUint16(28, n.length, true);
    c.setUint16(30, 0, true); c.setUint16(32, 0, true); c.setUint16(34, 0, true); c.setUint16(36, 0, true);
    c.setUint32(38, 0, true); c.setUint32(42, offset, true);
    centrali.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + b.length;
  }
  const dimC = centrali.reduce((s, x) => s + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(4, 0, true); e.setUint16(6, 0, true);
  e.setUint16(8, file.length, true); e.setUint16(10, file.length, true);
  e.setUint32(12, dimC, true); e.setUint32(16, offset, true); e.setUint16(20, 0, true);
  const pezzi = [...locali, ...centrali, new Uint8Array(e.buffer)];
  const out = new Uint8Array(pezzi.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of pezzi) { out.set(x, p); p += x.length; }
  return out;
}

/* l'impronta SHA-256 in esadecimale (Web Crypto: browser e Node 20+) */
export async function sha256(byte) {
  const h = await crypto.subtle.digest('SHA-256', byte);
  return [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
