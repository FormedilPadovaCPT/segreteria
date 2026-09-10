/* ============================================================
   ABBINAMENTI ALLIEVI-AZIENDE DELLA SCUOLA — lettura del Word

   Due volte l'anno la didattica (Barbara Bertan per Padova, Alessia
   Ranci per Stanghella) manda l'elenco: sopra la tabella classe,
   sede, periodo e ore; nella tabella, per ogni allievo, l'azienda
   con i suoi dati (sede, P.IVA, legale rappresentante, sedi di
   cantiere, tutor), l'orario e — quando l'ha aggiunta l'ufficio —
   il TECNICO. Ogni riga e' una richiesta di visita allo stagista.

   Si legge SOLO il Word (.docx), decisione dell'utente del
   10/09/2026: il PDF impaginato fa scivolare i nomi sotto le
   aziende sbagliate, e un elenco sbagliato manda un tecnico nel
   posto sbagliato.

   Nessuna libreria: lo zip si apre con DecompressionStream, l'XML
   di Word si scorre a mano. Le funzioni sono pure e girano uguali
   nel browser e in Node, cosi' i test usano lo stesso codice.

   Due forme di file, entrambe reali:
   - Stanghella: tabella pulita a 3-4 colonne, etichette «Sede legale:»,
     «P.IVA:», «Sede cantieri: 1) … 2) …», «Tutor scolastico:»;
   - Padova: nato da un vecchio .doc con la stampa unione, tabelle
     annidate nelle celle, nome e cognome in celle separate, l'elenco
     spezzato in piu' tabelle, niente P.IVA, ragione sociale sulla
     stessa riga di citta', telefono e mail.
   ============================================================ */

// ─── zip ────────────────────────────────────────────────────────────────────
async function inflateRaw(bytes) {
  const out = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Il contenuto (bytes) di un file dentro lo zip, o null se non c'e'. */
export async function leggiDaZip(buffer, nome) {
  const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;   // fine della central directory, cercata dal fondo
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Il file non è un documento Word (.docx) leggibile.');
  const voci = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let k = 0; k < voci; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(p + 10, true);
    const compressa = dv.getUint32(p + 20, true);
    const lnNome = dv.getUint16(p + 28, true);
    const lnExtra = dv.getUint16(p + 30, true);
    const lnComm = dv.getUint16(p + 32, true);
    const locale = dv.getUint32(p + 42, true);
    if (dec.decode(u8.subarray(p + 46, p + 46 + lnNome)) === nome) {
      const inizio = locale + 30 + dv.getUint16(locale + 26, true) + dv.getUint16(locale + 28, true);
      const dati = u8.subarray(inizio, inizio + compressa);
      if (metodo === 0) return dati;
      if (metodo === 8) return inflateRaw(dati);
      throw new Error(`Compressione ${metodo} non gestita.`);
    }
    p += 46 + lnNome + lnExtra + lnComm;
  }
  return null;
}

// ─── xml di Word ────────────────────────────────────────────────────────────
function decodificaEntita(s) {
  return s.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => {
    const t = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
    if (t) return t;
    return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  });
}

/**
 * Scorre document.xml e restituisce { paragrafi, tabelle }:
 * - paragrafi: il testo prima della prima tabella (l'intestazione dell'elenco);
 * - tabelle: le tabelle di PRIMO livello, righe → celle → righe di testo.
 * Le tabelle annidate in una cella finiscono nel testo della cella che le
 * contiene. Si legge solo <w:t>: i codici della stampa unione stanno in
 * <w:instrText> e restano fuori.
 */
