/* ============================================================
   LA FIRMA DELLA POSTA D'UFFICIO — una sola, per tutte le mail
   che l'app prepara.

   Fino al 03/09/2026 le bozze .eml uscivano in testo semplice, senza
   logo né grafica: la firma era una manciata di righe in fondo. Da
   qui nasce ogni mail in DUE versioni dentro lo stesso messaggio:
   - text/plain, con la firma in righe (FIRMA_SEGRETERIA) per i client
     che non mostrano l'HTML;
   - text/html, col logo dell'ente, la barra arancione, gli orari, il
     bottone dei servizi, l'accreditamento e la nota privacy — la firma
     disegnata in «Firma Area Sicurezza e Salute» (Claude Design,
     03/09/2026), che è la stessa configurata in Outlook.

   ⚠️ Il logo viaggia come immagine INLINE (Content-ID, `cid:`), non
   come data-URI nel corpo: Outlook desktop non rende le immagini
   data:, mentre le inline le mostra. È la ragione per cui la mail è
   un multipart/related e non un semplice text/html.

   Questo modulo è usato dal browser (js/eml.js) E dalla edge function
   send-protocollo, che ne tiene una COPIA in
   supabase/functions/send-protocollo/ (Deno non può leggere fuori
   dalla cartella della funzione al deploy). La copia si rigenera con
   `npm run firma-sync`; `strumenti/verifica-firma.mjs` fallisce se le
   due divergono. Non usa DOM: gira uguale in browser, Node e Deno.
   ============================================================ */

import { LOGO_FIRMA_B64, LOGO_FIRMA_MIME, LOGO_FIRMA_LARGHEZZA, LOGO_FIRMA_ALTEZZA } from './firma-logo.js';

export const LOGO_FIRMA_CID = 'logo-formedil-padova@segreteria';

/* I dati della firma, in un posto solo: le due versioni (righe e HTML)
   si scrivono da qui. */
export const FIRMA_DATI = {
  nome: 'Renato Squizzato',
  area: 'Area Sicurezza e Salute',
  ente: 'Formedil Padova',
  indirizzo: 'Via Basilicata 10 · 35127 Padova (PD)',
  tel: '+39 049761168',
  telLink: '+39049761168',
  interno: 'int. 4',
  email: 'cpt@formedilpadova.it',
  sito: 'www.formedilpadova.it',
  sitoUrl: 'https://www.formedilpadova.it',
  serviziUrl: 'https://formedilpadovacpt.github.io/servizi/',
  serviziTesto: 'Richiesta sopralluoghi in cantiere · RLST · Asseverazione Sicurezza',
  orari: [
    ['Lunedì', 'dalle 09:00 alle 13:00 e dalle 14:00 alle 16:00'],
    ['Martedì', 'dalle 09:00 alle 13:00 e dalle 14:00 alle 18:00'],
    ['Mercoledì', 'dalle 09:00 alle 13:00 e dalle 14:00 alle 18:00'],
    ['Giovedì', 'dalle 09:00 alle 13:00 e dalle 14:00 alle 18:00'],
  ],
  accreditamento: [
    'Organismo Accreditato Regione Veneto',
    '› per la formazione L.R. n. 19 del 09.08.02 cod. AO119',
    '› per i servizi al lavoro codice L236',
  ],
  privacy: 'Ai sensi del Regolamento (UE) 2016/679 (GDPR) relativo alla protezione delle persone fisiche con riguardo al trattamento dei dati personali, la presente e-mail è destinata unicamente alle persone sopra indicate e le informazioni in essa contenute sono da considerarsi strettamente riservate. Se avete ricevuto questo messaggio per errore, siete pregati di rispedirlo al mittente, distruggendo qualunque copia in Vostro possesso, grazie.',
};

/* ── la firma in righe: la versione text/plain, e quella che i moduli
      accodano al corpo (vedi eml.js) ── */
