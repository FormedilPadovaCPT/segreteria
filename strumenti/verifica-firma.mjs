/* ============================================================
   verifica-firma.mjs — chi tocca la firma della posta esegue questo.

   1. Controlla che le COPIE di js/firma.js e js/firma-logo.js dentro
      supabase/functions/send-protocollo/ siano identiche agli originali
      (con --sincronizza le riallinea: è `npm run firma-sync`).
   2. Compone una bozza di prova con componiEml e la scrive in
      strumenti/_prova-firma.eml, insieme all'HTML del corpo in
      strumenti/_prova-firma.html per guardarla in un browser.
   3. Controlla il messaggio: parti text/plain e text/html presenti,
      logo inline con il Content-ID citato dall'HTML, allegato in coda,
      righe entro i 998 caratteri di RFC 5322, X-Unsent in testa.
   Esce con errore se un controllo fallisce.
   ============================================================ */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const qui = dirname(fileURLToPath(import.meta.url));
const radice = join(qui, '..');
const sincronizza = process.argv.includes('--sincronizza');

const COPIE = ['firma.js', 'firma-logo.js'].map((f) => ({
  orig: join(radice, 'js', f),
  copia: join(radice, 'supabase', 'functions', 'send-protocollo', f),
  nome: f,
}));

let errori = 0;
const ko = (m) => { errori++; console.error('✗ ' + m); };
const ok = (m) => console.log('✓ ' + m);

for (const c of COPIE) {
  const o = readFileSync(c.orig, 'utf8');
  const k = existsSync(c.copia) ? readFileSync(c.copia, 'utf8') : null;
  if (k === o) { ok(`copia allineata: send-protocollo/${c.nome}`); continue; }
  if (sincronizza) { copyFileSync(c.orig, c.copia); ok(`copia rigenerata: send-protocollo/${c.nome}`); }
  else ko(`send-protocollo/${c.nome} ${k === null ? 'manca' : 'diverge da js/' + c.nome} — esegui: npm run firma-sync`);
}

const { componiEml, FIRMA_SEGRETERIA, LOGO_FIRMA_CID, paginaHtml, testoInHtml, senzaFirma } = await import('../js/firma.js');
const { LOGO_FIRMA_B64, LOGO_FIRMA_MIME } = await import('../js/firma-logo.js');

const corpo = `Gent.le Sig. Rossi,
buongiorno,

le trasmettiamo in allegato la comunicazione in oggetto. Il modulo è raggiungibile da https://formedilpadovacpt.github.io/servizi/ e per ogni dubbio può scrivere a cpt@formedilpadova.it.

Distinti saluti.

${FIRMA_SEGRETERIA}`;

const pdfFinto = new TextEncoder().encode('%PDF-1.4\n% prova\n%%EOF\n');
const eml = componiEml({
  to: 'rossi@esempio.it',
  cc: ['direzione@formedilpadova.it'],
  oggetto: 'Formedil Padova - Area Sicurezza e Salute - Prova firma è ok',
  corpo,
  allegati: [{ nome: 'documento-di-prova.pdf', byte: pdfFinto }],
});
writeFileSync(join(qui, '_prova-firma.eml'), eml);
writeFileSync(join(qui, '_prova-firma.html'),
  /* nell'anteprima il logo va in data: URI (in un browser va bene; nella mail no, vedi firma.js) */
  paginaHtml(testoInHtml(senzaFirma(corpo))).replace(`cid:${LOGO_FIRMA_CID}`, `data:${LOGO_FIRMA_MIME};base64,${LOGO_FIRMA_B64}`));

const decodifica = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
const parte = (intestazione) => {
  const dopo = eml.split(`${intestazione}\r\nContent-Transfer-Encoding: base64\r\n\r\n`)[1];
  return dopo ? decodifica(dopo.split('\r\n--')[0].replace(/\r\n/g, '')) : '';
};

/* controlli sul messaggio */
const righe = eml.split('\r\n');
if (righe[0] !== 'X-Unsent: 1') ko('manca X-Unsent: 1 in testa'); else ok('X-Unsent: 1 in testa');
const lunga = righe.find((r) => r.length > 998);
if (lunga) ko(`riga oltre 998 caratteri: ${lunga.slice(0, 60)}…`); else ok('nessuna riga oltre 998 caratteri');
if (!/Subject: =\?utf-8\?B\?/.test(eml)) ko('oggetto non ASCII non codificato'); else ok('oggetto codificato');
for (const atteso of ['Content-Type: multipart/mixed', 'Content-Type: multipart/alternative', 'Content-Type: multipart/related',
  'Content-Type: text/plain', 'Content-Type: text/html', `Content-ID: <${LOGO_FIRMA_CID}>`, 'Content-Disposition: inline',
  'Content-Disposition: attachment; filename="documento-di-prova.pdf"']) {
  if (!eml.includes(atteso)) ko(`manca «${atteso}»`); else ok(atteso);
}

const html = parte('Content-Type: text/html; charset=utf-8');
for (const [che, attesa] of [['logo cid', `cid:${LOGO_FIRMA_CID}`], ['nome', 'Renato Squizzato'], ['orari', 'Orari uff.'],
  ['servizi', 'Vai ai Servizi'], ['privacy', 'GDPR'], ['link cliccabile', 'href="https://formedilpadovacpt.github.io/servizi/"'],
  ['mailto nel testo', 'href="mailto:cpt@formedilpadova.it"']]) {
  if (!html.includes(attesa)) ko(`HTML senza ${che}`); else ok(`HTML con ${che}`);
}
if ((html.match(/Renato Squizzato/g) || []).length !== 1) ko("la firma compare più di una volta nell'HTML (la copia in righe non è stata tolta)");
else ok("firma una volta sola nell'HTML");

const plain = parte('Content-Type: text/plain; charset=utf-8');
if ((plain.match(/Renato Squizzato/g) || []).length !== 1) ko('firma doppia o assente nel testo semplice'); else ok('firma una volta sola nel testo semplice');
if (!plain.includes('Gent.le Sig. Rossi')) ko('corpo assente nel testo semplice'); else ok('corpo nel testo semplice');

console.log(errori ? `\n${errori} controlli falliti` : `\nTutto a posto — bozza di prova in strumenti/_prova-firma.eml (${(eml.length / 1024).toFixed(0)} KB)`);
process.exit(errori ? 1 : 0);
