// Kit per l'agenzia (17/11/2026): che cosa si allega e con che nome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nomeSicuro, percorsoKit, motivoRifiuto, elencoKit, mimeDaNome, righeAllegati, KIT_MAX_FILE } from '../js/kit-agenzia.js';

test('nome di file pulito', () => {
  assert.equal(nomeSicuro('Città del Lavoro 1080x1350.JPG'), 'Citta-del-Lavoro-1080x1350.jpg');
  assert.equal(nomeSicuro('C:\\cartella\\video finale.mp4'), 'video-finale.mp4');
  assert.equal(nomeSicuro(''), 'file');
  assert.equal(nomeSicuro('..'), 'file');
  assert.ok(nomeSicuro('a'.repeat(300) + '.png').length <= 114);
});

test('il percorso sta sotto post-<id>/, come chiede la regola del bucket', () => {
  assert.equal(percorsoKit(117, 'richiamo 1080x1350.jpg', 42), 'post-117/42-richiamo-1080x1350.jpg');
  assert.match(percorsoKit('99', 'x.mp4'), /^post-99\/\d+-x\.mp4$/);
});

test('si caricano solo immagini e MP4, fino a 50 MB', () => {
  assert.equal(motivoRifiuto({ name: 'a.jpg', type: 'image/jpeg', size: 1000 }), '');
  assert.equal(motivoRifiuto({ name: 'v.mp4', type: 'video/mp4', size: KIT_MAX_FILE }), '');
  assert.match(motivoRifiuto({ name: 'b.pdf', type: 'application/pdf', size: 10 }), /solo immagini/);
  assert.match(motivoRifiuto({ name: 'g.mp4', type: 'video/mp4', size: KIT_MAX_FILE + 1 }), /50 MB/);
  assert.equal(motivoRifiuto(null), 'nessun file');
});

test('il kit: immagini del post, video per Telegram, materiale per l\'agenzia, in quest\'ordine', () => {
  const post = {
    id: 117,
    immagini: [{ url: 'https://x/social-media/post-117/1.jpg', path: 'post-117/1.jpg' }, { url: 'https://x/post-117/2.png' }],
    video_file_url: 'https://x/social-video/post-117/v.mp4',
    kit_allegati: [{ nome: 'annuncio 1080x1350.jpg', path: 'post-117/5-annuncio-1080x1350.jpg', mime: 'image/jpeg', dimensione: 300000 },
                   { nome: 'video reel.mp4', path: 'post-117/6-video-reel.mp4', mime: 'video/mp4' }],
  };
  const k = elencoKit(post);
  assert.deepEqual(k.map((x) => x.origine), ['immagine', 'immagine', 'video', 'agenzia', 'agenzia']);
  assert.deepEqual(k.map((x) => x.nome), ['post-117_01_copertina.jpg', 'post-117_02_carosello.png', 'post-117_video.mp4', 'annuncio-1080x1350.jpg', 'video-reel.mp4']);
  assert.equal(k[3].path, 'post-117/5-annuncio-1080x1350.jpg');
});

test('senza carosello vale la sola copertina; senza niente il kit è vuoto', () => {
  assert.deepEqual(elencoKit({ id: 5, immagini: [], immagine_url: 'https://x/c.webp' }).map((x) => x.nome), ['post-5_01_copertina.webp']);
  assert.deepEqual(elencoKit({ id: 5 }), []);
  assert.deepEqual(elencoKit({ id: 5, kit_allegati: [{ nome: 'x.jpg' }] }), [], 'una voce senza percorso non si allega');
});

test('due file con lo stesso nome non arrivano all\'agenzia uguali', () => {
  const k = elencoKit({ id: 1, kit_allegati: [{ nome: 'post.jpg', path: 'post-1/1-post.jpg' }, { nome: 'POST.jpg', path: 'post-1/2-post.jpg' }] });
  assert.deepEqual(k.map((x) => x.nome), ['post.jpg', 'POST_2.jpg']);
});

test('tipo dal nome e righe dell\'elenco', () => {
  assert.equal(mimeDaNome('a.JPG'), 'image/jpeg');
  assert.equal(mimeDaNome('a.jpeg'), 'image/jpeg');
  assert.equal(mimeDaNome('v.mp4'), 'video/mp4');
  assert.equal(mimeDaNome('x.zip'), 'application/octet-stream');
  assert.deepEqual(righeAllegati([]), ['Allegati: nessuno.']);
  const r = righeAllegati([{ nome: 'a.jpg', origine: 'immagine', byte: new Uint8Array(2048) }, { nome: 'v.mp4', origine: 'agenzia', byte: new Uint8Array(3 * 1048576) }]);
  assert.deepEqual(r, ['Allegati:', '- a.jpg (immagine del post, 2 KB)', '- v.mp4 (per i vostri canali, 3.0 MB)']);
});