export const FIRMA_SEGRETERIA = `${FIRMA_DATI.nome}
${FIRMA_DATI.area} | ${FIRMA_DATI.ente.toUpperCase()}

${FIRMA_DATI.indirizzo.replace(' · ', '\n')}
Tel. ${FIRMA_DATI.tel} (${FIRMA_DATI.interno})
email: ${FIRMA_DATI.email}
URL: ${FIRMA_DATI.sitoUrl}

Orari uff. ${FIRMA_DATI.area}
${FIRMA_DATI.orari.map(([g, o]) => `${g} ${o}`).join('\n')}

App Servizi CPT — ${FIRMA_DATI.serviziTesto}
${FIRMA_DATI.serviziUrl}

${FIRMA_DATI.accreditamento.join('\n')}

__________________________________________________________________________

${FIRMA_DATI.privacy}`;

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FONT = "Barlow,'Segoe UI',Arial,Helvetica,sans-serif";
const ARANCIO = '#E7500F';
const GRIGIO = '#565C66';
const SCURO = '#3F444C';
const CHIARO = '#8A9099';

/* ── la firma HTML: tabella a larghezza fissa, stili inline, nessun
      CSS esterno — è quello che regge in Outlook ── */
export function firmaHtml() {
  const d = FIRMA_DATI;
  const cella = (extra = '') => `font-family:${FONT};${extra}`;
  const righeOrari = d.orari.map(([g, o], i) => `
<tr>
<td width="14" valign="top" style="width:14px;padding:${i ? 3 : 0}px 0 0 0;${cella(`font-size:12px;line-height:17px;mso-line-height-rule:exactly;color:${ARANCIO};`)}">&rsaquo;</td>
<td width="96" valign="top" style="width:96px;padding:${i ? 3 : 0}px 0 0 0;${cella(`font-size:12px;line-height:17px;mso-line-height-rule:exactly;font-weight:600;color:${GRIGIO};`)}">${esc(g)}</td>
<td valign="top" style="padding:${i ? 3 : 0}px 0 0 0;${cella(`font-size:12px;line-height:17px;mso-line-height-rule:exactly;color:${CHIARO};`)}">${esc(o)}</td>
</tr>`).join('');

  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="552" style="width:552px;border-collapse:collapse;${cella(`color:${GRIGIO};`)}">
<tr>
<td width="552" style="width:552px;padding:0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="552" style="width:552px;border-collapse:collapse;">
<tr>
<td width="250" valign="top" style="width:250px;padding:0 20px 0 0;">
<img src="cid:${LOGO_FIRMA_CID}" width="${LOGO_FIRMA_LARGHEZZA}" height="${LOGO_FIRMA_ALTEZZA}" alt="Formedil Padova — Scuola Costruzioni Giuseppe Jappelli" style="display:block;width:${LOGO_FIRMA_LARGHEZZA}px;height:${LOGO_FIRMA_ALTEZZA}px;border:0;outline:none;text-decoration:none;">
</td>
<td width="3" bgcolor="${ARANCIO}" style="width:3px;background-color:${ARANCIO};font-size:0;line-height:0;">&nbsp;</td>
<td width="279" valign="top" style="width:279px;padding:0 0 0 20px;${cella(`font-size:14px;line-height:20px;mso-line-height-rule:exactly;color:${GRIGIO};`)}">
<div style="font-size:19px;line-height:24px;mso-line-height-rule:exactly;font-weight:600;color:${SCURO};">${esc(d.nome)}</div>
<div style="padding-top:2px;font-size:11px;line-height:16px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${ARANCIO};">${esc(d.area)}</div>
<div style="padding-top:1px;font-size:11px;line-height:16px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${GRIGIO};">${esc(d.ente)}</div>
<div style="padding-top:10px;font-size:13px;line-height:19px;mso-line-height-rule:exactly;color:${GRIGIO};">${esc(d.indirizzo)}</div>
<div style="padding-top:4px;font-size:13px;line-height:19px;mso-line-height-rule:exactly;color:${GRIGIO};">Tel. <a href="tel:${esc(d.telLink)}" style="color:${GRIGIO};text-decoration:none;">${esc(d.tel)}</a> (${esc(d.interno).replace(' ', '&nbsp;')})</div>
<div style="padding-top:4px;font-size:13px;line-height:19px;mso-line-height-rule:exactly;color:${GRIGIO};">email: <a href="mailto:${esc(d.email)}" style="color:${ARANCIO};text-decoration:none;font-weight:600;">${esc(d.email)}</a></div>
<div style="padding-top:4px;font-size:13px;line-height:19px;mso-line-height-rule:exactly;color:${GRIGIO};"><a href="${esc(d.sitoUrl)}" style="color:${ARANCIO};text-decoration:none;font-weight:600;">${esc(d.sito)}</a></div>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td width="552" style="width:552px;padding:16px 0 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="552" style="width:552px;border-collapse:collapse;">
<tr>
<td width="552" style="width:552px;padding:0 0 7px 0;${cella(`font-size:11px;line-height:16px;mso-line-height-rule:exactly;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${SCURO};`)}">Orari uff. ${esc(d.area)}</td>
</tr>
<tr>
<td width="552" style="width:552px;padding:0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="552" style="width:552px;border-collapse:collapse;">${righeOrari}
</table>
</td>
</tr>
</table>
</td>
</tr>
<tr>
<td width="552" style="width:552px;padding:18px 0 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
<tr>
<td bgcolor="${ARANCIO}" style="background-color:${ARANCIO};border-radius:6px;padding:9px 18px;white-space:nowrap;${cella('font-size:13px;line-height:17px;mso-line-height-rule:exactly;font-weight:600;')}">
<a href="${esc(d.serviziUrl)}" style="display:block;color:#FFFFFF;text-decoration:none;font-weight:600;white-space:nowrap;">Vai ai Servizi &nbsp;&rsaquo;</a>
</td>
<td style="padding-left:14px;${cella(`font-size:13px;line-height:18px;mso-line-height-rule:exactly;color:${SCURO};`)}"><span style="font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${GRIGIO};">App Servizi CPT</span> — ${esc(d.serviziTesto)}</td>
</tr>
</table>
</td>
</tr>
<tr>
<td width="552" style="width:552px;padding:16px 0 0 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="552" style="width:552px;border-collapse:collapse;">
<tr><td width="552" height="1" bgcolor="#DDDDDD" style="width:552px;height:1px;background-color:#DDDDDD;font-size:0;line-height:0;padding:0;">&nbsp;</td></tr>
</table>
</td>
</tr>
<tr>
<td width="552" style="width:552px;padding:12px 0 0 0;${cella(`font-size:11px;line-height:17px;mso-line-height-rule:exactly;color:${CHIARO};`)}">
${d.accreditamento.map(esc).join('<br>\n')}
</td>
</tr>
<tr>
<td width="552" style="width:552px;padding:14px 0 0 0;${cella('font-size:10px;line-height:15px;mso-line-height-rule:exactly;color:#9AA0A8;')}">
${esc(d.privacy)}
</td>
</tr>
</table>`;
}

/* ── il testo di una mail scritto dai moduli (righe, paragrafi separati
      da una riga vuota) reso in HTML: paragrafi, a-capo, link cliccabili
      su indirizzi web e di posta. Non interpreta markup: il testo
      resta testo ── */
export function testoInHtml(testo) {
  const linkifica = (s) => s
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:)])/g, `<a href="$1" style="color:${ARANCIO};">$1</a>`)
    .replace(/(^|[\s(])([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g, `$1<a href="mailto:$2" style="color:${ARANCIO};">$2</a>`);
  return String(testo ?? '').replace(/\r\n/g, '\n').trim().split(/\n{2,}/).map((par) =>
    `<p style="margin:0 0 12px;${`font-family:${FONT};`}font-size:14px;line-height:21px;color:#1F2933;">${
      linkifica(esc(par)).replace(/\n/g, '<br>\n')}</p>`).join('\n');
}

/* ── una pagina HTML completa: corpo + firma ── */
export function paginaHtml(corpoHtml, { firma = true } = {}) {
  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:18px 20px;background:#FFFFFF;">
${corpoHtml}
${firma ? `<div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>\n${firmaHtml()}` : ''}
</body></html>`;
}

