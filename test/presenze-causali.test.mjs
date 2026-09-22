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
/* il codice senza commenti: i controlli «questa cosa NON deve esserci» vanno
   fatti qui, o li fa scattare la spiegazione scritta nel commento accanto
   (successo subito, al primo giro di questo test) */
const codice = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

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

test('i monti sindacali sono DUE e distinti, e nessuno è quello del contratto', () => {
  // precisato dall'utente il 22/09/2026: «Riunione sindacale → Permessi
  // sindacali (quelli rsu sono a parte)»
  for (const m of ['permessi_rsu', 'permessi_sindacali', 'permessi']) {
    assert.match(monti, new RegExp(`monte: '${m}'`), `manca il monte ${m}`);
  }
  const posizioni = ['permessi', 'permessi_rsu', 'permessi_sindacali'].map((m) => monti.indexOf(`monte: '${m}'`));
  assert.equal(new Set(posizioni).size, 3, 'i tre monti devono essere righe diverse');
});

test('ogni voce sindacale sta sul SUO monte, mai sui permessi retribuiti', () => {
  const atteso = {
    permesso_rsu: 'permessi_rsu',
    riunione_sindacale: 'permessi_sindacali',   // NON permessi_rsu: sono a parte
  };
  for (const [t, m] of Object.entries(atteso)) {
    const riga = tipi.split('\n').find((r) => r.includes(`tipo: '${t}'`));
    assert.ok(riga, `manca il tipo di richiesta ${t}`);
    assert.match(riga, new RegExp(`monte: '${m}'`), `${t} deve scalare il monte ${m}`);
    assert.doesNotMatch(riga, /monte: 'permessi'[,\s]/, `${t} non deve scalare i permessi del contratto`);
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

test('delle ore sindacali si mostra il CONSUMATO, mai un residuo', () => {
  // Regola dell'utente (22/09/2026): «sono circa 8 ore mensili ma non è un tetto
  // fisso, perché possono essere aumentate o usufruite in modo da recuperare
  // anche le ore non utilizzate da un altro RSU». Il monte è del GRUPPO, non
  // della persona: un «ore rimaste» sarebbe un numero falso, e nessuno che
  // arriva dopo deve aggiungerlo credendo di completare il lavoro.
  assert.match(codice, /usati nel/, 'il riquadro deve parlare di ore usate');
  // ⚠️ si vieta il CALCOLO, non la parola: nel riquadro la frase «qui non
  // compare nessun residuo: sarebbe un numero falso» è quella che spiega la
  // scelta a chi guarda, e deve poter restare (ci è inciampato il primo giro
  // di questo test).
  assert.doesNotMatch(codice, /(const|let|var)\s+\w*residu/i, 'non si calcola un residuo di ore sindacali');
  assert.doesNotMatch(codice, /\bresidu\w*\s*=[^=]/i, 'non si assegna un residuo di ore sindacali');
  assert.doesNotMatch(codice, /(const|let|var)\s+\w*(rimast|rimanent)/i, 'non si calcolano ore rimanenti');
  // il riferimento mensile arriva da s_config, non è scritto nel codice
  assert.match(codice, /presenze_rsu_ore_mensili_indicative/);
  assert.doesNotMatch(codice, /const\s+ORE_RSU_MENSILI\s*=\s*8/, 'il riferimento non si cabla nel codice');
  // e dev'essere dichiarato come indicativo
  assert.match(codice, /Riferimento indicativo/);
  assert.match(codice, /Non è un tetto/);
});

test('la generazione delle righe usa la causale del tipo, non un elenco a parte', () => {
  // prima c'era: r.tipo === 'ferie' ? 'Ferie' : r.tipo === 'permesso' ? 'Permesso' : 'Recupero'
  // che mandava OGNI tipo nuovo su «Recupero», cioè sulla banca ore
  assert.match(src, /const causale = tipoRic\(r\.tipo\)\.causale;/);
  assert.doesNotMatch(src, /r\.tipo === 'permesso' \? 'Permesso' : 'Recupero'/);
});