export function leggiDocumentXml(xml) {
  const re = /<(\/?)(w:tbl|w:tr|w:tc|w:p|w:t|w:br|w:tab|w:cr)(?=[\s>/])[^>]*?(\/?)>|([^<]+)|<[^>]*>/g;
  const paragrafi = [];
  const tabelle = [];
  let righe = null;   // righe della tabella di primo livello in corso
  let prof = 0;       // profondita' delle tabelle
  let inT = false;
  let para = null;
  let cella = null;
  let riga = null;
  let m;
  while ((m = re.exec(xml))) {
    const [, chiude, tag, auto, testo] = m;
    if (testo !== undefined) { if (inT && para !== null) para += decodificaEntita(testo); continue; }
    if (!tag) continue;
    const apre = !chiude;
    switch (tag) {
      case 'w:tbl':
        if (apre) { prof++; if (prof === 1) righe = []; }
        else { if (prof === 1 && righe) { tabelle.push(righe); righe = null; } prof--; }
        break;
      case 'w:tr':
        if (prof === 1 && righe) { if (apre) riga = []; else { if (riga) righe.push(riga); riga = null; } }
        break;
      case 'w:tc':
        if (prof === 1 && riga) { if (apre) cella = []; else { riga.push(cella || []); cella = null; } }
        break;
      case 'w:p':
        if (apre && !auto) para = '';
        else if (!apre) {
          const t = (para || '').replace(/[^\S\n]+/g, ' ').trim();
          if (t) {
            if (prof === 0 && !tabelle.length) paragrafi.push(t);
            else if (prof >= 1 && cella) cella.push(t);
          }
          para = null;
        }
        break;
      case 'w:t':
        inT = apre && !auto;
        break;
      case 'w:br': case 'w:cr':
        if (para !== null) para += '\n';
        break;
      case 'w:tab':
        if (para !== null) para += ' ';
        break;
    }
  }
  const esplodi = (arr) => arr.flatMap((s) => s.split('\n')).map((s) => s.trim()).filter(Boolean);
  return { paragrafi: esplodi(paragrafi), tabelle: tabelle.map((t) => t.map((r) => r.map(esplodi))) };
}

