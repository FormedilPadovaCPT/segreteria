// Le lacune del fascicolo digitale (14/10/2026, dalla verifica di legge del 14/10): codice personale sul
// biglietto e anno di nascita alla firma, elenco dei docenti con le firme, traccia delle firme, pacchetto
// del corso (.zip). Dati INVENTATI. Il modulo zip.js è puro e si prova davvero; il resto sulla forma del
// sorgente e sulle funzioni pure estratte (i moduli importano core.js, del browser). La parte di database
// è provata in tests-db/42_lacune_fascicolo.sql.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const qui = path.dirname(fileURLToPath(import.meta.url));
const leggi = (f) => readFileSync(path.join(qui, f), 'utf8').replace(/\r\n/g, '\n');
const fasc = leggi('../js/corsi-fascicolo.js');
const doc = leggi('../js/corsi-doc.js');
const pq = leggi('../js/corsi-presenze-qr.js');
const tst = leggi('../js/corsi-test.js');
const aiuto = leggi('../js/aiuto.js');
const sql = leggi('../supabase/sql/2026_10_14_lacune_fascicolo.sql');
const sqlServizi = leggi('../supabase/progetto-servizi/sql/2026_10_14_presenze_anno.sql');
const ricevi = leggi('../supabase/progetto-servizi/functions/questionari-ricevi/index.ts');
const richieste = leggi('../supabase/functions/portale-richieste/index.ts');
const dc = leggi('../supabase/functions/documenti-corso/index.ts');
const portale = readFileSync(path.join(qui, '../../servizi/index.html'), 'utf8').replace(/\r\n/g, '\n');
const docente = readFileSync(path.join(qui, '../../gestionale-visite/formazione-docente.js'), 'utf8').replace(/\r\n/g, '\n');

const { creaZip, crc32, sha256 } = await import(pathToFileURL(path.join(qui, '../js/zip.js')).href);

/* legge uno zip «stored» col solo indice centrale: nome, dimensione, CRC, contenuto */
function leggiZip(z) {
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  let e = z.length - 22;
  assert.equal(dv.getUint32(e, true), 0x06054b50, 'fine dell\'indice centrale');
  const n = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const out = [];
  for (let i = 0; i < n; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    assert.equal(dv.getUint16(p + 8, true) & 0x0800, 0x0800, 'nomi in UTF-8');
    const crc = dv.getUint32(p + 16, true), dim = dv.getUint32(p + 20, true), ln = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
    const nome = new TextDecoder().decode(z.subarray(p + 46, p + 46 + ln));
    const lnl = dv.getUint16(off + 26, true);
    const dati = z.subarray(off + 30 + lnl, off + 30 + lnl + dim);
    out.push({ nome, crc, dim, dati });
    p += 46 + ln;
  }
  return out;
}

