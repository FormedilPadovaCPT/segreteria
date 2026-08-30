/* ============================================================
   Bozze .eml per Outlook, con allegati.

   La riga «X-Unsent: 1» fa aprire il file nella finestra di
   composizione invece che come messaggio ricevuto: si rilegge,
   si sceglie l'account (cpt@formedilpadova.it) e si preme Invia
   a mano. È il confine di sempre: quello che esce dall'ufficio
   lo manda una persona.
   ============================================================ */

const b64riga = (byte) => {
  let s = '';
  const PEZZO = 0x8000;
  for (let i = 0; i < byte.length; i += PEZZO) s += String.fromCharCode(...byte.subarray(i, i + PEZZO));
  return btoa(s).replace(/(.{76})/g, '$1\r\n');
};

const codificaOggetto = (s) => /^[\x20-\x7e]*$/.test(s) ? s
  : '=?utf-8?B?' + btoa(String.fromCharCode(...new TextEncoder().encode(s))) + '?=';

/* Per le mail SENZA allegato: mailto: apre direttamente la finestra
   di composizione dell'app di posta predefinita (Outlook), senza
   passare da un file. Il protocollo mailto non puo' portare allegati:
   quando c'e' un PDF da allegare resta la strada del .eml. */
export function apriMailto({ to = '', cc = [], oggetto = '', corpo = '' }) {
  const p = new URLSearchParams();
  if (cc.length) p.set('cc', cc.join(','));
  p.set('subject', oggetto);
  p.set('body', corpo);
  /* URLSearchParams codifica gli spazi come «+», che i client di posta
     leggono alla lettera: si riportano alla forma %20 */
  window.location.href = `mailto:${encodeURIComponent(to)}?${p.toString().replace(/\+/g, '%20')}`;
}

/* Compone la bozza e la scarica. `allegati` = [{nome, byte, mime?}]. */
export function scaricaEml({ to = '', cc = [], oggetto, corpo, allegati = [], nomeFile = 'bozza.eml' }) {
  const B = 'Bozza-Formedil-Segreteria';
  const eml = [
    'X-Unsent: 1',
    `To: ${to}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    `Subject: ${codificaOggetto(oggetto)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${B}"`,
    '',
    `--${B}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    corpo,
    '',
    ...allegati.flatMap((a) => [
      `--${B}`,
      `Content-Type: ${a.mime || 'application/pdf'}; name="${a.nome}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${a.nome}"`,
      '',
      b64riga(a.byte),
    ]),
    `--${B}--`,
  ].join('\r\n');

  const url = URL.createObjectURL(new Blob([new TextEncoder().encode(eml)], { type: 'message/rfc822' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeFile;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* La firma della Segreteria come nella posta vera dell'ufficio,
   nota privacy compresa. */
export const FIRMA_SEGRETERIA = `Renato Squizzato
Area Sicurezza e Salute | FORMEDIL PADOVA

Via Basilicata 10
35127 Padova (PD)
email: cpt@formedilpadova.it
Tel. +39 049761168 (int.4) e Fax. +39 049760940
URL: https://www.formedilpadova.it

Organismo Accreditato Regione Veneto
per la formazione L.R. n. 19 del 09.08.02 cod. AO119
per i servizi al lavoro codice L236

__________________________________________________________________________

Ai sensi del Regolamento (UE) 2016/679 (GDPR) relativo alla protezione delle persone fisiche con riguardo al trattamento dei dati personali, la presente e-mail è destinata unicamente alle persone sopra indicate e le informazioni in essa contenute sono da considerarsi strettamente riservate. Se avete ricevuto questo messaggio per errore, siete pregati di rispedirlo al mittente, distruggendo qualunque copia in Vostro possesso, grazie.`;
