/* ============================================================
   LEGGERE UN RAPPORTO DI MANCATA CONSEGNA (21/09/2026).

   Le tre cose che servono a capire un rimbalzo, messe qui perché
   si possano provare senza chiamare Gmail: decodificare l'oggetto
   della mail originale, tirare fuori gli indirizzi che hanno
   fallito, riconoscere il numero di verbale.

   ⚠️ È un modulo PURO: niente rete, niente database, niente Deno.
   La edge function `mail-respinte` ne tiene una copia identica
   (come firma.js), tenuta allineata da `npm run firma-sync` e
   controllata da `npm run verifica-firma`.
   ============================================================ */

/* il numero di verbale come lo scrive il gestionale: CPT/25_26/0874 */
export const VERBALE_RE = /CPT\/\d{2}_\d{2}\/\d{3,5}/;
const MAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* ── l'oggetto di una mail non è testo: è codificato (RFC 2047) ──
   `=?UTF-8?Q?FORMEDIL_Padova_=2DAREA...?=`. Senza decodificarlo il
   numero di verbale resterebbe nascosto dentro la codifica e non si
   aggancerebbe mai niente — visto alla prima prova sulla casella vera,
   dove l'oggetto arrivava tutto in Q-encoding. */
export function decodificaOggetto(s) {
  return String(s || '')
    /* due parole codificate di fila: lo spazio in mezzo non è testo, è
       solo il modo di andare a capo previsto dalla norma */
    .replace(/(=\?[^?]+\?[QqBb]\?[^?]*\?=)\s+(?==\?)/g, '$1')
    .replace(/=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g, (_t, _ch, tipo, testo) => {
      try {
        let byte;
        if (/b/i.test(tipo)) {
          const b = atob(String(testo).replace(/-/g, '+').replace(/_/g, '/'));
          byte = Uint8Array.from(b, (c) => c.charCodeAt(0));
        } else {
          const crudo = String(testo).replace(/_/g, ' ');
          const n = [];
          for (let i = 0; i < crudo.length; i++) {
            if (crudo[i] === '=' && /^[0-9a-f]{2}$/i.test(crudo.slice(i + 1, i + 3))) {
              n.push(parseInt(crudo.slice(i + 1, i + 3), 16)); i += 2;
            } else n.push(crudo.charCodeAt(i));
          }
          byte = Uint8Array.from(n);
        }
        return new TextDecoder('utf-8').decode(byte);
      } catch { return testo; }
    });
}

/* ── gli indirizzi che hanno fallito ──
   Stanno nel blocco `message/delivery-status`, un gruppo di righe per
   destinatario. Si tengono solo i FALLITI: «delayed» vuol dire che il
   server ci sta ancora provando, e non è una notizia per nessuno. */
export function falliti(testo) {
  const out = [];
  /* le righe piegate (continuazione con spazio in testa) si riuniscono,
     o il Diagnostic-Code lungo arriverebbe tagliato a metà */
  const piano = String(testo || '').replace(/\r\n/g, '\n').replace(/\n[ \t]+/g, ' ');
  for (const blocco of piano.split(/\n\s*\n/)) {
    if (!/final-recipient|original-recipient/i.test(blocco)) continue;
    const azione = (blocco.match(/^Action:\s*([a-z]+)/im) || [])[1] || '';
    if (azione && !/failed/i.test(azione)) continue;
    const dest = (blocco.match(/^(?:Final|Original)-Recipient:\s*[^;]*;\s*<?([^\s>]+)/im) || [])[1] || '';
    if (!MAIL_RE.test(dest)) continue;
    const codice = (blocco.match(/^Status:\s*([245]\.\d+\.\d+)/im) || [])[1] || '';
    const motivo = ((blocco.match(/^Diagnostic-Code:\s*(.+)$/im) || [])[1] || '').trim();
    if (!azione && !codice) continue;      /* senza né azione né stato non è un rapporto */
    if (out.some((x) => x.destinatario === dest.toLowerCase())) continue;
    out.push({ destinatario: dest.toLowerCase(), codice, motivo: motivo.slice(0, 400) });
  }
  return out;
}

/* ── l'oggetto del messaggio ORIGINALE, non quello del rapporto ──
   Gmail non lo espone sempre come intestazione di una parte: a volte sta
   scritto dentro il corpo del rapporto, sotto «----- Original message
   -----». Si guarda in tutti e due i posti, si decodifica, e si scarta
   l'oggetto del rapporto stesso, che dice soltanto «Delivery Status
   Notification (Failure)» e non serve a nessuno. */
const RAPPORTO_RE = /delivery status notification|undelivered mail|mail delivery (failed|subsystem)|delivery has failed|returned mail/i;

export function oggettiCandidati(intestazioni, testo) {
  const dal = [...String(testo || '').matchAll(/^Subject:\s*(.+)$/gim)].map((x) => x[1].trim());
  return (intestazioni || []).concat(dal)
    .map((t) => decodificaOggetto(String(t || '')).trim())
    .filter(Boolean);
}

export function oggettoOriginale(candidati) {
  const c = candidati || [];
  const conVerbale = c.find((t) => VERBALE_RE.test(t));
  if (conVerbale) return conVerbale;
  const veri = c.filter((t) => !RAPPORTO_RE.test(t));
  return veri[veri.length - 1] || c[0] || null;
}

export function numeroVerbale(candidati, testo) {
  const m = (candidati || []).join(' | ').match(VERBALE_RE) || String(testo || '').match(VERBALE_RE);
  return m ? m[0] : null;
}
