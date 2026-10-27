// (26/10/2026) «✍️ Documento alla firma»: il riquadro della firma si trova
// leggendo il PDF, sotto l'ultima scritta della carica.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  righeDaTesto, riquadroFirma, rifDocumento, titoloDaFile, nomePulito, MISURE, RIF_PREFISSO,
} from '../js/documento-firma-regole.js';

const A4 = [{ w: 595.3, h: 841.9 }, { w: 595.3, h: 841.9 }];
const pezzo = (pagina, str, x, y, w = 60, h = 11) => ({ pagina, str, x, y, w, h });

test('Word spezza la riga: i pezzi alla stessa altezza diventano una riga sola', () => {
  const righe = righeDaTesto([pezzo(1, 'Il ', 379, 91, 10), pezzo(1, 'Direttore', 389, 91.5, 40), pezzo(1, 'altro', 60, 300)]);
  const r = righe.find((x) => x.testo === 'Il Direttore');
  assert.ok(r, 'la riga ricomposta');
  assert.equal(r.x0, 379);
  assert.equal(r.x1, 429);
});

test('la firma va sotto l\'ultima scritta, centrata, sopra al piè di pagina', () => {
  const righe = righeDaTesto([
    pezzo(0, 'Il Direttore della Scuola ha scritto…', 60, 500, 300), // nel testo: non è la firma
    pezzo(1, 'Formedil Padova – Scuola Costruzioni Giuseppe Jappelli', 300, 160, 230),
    pezzo(1, 'Il Direttore', 380, 145, 50),
    pezzo(1, 'piè di pagina', 60, 40, 470, 8),
  ]);
  const rq = riquadroFirma(righe, 'direttore', A4);
  assert.equal(rq.pagina, 1);
  assert.equal(rq.w, MISURE.w);
  assert.equal(rq.h, MISURE.hMax);
  assert.ok(rq.y + rq.h < 145, 'sotto la scritta');
  assert.ok(rq.y - MISURE.timbro > 40 + 8 * 0.8, 'la riga «Firmato nell\'app» resta sopra il piè di pagina');
  assert.ok(Math.abs(rq.x + rq.w / 2 - 405) < 1, 'centrata sulla scritta');
});

test('poco spazio sotto la scritta: firma a misura piena, sale sopra il testo, non tocca il piè di pagina', () => {
  // (27/10/2026) il caso vero della dichiarazione Carron: con ~40 punti liberi
  // la firma era uscita rimpicciolita; ora resta alta hMax e sale sulla scritta
  const righe = righeDaTesto([pezzo(1, 'Il Direttore', 379, 91, 50), pezzo(1, 'Formedil Padova – Scuola…', 75, 40, 450, 8), pezzo(1, 'Salute: cpt@…', 260, 31, 80, 8)]);
  const rq = riquadroFirma(righe, 'direttore', A4);
  assert.equal(rq.h, MISURE.hMax, 'misura piena');
  assert.equal(rq.sopraTesto, true);
  assert.ok(rq.y + rq.h > 91, 'si appoggia sulla scritta');
  assert.ok(rq.y - MISURE.timbro >= 40 + 8 * 0.8 + MISURE.stacco - 0.1, 'la riga «Firmato nell\'app» resta sopra il piè di pagina');
});

test('con spazio sotto la scritta la firma non sale', () => {
  const righe = righeDaTesto([pezzo(1, 'Il Direttore', 380, 145, 50), pezzo(1, 'piè di pagina', 60, 40, 470, 8)]);
  assert.equal(riquadroFirma(righe, 'direttore', A4).sopraTesto, false);
});

test('scritta attaccata al bordo alto: la firma non sta e lo dice', () => {
  const righe = righeDaTesto([pezzo(0, 'Il Direttore', 380, 830, 50), pezzo(0, 'testo', 60, 800, 470, 30)]);
  assert.throws(() => riquadroFirma(righe, 'direttore', A4), /non sta nella pagina/);
});

test('se la carica non è scritta nel PDF lo dice', () => {
  const righe = righeDaTesto([pezzo(0, 'Il Presidente', 380, 200)]);
  assert.throws(() => riquadroFirma(righe, 'direttore', A4), /non trovo la scritta «Il Direttore»/);
  assert.ok(riquadroFirma(righe, 'presidente', A4));
  assert.throws(() => riquadroFirma(righe, 'tecnico', A4), /non previsto/);
});

test('il riquadro non esce dalla pagina quando la scritta è sul bordo', () => {
  const righe = righeDaTesto([pezzo(0, 'Il Presidente', 560, 300, 30)]);
  const rq = riquadroFirma(righe, 'presidente', A4);
  assert.ok(rq.x + rq.w <= A4[0].w - MISURE.lato + 0.1);
});

test('riferimento, titolo e nome del file', () => {
  const nome = '2026_10_26_DICH_Formedil-Padova_attivita-svolte-per-Carron-Cav-Angelo_bozza.pdf';
  const rif = rifDocumento(nome, new Date(0));
  assert.ok(rif.startsWith(RIF_PREFISSO));
  assert.ok(!/[^\w:-]/.test(rif), 'solo caratteri sicuri');
  assert.equal(titoloDaFile(nome), 'Formedil Padova attivita svolte per Carron Cav Angelo');
  assert.equal(nomePulito('dichiarazione Carron'), 'dichiarazione_Carron.pdf');
});
