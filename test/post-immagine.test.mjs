// L'immagine proposta dei post (09/11/2026, rifatta sul Brand Design System lo stesso giorno):
// che cosa propone l'app a partire dal post e dalla «Grafica suggerita». Dati INVENTATI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proposta, leggiSuggerita, sceltaFoto, numeroInTesta, puntiDelTesto, titoloPulito, senzaSegni, aCapo, MODELLI, LARGHEZZA, ALTEZZA } from '../js/post-immagine.js';

const ARCHIVIO = [
  { nome: 'istruttore-planimetria', parole: ['planimetria', 'istruttore'] },
  { nome: 'tecnico-casco-gilet', parole: ['tecnico', 'casco', 'gilet'] },
  { nome: 'armadietti-imbracature', parole: ['armadietti', 'imbracature'] },
  { nome: 'allievi-cantiere-scuola', parole: ['allievi'] },
];

test('post quadrato e i quattro modelli del manuale', () => {
  assert.equal(LARGHEZZA, 1080); assert.equal(ALTEZZA, 1080);
  assert.deepEqual(Object.keys(MODELLI), ['A', 'B', 'C', 'T']);
});

test('il numero in testa alla prima riga diventa il numero grande, così com\'è scritto', () => {
  assert.deepEqual(numeroInTesta('28 volte in un anno: aperture verso il vuoto senza protezione'),
    { numero: '28', didascalia: 'volte in un anno', resto: 'aperture verso il vuoto senza protezione' });
  assert.equal(numeroInTesta('71,2% dei cantieri migliora').numero, '71,2%');
  assert.equal(numeroInTesta('Quando il tecnico torna'), null);
  assert.equal(numeroInTesta('Dei 66 cantieri trovati'), null, 'un numero dentro la frase non si stacca');
});

test('la grafica suggerita: modello, numero, titolo, sottotitolo, fascia', () => {
  const a = leggiSuggerita("Post singolo, template A (fondo arancione + foto). Testo: numero grande '15' + titolo 'Sotto questa soglia, il cantiere si ferma'. Foto: tecnico con casco.");
  assert.equal(a.modello, 'A'); assert.equal(a.numero, '15'); assert.equal(a.titolo, 'Sotto questa soglia, il cantiere si ferma');
  const b = leggiSuggerita("Template A. Testo: 'CONFERENZA DI CANTIERE' con sottotitolo 'La formazione dove lavorano i tuoi operai'.");
  assert.equal(b.titolo, 'CONFERENZA DI CANTIERE', '«titolo» non deve prendere il testo del «sottotitolo»');
  assert.equal(b.sottotitolo, 'La formazione dove lavorano i tuoi operai');
  const c = leggiSuggerita("Template B. Testo in fascia: 'ASSEVERAZIONE DEL MODELLO DI SICUREZZA' + sottotitolo 'Art. 51 c. 3-bis'.");
  assert.equal(c.modello, 'B');
  assert.equal(c.titolo, 'ASSEVERAZIONE DEL MODELLO DI SICUREZZA', 'un testo lungo in fascia è il titolo');
  assert.equal(c.fascia, '');
  const d = leggiSuggerita("Template B. Testo in fascia arancione: «Il tecnico risponde» + sottotitolo «Il POS serve anche per 3 giorni».");
  assert.equal(d.fascia, 'Il tecnico risponde'); assert.equal(d.sottotitolo, 'Il POS serve anche per 3 giorni');
  const e = leggiSuggerita("Template C. Testo minimale: '47%' in grande e sotto 'cantieri non in regola'.");
  assert.equal(e.modello, 'C'); assert.equal(e.numero, '47%');
  const f = leggiSuggerita("Template B. Testo in fascia: numero grande «18» + «NOVEMBRE» sotto, poi «Formazione lavoratori rischio alto».");
  assert.equal(f.numero, '18'); assert.equal(f.didascalia, 'NOVEMBRE'); assert.equal(f.titolo, 'Formazione lavoratori rischio alto');
  assert.equal(leggiSuggerita('Testo «CREDITI AGGIUNTIVI» in arancione; niente foto.').modello, 'T');
  assert.equal(leggiSuggerita('').modello, '');
});

test('la foto si sceglie dalle parole della grafica suggerita, poi dal pilastro', () => {
  assert.equal(sceltaFoto(ARCHIVIO, 'Foto: istruttore che illustra una planimetria', 'servizi'), 'istruttore-planimetria');
  assert.equal(sceltaFoto(ARCHIVIO, 'Foto: armadietti con attrezzi e imbracature', 'cantiere'), 'armadietti-imbracature');
  assert.equal(sceltaFoto(ARCHIVIO, '', 'cantiere'), 'allievi-cantiere-scuola');
  assert.equal(sceltaFoto([], 'qualunque', 'cantiere'), '');
});

