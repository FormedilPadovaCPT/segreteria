// Il fascicolo su Drive e la verifica di efficacia (14/10/2026, lotti 6 e 7 del fascicolo corso digitale).
// Dati INVENTATI. Prove sulla forma del sorgente e sulle funzioni pure (slug, nomeCartella, pezziDaDepositare,
// indiceMd, testoEfficacia) estratte dai moduli, che importano core.js (browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const qui = path.dirname(fileURLToPath(import.meta.url));
const leggi = (f) => readFileSync(path.join(qui, f), 'utf8').replace(/\r\n/g, '\n');
const fasc = leggi('../js/corsi-fascicolo.js');
const eff = leggi('../js/efficacia.js');
const corsi = leggi('../js/corsi.js');
const home = leggi('../js/home.js');
const aiuto = leggi('../js/aiuto.js');
const sql = leggi('../supabase/sql/2026_10_14_fascicolo_efficacia.sql');

/* le funzioni pure si estraggono dal sorgente (i moduli importano core.js, del browser) */
function estrai(src, nomi) {
  const corpo = nomi.map((n) => {
    const m = src.match(new RegExp(`export (?:const|function) ${n}\\b[\\s\\S]*?\\n(?=export |$)`));
    if (!m) throw new Error('non trovo ' + n);
    return m[0].replace(/^export /, '');
  }).join('\n');
  const dataIt = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
  const oggiIso = () => '2026-10-14';
  return new Function('dataIt', 'oggiIso', corpo + `\nreturn { ${nomi.join(', ')} };`)(dataIt, oggiIso);
}

