/* ============================================================
   IL TIMBRO DI PROTOCOLLO NELLA MAIL — la «stampa del protocollo»
   che va in testa al messaggio «Invia protocollato».

   È lo stesso disegno del timbro «blocco» che si mette sul cartaceo
   (js/timbro-disegno.js): cornice arancione, banda arancione in alto
   col nome dell'ente, numero e data in grande con il QR a destra, e
   sotto la griglia a filo sottile — oggetto | ufficio, mittente o
   destinatario | mezzo, cartella | referente. Chiesto dall'utente il
   09/09/2026: «il formato che mettiamo anche nel cartaceo, quello
   completo con la banda arancione in alto».

   Scritto in HTML da posta (tabelle, stili inline, niente CSS
   esterno) perché deve reggere in Outlook. Il QR arriva come
   immagine inline (cid:), non come data-URI: Outlook desktop le
   immagini data: non le rende.

   Modulo puro, senza import: gira in Deno (la edge function) e in
   Node (l'anteprima in strumenti/), e non dipende dal browser.
   ============================================================ */

export const FONT_MAIL = "Barlow,'Segoe UI',Arial,Helvetica,sans-serif";
const ARANCIO = '#E7500F';
const NERO = '#1A1A1F';
const GRIGIO = '#565C66';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const dataIt = (iso) => {
  if (!iso) return '';
  const [a, m, g] = String(iso).slice(0, 10).split('-');
  return g ? `${g}/${m}/${a}` : String(iso);
};

/* Il numero come sul timbro: prima della serie unica «n° 2563», dopo
   il codice intero (Prot_26-27_0001). */
const numeroTimbro = (p) => p.esercizio
  ? (p.codice || `Prot_${p.esercizio}_${String(p.numero ?? '').padStart(4, '0')}`)
  : `n° ${p.numero ?? ''}`;

/* Il testo che il QR porta: identico a quello del timbro sul cartaceo
   (testoQr in timbro-disegno.js), così i due QR dicono la stessa cosa. */
export function testoQrTimbro(p) {
  const codice = p.codice || (p.esercizio
    ? `Prot_${p.esercizio}_${String(p.numero ?? '').padStart(4, '0')}`
    : `${p.numero ?? ''}${p.direzione === 'IN' ? '-in' : p.direzione === 'OUT' ? '-out' : ''}`);
  const sigla = codice.startsWith('Prot_') ? codice : `Prot_${codice}`;
  const nominativo = p.impresa_nome || p.persona || p.alla_ca || '';
  return [sigla, dataIt(p.data_prot), (p.oggetto || '').slice(0, 90), nominativo.slice(0, 60)]
    .filter(Boolean).join(' ');
}

/* `qrSrc` è il src dell'immagine del QR (di norma `cid:…`); senza, la
   casella del QR resta vuota. `ente` e `area` come in config.js. */
export function timbroHtml(p, { qrSrc = '', ente = 'FORMEDIL PADOVA', area = 'Area Sicurezza e Salute' } = {}) {
  const cella = (extra = '') => `font-family:${FONT_MAIL};${extra}`;
  const filo = `border-top:1px solid ${ARANCIO};`;
  const testoCella = `${cella(`font-size:9.5px;line-height:12px;color:${NERO};`)}padding:3px 6px;vertical-align:top;word-break:break-word;`;
  const sx = `${testoCella}width:224px;border-right:1px solid ${ARANCIO};`;
  const dx = `${testoCella}width:124px;`;
  const riga = (a, b) => `
<tr>
<td width="224" style="${sx}${filo}">${esc(a) || '&nbsp;'}</td>
<td width="124" style="${dx}${filo}">${esc(b) || '&nbsp;'}</td>
</tr>`;

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="360" style="width:360px;table-layout:fixed;border-collapse:collapse;border:1px solid ${ARANCIO};background:#FFFFFF;">
<tr>
<td colspan="2" bgcolor="${ARANCIO}" style="background-color:${ARANCIO};padding:3px 6px;${cella('font-size:8px;line-height:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:#FFFFFF;')}">${esc(ente)} &middot; ${esc(area)}</td>
</tr>
<tr>
<td colspan="2" style="padding:0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="360" style="width:360px;border-collapse:collapse;">
<tr>
<td valign="top" style="padding:6px 8px 4px;${cella('')}">
<div style="${cella(`font-size:18px;line-height:22px;font-weight:700;color:${ARANCIO};`)}">${esc(numeroTimbro(p))}</div>
<div style="${cella(`font-size:11px;line-height:15px;color:${NERO};`)}">del ${esc(dataIt(p.data_prot))}</div>
</td>
<td width="64" valign="top" align="right" style="width:64px;padding:4px 6px 2px 0;">
${qrSrc ? `<img src="${esc(qrSrc)}" width="56" height="56" alt="QR del protocollo" style="display:block;width:56px;height:56px;border:0;">` : '&nbsp;'}
</td>
</tr>
</table>
</td>
</tr>
${riga(p.oggetto, p.ufficio || 'Segreteria Area Sicurezza e Salute')}
${riga(p.impresa_nome || p.persona, p.mezzo)}
${riga(p.cartella, p.referente)}
</table>`;
}

/* La stessa cosa in righe, per la parte text/plain della mail. */
export function timbroTesto(p, { ente = 'FORMEDIL PADOVA', area = 'Area Sicurezza e Salute' } = {}) {
  return [
    `${ente} · ${area}`.toUpperCase(),
    `Protocollo ${numeroTimbro(p)} del ${dataIt(p.data_prot)}`,
    p.oggetto ? `Oggetto: ${p.oggetto}` : '',
    `Ufficio: ${p.ufficio || 'Segreteria Area Sicurezza e Salute'}`,
    (p.impresa_nome || p.persona) ? `Destinatario: ${p.impresa_nome || p.persona}` : '',
    p.mezzo ? `Mezzo: ${p.mezzo}` : '',
    p.referente ? `Referente: ${p.referente}` : '',
  ].filter(Boolean).join('\n');
}
