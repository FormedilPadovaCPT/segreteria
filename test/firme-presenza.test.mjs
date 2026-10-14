// Le firme di presenza dal QR (13/10/2026, lotto 4 del fascicolo corso digitale).
// Dati INVENTATI. Prove sulla forma del sorgente (i moduli importano core.js, del browser) e sulla
// funzione pura oraRoma. Il cuore della regola (entrata/uscita, conferme → presenze) è provato sul
// database in tests-db/39_firme_presenza.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const qui = path.dirname(fileURLToPath(import.meta.url));
const leggi = (f) => readFileSync(path.join(qui, f), 'utf8').replace(/\r\n/g, '\n');
const pq = leggi('../js/corsi-presenze-qr.js');
const corsi = leggi('../js/corsi.js');
const doc = leggi('../js/corsi-doc.js');
const aiuto = leggi('../js/aiuto.js');
const sql = leggi('../supabase/sql/2026_10_13_firme_presenza.sql');
const sqlServizi = leggi('../supabase/progetto-servizi/sql/2026_10_13_presenze_pubbliche.sql');
const pubblica = leggi('../supabase/functions/questionari-pubblica/index.ts');
const ricevi = leggi('../supabase/progetto-servizi/functions/questionari-ricevi/index.ts');
const cassetta = leggi('../supabase/progetto-servizi/functions/portale-ricevi/index.ts');
const richieste = leggi('../supabase/functions/portale-richieste/index.ts');
// La pagina del portale sta nel repo servizi: c'è solo dove i repo sono affiancati (sul PC, non su GitHub).
const filePortale = path.join(qui, '../../servizi/index.html');
const portale = existsSync(filePortale) ? readFileSync(filePortale, 'utf8').replace(/\r\n/g, '\n') : null;

test('la segreteria scrive solo attraverso le RPC: mai un update sulla tabella delle firme', () => {
  for (const r of ['pres_apri', 'pres_link', 'pres_conferma', 'pres_conferma_allievo', 'corso_codici_personali']) {
    assert.ok(pq.includes(`sb.rpc('${r}'`), `RPC ${r} usata`);
  }
  assert.doesNotMatch(pq, /from\('s_corsi_firme_presenza'\)\s*\.(insert|update|delete|upsert)/, 'nessuna scrittura diretta');
  assert.match(pq, /from\('s_corsi_firme_presenza'\)\.select/, 'le firme si leggono');
  assert.match(pq, /errore: e1\?\.message \|\| e2\?\.message \|\| null/, 'un errore di lettura si tiene e si dice');
  assert.match(pq, /Non sono riuscito a leggere le firme/, '«nessuna firma» non è «non ho letto»');
});

test('il corso si pubblica sul portale con cosa:presenza, e prima si assegnano i codici a chi non ce l\'ha', () => {
  assert.match(pq, /sb\.rpc\('corso_codici_personali', \{ p_corso_id: c\.id \}\)/);
  assert.match(pq, /functions\.invoke\('questionari-pubblica', \{ body: \{ corso_id: c\.id, cosa: 'presenza' \} \}\)/);
  assert.match(pq, /Le firme NON sono sul portale/, 'un fallimento si dice per quello che è');
  assert.match(pubblica, /const pres = corpo\.cosa === 'presenza'/);
  assert.match(pubblica, /pres \? 'pres_pubblicazione'/);
  assert.match(pubblica, /quando: 'pres_pubblicato_il', esito: 'pres_pubblica_esito'/);
  assert.match(pubblica, /giornate: q\.giornate \?\? \[\],\s*persone: q\.persone \?\? \[\]/, 'scendono giornate e persone (impronta + iniziali)');
});