// ─── interpretazione ────────────────────────────────────────────────────────
export function pulisci(s) {
  return String(s ?? '')
    .replace(/[   ]/g, ' ')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

const senzaAccenti = (s) => pulisci(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const iso = (a, m, g) => `${a}-${String(m).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
const dataIt = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const MESI = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };

/** Classe, sede, anno scolastico, periodo e ore dall'intestazione sopra la tabella. */
export function analizzaIntestazione(paragrafi) {
  const t = pulisci(paragrafi.join(' \n '));
  const out = { classe: null, sede: null, anno_scolastico: null, dal: null, al: null, ore_giorno: null, ore_totali: null, testo: paragrafi.join('\n') };
  const cl = t.match(/STAGE\s+(\d)\s*(?:°|\^|ª|º)?\s*(?:OPERATORE\s+EDILE|OE)\b/i);
  if (cl) out.classe = Number(cl[1]);
  const an = t.match(/(20\d\d)\s*-\s*(20\d\d)/);
  if (an) out.anno_scolastico = `${an[1]}-${an[2]}`;
  const se = t.match(/OPERATORE\s+EDILE[^\n]*?\b(PADOVA|STANGHELLA)\b/i) || t.match(/\b(PADOVA|STANGHELLA)\b/i);
  if (se) out.sede = se[1][0].toUpperCase() + se[1].slice(1).toLowerCase();
  // «dal 27 aprile al 27 maggio 2026» (anno anche solo in fondo) o «Dal 10/03/2025 al 12/05/2025»
  const pl = t.match(/dal\s+(\d{1,2})\s+([a-zà]+)\s*(\d{4})?\s+al\s+(\d{1,2})\s+([a-zà]+)\s+(\d{4})/i);
  if (pl && MESI[pl[2].toLowerCase()] && MESI[pl[5].toLowerCase()]) {
    const a2 = Number(pl[6]);
    const m1 = MESI[pl[2].toLowerCase()];
    const m2 = MESI[pl[5].toLowerCase()];
    const a1 = pl[3] ? Number(pl[3]) : (m1 > m2 ? a2 - 1 : a2);
    out.dal = iso(a1, m1, pl[1]);
    out.al = iso(a2, m2, pl[4]);
  } else {
    const pn = t.match(/dal\s+(\d{1,2})\/(\d{1,2})\/(\d{4})\s+al\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
    if (pn) { out.dal = iso(pn[3], pn[2], pn[1]); out.al = iso(pn[6], pn[5], pn[4]); }
  }
  const og = t.match(/(\d{1,2})\s*ore\s+al\s+giorno/i);
  if (og) out.ore_giorno = Number(og[1]);
  const ot = t.match(/totale\s+ore(?:\s+stage)?\s*:?\s*(\d{2,4})/i);
  if (ot) out.ore_totali = Number(ot[1]);
  return out;
}

/** Indici delle colonne dalla riga di intestazione (TECNICO e ORARIO facoltative). */
export function trovaColonne(intestazione) {
  const testi = intestazione.map((c) => pulisci(c.join(' ')).toLowerCase());
  const idx = (re) => testi.findIndex((t) => re.test(t));
  const col = { allievo: idx(/nominativo|allievo|corsista|studente/), azienda: idx(/azienda|impresa|ditta/), orario: idx(/orario/), tecnico: idx(/tecnico/) };
  return col.allievo >= 0 && col.azienda >= 0 ? col : null;
}

// Etichette della cella «Azienda». L'ordine conta: le piu' specifiche prima.
const ETICHETTE = [
  ['cf_lr', /^c\.?\s*f\.?\s*(?:del\s+)?legale\s+rappresentante\s*:?\s*/i],
  ['lr_nascita', /^nat[oa]\s+a\s+/i],
  ['legale_rappresentante', /^legale\s+rappresentante\s*:?\s*/i],
  ['sede_legale', /^sede\s+legale\s*:?\s*/i],
  ['sede_operativa', /^sede\s+operativa\s*:?\s*/i],
  ['cantieri', /^(?:sed[ei]\s+(?:di\s+|del\s+)?)?cantier[ei]\s*:\s*|^sed[ei]\s+(?:di\s+|del\s+)?cantier[ei]\s*/i],
  ['codice_fiscale', /^(?:cod(?:ice)?\.?\s*fiscale|c\.\s*f\.)\s*:?\s*/i],
  ['partita_iva', /^(?:p\.?\s*iva|partita\s+iva)\s*:?\s*/i],
  ['telefono', /^tel(?:efono)?\.?\s*:?\s*/i],
  ['cellulare', /^cell(?:ulare)?\.?\s*:?\s*/i],
  ['email', /^(?:e-?)?mail\s*:?\s*/i],
  ['tutor_aziendale', /^tutor\s+aziendale\s*:?\s*/i],
  ['tutor_formativo', /^tutor\s+formativo\s*:?\s*/i],
  ['tutor_scuola', /^tutor\s+(?:scuola|scolastico)\s*:?\s*/i],
  ['tecnico_cpt', /^tecnico\s+cpt\s*:?\s*/i],
];
const RE_EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const RE_TEL = /(?:\+39\s*)?0\d{1,3}[\s./-]?\d{5,8}|3\d{2}[\s./-]?\d{3}[\s./-]?\d{3,4}/;
const RE_CF16 = /\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b/i;

/** Scompone il testo della cella «Azienda» nei suoi campi. */
export function analizzaAzienda(righeCella) {
  const campi = { preambolo: [] };
  let corrente = 'preambolo';
  for (const r0 of righeCella) {
    const r = pulisci(r0);
    if (!r) continue;
    const et = ETICHETTE.find(([, re]) => re.test(r));
    if (et) {
      corrente = et[0];
      campi[corrente] = campi[corrente] || [];
      const resto = r.replace(et[1], '').trim();
      if (resto) campi[corrente].push(resto);
    } else {
      campi[corrente].push(r);
    }
  }
  const unisci = (k, sep = ' ') => (campi[k] || []).join(sep).trim() || null;
  const telG = new RegExp(RE_TEL.source, 'g');
  const pre = campi.preambolo;

  // ragione sociale = prima riga; nei file della stampa unione ci finiscono
  // anche citta', telefono e mail, che si tolgono
  const ragione = (pre[0] || '')
    .replace(RE_EMAIL, '').replace(telG, '')
    .replace(/\s+\S+\s*\([A-Z]{2}\)\s*$/, '')
    .replace(/\s{2,}/g, ' ').replace(/[\s,;-]+$/, '').trim();

  let piva = (unisci('partita_iva') || '').match(/\b\d{11}\b/)?.[0] || null;
  const cfTesto = unisci('codice_fiscale') || '';
  const cf = cfTesto.match(RE_CF16)?.[0]?.toUpperCase() || cfTesto.match(/\b\d{11}\b/)?.[0] || null;
  if (!piva && cf && /^\d{11}$/.test(cf)) piva = cf;

  let sede = unisci('sede_legale');
  if (!sede && pre.length > 1) {
    sede = pre.slice(1).filter((x) => !RE_EMAIL.test(x) && !/^tel/i.test(x) && !/^c\/o/i.test(x))
      .join(' ').replace(telG, '').replace(/\s{2,}/g, ' ').trim() || null;
  }

  // «1) …  2) …» diventano voci separate; senza numerazione resta un testo solo
  const cantTesto = unisci('cantieri', '\n') || '';
  let cantieri = cantTesto.split(/\n|(?=\b\d\)\s?)/).map((x) => pulisci(x.replace(/^\d\)\s*/, ''))).filter(Boolean);
  if (cantieri.length > 1 && !/\b\d\)/.test(cantTesto)) cantieri = [pulisci(cantTesto.replace(/\n/g, ' '))];

  const conTelefono = (k) => {
    const v = unisci(k);
    if (!v) return { nome: null, telefono: null };
    const nome = pulisci(v.replace(telG, '')).replace(/[\s,;:/-]+$/, '');
    return { nome: nome || null, telefono: v.match(RE_TEL)?.[0] || null };
  };

  return {
    ragione_sociale: ragione || null,
    partita_iva: piva,
    codice_fiscale: cf,
    sede,
    sede_operativa: unisci('sede_operativa'),
    telefono: (unisci('telefono') || '').match(RE_TEL)?.[0] || pre.join(' ').match(RE_TEL)?.[0] || null,
    cellulare: (unisci('cellulare') || '').match(RE_TEL)?.[0] || null,
    email: (unisci('email') || '').match(RE_EMAIL)?.[0] || righeCella.join('\n').match(RE_EMAIL)?.[0] || null,
    legale_rappresentante: conTelefono('legale_rappresentante').nome,
    cf_legale_rappresentante: (unisci('cf_lr') || '').match(RE_CF16)?.[0]?.toUpperCase() || null,
    cantieri,
    tutor_aziendale: conTelefono('tutor_aziendale'),
    tutor_formativo: unisci('tutor_formativo'),
    tutor_scuola: unisci('tutor_scuola'),
  };
}

/**
 * Dal file .docx all'elenco da controllare.
 * { intestazione, righe: [{ n, allievo, orario, tecnico_file, azienda, avvisi }], avvisi }
 */
export async function leggiAbbinamenti(buffer) {
  const xmlBytes = await leggiDaZip(buffer, 'word/document.xml');
  if (!xmlBytes) throw new Error('Nel file non c\'è il testo di un documento Word.');
  const { paragrafi, tabelle } = leggiDocumentXml(new TextDecoder().decode(xmlBytes));
  if (!tabelle.length) throw new Error('Nel documento non c\'è nessuna tabella.');
  const intestazione = analizzaIntestazione(paragrafi);

  // la riga di intestazione nella prima tabella che ce l'ha; poi le righe di
  // quella tabella e delle successive con abbastanza celle (i .doc convertiti
  // spezzano l'elenco in piu' tabelle)
  let col = null;
  const tabella = [];
  for (const t of tabelle) {
    if (!col) {
      const i = t.findIndex((r) => trovaColonne(r));
      if (i >= 0) { col = trovaColonne(t[i]); tabella.push(...t.slice(i + 1)); }
      continue;
    }
    const servono = Math.max(col.allievo, col.azienda) + 1;
    tabella.push(...t.filter((r) => r.length >= servono && !trovaColonne(r)));
  }
  if (!col) throw new Error('Non trovo la riga di intestazione della tabella (Nominativo / Azienda).');

  const avvisi = [];
  if (!intestazione.classe) avvisi.push('Classe non riconosciuta nell\'intestazione.');
  if (!intestazione.sede) avvisi.push('Sede (Padova/Stanghella) non riconosciuta nell\'intestazione.');
  if (!intestazione.dal) avvisi.push('Periodo di stage non riconosciuto nell\'intestazione.');

  const righe = [];
  for (const r of tabella) {
    const cella = (i) => (i >= 0 && r[i]) ? r[i] : [];
    const allievo = pulisci(cella(col.allievo).join(' '));
    const aziendaRighe = cella(col.azienda);
    if (!allievo && !aziendaRighe.length) continue;
    const azienda = analizzaAzienda(aziendaRighe);
    const tecnico = pulisci(cella(col.tecnico).join(' ')) || null;
    const a = [];
    if (!allievo) a.push('Manca il nominativo dell\'allievo.');
    if (!azienda.ragione_sociale) a.push('Manca la ragione sociale.');
    if (!azienda.partita_iva && !azienda.codice_fiscale) a.push('Nel file non c\'è la P.IVA: impresa cercata per nome.');
    if (!azienda.cantieri.length) a.push('Nessuna sede di cantiere indicata.');
    righe.push({
      n: righe.length + 1,
      allievo,
      orario: cella(col.orario).map(pulisci).join('; ') || null,
      tecnico_file: tecnico && !/^(nessuno|-+)$/i.test(tecnico) ? tecnico : null,
      azienda,
      avvisi: a,
    });
  }
  if (!righe.length) avvisi.push('La tabella non contiene righe di allievi.');
  return { intestazione, righe, avvisi };
}

// ─── aiuti per la maschera di conferma ──────────────────────────────────────
export const normComune = (s) => senzaAccenti(s).toLowerCase().replace(/[^a-z']/g, ' ').replace(/\s+/g, ' ').trim();

/** Chiave di ricerca di una ragione sociale: la parola piu' lunga che non sia una forma giuridica. */
export function chiaveNome(s) {
  const stop = new Set(['srl', 'srls', 'spa', 'snc', 'sas', 'soc', 'societa', 'cooperativa', 'coop', 'impresa', 'edile',
    'edilizia', 'costruzioni', 'ditta', 'individuale', 'del', 'della', 'dei', 'delle', 'generali', 'comune', 'fratelli', 'flli']);
  const toks = senzaAccenti(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  return toks.sort((a, b) => b.length - a.length)[0] || pulisci(s);
}

/** Ragione sociale confrontabile: senza punteggiatura, accenti e forme giuridiche. */
export function normNome(s) {
  return senzaAccenti(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(s ?r ?l ?s?|s ?n ?c|s ?a ?s|s ?p ?a|soc|societa|impresa edile|impresa|ditta)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * I nomi di comune possibili dentro l'indirizzo di un cantiere, con la
 * provincia quando c'e': «VIA DE CONTI - 35043 MONSELICE (PD)»,
 * «via Piove 31 Fiesso D'Artico (VE)», «ARINO DI DOLO 30031 (VE)».
 * Il peso dice quanto fidarsi: la provincia fra parentesi vale piu' del resto.
 */
export function candidatiComune(testo) {
  const t = pulisci(testo);
  const out = [];
  const valido = (n) => /^[A-Za-zÀ-ÿ' .-]+$/.test(n) && n.replace(/[^A-Za-zÀ-ÿ]/g, '').length >= 3;
  const parole = (s) => s.split(/\s+/).map((w) => w.replace(/^[-,;.]+|[-,;]+$/g, '')).filter(Boolean);
  const dopoUltimoNumero = (ws) => { let i = -1; ws.forEach((w, k) => { if (/\d/.test(w)) i = k; }); return ws.slice(i + 1); };
  const code = (ws, prov, peso) => {
    for (let n = Math.min(4, ws.length); n >= 1; n--) { const nome = ws.slice(-n).join(' '); if (valido(nome)) out.push({ nome, prov, peso: peso + n }); }
  };
  const teste = (ws, prov, peso) => {
    for (let n = Math.min(4, ws.length); n >= 1; n--) { const nome = ws.slice(0, n).join(' '); if (valido(nome)) out.push({ nome, prov, peso: peso + n }); }
  };
  // 1. parole prima di «(PD)», dopo l'ultimo numero (civico o CAP)
  for (const m of t.matchAll(/([^()]*?)\s*\(([A-Z]{2})\)/g)) {
    const ws = parole(m[1]);
    const dopo = dopoUltimoNumero(ws);
    if (dopo.length) code(dopo, m[2], 20);
    else {
      // «ARINO DI DOLO 30031 (VE)»: il nome sta prima del CAP
      const cap = ws.findIndex((w) => /^\d{5}$/.test(w));
      if (cap > 0) code(dopoUltimoNumero(ws.slice(0, cap)), m[2], 18);
    }
  }
  // 2. il nome dopo un CAP: «- 35047 SOLESINO»
  for (const m of t.matchAll(/\b\d{5}\b\s+([A-Za-zÀ-ÿ' .]+?)(?=\s*(?:\(|-|,|;|$))/g)) {
    const prov = t.slice(m.index + m[0].length).match(/^\s*\(([A-Z]{2})\)/)?.[1] || null;
    teste(parole(m[1]), prov, prov ? 20 : 10);
  }
  return out;
}

/** Fra i candidati, quello che esiste davvero (righe di comuni_catastali: nome, prov). */
export function scegliComune(candidati, trovati) {
  const idx = new Map();
  for (const c of trovati || []) {
    const k = normComune(c.nome);
    if (!idx.has(k)) idx.set(k, []);
    idx.get(k).push(c);
  }
  let best = null;
  for (const c of candidati || []) {
    const lista = idx.get(normComune(c.nome));
    if (!lista) continue;
    const m = c.prov ? lista.find((x) => x.prov === c.prov) : (lista.length === 1 ? lista[0] : null);
    if (!m) continue;
    const punti = c.peso * 100 + m.nome.length;
    if (!best || punti > best.punti) best = { nome: m.nome, prov: m.prov, punti };
  }
  return best ? { nome: best.nome, prov: best.prov } : null;
}

/** Ultima risorsa: un comune delle zone dei tecnici scritto nel testo («via Tunisi Padova»). */
export function comuneDaElenco(testo, nomi) {
  const T = ` ${normComune(testo)} `;
  let best = null;
  for (const n0 of nomi || []) {
    const n = String(n0 || '').replace(/\s+-\s+Q\d.*$/i, '');
    const k = normComune(n);
    if (k.length >= 3 && T.includes(` ${k} `) && (!best || k.length > best.k.length)) best = { nome: n, k };
  }
  return best ? best.nome : null;
}

/** Via e civico del cantiere, senza CAP, citta' e provincia. */
export function pulisciIndirizzo(testo, comune = '') {
  let t = pulisci(testo);
  t = t.replace(/\s*[-,]?\s*\b\d{5}\b.*$/, '');   // CAP e quel che segue
  t = t.replace(/\s*\(.*$/, '');                   // provincia o note fra parentesi
  const civ = t.match(/^(.*?\d+[a-zA-Z]?(?:\s*[/-]\s*\d+[a-zA-Z]?)*)(?=\s|,|$)/);
  if (civ && /[A-Za-zÀ-ÿ]{3}/.test(civ[1])) t = civ[1];
  else if (comune) t = t.replace(new RegExp(`\\s*[-,]?\\s*${escRe(pulisci(comune))}\\s*$`, 'i'), '');
  return t.replace(/[\s,;-]+$/, '').trim();
}

function distanza(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

/** Il tecnico scritto nella colonna TECNICO («CAON», «DE MARCO», anche «VISINTINI»). */
export function tecnicoDalFile(testo, tecnici) {
  const t = normComune(testo || '').replace(/'/g, '');
  if (!t || /^(nessuno|nessun|nd|n d)$/.test(t)) return null;
  const trovati = (tecnici || []).filter((x) => {
    const c = normComune(x.tecnico_cognome || '').replace(/'/g, '');
    if (!c) return false;
    return c === t || t.startsWith(`${c} `) || t.endsWith(` ${c}`) || (c.length >= 5 && distanza(c, t) <= 2);
  });
  const email = [...new Set(trovati.map((x) => x.email))];
  return email.length === 1 ? email[0] : null;
}

/** Il nome della tutor scuola che compare piu' spesso nelle righe. */
export function richiedenteDaRighe(righe) {
  const conta = new Map();
  for (const r of righe || []) {
    const n = pulisci(r.azienda?.tutor_scuola || r.tutor_scuola || '');
    if (n) conta.set(n, (conta.get(n) || 0) + 1);
  }
  return [...conta.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/**
 * Il testo che il tecnico legge nell'incarico. La PRIMA riga deve cominciare
 * con «stage dal …»: e' da li' che la relazione allo stagista (gestionale,
 * stage-relazione.js) ricava il periodo, e si ferma alla fine della riga.
 */
export function testoNotaIncarico(h, r, dataRichiesta) {
  const righe = [];
  righe.push(h.dal && h.al ? `stage dal ${dataIt(h.dal)} al ${dataIt(h.al)}` : 'stage — periodo da confermare');
  righe.push(`${h.classe || '?'}ª Operatore Edile ${h.sede || ''} — a.s. ${h.anno_scolastico || '?'}${h.ore_giorno ? ` — ${h.ore_giorno} ore al giorno` : ''}`);
  if (r.orario) righe.push(`Orario: ${r.orario}`);
  if (r.tutor) righe.push(`Tutor aziendale: ${r.tutor}${r.tutor_tel ? ` ${r.tutor_tel}` : ''}`);
  if (r.tutor_formativo) righe.push(`Tutor formativo: ${r.tutor_formativo}`);
  if (r.tutor_scuola) righe.push(`Tutor scuola: ${r.tutor_scuola}`);
  if (r.cantieri && r.cantieri.length > 1) righe.push(`Sedi di cantiere: ${r.cantieri.map((c, k) => `${k + 1}) ${c}`).join('; ')}`);
  if (dataRichiesta) righe.push(`Dall'elenco degli abbinamenti della Scuola arrivato il ${dataIt(dataRichiesta)}.`);
  return righe.join('\n');
}

export const oggettoIncarico = (h) => `Visita allo stagista — ${h.classe || '?'}ª OE ${h.sede || ''}, a.s. ${h.anno_scolastico || '?'}`;

/** Nome a convenzione del vault per il Word depositato. */
export const nomeFileElenco = (h, data) =>
  `${String(data).replace(/-/g, '_')}_ELEN_Formedil-Padova_abbinamento-allievi-aziende-stage-${h.classe}-OE-${h.sede}-${h.anno_scolastico}.docx`;

/** La sottocartella di stage_scolastici, come quelle che ci sono gia' («2026 04 29 STAGE»). */
export const cartellaElenco = (data) => `${String(data).replace(/-/g, ' ')} STAGE`;

// ─── il modello Excel (canale principale dal 10/09/2026) ────────────────────
/*
   Idea dell'utente: invece di interpretare il Word, la didattica compila un
   modello Excel con una colonna per ogni dato. Qui non si indovina niente:
   via, civico, comune e provincia arrivano gia' separati.

   Le colonne si riconoscono dall'INTESTAZIONE, non dalla posizione: se
   qualcuno ne sposta una o ne aggiunge, l'import regge. Il modello sta in
   2_AREE/Formazione/Scuola_Edile_offerta_formativa/stage_scolastici/_modello/.
*/
const normTesto = (s) => senzaAccenti(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const CAMPI_ELENCO = [
  ['sede', /^sede/], ['classe', /^classe/], ['anno_scolastico', /^anno/],
  ['dal', /dal$|^inizio|^stage dal/], ['al', /al$|^fine|^stage al/],
  ['ore_giorno', /^ore/], ['tutor_scuola', /tutor scuola|tutor scolastico|referente/],
  ['tutor_formativo', /tutor formativo/], ['note', /^note/],
];
const COLONNE_ALLIEVI = [
  ['cognome', /^cognome allievo|^cognome$/], ['nome', /^nome allievo|^nome$/],
  ['allievo', /^allievo|^nominativo/],
  ['ragione', /ragione sociale|^impresa$|^azienda$/], ['piva', /partita iva|p iva|^piva/],
  ['cf', /codice fiscale/], ['via', /^cantiere via|^via/], ['civico', /civico/],
  ['comune', /^cantiere comune|^comune/], ['prov', /^cantiere provincia|^provincia|^prov/],
  ['altri_cantieri', /altri cantieri/], ['tutor', /^tutor aziendale$|^tutor aziendale cognome|^tutor aziendale nome/],
  ['tutor_tel', /telefono tutor|tel tutor|cellulare tutor/], ['orario', /^orario/],
  ['tutor_formativo', /tutor formativo/], ['email_impresa', /mail impresa|email impresa|^e mail/], ['note', /^note/],
];

/** Date come le restituisce il foglio: 2026-04-27, 27/04/2026, 27-04-26. */
export function leggiDataCella(v) {
  const t = pulisci(v);
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(m[1], m[2], m[3]);
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return iso(m[3].length === 2 ? `20${m[3]}` : m[3], m[2], m[1]);
  return null;
}

/**
 * Dal modello Excel, gia' letto in righe di celle (sheet_to_json con header:1),
 * alla stessa forma di leggiAbbinamenti: { intestazione, righe, avvisi }.
 * - elenco: righe [campo, valore] del foglio «Dati elenco»
 * - allievi: righe del foglio «Allievi», la prima e' l'intestazione
 */
export function leggiModelloRighe(elenco, allievi) {
  const avvisi = [];
  const h = { classe: null, sede: null, anno_scolastico: null, dal: null, al: null, ore_giorno: null, ore_totali: null, testo: '' };
  const extra = {};
  for (const r of elenco || []) {
    const k = normTesto(r?.[0]);
    const v = pulisci(r?.[1]);
    if (!k || !v) continue;
    const campo = CAMPI_ELENCO.find(([, re]) => re.test(k))?.[0];
    if (!campo) continue;
    if (campo === 'sede') h.sede = /stangh/i.test(v) ? 'Stanghella' : /padov/i.test(v) ? 'Padova' : null;
    else if (campo === 'classe') h.classe = Number(v.match(/\d/)?.[0]) || null;
    else if (campo === 'anno_scolastico') { const m = v.match(/(20\d\d)\s*[-/]\s*(20\d\d)/); h.anno_scolastico = m ? `${m[1]}-${m[2]}` : null; }
    else if (campo === 'dal' || campo === 'al') h[campo] = leggiDataCella(v);
    else if (campo === 'ore_giorno') h.ore_giorno = Number(v.replace(',', '.')) || null;
    else extra[campo] = v;
  }
  h.testo = (elenco || []).filter((r) => pulisci(r?.[0]) && pulisci(r?.[1])).map((r) => `${pulisci(r[0])}: ${pulisci(r[1])}`).join('\n');
  if (!h.sede) avvisi.push('Sede non indicata nel foglio «Dati elenco».');
  if (!h.classe) avvisi.push('Classe non indicata nel foglio «Dati elenco».');
  if (!h.dal || !h.al) avvisi.push('Periodo di stage (dal/al) non indicato o non leggibile.');

  const [testa = [], ...corpo] = allievi || [];
  const col = {};
  testa.forEach((c, i) => {
    const k = normTesto(c);
    const campo = COLONNE_ALLIEVI.find(([nome, re]) => col[nome] === undefined && re.test(k))?.[0];
    if (campo) col[campo] = i;
  });
  if (col.ragione === undefined || (col.cognome === undefined && col.allievo === undefined)) {
    throw new Error('Il foglio «Allievi» non ha le colonne del modello (servono almeno Cognome allievo e Ragione sociale impresa).');
  }
  const v = (r, k) => (col[k] === undefined ? '' : pulisci(r[col[k]]));

  const righe = [];
  for (const r of corpo) {
    if (!r || !r.some((x) => pulisci(x))) continue;
    const allievo = pulisci(col.allievo !== undefined && v(r, 'allievo') ? v(r, 'allievo') : `${v(r, 'cognome')} ${v(r, 'nome')}`).toUpperCase();
    const ragione = v(r, 'ragione');
    if (/^esempio/i.test(allievo) || /^esempio/i.test(ragione)) continue;
    const piva = v(r, 'piva').replace(/\s/g, '');
    const cf = v(r, 'cf').replace(/\s/g, '').toUpperCase();
    const via = v(r, 'via');
    const civico = v(r, 'civico');
    const comune = v(r, 'comune');
    const prov = v(r, 'prov').toUpperCase();
    const principale = [[via, civico].filter(Boolean).join(' '), [comune, prov ? `(${prov})` : ''].filter(Boolean).join(' ')].filter(Boolean).join(' - ');
    const altri = v(r, 'altri_cantieri').split(/\s*[;\n]\s*/).map(pulisci).filter(Boolean);
    const a = [];
    if (!allievo) a.push('Manca il nominativo dell\'allievo.');
    if (!ragione) a.push('Manca la ragione sociale.');
    if (piva && !/^\d{11}$/.test(piva)) a.push(`P.IVA «${piva}» non valida (servono 11 cifre).`);
    if (!piva && !cf) a.push('P.IVA non indicata: impresa cercata per nome.');
    if (!comune) a.push('Comune del cantiere non indicato.');
    righe.push({
      n: righe.length + 1,
      allievo,
      orario: v(r, 'orario') || null,
      tecnico_file: null,
      cantiere: { via, civico, comune, prov },
      azienda: {
        ragione_sociale: ragione || null,
        partita_iva: /^\d{11}$/.test(piva) ? piva : null,
        codice_fiscale: cf || (/^\d{11}$/.test(piva) ? piva : null),
        sede: null, sede_operativa: null, telefono: null, cellulare: null,
        email: v(r, 'email_impresa') || null,
        legale_rappresentante: null, cf_legale_rappresentante: null,
        cantieri: [principale, ...altri].filter(Boolean),
        tutor_aziendale: { nome: v(r, 'tutor') || null, telefono: v(r, 'tutor_tel') || null },
        tutor_formativo: v(r, 'tutor_formativo') || extra.tutor_formativo || null,
        tutor_scuola: extra.tutor_scuola || null,
      },
      note: v(r, 'note') || null,
      avvisi: a,
    });
  }
  if (!righe.length) avvisi.push('Il foglio «Allievi» non contiene righe compilate.');
  return { intestazione: h, righe, avvisi, note_elenco: extra.note || null };
}

/** L'anno scolastico in corso a una data: da settembre si passa al successivo. */
export function annoScolasticoDi(isoData) {
  const [a, m] = String(isoData).split('-').map(Number);
  return m >= 9 ? `${a}-${a + 1}` : `${a - 1}-${a}`;
}
