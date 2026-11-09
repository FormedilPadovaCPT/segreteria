/* La pagina «Commissione Sicurezza» ridotta alle sue regole (09/11/2026). Modulo puro:
   niente DOM, niente database — lo usa js/commissione.js e lo provano i test
   (test/commissione-regole.test.mjs). */

import { esc, dataIt } from './comune.js';

export const CARICHE = { presidente: 'Presidente', vicepresidente: 'Vicepresidente', consigliere: 'Consigliere' };
export const APP_URL = 'https://formedilpadovacpt.github.io/gestionale-visite/';

/* lo stato dell'accesso, in parole */
export function statoAccesso(m) {
  const a = m.accesso;
  if (!a || !a.account) return { testo: 'nessun accesso', classe: 'pill-off' };
  if (a.stato && a.stato !== 'attivo') return { testo: 'accesso chiuso', classe: 'pill-off' };
  if (!a.stessa_persona) return { testo: 'accesso di ' + (a.nome || 'un\'altra persona'), classe: 'pill-succ' };
  if (a.password_da_cambiare) return { testo: 'mai entrato', classe: 'pill-succ' };
  if (a.password_cambiata) return { testo: 'primo accesso il ' + dataIt(String(a.password_cambiata).slice(0, 10)), classe: 'pill-prima' };
  if (a.ultimo_accesso) return { testo: 'entrato il ' + dataIt(String(a.ultimo_accesso).slice(0, 10)), classe: 'pill-prima' };
  return { testo: 'mai entrato', classe: 'pill-succ' };
}

/* l'azione che manca, come pulsante */
export function azione(m) {
  const id = m.nomina_id;
  switch (m.da_fare) {
    case 'crea': return `<button class="btn btn-primary btn-sm" data-cm-crea="${id}" data-aiuto="Crea l'account del gestionale per questa persona: sola consultazione, password provvisoria il suo codice fiscale, da cambiare al primo accesso. Nessuna mail parte da sola.">🔑 Crea l'accesso</button>`;
    case 'riapri': return `<button class="btn btn-primary btn-sm" data-cm-crea="${id}" data-aiuto="Riapre l'accesso chiuso: la password torna quella provvisoria (codice fiscale), da cambiare al primo accesso.">↺ Riapri l'accesso</button>`;
    case 'subentro': return `<button class="btn btn-primary btn-sm" data-cm-crea="${id}" data-cm-subentro="1" data-aiuto="L'indirizzo di ruolo era di un'altra persona: passa l'accesso a questa. La password di prima smette di valere; le decisioni prese prima restano col nome di chi le ha prese.">🔁 Passaggio di consegne</button>`;
    case 'carica': return `<button class="btn btn-secondary btn-sm" data-cm-carica="${id}" data-aiuto="La mansione della nomina è cambiata: porta la stessa carica nell'accesso al gestionale (un solo Presidente e un solo Vicepresidente).">✏️ Aggiorna la carica</button>`;
    case 'manca_cf': return '<span class="hint">Manca il codice fiscale nell\'anagrafica: serve per la password provvisoria.</span>';
    case 'manca_email': return '<span class="hint">La nomina non ha un indirizzo: scrivilo nella nomina (email del ruolo).</span>';
    case 'conflitto': return '<span class="hint">L\'indirizzo è già usato da un accesso di altro tipo: da sistemare a parte.</span>';
    default: return m.accesso && m.accesso.password_da_cambiare
      ? `<button class="btn btn-ghost btn-sm" data-cm-benvenuto="${id}" data-aiuto="Apre il protocollo in uscita già compilato con la mail di benvenuto (indirizzo, link all'app, password provvisoria). La manda una persona, protocollata.">✉️ Benvenuto</button>`
      : '<span class="hint">a posto</span>';
  }
}

/* il testo del benvenuto: le note del protocollo OUT (Da:, A:, Oggetto:, riga vuota, saluto e corpo, senza firma) */
export function testoBenvenuto(m) {
  const carica = { presidente: 'Presidente', vicepresidente: 'Vicepresidente' }[m.carica] || 'membro';
  return `Da: cpt@formedilpadova.it
A: ${m.email}
Oggetto: Accesso all'applicazione delle visite in cantiere (Commissione Sicurezza, sola consultazione)

Gent.le ${m.nominativo},
in qualità di ${carica} della Commissione Sicurezza Le abbiamo attivato l'accesso all'applicazione con cui l'Area Sicurezza e Salute di FORMEDIL PADOVA gestisce le visite in cantiere.

Dall'applicazione può vedere la situazione delle visite sulla mappa e le statistiche d'insieme, aggiornate in tempo reale. Il Suo accesso è di sola consultazione.

Apri l'applicazione: ${APP_URL}

Come entrare
- Utente: ${m.email}
- Password provvisoria: il Suo codice fiscale, scritto tutto in maiuscolo e senza spazi. Vale solo per il primo accesso.
- Appena entrato, l'applicazione Le chiede di scegliere una password Sua: almeno 10 caratteri, con lettere e numeri. La si scrive due volte, per sicurezza.

Il manuale
In alto nell'applicazione trova il pulsante «Manuale»: scarica sempre l'ultima versione pubblicata.

Per qualunque necessità la Segreteria è a disposizione.

Cordiali saluti`;
}