/* ── MIME ── */
const b64 = (byte) => {
  let s = '';
  const PEZZO = 0x8000;
  for (let i = 0; i < byte.length; i += PEZZO) s += String.fromCharCode(...byte.subarray(i, i + PEZZO));
  return btoa(s);
};
const b64testo = (s) => b64(new TextEncoder().encode(s));
const aRighe = (s) => s.replace(/(.{76})/g, '$1\r\n');

export const codificaOggetto = (s) => /^[\x20-\x7e]*$/.test(s) ? s : `=?utf-8?B?${b64testo(s)}?=`;

/* Toglie dal corpo la firma in righe, se un modulo l'ha già accodata:
   nel messaggio ci pensa componiEml a metterla, in tutte e due le
   versioni. */
export function senzaFirma(corpo) {
  const c = String(corpo ?? '').replace(/\r\n/g, '\n');
  const i = c.indexOf(FIRMA_SEGRETERIA);
  return (i >= 0 ? c.slice(0, i) : c).replace(/\s+$/, '');
}

/* Compone il messaggio completo e lo restituisce come testo RFC 822.
     to, cc, oggetto      — intestazioni
     corpo                — il testo in righe (con o senza firma in coda)
     html                 — facoltativo: un corpo HTML già pronto (le mail
                            del protocollo); se manca si ricava dal corpo
     allegati             — [{nome, byte: Uint8Array, mime?}]
     firma                — false per una mail senza firma
     unsent               — true: «X-Unsent: 1», Outlook la apre in bozza
     from                 — facoltativo (le bozze prendono l'account di Outlook)
   Struttura:
     multipart/mixed
       multipart/alternative
         text/plain
         multipart/related
           text/html
           image/jpeg (il logo, cid:)
       allegati…                                                       */
