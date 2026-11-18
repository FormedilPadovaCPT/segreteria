/* ============================================================
   La bozza di una mail protocollata in uscita, preparata da un modulo
   dei servizi passando dalla STESSA funzione di «Invia protocollato»
   (send-protocollo, modo «protocollato»): cartiglio col QR in testa,
   firma e logo, oggetto nella forma di sempre (18/11/2026).

   Prima consulenze e cantieri critici componevano la mail da sé e il
   protocollo usciva come una riga di testo: vedi bozza-protocollata-testo.js.

   Fa tre cose, nell'ordine di mail.js: chiede la bozza alla funzione,
   registra la preparazione in s_prot_invii (l'invio lo fa una persona
   da Outlook, l'app non lo sa) e scrive nel campo note del protocollo
   il testo completo della mail. Torna i byte del .eml, che il modulo
   deposita nel vault e scarica.
   ============================================================ */

import { sb, state } from './core.js';
import { allargaDestinatari } from './eml.js';
import { dividiLettera, noteDaMail, listaIndirizzi } from './bozza-protocollata-testo.js';

const daB64 = (b64) => {
  const bin = atob(b64);
  const byte = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) byte[i] = bin.charCodeAt(i);
  return byte;
};

/* Il messaggio d'errore della funzione sta nel corpo della risposta, non in
   error.message (stessa lettura di mail.js, 13/11/2026). */
async function motivo(data, error) {
  if (data?.error) return data.error;
  try { const j = await error?.context?.json?.(); if (j?.error) return j.error; } catch { /* non JSON */ }
  return error?.message || 'risposta vuota';
}

/** `testo` = la lettera intera scritta dal modulo (apertura + corpo); in
 *  alternativa `saluto` e `messaggio` già divisi. `driveFileIds` = allegati
 *  che stanno su Drive. */
export async function preparaBozzaProtocollata({ protocollo, to, cc = [], testo, saluto, messaggio, oggettoMail, driveFileIds = [], nomiAllegati = [] }) {
  const parti = testo != null ? dividiLettera(testo) : { saluto: saluto || '', messaggio: messaggio || '' };
  /* i secondi indirizzi di chi non legge la casella d'ufficio, come per ogni bozza */
  const dest = allargaDestinatari({ to: listaIndirizzi(to).join(', '), cc: listaIndirizzi(cc) });
  const a = listaIndirizzi(dest.to);
  if (!a.length) throw new Error('Serve almeno un destinatario per la mail.');

  const { data, error } = await sb.functions.invoke('send-protocollo', { body: {
    protocolloId: protocollo.id, modo: 'protocollato', azione: 'bozza',
    to: a, cc: dest.cc, saluto: parti.saluto || undefined, messaggio: parti.messaggio,
    oggettoMail: oggettoMail || undefined, driveFileIds,
  } });
  if (error || data?.error || !data?.eml) {
    throw new Error(`Protocollo preso, ma la bozza non si è preparata: ${await motivo(data, error)}. Riprova: il numero resta lo stesso.`);
  }

  const allegati = data.allegati?.length ? data.allegati : nomiAllegati;
  const avvisi = [];
  const { error: eInv } = await sb.from('s_prot_invii').insert({
    protocollo_id: protocollo.id, modo: 'protocollato', canale: 'outlook',
    destinatari: a, cc: dest.cc, gruppi: [], oggetto: data.oggetto || null,
    testo: parti.messaggio || null, saluto: parti.saluto || null,
    allegati, preparata_da: state.email || null,
  });
  if (eInv) avvisi.push('preparazione non registrata nel protocollo: ' + eInv.message);

  const note = noteDaMail({ to: a, cc: dest.cc, oggetto: data.oggetto || '', allegati, saluto: parti.saluto, messaggio: parti.messaggio });
  const { error: eNote } = await sb.from('s_protocollo').update({
    note, mail_destinatari: [a.join(', '), dest.cc.length ? 'cc ' + dest.cc.join(', ') : ''].filter(Boolean).join('; '),
  }).eq('id', protocollo.id);
  if (eNote) avvisi.push('testo della mail non scritto nelle note del protocollo: ' + eNote.message);

  return { byte: daB64(data.eml), nomeFile: data.nomeFile || 'protocollo.eml', oggetto: data.oggetto, a, cc: dest.cc, avvisi };
}

/* il .eml scaricato: doppio clic e Outlook lo apre in composizione */
export function scaricaByteEml(byte, nome) {
  const url = URL.createObjectURL(new Blob([byte], { type: 'message/rfc822' }));
  const el = document.createElement('a');
  el.href = url; el.download = nome;
  document.body.appendChild(el); el.click(); el.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
