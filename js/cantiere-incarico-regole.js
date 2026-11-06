/* ============================================================
   IL CANTIERE DELL'INCARICO — le regole pure (29/10/2026).
   Funzioni senza Supabase e senza DOM, per provarle con Node;
   la maschera sta in cantiere-incarico.js.
   ============================================================ */

/* Il comune scritto nel modulo («PADOVA - Q3 EST (Brenta - Venezia…)») come lo vuole
   l'anagrafica dei cantieri: il nome del comune, senza quartiere, in maiuscolo (il
   quartiere a Padova lo ricava il gestionale dall'indirizzo). Il codice ISTAT lo mette
   il database dal nome (trg_cantiere_autofill). */
export function comuneAnagrafica(testo) {
  return String(testo || '')
    .replace(/\(.*$/, '')
    .replace(/\s+-\s+.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/* Il testo cercato dentro un filtro .or() di PostgREST: virgole, parentesi, asterischi
   e punti spezzerebbero il filtro, quindi diventano spazi; restano almeno 2 caratteri. */
export function testoRicerca(q) {
  const t = String(q || '').replace(/[,()*%\\.:"']/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length >= 2 ? t : '';
}

/* Indirizzo e civico scritti nel modulo in un campo solo («via Marghera 4/6»,
   «VIA GIOVANNI BOCCACCIO SNC»): il civico è l'ultima parola se comincia con una cifra
   o è SNC; altrimenti civico SNC, che è come l'anagrafica scrive «senza numero». */
export function separaCivico(testo) {
  const t = String(testo || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.*\S)\s+(\d[\w/-]*|snc|s\.n\.c\.?)$/i);
  if (m) return { indirizzo: m[1].toUpperCase(), civico: /^s/i.test(m[2]) ? 'SNC' : m[2].toUpperCase() };
  return { indirizzo: t.toUpperCase(), civico: 'SNC' };
}

/* Come si legge un cantiere in un elenco: etichetta se c'è, altrimenti indirizzo e
   civico, poi lotto e comune. */
export function etichettaCantiere(c) {
  if (!c) return '';
  const base = String(c.cantiere_etichetta || c.etichetta || '').trim()
    || [c.cantiere_indirizzo || c.indirizzo, c.cantiere_civico || c.civico].filter(Boolean).join(' ');
  const lotto = c.lotto && !new RegExp('lotto\\s+' + String(c.lotto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(base)
    ? ` – lotto ${c.lotto}` : '';
  const comune = c.comune_nome || c.comune;
  return `${base}${lotto}${comune ? ` · ${comune}` : ''}`;
}

/* Che cosa scrivere sulla pratica (e sull'incarico) dalla scelta fatta nella maschera.
   lotti = righe di lotti_del_cantiere; scelta = cantiere_id di un lotto oppure 'tutti'.
   Con «tutti» l'incarico prende la scheda di partenza del complesso (la radice, quella
   senza lotto_di) o, se non si conosce, quella cercata: il complesso lo ricalcola sempre
   il database con lotti_del_cantiere, quindi valgono anche i lotti creati dopo. */
export function sceltaDaSalvare({ cercato, lotti = [], scelta }) {
  if (!cercato) return null;
  if (scelta === 'tutti') {
    if (lotti.length < 2) return { cantiere_id: cercato, tutti_i_lotti: false };
    return { cantiere_id: cercato, tutti_i_lotti: true };
  }
  const id = scelta || cercato;
  if (lotti.length && !lotti.some((l) => l.cantiere_id === id)) return null;
  return { cantiere_id: id, tutti_i_lotti: false };
}

/* (06/11/2026) La richiesta di visita del portale porta il cantiere completo (portale-richieste,
   cantiere-visita.js). Da lì i campi della scheda del cantiere, solo quelli validi: la segreteria li
   vede prima di creare la scheda, e quello che manca lo completa il tecnico nel verbale. */
const intero = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const giorno = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
export function schedaDaModulo(m) {
  m = m || {};
  const tipOpe = intero(m.tip_ope, 1, 16);
  const lat = Number(m.lat), lng = Number(m.lng);
  const pos = m.lat != null && m.lng != null && isFinite(lat) && isFinite(lng) && lat >= 43 && lat <= 48 && lng >= 9 && lng <= 15;
  const f = {
    cantiere_descrizione: String(m.descrizione || '').trim() || null,
    cantiere_tip_int: intero(m.tip_int, 1, 4),
    cantiere_tip_ope: tipOpe,
    cantiere_tip_ope_altro: tipOpe === 16 ? (String(m.tip_ope_altro || '').trim() || null) : null,
    data_inizio_lavori: giorno(m.data_inizio),
    data_ult: giorno(m.data_fine),
    cantiere_importo: intero(m.importo, 1, 10),
    cantiere_cnce: String(m.cnce || '').replace(/\s+/g, '').toUpperCase() || null,
    ...(pos ? { lat, lng, geocode_status: 'manuale', geocoded_at: new Date().toISOString() } : {}),
  };
  for (const k of Object.keys(f)) if (f[k] === null) delete f[k];
  return f;
}

/* Il committente del modulo come riga di `committenti`. La chiave è il codice fiscale o la P.IVA
   (come nel gestionale): senza, non si crea niente e lo completa il tecnico. 1 = pubblico, 2 = privato;
   PF/PG come tipo_sogg. */
export function committenteDaModulo(c) {
  if (!c) return null;
  const cf = String(c.cf || '').replace(/\s+/g, '').toUpperCase();
  const nome = c.tipo === 'giuridica'
    ? String(c.ragione_sociale || '').trim()
    : [c.nome, c.cognome].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
  const tipo = c.natura === 'pubblico' ? 1 : c.natura === 'privato' ? 2 : null;
  return {
    chiave: /^[A-Z0-9]{11}$|^[A-Z0-9]{16}$/.test(cf) ? cf : null,
    riga: {
      committente_nome: nome.toUpperCase() || null,
      committente_tipo: tipo,
      tipo_sogg: c.tipo === 'giuridica' ? 'PG' : c.tipo === 'fisica' ? 'PF' : null,
      cf_piva: cf || null,
      piva: /^\d{11}$/.test(cf) ? cf : null,
      email: /@/.test(String(c.contatto || '')) ? String(c.contatto).trim() : null,
      telefono: c.contatto && !/@/.test(String(c.contatto)) ? String(c.contatto).trim() : null,
    },
  };
}

/* distanza in metri fra due punti (per i cantieri vicini al segnaposto del modulo) */
export function metri(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
}