test('il portale accetta solo campi previsti: niente nomi, niente CF', () => {
  assert.match(ricevi, /const CAMPI_PRES = new Set\(\['codice', 'firma_hash', 'titolo', 'quando', 'sede', 'chiuso_il', 'giornate', 'persone'\]\)/);
  assert.match(ricevi, /function controllaPres\(/);
  assert.match(ricevi, /\/\^P\[0-9\]\{1,8\}-\[A-Z0-9\]\{4\}\$\//, 'il codice delle firme ha la sua forma P<corso>-XXXX');
  assert.match(ricevi, /azione === 'pubblica_pres' \|\| azione === 'ritira_pres'/);
  assert.match(ricevi, /from\('presenze_pubbliche'\)\.upsert/);
  assert.match(ricevi, /qui vanno le iniziali, non un nome/);
});

test('il tipo prs sta nei tre posti: cassetta, lavorazione, vincolo', () => {
  assert.match(cassetta, /const TIPI = \[[^\]]*'prs'\]/);
  assert.match(cassetta, /\n  prs: \[\],/, 'obbligatori del prs');
  assert.match(cassetta, /prs: 16 \* 1024,/, 'misura per modulo');
  assert.match(richieste, /\n  prs: \{\n    tabella: 's_corsi_firme_presenza',/);
  assert.match(richieste, /silenzioso: true,\n    colonne: \{\},\n    extra: agganciaPresenza,/);
  assert.match(richieste, /sb\.rpc\('pres_registra', \{/);
  assert.match(richieste, /riferimento_esito: 'registrazione non riuscita: ' \+ error\.message/, 'un errore non è «non riconosciuta»');
  assert.match(sqlServizi, /'dtst','prs'\]\)\);/, 'cassetta_tipo_check allargato sul progetto Servizi');
});

test('la regola entrata/uscita sta nel database, uguale sui due progetti, e la firma del link è revocata', () => {
  const regola = (s) => s.slice(s.indexOf('create or replace function public.pres_decidi'), s.indexOf('end $$;', s.indexOf('create or replace function public.pres_decidi')));
  assert.equal(regola(sql), regola(sqlServizi), 'pres_decidi parola per parola uguale');
  assert.match(sql, /interval '60 minutes' and p_ora < v_meta/, 'entrata: da 60 min prima a metà turno');
  assert.match(sql, /p_ora >= v_meta and p_ora <= v_fine \+ interval '60 minutes'/, 'uscita: da metà a 60 min dopo');
  assert.match(sql, /revoke execute on function public\.pres_firma\(text\) from public, anon, authenticated;/);
  assert.match(sql, /revoke execute on function public\.pres_registra\(text, text, text, text\) from public, anon, authenticated;/);
  assert.match(sql, /where stato = 'confermata';/, 'una sola firma confermata per momento');
  assert.match(sql, /create trigger trg_s_corsi_firme_presenza_applica/, 'le confermate scrivono le presenze');
  assert.match(sql, /'pres_firma_qr'/, 'il flusso nel cruscotto «che cosa è stato usato»');
});

test('la pagina del portale: un pulsante solo, niente CF, senza rete si firma lo stesso', { skip: !portale && 'servizi non è accanto' }, () => {
  assert.match(portale, /<div class="page" id="page-presenza">/);
  assert.match(portale, /presenza: \['Firma di presenza', ''\],/, 'in PAGE_TITLES');
  assert.match(portale, /_sb\.rpc\('apri_presenza', \{ p_codice: codice, p_firma: firma \}\)/);
  /* dal 14/10/2026 con l'anno di nascita */
  assert.match(portale, /_sb\.rpc\('pres_che_cosa', \{ p_codice: codice, p_firma: firma, p_personale: v, p_anno: a \}\)/);
  assert.match(portale, /submitForm\('form-presenza', 'prs', async function \(form\)/);
  assert.match(portale, /f\.ora_dispositivo {2}= new Date\(\)\.toISOString\(\);/, 'l\'ora del telefono parte, indicativa');
  assert.match(portale, /senzaRete = true;/, 'senza rete si prosegue');
  assert.match(portale, /id="form-presenza" novalidate hidden data-senza-ricevuta/, 'una firma non è una pratica con numero');
  assert.doesNotMatch(portale.slice(portale.indexOf('id="page-presenza"'), portale.indexOf('id="page-testdocente"')), /codice fiscale/i, 'niente CF nella pagina');
  assert.match(portale, /q\.get\('presenza'\)/);
});

test('il registro: QR in copertina, foglio in coda, il codice NON accanto al nome (14/10); la scheda corso ha la sezione', () => {
  assert.match(doc, /export async function pdfRegistro\(corso, giornate, interventi, iscritti, conf, quest = null, test = null, pres = null\)/);
  assert.doesNotMatch(doc, /if \(\(test \|\| pres\) && p\.test_codice\)/, 'il codice personale non si stampa più sul registro');
  assert.doesNotMatch(doc, /accanto al (tuo|vostro) nome/, 'nessun testo rimanda al registro per il codice');
  assert.match(doc, /if \(pres && pres\.codice\) await foglioPresenze\(k, corso, pres\);/);
  assert.match(doc, /export async function pdfFoglioPresenze\(corso, pres\)/);
  assert.match(doc, /if \(pres && pres\.codice && pres\.link && yr - 84 > 136\)/, 'in copertina solo se c\'è spazio');
  assert.match(corsi, /import \{ datiPres, sezionePres, collegaPres \} from '\.\/corsi-presenze-qr\.js';/);
  assert.match(corsi, /\$\{sezionePres\(c, presQr, iscritti, giornate \|\| \[\]\)\}/);
  assert.match(corsi, /collegaPres\(c, presQr, iscritti, giornate \|\| \[\], \(\) => apriCorso\(c\.id\)\);/);
  assert.match(corsi, /c\.pres_codice \? \{ codice: c\.pres_codice, link: presQr\.link\?\.link \|\| '' \} : null\);/);
  for (const id of ['pq-apri', 'pq-foglio', 'pq-pubblica', 'pq-codici', 'pq-link']) assert.ok(aiuto.includes(`'${id}':`), `nuvoletta ${id}`);
});

test('oraRoma: l\'ora della firma si mostra nel fuso di Roma', async () => {
  /* il modulo importa core.js (browser): si estrae la funzione dal sorgente */
  const m = pq.match(/export function oraRoma\(iso\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'oraRoma trovata');
  const oraRoma = new Function('return ' + m[0].replace(/^export /, ''))();
  assert.equal(oraRoma('2026-10-13T06:31:00Z'), '08:31', 'ottobre: UTC+2');
  assert.equal(oraRoma('2026-12-01T07:05:00Z'), '08:05', 'dicembre: UTC+1');
  assert.equal(oraRoma(null), '—');
  assert.equal(oraRoma('boh'), '—');
});