export function componiEml({ from = '', to = '', cc = [], oggetto = '', corpo = '', html = '', allegati = [], firma = true, unsent = true }) {
  const testo = senzaFirma(corpo);
  const plain = firma ? `${testo}\n\n${FIRMA_SEGRETERIA}` : testo;
  const pagina = html || paginaHtml(testoInHtml(testo), { firma });
  const conLogo = pagina.includes(`cid:${LOGO_FIRMA_CID}`);
  const stampo = Date.now().toString(36);
  const B_MIX = `=_mix_${stampo}`;
  const B_ALT = `=_alt_${stampo}`;
  const B_REL = `=_rel_${stampo}`;
  const ccList = Array.isArray(cc) ? cc.filter(Boolean) : (cc ? [cc] : []);

  const parteHtml = [
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    aRighe(b64testo(pagina)),
  ];
  const htmlEventualmenteConLogo = conLogo ? [
    `Content-Type: multipart/related; boundary="${B_REL}"; type="text/html"`,
    '',
    `--${B_REL}`,
    ...parteHtml,
    '',
    `--${B_REL}`,
    `Content-Type: ${LOGO_FIRMA_MIME}; name="logo-formedil-padova.jpg"`,
    'Content-Transfer-Encoding: base64',
    `Content-ID: <${LOGO_FIRMA_CID}>`,
    'Content-Disposition: inline; filename="logo-formedil-padova.jpg"',
    '',
    aRighe(LOGO_FIRMA_B64),
    '',
    `--${B_REL}--`,
  ] : parteHtml;

  return [
    ...(unsent ? ['X-Unsent: 1'] : []),
    ...(from ? [`From: ${from}`] : []),
    `To: ${to}`,
    ...(ccList.length ? [`Cc: ${ccList.join(', ')}`] : []),
    `Subject: ${codificaOggetto(oggetto)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${B_MIX}"`,
    '',
    `--${B_MIX}`,
    `Content-Type: multipart/alternative; boundary="${B_ALT}"`,
    '',
    `--${B_ALT}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    aRighe(b64testo(plain)),
    '',
    `--${B_ALT}`,
    ...htmlEventualmenteConLogo,
    '',
    `--${B_ALT}--`,
    '',
    ...allegati.flatMap((a) => [
      `--${B_MIX}`,
      `Content-Type: ${a.mime || 'application/pdf'}; name="${a.nome}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${a.nome}"`,
      '',
      aRighe(b64(a.byte)),
      '',
    ]),
    `--${B_MIX}--`,
    '',
  ].join('\r\n');
}
