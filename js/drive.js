/* ============================================================
   I documenti del protocollo stanno su Google Drive.

   Non nel bucket di Supabase: decisione dell'utente del
   2026-08-28. Nel database resta solo l'indice — quali file
   appartengono a un protocollo, quale e' l'originale e quale il
   timbrato — con l'id Drive di ciascuno.

   Tutto passa dalla edge function `allegati-protocollo`, che
   scrive con il service account dell'ente: le credenziali non
   arrivano mai al browser, e i file non sono pubblici (chi non
   ha l'accesso non ci arriva nemmeno col link).

   ⚠️ Il protocollo non e' un contenitore, e' una MAPPA. I documenti
   protocollati non restano in una cartella del protocollo: vengono
   smistati dove devono stare, come tutto il resto del second brain
   — il preventivo firmato nell'asseverazione di quell'impresa, la
   circolare in 3_RISORSE. Il protocollo serve a sapere DOVE sono
   andati a finire.

   Per questo il caricamento mette il file in `00_INBOX/_protocollo`,
   che e' una zona d'attesa e non un archivio, e il link e' sempre al
   SINGOLO FILE, mai a una cartella. Funziona perche' spostando un
   file dentro Drive **l'id non cambia**: lo smistamento non rompe
   nessun link.
   ============================================================ */

import { sb, codiceProtocollo } from './core.js';

/* Il passaggio via base64 dentro a JSON gonfia il file di un terzo
   e lo tiene tutto in memoria, di qua e di la'. Sopra i pochi MB
   non regge: meglio dirlo prima che a meta' caricamento. */
export const LIMITE_MB = 12;

const b64 = (byte) => {
  let s = '';
  const PEZZO = 0x8000;
  for (let i = 0; i < byte.length; i += PEZZO) s += String.fromCharCode(...byte.subarray(i, i + PEZZO));
  return btoa(s);
};
const daB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function chiama(corpo) {
  const { data, error } = await sb.functions.invoke('allegati-protocollo', { body: corpo });
  if (error) throw new Error(error.message || String(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

/* Carica dei byte e restituisce id e link. `nome` e' il nome che
   il file avra' su Drive. */
export async function caricaByte(protocollo, nome, byte, mime = 'application/pdf') {
  if (byte.length > LIMITE_MB * 1024 * 1024) {
    throw new Error(`Il file supera i ${LIMITE_MB} MB e non passa da qui. `
      + 'Mettilo a mano nella cartella su Drive e incolla il link nel protocollo.');
  }
  return chiama({
    action: 'upload',
    codice: codiceProtocollo(protocollo),   /* entra nel NOME del file, non nella cartella */
    filename: nome, mime_type: mime, base64: b64(byte),
  });
}

export async function caricaFile(protocollo, file) {
  const byte = new Uint8Array(await file.arrayBuffer());
  return caricaByte(protocollo, file.name, byte, file.type || 'application/octet-stream');
}

/* Rilegge un documento da Drive, per timbrarlo o per mandarlo. */
export async function leggiByte(driveFileId) {
  const d = await chiama({ action: 'download', drive_file_id: driveFileId });
  return daB64(d.base64);
}

/* In che cartella si trova ADESSO il documento. E' quello che rende
   il protocollo una mappa: dopo lo smistamento dice dov'e' finito. */
export async function dove(driveFileId) {
  return chiama({ action: 'dove', drive_file_id: driveFileId });
}

/* Non cancella: mette nel cestino di Drive, da cui si recupera.
   E' la regola d'oro 4 del vault applicata anche qui. */
export async function cestina(driveFileId) {
  return chiama({ action: 'delete', drive_file_id: driveFileId });
}
