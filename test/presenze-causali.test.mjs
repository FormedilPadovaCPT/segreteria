// Causali e monti delle presenze: le voci sindacali RSU devono esserci e non
// devono scalare i permessi retribuiti del contratto.
//
// Nato il 22/09/2026 da una segnalazione dell'utente: la prima richiesta di
// permesso vera (n° 1, 2 ore del 22/09) era un PERMESSO SINDACALE RSU, ma la
// maschera offriva solo Ferie / Permesso / Recupero, quindi era finita sul
// monte «permessi» del contratto. In banca ore le causali giuste esistevano
// già dallo storico Access — «Permesso sindacale RSU» (14 righe) e «Riunione
// sindacale» (3) — ma nessuna maschera le proponeva.
//
// Si legge il file come testo: presenze.js importa Supabase e in Node non si
// carica (stesso motivo di viste.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../js/presenze.js', import.meta.url), 'utf8');

/* estrae il contenuto di un array o di una costante dichiarata con const */
function blocco(nome, aperta, chiusa) {
  const i = src.indexOf(`const ${nome} = ${aperta}`);
  assert.ok(i >= 0, `manca la costante ${nome} in presenze.js`);
  const da = src.indexOf(aperta, i);
  let liv = 0;
  for (let k = da; k < src.length; k++) {
    if (src[k] === aperta) liv++;
    else if (src[k] === chiusa) { liv--; if (!liv) return src.slice(da, k + 1); }
  }
  throw new Error(`blocco ${nome} non chiuso`);
}

const causali = blocco('CAUSALI_BASE', '[', ']');
const tipi = blocco('TIPI_RICHIESTA', '[', ']');
const monti = blocco('MONTI', '[', ']');

test('le due causali sindacali sono fra quelle proposte, scritte come nello storico', () => {
  // i testi devono combaciare CARATTERE PER CARATTERE con i valori già in
  // s_presenze_extra, altrimenti il conteggio del monte si spacca in due
  assert.match(causali, /'Permesso sindacale RSU'/);
  assert.match(causali, /'Riunione sindacale'/);
  // «Riunione» (di lavoro) resta una causale distinta: non si accorpano
  assert.match(causali, /'Riunione'/);
});

test('esiste il monte «permessi sindacali RSU», distinto dai permessi del contratto', () => {
  assert.match(monti, /monte: 'permessi_rsu'/);
  assert.match(monti, /monte: 'permessi'/);
  assert.notEqual(
    monti.indexOf("monte: 'permessi'"),
    monti.indexOf("monte: 'permessi_rsu'"),
    'permessi e permessi_rsu devono essere due monti diversi',
  );
});

test('i tipi sindacali attingono al monte RSU, non ai permessi retribuiti', () => {
  for (const t of ['permesso_rsu', 'riunione_sindacale']) {
    const riga = tipi.split('\n').find((r) => r.includes(`tipo: '${t}'`));
    assert.ok(riga, `manca il tipo di richiesta ${t}`);
    assert.match(riga, /monte: 'permessi_rsu'/, `${t} deve scalare il monte RSU`);
  }
  const permesso = tipi.split('\n').find((r) => r.includes("tipo: 'permesso'"));
  assert.match(permesso, /monte: 'permessi'/, 'il permesso ordinario resta sul monte del contratto');
});

test('ogni tipo di richiesta porta la causale con cui finirà in banca ore', () => {
  const righe = tipi.split('\n').filter((r) => r.includes("tipo: '"));
  assert.ok(righe.length >= 6, 'attesi almeno sei tipi di richiesta');
  for (const r of righe) {
    assert.match(r, /causale: '[^']+'/, `riga senza causale: ${r.trim()}`);
    assert.match(r, /monte: '[^']+'/, `riga senza monte: ${r.trim()}`);
  }
  // e la causale dichiarata deve essere una di quelle proposte all'ufficio
  for (const r of righe) {
    const c = r.match(/causale: '([^']+)'/)[1];
    assert.ok(causali.includes(`'${c}'`), `la causale «${c}» non è in CAUSALI_BASE`);
  }
});

test('la generazione delle righe usa la causale del tipo, non un elenco a parte', () => {
  // prima c'era: r.tipo === 'ferie' ? 'Ferie' : r.tipo === 'permesso' ? 'Permesso' : 'Recupero'
  // che mandava OGNI tipo nuovo su «Recupero», cioè sulla banca ore
  assert.match(src, /const causale = tipoRic\(r\.tipo\)\.causale;/);
  assert.doesNotMatch(src, /r\.tipo === 'permesso' \? 'Permesso' : 'Recupero'/);
});
