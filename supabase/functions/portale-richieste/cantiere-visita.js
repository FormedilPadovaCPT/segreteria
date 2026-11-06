/* ============================================================
   IL CANTIERE DELLA RICHIESTA DI VISITA (06/11/2026, deciso
   dall'utente: «se una impresa ci chiede il servizio li conosce»).

   Il modulo del portale raccoglie, oltre a indirizzo e comune,
   civico, posizione sulla mappa, descrizione, tipo di intervento,
   tipo di opera, date, fascia d'importo, codice CNCE, il
   committente e le altre imprese in cantiere. Tutto va nel primo
   elemento di s_visite_richieste.cantieri (jsonb): niente colonne
   nuove, e le pratiche di prima restano leggibili come sono.

   Si tiene solo ciò che ha senso: un codice fuori elenco, una data
   storta o una posizione fuori dal Nord-Est diventano vuoti invece
   di far cadere la richiesta. In segreteria la scheda del cantiere
   nasce da qui solo dopo che una persona l'ha controllata.

   Le voci sono quelle dell'Osservatorio nazionale (gestionale,
   app-data.js): intervento 1-4, opera 1-16 (16 = Altro, con la
   descrizione), importo 1-10.
   ============================================================ */

/* le voci come le legge una persona (mail alla segreteria, riquadro della pratica) */
export const VOCI_CANTIERE = {
  cant_tip_int: { 1: 'Costruzione', 2: 'Ristrutturazione', 3: 'Demolizione', 4: 'Ampliamento' },
  cant_tip_ope: { 1: 'Industriale', 2: 'Civile', 3: 'Commerciale', 4: 'Ospedaliera', 5: 'Stradale', 6: 'Rurale', 7: 'Funeraria',
    8: 'Scolastica', 9: 'Ferroviaria', 10: 'Marittima', 11: 'Fluviale', 12: 'Sportiva', 13: 'Carceraria', 14: 'Campi eolici',
    15: 'Fotovoltaica', 16: 'Altro' },
  cant_importo: { 1: 'fino a 250.000 €', 2: '250.001 – 500.000 €', 3: '500.001 – 1.000.000 €', 4: '1.000.001 – 1.500.000 €',
    5: '1.500.001 – 2.500.000 €', 6: '2.500.001 – 3.500.000 €', 7: '3.500.001 – 5.000.000 €', 8: '5.000.001 – 10.000.000 €',
    9: '10.000.001 – 15.000.000 €', 10: 'oltre 15.000.000 €' },
  comm_natura: { pubblico: 'Pubblico', privato: 'Privato' },
  comm_tipo: { fisica: 'Persona', giuridica: 'Società o ente' },
};

const t = (v, max = 300) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
const codice = (v, lo, hi) => { const n = Number(String(v ?? '').trim()); return Number.isInteger(n) && n >= lo && n <= hi ? n : null; };
const data = (v) => { const s = String(v ?? '').trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null; const d = new Date(s + 'T12:00:00Z'); return isNaN(d) || d.toISOString().slice(0, 10) !== s ? null : s; };
/* il riquadro largo del Nord-Est: basta a scartare un punto messo per sbaglio in mezzo al mare */
const coord = (lat, lng) => {
  const a = Number(lat), b = Number(lng);
  if (!isFinite(a) || !isFinite(b) || String(lat ?? '').trim() === '' || String(lng ?? '').trim() === '') return null;
  return a >= 43 && a <= 48 && b >= 9 && b <= 15 ? { lat: Math.round(a * 1e6) / 1e6, lng: Math.round(b * 1e6) / 1e6 } : null;
};

export function committenteDaModulo(d) {
  const natura = ['pubblico', 'privato'].includes(String(d.comm_natura || '')) ? d.comm_natura : null;
  const tipo = ['fisica', 'giuridica'].includes(String(d.comm_tipo || '')) ? d.comm_tipo : null;
  const c = {
    natura, tipo,
    nome: tipo === 'giuridica' ? null : t(d.comm_nome, 100),
    cognome: tipo === 'giuridica' ? null : t(d.comm_cognome, 100),
    ragione_sociale: tipo === 'fisica' ? null : t(d.comm_ragione_sociale, 200),
    cf: (t(d.comm_cf, 16) || '').replace(/\s+/g, '').toUpperCase() || null,
    contatto: t(d.comm_contatto, 200),
  };
  return Object.values(c).some(Boolean) ? c : null;
}

export function cantiereDaModulo(d, imprese) {
  const tipOpe = codice(d.cant_tip_ope, 1, 16);
  const pos = coord(d.cant_lat, d.cant_lng);
  const c = {
    indirizzo: t(d.indirizzo_cantiere),
    civico: t(d.civico_cantiere, 20),
    comune: t(d.comune_cantiere, 200),
    lat: pos ? pos.lat : null,
    lng: pos ? pos.lng : null,
    descrizione: t(d.cant_descrizione, 500),
    tip_int: codice(d.cant_tip_int, 1, 4),
    tip_ope: tipOpe,
    tip_ope_altro: tipOpe === 16 ? t(d.cant_tip_ope_altro, 200) : null,
    data_inizio: data(d.cant_data_inizio),
    data_fine: data(d.cant_data_fine),
    importo: codice(d.cant_importo, 1, 10),
    cnce: (t(d.cant_cnce, 30) || '').replace(/\s+/g, '').toUpperCase() || null,
    committente: committenteDaModulo(d),
    imprese: Array.isArray(imprese) && imprese.length ? imprese : null,
  };
  /* una data di fine prima dell'inizio non si tiene: la durata verrebbe negativa */
  if (c.data_inizio && c.data_fine && c.data_fine < c.data_inizio) c.data_fine = null;
  for (const k of Object.keys(c)) if (c[k] === null) delete c[k];
  return c.indirizzo || c.comune ? c : null;
}