test('zip.js: CRC-32 e SHA-256 noti, archivio che si rilegge uguale', async () => {
  const enc = new TextEncoder();
  assert.equal(crc32(enc.encode('123456789')).toString(16), 'cbf43926');
  assert.equal(await sha256(enc.encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const file = [{ nome: '00_LEGGIMI.txt', byte: enc.encode('ciao') }, { nome: 'documenti/a.pdf', byte: new Uint8Array([1, 2, 3, 4]) }, { nome: 'dati/vuoto.json', byte: new Uint8Array(0) }];
  const z = creaZip(file, new Date(2026, 9, 14, 10, 30, 0));
  const letti = leggiZip(z);
  assert.deepEqual(letti.map((x) => x.nome), file.map((x) => x.nome));
  for (const [i, x] of letti.entries()) {
    assert.deepEqual([...x.dati], [...file[i].byte], `contenuto di ${x.nome}`);
    assert.equal(x.crc, crc32(file[i].byte));
  }
  assert.throws(() => creaZip([{ nome: 'a.txt', byte: enc.encode('1') }, { nome: 'A.TXT', byte: enc.encode('2') }]), /nome ripetuto/, 'due nomi uguali a maiuscole ignorate non passano');
});

/* le funzioni pure di corsi-fascicolo.js, estratte dal sorgente */
function estrai(src, nomi) {
  const corpo = nomi.map((n) => {
    const m = src.match(new RegExp(`export (?:const|function) ${n}\\b[\\s\\S]*?\\n(?=export |/\\* |const GENERATI|$)`));
    if (!m) throw new Error('non trovo ' + n);
    return m[0].replace(/^export /, '');
  }).join('\n');
  const dataIt = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
  const suffissoNumeroFile = (numero) => { const n = String(numero ?? '').trim(); return n.includes('/') ? `_n${n.replace('/', '-')}` : `_Prot_${n}`; };
  return new Function('dataIt', 'suffissoNumeroFile', corpo + `\nreturn { ${nomi.join(', ')} };`)(dataIt, suffissoNumeroFile);
}

test('il pacchetto: CSV della traccia, nome degli attestati a convenzione, LEGGIMI che dice come verificare', () => {
  const { slug, tracciaCsv, nomeAttestato, leggimi } = estrai(fasc, ['slug', 'tracciaCsv', 'nomeAttestato', 'leggimi']);
  const csv = tracciaCsv([{ id: 1, giornata: '2026-10-20', nominativo: 'ROSSI; MARIO', tipo: 'entrata', turno: 1, stato: 'confermata', note: 'disse "ciao"' }]);
  const r = csv.split('\r\n');
  assert.match(r[0], /^id;progressivo;giornata;nominativo;tipo;turno;ora_server;ora_dispositivo;fuori_orario;anno_corrisponde;stato/);
  assert.match(r[1], /^1;;2026-10-20;"ROSSI; MARIO";entrata;1;/, 'il separatore dentro un campo si protegge');
  assert.match(r[1], /"disse ""ciao"""/, 'le virgolette si raddoppiano');
  assert.equal(nomeAttestato({ attestato_data: '2026-10-22', nominativo: 'Bianchi Luca', cf: 'bnclcu85c15g224k', attestato_numero: '3/2026' }),
    '2026-10-22_Attestato_Bianchi-Luca_BNCLCU85C15G224K_n3-2026.pdf', 'la convenzione del vault per gli attestati della serie nuova');
  const t = leggimi({ id: 203, titolo: 'Corso di prova', data_inizio: '2026-10-20', data_fine: '2026-10-20', sede: 'Padova' }, { quando: '14/10/2026', chi: 'cptpd@did.formedilpadova.it', mancanti: ['attestato 4/2026 di VERDI ANNA: non è su Drive'] });
  assert.match(t, /sha256sum -c MANIFESTO-sha256\.txt/);
  assert.match(t, /Get-FileHash -Algorithm SHA256/);
  assert.match(t, /almeno 10 anni/i);
  assert.match(t, /NON ENTRATI NEL PACCHETTO[\s\S]*attestato 4\/2026 di VERDI ANNA/, 'quello che manca si dice, non si tace');
  assert.equal(slug('Corso «antincendio» è'), 'Corso-antincendio-e');
});

test('il pacchetto: costruito dai dati, manifesto con le impronte, impronta registrata, pulsante e chiusura', () => {
  assert.match(fasc, /import \{ creaZip, sha256 \} from '\.\/zip\.js';/);
  assert.match(fasc, /sb\.rpc\('corso_pacchetto_dati', \{ p_corso: c\.id \}\)/);
  assert.match(fasc, /sb\.rpc\('corso_traccia_presenze', \{ p_corso: c\.id \}\)/);
  assert.match(fasc, /metti\('MANIFESTO-sha256\.txt'/, 'il manifesto');
  assert.match(fasc, /for \(const x of file\) righe\.push\(`\$\{await sha256\(x\.byte\)\}  \$\{x\.nome\}`\);/, 'formato di sha256sum: impronta, due spazi, nome');
  assert.match(fasc, /pezzo: 'pacchetto', rif: '', nome: up\.file_name \|\| pk\.nome, drive_id: up\.drive_file_id, drive_url: up\.drive_url, sha256: pk\.sha256/, 'l\'impronta del pacchetto va al database');
  assert.match(fasc, /scaricaZip\(pk\.zip, pk\.nome\);/, 'alla chiusura il pacchetto si scarica anche, per il server della scuola');
  assert.match(fasc, /Il pacchetto NON è su Drive/, 'se Drive lo rifiuta si dice');
  assert.match(fasc, /id="fs-pacchetto"/);
  assert.match(fasc, /'elenco_docenti'[\s\S]*'traccia_presenze'/, 'i due pezzi generati');
  assert.match(fasc, /await cestina\(prima\.drive_id\)/, 'il vecchio generato va nel cestino, non resta doppio');
  for (const id of ['fs-pacchetto', 'pq-biglietti', 'tz-biglietti']) assert.ok(aiuto.includes(`'${id}':`), `nuvoletta ${id}`);
});

test('i biglietti dei codici: un PDF a sé, raggiungibile da firme e test; il registro non stampa più i codici', () => {
  assert.match(doc, /export async function pdfBigliettiCodici\(corso, iscritti, \{ pres = false, test = false \} = \{\}\)/);
  assert.doesNotMatch(doc.slice(doc.indexOf('export async function pdfBigliettiCodici')), /\.cf\b/, 'niente codice fiscale sul biglietto');
  assert.match(pq, /id="pq-biglietti"/);
  assert.match(tst, /id="tz-biglietti"/);
  assert.doesNotMatch(pq + tst, /stampato accanto al nome sul registro: questa è solo/, 'i testi vecchi sono andati');
});

test('l\'anno di nascita: portale, cassetta, database dei due progetti, pagina del docente', () => {
  /* portale: campo, controllo, chiamata, invio, informativa */
  const pagina = portale.slice(portale.indexOf('id="page-presenza"'), portale.indexOf('id="page-testdocente"'));
  assert.match(pagina, /id="pz-anno" maxlength="4" inputmode="numeric"/);
  assert.match(pagina, /Informativa privacy \(Reg\. UE 2016\/679\)/, 'l\'informativa sulla pagina delle firme');
  assert.match(pagina, /Non registriamo\s+la tua posizione/);
  assert.match(portale, /f\.anno_nascita     = anno;/);
  assert.match(portale, /r\.data && r\.data\.anno_errato/);
  assert.doesNotMatch(pagina, /stampato accanto al tuo nome/);
  /* la cassetta passa l'anno; il ricevitore accetta l'impronta «a» */
  assert.match(richieste, /p_anno: String\(d\.anno_nascita \?\? ''\)\.slice\(0, 8\),/);
  assert.match(richieste, /anno_dichiarato: r\.anno_dichiarato \?\? null, anno_corrisponde: r\.anno_corrisponde \?\? null,/);
  assert.match(ricevi, /k !== 'h' && k !== 'n' && k !== 'a'/);
  /* Gestionale: si confronta, non si rifiuta; la conferma di gruppo salta l'anno sbagliato */
  assert.match(sql, /v_corr := case when v_anno is null or v_yy is null then null else \(v_anno % 100\) = v_yy end;/);
  assert.match(sql, /and anno_corrisponde is not false/);
  assert.match(sql, /'a', public\.pres_impronta_anno\(i\.test_codice, public\.iscritto_yy\(i\.id\)\)/, 'al portale l\'impronta, mai l\'anno');
  assert.match(sql, /translate\(substr\(v_cf, 7, 2\), 'LMNPQRSTUV', '0123456789'\)/, 'omocodia del codice fiscale');
  assert.match(sql, /drop function if exists public\.pres_registra\(text, text, text, text\);/, 'una sola versione: niente ambiguità');
  /* Servizi: un anno sbagliato ferma la firma online, senza dire le iniziali */
  assert.match(sqlServizi, /return jsonb_build_object\('trovato', false, 'anno_errato', true\);/);
  assert.match(sqlServizi, /drop function if exists public\.pres_che_cosa\(text, text, text\);/);
  assert.match(sqlServizi, /grant execute on function public\.pres_che_cosa\(text, text, text, text\) to anon/);
  /* il docente vede il segno e la conferma di gruppo lo salta */
  assert.match(docente, /f\.anno_corrisponde === false \?/);
  assert.match(docente, /!f\.fuori_orario && f\.anno_corrisponde !== false/);
});

test('elenco dei docenti e traccia: due azioni di documenti-corso, lette col token di chi chiama', () => {
  assert.match(dc, /export async function disegnaElencoDocenti\(c: Riga, docenti: Riga\[\]\)/);
  assert.match(dc, /export async function disegnaTraccia\(c: Riga, righe: Riga\[\]\)/);
  assert.match(dc, /sbUtente\.rpc\('corso_elenco_docenti', \{ p_corso: id \}\)/);
  assert.match(dc, /sbUtente\.rpc\('corso_traccia_presenze', \{ p_corso: id \}\)/);
  assert.match(sql, /create or replace function public\.corso_elenco_docenti\(p_corso bigint\)/);
  assert.match(sql, /if not \(public\.is_segreteria\(\) or public\.is_rpf\(\)\) then raise exception 'non autorizzato'; end if;/);
  assert.match(sql, /check \(pezzo in \('scheda', 'progetto', 'registro_giornata', 'verbale', 'accettazione', 'indice', 'elenco_docenti', 'traccia_presenze', 'pacchetto', 'altro'\)\)/);
});
