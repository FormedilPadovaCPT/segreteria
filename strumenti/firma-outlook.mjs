/* ============================================================
   firma-outlook.mjs — la firma da installare in Outlook.

   La firma dell'ufficio è disegnata da `firmaHtml()` in js/firma.js ed è
   quella che le app mettono in fondo a ogni bozza. In Outlook però la
   firma è configurata a mano, e finché si ricopia a occhio le due
   divergono: è successo il 21/09/2026 col bottone «Vai ai Servizi», che
   nelle mail dell'app aveva preso il rilievo e in Outlook no.

   Qui la firma si GENERA dalla stessa funzione, così resta una sola.
   Lo script scrive, nella cartella indicata:

     <Nome>.htm            la firma, con l'immagine in percorso relativo
     <Nome>_file/logo-firma.jpg   il logo, dove Outlook se lo aspetta
     _ANTEPRIMA.html       la stessa firma col logo incorporato, per
                           guardarla nel browser (e per il copia-incolla)

   ⚠️ Il logo NON è un data URI nel file di Outlook: Outlook desktop non
   rende le immagini `data:`. Nelle mail viaggia come immagine inline
   (`cid:`), qui come file affiancato — sono due strade per lo stesso
   motivo, e nessuna delle due è il data URI.

   Uso:  node strumenti/firma-outlook.mjs [cartella] [--nome "Area …"]
   Senza argomenti scrive in strumenti/_firma-outlook/.
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const qui = dirname(fileURLToPath(import.meta.url));
const radice = join(qui, '..');

const argomenti = process.argv.slice(2);
const iNome = argomenti.indexOf('--nome');
const NOME = iNome >= 0 ? argomenti[iNome + 1] : 'Area Sicurezza e Salute';
/* ⚠️ senza «--nome» iNome vale -1, e iNome+1 è 0: il filtro scarterebbe
   proprio il primo argomento, cioè la cartella (successo alla prima prova) */
const destArg = argomenti.filter((a, k) => !a.startsWith('--') && (iNome < 0 || k !== iNome + 1))[0];
const DEST = resolve(destArg || join(qui, '_firma-outlook'));

const { firmaHtml, LOGO_FIRMA_CID, FIRMA_DATI } = await import('../js/firma.js');
const { LOGO_FIRMA_B64, LOGO_FIRMA_MIME } = await import('../js/firma-logo.js');

const logo = join(radice, 'img', 'logo-firma.jpg');
if (!existsSync(logo)) { console.error('✗ manca img/logo-firma.jpg'); process.exit(1); }

const corpo = firmaHtml();
const cid = `cid:${LOGO_FIRMA_CID}`;
if (!corpo.includes(cid)) { console.error('✗ la firma non cita il logo inline: controlla firma.js'); process.exit(1); }

const cartellaFile = `${NOME}_file`;
const pagina = (srcLogo) => `<!DOCTYPE html>
<html lang="it"><head><meta charset="UTF-8"><meta name="color-scheme" content="light">
<title>${NOME}</title></head>
<body style="margin:0;padding:0;background:#FFFFFF;">
${corpo.replace(cid, srcLogo)}
</body></html>`;

mkdirSync(join(DEST, cartellaFile), { recursive: true });
writeFileSync(join(DEST, `${NOME}.htm`), pagina(`${cartellaFile}/logo-firma.jpg`), 'utf8');
writeFileSync(join(DEST, cartellaFile, 'logo-firma.jpg'), readFileSync(logo));
writeFileSync(join(DEST, '_ANTEPRIMA.html'), pagina(`data:${LOGO_FIRMA_MIME};base64,${LOGO_FIRMA_B64}`), 'utf8');

/* due controlli, perché una firma sbagliata si scopre solo quando è già partita */
const scritta = readFileSync(join(DEST, `${NOME}.htm`), 'utf8');
const ko = [];
if (scritta.includes('cid:')) ko.push('è rimasto un riferimento cid: nel file di Outlook');
if (!scritta.includes(FIRMA_DATI.nome)) ko.push('manca il nome nella firma');
if (!scritta.includes('border-bottom:3px solid')) ko.push('il bottone dei Servizi non ha il rilievo');
if (ko.length) { ko.forEach((m) => console.error('✗ ' + m)); process.exit(1); }

console.log(`✓ firma per Outlook in ${DEST}`);
console.log(`  ${NOME}.htm  +  ${cartellaFile}/logo-firma.jpg  +  _ANTEPRIMA.html`);