test('lo stato del fascicolo lo calcola il database; la segreteria deposita e chiude solo via RPC', () => {
  assert.match(fasc, /sb\.rpc\('corso_fascicolo', \{ p_corso: c\.id \}\)/);
  assert.match(fasc, /sb\.rpc\('corso_fascicolo_deposita'/);
  assert.match(fasc, /sb\.rpc\('corso_fascicolo_chiudi', \{ p_corso: c\.id \}\)/);
  assert.doesNotMatch(fasc, /from\('s_corsi(_fascicolo_file)?'\)\s*\.(insert|update|delete|upsert)/, 'nessuna scrittura diretta');
  assert.match(fasc, /Non sono riuscito a leggere lo stato del fascicolo/, 'un errore di lettura si dice');
  assert.match(fasc, /const BASE = '2_AREE\/Formazione\/edizioni_corsi';/, 'la cartella del corso sta fra le edizioni');
  assert.match(fasc, /storage\.from\(BUCKET\)\.download\(path\)/, 'i firmati si leggono dal bucket delle firme');
  assert.match(fasc, /caricaByte\(null, nome, byte, 'application\/pdf', cartella\)/, 'e si caricano su Drive senza codice di protocollo nel nome');
  assert.match(corsi, /import \{ datiFascicolo, sezioneFascicoloDrive, collegaFascicoloDrive \} from '\.\/corsi-fascicolo\.js';/);
  assert.match(corsi, /\$\{sezioneFascicoloDrive\(c, fasc\)\}/);
  for (const id of ['fs-dep', 'fs-chiudi']) assert.ok(aiuto.includes(`'${id}':`), `nuvoletta ${id}`);
});

test('il nome della cartella e i pezzi da depositare', () => {
  const { slug, nomeCartella, pezziDaDepositare } = estrai(fasc, ['slug', 'nomeCartella', 'pezziDaDepositare']);
  assert.equal(slug('Aggiornamento preposti — edilizia (8 ore)'), 'Aggiornamento-preposti-edilizia-8-ore');
  assert.equal(nomeCartella({ id: 214, data_inizio: '2026-10-05', titolo: 'Corso antincendio' }), '2026_10_05_Corso-214_Corso-antincendio');
  const f = {
    scheda: { id: 3, versione: 2, firmato: { file: 'firmate/a.pdf', firma_id: 10 } },
    progetto: { firmato: { file: 'firmate/b.pdf', firma_id: 11 } },
    giornate: [{ id: 7, data: '2026-10-05', registro: { file: 'firmate/c.pdf', firma_id: 12 } }, { id: 8, data: '2026-10-06', registro: null }],
    verbale: { id: 5, versione: 1, firmato: null },
    incarichi: [{ id: 9, nominativo: 'DOCENTE', accettazione: { file: 'firmate/d.pdf', firma_id: 13 } }],
    depositati: [{ pezzo: 'registro_giornata', rif: 'giornata:7', firma_id: 12 }, { pezzo: 'scheda', rif: 'scheda:3', firma_id: 1 }],
  };
  const p = pezziDaDepositare({ id: 214 }, f);
  assert.deepEqual(p.map((x) => x.pezzo + ':' + x.daFare), ['scheda:true', 'progetto:true', 'registro_giornata:false', 'accettazione:true'], 'solo i firmati; chi è già su Drive con la stessa firma non si rifà, una firma nuova sì');
  assert.equal(pezziDaDepositare({ id: 1 }, null).length, 0);
});

test('la nota _indice.md segue la regola del vault: frontmatter, argomenti, docenti, partecipanti, attestati', () => {
  const { indiceMd } = estrai(fasc, ['indiceMd']);
  const c = { id: 214, titolo: 'Corso antincendio', data_inizio: '2026-10-05', data_fine: '2026-10-05', sede: 'Padova', durata_ore: 8, codice_socrate: 'S-99', validita_txt: '5 anni' };
  const f = { accordo: true, tipologia: { titolo: 'Antincendio livello 2' }, depositati: [{ pezzo: 'registro_giornata', nome: 'reg.pdf', drive_url: 'https://x/y', depositato_il: '2026-10-14' }], attestati: { previsti: true }, test: { prove: 3, convalidate: 3 }, questionario: { risposte: 2 }, chiuso_il: '2026-10-14T10:00:00Z' };
  const ctx = {
    giornate: [], incarichi: [],
    interventi: [{ qualita: 'docente', nominativo: 'Mario Docente', materia: 'Antincendio', argomenti: 'estintori' }, { qualita: 'relatore', nominativo: 'Anna Relatrice' }],
    iscritti: [{ nominativo: 'ROSSI MARIO', impresa_txt: 'Impresa Uno', mansione: 'operaio', esito: 'presente', attestato_numero: '3/2026', cf: 'RSSMRA80A01H501U' }, { nominativo: 'ANNULLATO', esito: 'annullato' }],
  };
  const md = indiceMd(c, f, ctx);
  assert.match(md, /^---\ntitolo: "Corso antincendio"\ntipo: evento\n/, 'frontmatter base');
  assert.match(md, /stato: concluso/);
  assert.match(md, /codice_socrate: "S-99"/);
  assert.match(md, /argomenti:\n  - "Antincendio: estintori"/);
  assert.match(md, /docenti:\n  - "Mario Docente"\n  - "Anna Relatrice"/);
  assert.match(md, /partecipanti_effettivi: 1/);
  assert.match(md, /attestati_rilasciati: 1/);
  assert.match(md, /attestati_collegati: "2_AREE\/Formazione\/attestati_emessi\/2026"/);
  assert.match(md, /- ROSSI MARIO \(Impresa Uno\) — operaio/);
  assert.doesNotMatch(md, /RSSMRA80A01H501U/, 'niente codici fiscali nella nota');
  assert.match(md, /\[apri\]\(https:\/\/x\/y\)/);
});

test('la verifica di efficacia: tessera nel cruscotto, bozza .eml, «inviata» via RPC, testo dai dati', () => {
  assert.match(home, /import \{ datiEfficacia, cardEfficacia, collegaEfficacia \} from '\.\/efficacia\.js';/);
  assert.match(home, /\$\{cardEfficacia\(card, effic\)\}/);
  assert.match(home, /collegaEfficacia\(host, render, effic\);/);
  assert.match(home, /pFirme, pApprov, pEffic\]\)/, 'la lettura parte insieme alle altre');
  assert.match(eff, /scaricaEml\(\{/, 'la mail è una bozza .eml: la manda una persona');
  assert.match(eff, /sb\.rpc\('efficacia_segna', \{ p_id: r\.id, p_stato: 'inviata'/);
  assert.match(eff, /errore: error\.message/, 'un errore di lettura si tiene');
  assert.ok(aiuto.includes("'hm-efficacia':"), 'nuvoletta della tessera');
  const { testoEfficacia } = estrai(eff, ['testoEfficacia']);
  const t = testoEfficacia({ impresa_txt: 'Impresa Uno', partecipanti: 2, entro: '2027-10-05', corso: { id: 214, titolo: 'Corso antincendio', data_fine: '2026-10-05', durata_ore: 8 } });
  assert.match(t, /^Gentile Impresa Uno,/);
  assert.match(t, /il 05\/10\/2026 si è concluso il corso «Corso antincendio» \(8 ore\), frequentato da 2 vostri lavoratori\./);
  assert.match(t, /entro il 05\/10\/2027/);
  assert.match(t, /VERIFICA DI EFFICACIA/);
});

test('il database: stato calcolato, chiusura solo se completo, promemoria a 6 e 12 mesi, giro mensile', () => {
  assert.match(sql, /create or replace function public\.corso_fascicolo\(p_corso bigint\)/);
  assert.match(sql, /raise exception 'Il fascicolo non è completo: manca %'/);
  assert.match(sql, /r\.data_fine \+ interval '6 months', r\.data_fine \+ interval '12 months'/);
  assert.match(sql, /cron\.schedule\('efficacia-genera', '30 4 1 \* \*'/);
  assert.match(sql, /t\.accordo_2025 and \(c\.tipo <> 'conferenza_cantiere' or coalesce\(c\.formativa, false\)\)/, 'solo i corsi dell\'Accordo (conferenza solo se formativa)');
  assert.match(sql, /'fascicolo_deposito'/);
});
