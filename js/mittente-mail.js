/* ============================================================
   CHI HA SCRITTO LA MAIL CHE SI STA PROTOCOLLANDO (30/09/2026).

   Un protocollo in entrata nato da una mail deve sapere a chi si
   risponde: «è una risposta, deve rispondere sempre alla mail
   ricevuta». L'indirizzo sta dentro il file che si allega — il
   `.msg` trascinato da Outlook o il `.eml` — e qui lo si legge, per
   scriverlo sul protocollo (`s_protocollo.mittente_email`).

   ⚠️ Modulo PURO: niente rete, niente database, niente DOM. Riceve
   i byte o il testo del file e restituisce { email, nome } oppure
   null. Non lancia mai: un file che non si legge dà null, e il
   campo resta da scrivere a mano.
   ============================================================ */

const EMAIL_RE = /[^\s@,;<>"'()]+@[^\s@,;<>"'()]+\.[a-z]{2,}/i;

function pulisciNome(s) {
  return String(s || '').replace(/^["'\s]+|["'\s]+$/g, '').trim();
}

/* `=?UTF-8?Q?Mario_Ross=C3=AC?=` → «Mario Rossì» (RFC 2047) */
function decodificaParola(s) {
  return String(s || '')
    .replace(/(=\?[^?]+\?[QqBb]\?[^?]*\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (tutto, charset, tipo, testo) => {
      try {
        const bin = tipo.toUpperCase() === 'B'
          ? atob(testo)
          : testo.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
        const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
      } catch { return tutto; }
    });
}

/* «Mario Rossi <m.rossi@esempio.example>» → { email, nome } */
export function indirizzoDaIntestazione(valore) {
  const v = decodificaParola(valore);
  const tra = v.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/);
  const email = (tra ? tra[1] : (v.match(EMAIL_RE) || [''])[0]).trim();
  if (!EMAIL_RE.test(email)) return null;
  const nome = pulisciNome(tra ? v.slice(0, tra.index) : v.replace(email, ''));
  return { email, nome };
}

/* Le intestazioni di una mail (fino alla prima riga vuota), con le righe
   spezzate ricomposte. */
function intestazioni(testo) {
  const capo = String(testo || '').split(/\r?\n\r?\n/)[0] || '';
  const righe = capo.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  const out = {};
  for (const r of righe) {
    const m = r.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (m && !(m[1].toLowerCase() in out)) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

/* A chi si risponde: «Reply-To» se la mail lo dichiara, altrimenti «From». */
export function mittenteDaIntestazioni(testo) {
  const h = intestazioni(testo);
  return indirizzoDaIntestazione(h['reply-to']) || indirizzoDaIntestazione(h.from) || null;
}

export function mittenteDaEml(testo) {
  try { return mittenteDaIntestazioni(testo); } catch { return null; }
}

/* ── il .msg di Outlook: un «compound file» (OLE) ─────────────
   Dentro c'è un piccolo file system: settori, una tabella che li
   concatena (FAT), una directory di voci. Le proprietà della mail
   sono flussi della radice chiamati `__substg1.0_<proprietà><tipo>`.
   Si leggono SOLO i figli della radice: gli allegati e le mail
   allegate hanno i loro flussi con gli stessi nomi, e il mittente di
   una mail inoltrata in allegato non è il mittente di questa. */
const FINE = 0xFFFFFFFE;
const LIBERO = 0xFFFFFFFF;

function apriCfb(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const firma = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  if (b.length < 1536 || firma.some((x, i) => b[i] !== x)) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);

  const dimSett = 1 << u16(30);
  const dimMini = 1 << u16(32);
  const soglia = u32(56);
  const inizio = (n) => (n + 1) * dimSett;
  const perSett = dimSett / 4;

  /* l'elenco dei settori che contengono la FAT */
  const difat = [];
  for (let i = 0; i < 109; i++) { const s = u32(76 + i * 4); if (s < FINE) difat.push(s); }
  let sd = u32(68);
  for (let giri = 0; sd < FINE && giri < 10000; giri++) {
    const o = inizio(sd);
    if (o + dimSett > b.length) break;
    for (let i = 0; i < perSett - 1; i++) { const s = u32(o + i * 4); if (s < FINE) difat.push(s); }
    sd = u32(o + (perSett - 1) * 4);
  }

  const fat = [];
  for (const s of difat) {
    const o = inizio(s);
    if (o + dimSett > b.length) continue;
    for (let i = 0; i < perSett; i++) fat.push(u32(o + i * 4));
  }

  const catena = (primo, tabella) => {
    const out = [];
    let s = primo;
    while (s < FINE && s !== LIBERO && out.length <= tabella.length) { out.push(s); s = tabella[s] ?? FINE; }
    return out;
  };
  const leggiSettori = (primo, lunghezza) => {
    const sett = catena(primo, fat);
    const out = new Uint8Array(sett.length * dimSett);
    sett.forEach((s, i) => {
      const o = inizio(s);
      out.set(b.subarray(o, Math.min(o + dimSett, b.length)), i * dimSett);
    });
    return lunghezza == null ? out : out.subarray(0, Math.min(lunghezza, out.length));
  };

  /* la directory */
  const dir = leggiSettori(u32(48));
  const dvDir = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const voci = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const lung = Math.max(0, Math.min(64, dvDir.getUint16(o + 64, true)) - 2);
    let nome = '';
    for (let i = 0; i < lung; i += 2) nome += String.fromCharCode(dvDir.getUint16(o + i, true));
    voci.push({
      nome,
      tipo: dir[o + 66],
      sinistra: dvDir.getUint32(o + 68, true),
      destra: dvDir.getUint32(o + 72, true),
      figlio: dvDir.getUint32(o + 76, true),
      primo: dvDir.getUint32(o + 116, true),
      dimensione: dvDir.getUint32(o + 120, true),
    });
  }
  if (!voci.length) return null;

  /* i flussi piccoli stanno tutti insieme nel «mini flusso» della radice */
  const radice = voci[0];
  const miniFlusso = leggiSettori(radice.primo, radice.dimensione);
  const miniFatBytes = leggiSettori(u32(60));
  const dvMini = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength);
  const miniFat = [];
  for (let o = 0; o + 4 <= miniFatBytes.length; o += 4) miniFat.push(dvMini.getUint32(o, true));

  const leggi = (v) => {
    if (v.dimensione >= soglia) return leggiSettori(v.primo, v.dimensione);
    const sett = catena(v.primo, miniFat);
    const out = new Uint8Array(sett.length * dimMini);
    sett.forEach((s, i) => out.set(miniFlusso.subarray(s * dimMini, s * dimMini + dimMini), i * dimMini));
    return out.subarray(0, Math.min(v.dimensione, out.length));
  };

  /* i figli diretti della radice: si visita l'albero dei fratelli */
  const figli = new Map();
  const daVedere = [radice.figlio];
  const visti = new Set();
  while (daVedere.length) {
    const i = daVedere.pop();
    if (i >= voci.length || visti.has(i)) continue;
    visti.add(i);
    const v = voci[i];
    if (v.tipo === 2) figli.set(v.nome.toLowerCase(), v);
    daVedere.push(v.sinistra, v.destra);
  }

  return { flusso: (nome) => { const v = figli.get(nome.toLowerCase()); return v ? leggi(v) : null; } };
}

function testoProprieta(cfb, codice) {
  const uni = cfb.flusso(`__substg1.0_${codice}001F`);
  if (uni) return new TextDecoder('utf-16le').decode(uni).replace(/\0+$/, '');
  const ansi = cfb.flusso(`__substg1.0_${codice}001E`);
  if (ansi) return new TextDecoder('windows-1252').decode(ansi).replace(/\0+$/, '');
  return '';
}

/**
 * Il mittente di un `.msg`. Nell'ordine: le intestazioni di trasporto
 * (dove c'è anche l'eventuale «Reply-To»), poi l'indirizzo SMTP del
 * mittente, poi quello di chi la manda per conto di qualcuno. L'indirizzo
 * «interno» di Exchange (/O=EXCHANGELABS/…) non è una e-mail e si scarta.
 */
export function mittenteDaMsg(bytes) {
  try {
    const cfb = apriCfb(bytes);
    if (!cfb) return null;
    const nome = pulisciNome(testoProprieta(cfb, '0C1A') || testoProprieta(cfb, '0042'));

    const daIntestazioni = mittenteDaIntestazioni(testoProprieta(cfb, '007D'));
    if (daIntestazioni) return { email: daIntestazioni.email, nome: daIntestazioni.nome || nome };

    for (const codice of ['5D01', '5D02', '0C1F', '0065']) {
      const v = testoProprieta(cfb, codice).trim();
      if (v.includes('@') && !v.startsWith('/') && EMAIL_RE.test(v)) return { email: v.match(EMAIL_RE)[0], nome };
    }
    return null;
  } catch { return null; }
}

/** Dal nome del file si capisce come leggerlo: `.msg` a byte, `.eml` a testo. */
export function mittenteDaFile(nomeFile, bytes) {
  const nome = String(nomeFile || '').toLowerCase();
  if (nome.endsWith('.msg')) return mittenteDaMsg(bytes);
  if (nome.endsWith('.eml')) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    /* bastano le intestazioni: i primi 64 KB */
    return mittenteDaEml(new TextDecoder('latin1').decode(b.subarray(0, 65536)));
  }
  return null;
}