test('la proposta dal post', () => {
  const p1 = proposta({ titolo: '3/9 · Messa a terra', pilastro: 'cantiere', gancio: '5 volte in un anno: messa a terra non verificata' }, ARCHIVIO);
  assert.equal(p1.modello, 'B', 'senza grafica suggerita: il modello del pilastro');
  assert.equal(p1.titolo, 'Messa a terra', 'senza il numero della serie');
  assert.equal(p1.numero, '5');
  assert.equal(p1.etichetta, 'Dal cantiere');
  assert.ok(!/049|@/.test(p1.fascia), 'la fascia invita all\'app servizi, mai telefono o mail');
  const p2 = proposta({ titolo: 'Patente', pilastro: 'normativa', gancio: 'Dal 1° gennaio 2026 ogni lavoratore in nero costa 5 crediti',
    immagine_suggerita: "template A. Testo: numero grande '15' + titolo 'Sotto questa soglia, il cantiere si ferma'. Foto: tecnico con casco e gilet",
    testo_telegram: 'Testo\n- uno;\n- due;\n- tre;\n- quattro.' }, ARCHIVIO);
  assert.equal(p2.modello, 'A'); assert.equal(p2.numero, '15'); assert.equal(p2.titolo, 'Sotto questa soglia, il cantiere si ferma');
  assert.equal(p2.frase, 'Dal 1° gennaio 2026 ogni lavoratore in nero costa 5 crediti');
  assert.equal(p2.foto, 'tecnico-casco-gilet');
  assert.deepEqual(p2.punti, ['uno', 'due', 'tre'], 'nel modello A al massimo tre punti');
  const p3 = proposta({ titolo: 'Rassegna: crollo in cantiere, il CSE risponde solo se informato', pilastro: 'rassegna' }, ARCHIVIO);
  assert.equal(p3.modello, 'C'); assert.equal(p3.etichetta, 'Rassegna');
  assert.equal(p3.titolo, 'Crollo in cantiere, il CSE risponde solo se informato', 'il titolo non ripete l\'etichetta');
  const p4 = proposta({ titolo: 'DM 132', pilastro: 'servizi', immagine_suggerita: 'Testo «CREDITI AGGIUNTIVI»; niente foto.' }, ARCHIVIO);
  assert.equal(p4.modello, 'T'); assert.equal(p4.foto, ''); assert.equal(p4.titolo, 'CREDITI AGGIUNTIVI');
  assert.equal(proposta({}).etichetta, 'Area Sicurezza e Salute');
});

test('pulizia dei segni e a capo', () => {
  assert.equal(senzaSegni('**grassetto** e [link](https://x.it) ++sotto++'), 'grassetto e link sotto');
  assert.equal(titoloPulito('9/9 · Che cosa fare'), 'Che cosa fare');
  assert.deepEqual(puntiDelTesto('1. uno\n2) due\n• tre\ntesto'), ['uno', 'due', 'tre']);
  const misura = (t) => t.length * 10;
  assert.deepEqual(aCapo('uno due tre quattro', 80, misura), ['uno due', 'tre', 'quattro']);
  const r = aCapo('uno due tre quattro cinque sei', 80, misura, 2);
  assert.equal(r.length, 2);
  assert.ok(r[1].endsWith('…'));
});

test('l\'archivio delle foto è nell\'app e ogni voce ha il suo file', () => {
  const arch = JSON.parse(readFileSync(new URL('../img/foto-post/archivio.json', import.meta.url), 'utf8'));
  assert.ok(arch.length >= 10);
  for (const f of arch) {
    assert.ok(f.nome && f.descrizione && Array.isArray(f.parole) && f.fonte, f.nome);
    assert.ok(readFileSync(new URL('../' + f.file, import.meta.url)).length > 10000, f.file);
    assert.ok(Math.min(f.larghezza, f.altezza) >= 1080, f.nome + ': sotto i 1080 px di lato corto la foto sgrana sul post');
  }
});

test('la scheda del post ha l\'immagine proposta, e niente QR né link dentro', () => {
  const com = readFileSync(new URL('../js/comunicazione.js', import.meta.url), 'utf8');
  const gr = readFileSync(new URL('../js/post-grafica.js', import.meta.url), 'utf8');
  assert.match(com, /\$\{htmlGrafica\(p, immagini\(p\)\.length\)\}/);
  assert.match(com, /collegaGrafica\(\$\('#drawer-body'\), p,/);
  assert.match(gr, /op: 'immagine', id: p\.id, mime: 'image\/jpeg', base64/, 'si carica dalla stessa strada del «Carica»');
  assert.doesNotMatch(gr, /qrcode|QR\(|https?:\/\/[^'"\s]*formedilpadova/i, 'nell\'immagine niente QR né indirizzi');
  assert.match(gr, /img\/logo-post-positivo\.png/);
  assert.match(gr, /img\/foto-post\/archivio\.json/);
  for (const c of ['p.immagine_suggerita', 'val', 'v', 'f.descrizione', 'f.nome']) {
    assert.ok(gr.includes('esc(' + c), c + ' passa da esc()');
  }
  assert.doesNotMatch(gr, /#202327|#000\b/, 'testi mai neri: il grigio dell\'ente');
});
