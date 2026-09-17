/* I testi che escono dall'ufficio per un accesso negato al cantiere
   (js/cantieri-critici-doc.js). Testo validato dall'utente il 17/09/2026:
   questi test tengono ferme le scelte fatte, non lo stile. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fraseMotivo, paragrafiAccessoNegato, paragrafiSollecito, corpoMail, corpoRichiestaPec,
  oggettoLettera, nomeFileLettera, slug } from '../js/cantieri-critici-doc.js';

const caso = { id: 12, data_evento: '2026-09-17', impresa_nome: 'Rossi Costruzioni S.r.l.',
  cantiere_desc: 'Via Olmo snc (Loc. Bronzola), CAMPODARSEGO — CNCEC90', cantiere_breve: 'Via Olmo snc, Campodarsego' };
const opz = { tecnico: 'Arch. Tommaso Visentini', tecnicoTel: '348 0000000', termine: '2026-10-02' };

test('il motivo dice solo quello che il tecnico ha scritto', () => {
  assert.equal(fraseMotivo({ motivo: 'nessuno_presente', presente_cognome: 'Bianchi' }), 'il cantiere era chiuso e non era presente nessuno');
  assert.equal(fraseMotivo({ motivo: 'rifiutato' }), "l'accesso non è stato consentito");
  assert.equal(fraseMotivo({ motivo: 'rifiutato', presente_titolo: 'Sig.', presente_nome: 'Mario', presente_cognome: 'Bianchi', presente_qualifica: 'Capo cantiere' }),
    "l'accesso non è stato consentito da Sig. Mario Bianchi, in qualità di Capo cantiere");
  assert.equal(fraseMotivo({ motivo: 'rifiutato', presente_qualifica: 'Preposto' }), "l'accesso non è stato consentito da una persona presente, in qualità di Preposto");
  /* i casi storici e quelli aperti a mano non hanno il motivo: vale la formula della vecchia lettera */
  assert.equal(fraseMotivo({}), 'non si sono determinate le condizioni per effettuare la visita');
});

test('la lettera: assistenza e non ispezione, termine, contatti; niente «organi dell\'Ente»', () => {
  const t = paragrafiAccessoNegato({ ...caso, motivo: 'nessuno_presente' }, opz).join('\n');
  assert.match(t, /il 17\/09\/2026 il nostro tecnico Arch\. Tommaso Visentini non ha potuto/);
  assert.match(t, /Via Olmo snc, Campodarsego: il cantiere era chiuso/);
  assert.match(t, /attività di assistenza all'impresa, non un'ispezione/);
  assert.match(t, /entro il 02\/10\/2026/);
  assert.match(t, /tel\. 049 761168 int\. 4, cpt@formedilpadova\.it/);
  assert.match(t, /tecnico di zona \(Arch\. Tommaso Visentini, tel\. 348 0000000\)/);
  /* tolto dall'utente il 17/09/2026: non deve tornare */
  assert.doesNotMatch(t, /organi dell.Ente|ulteriori iniziative/i);
  assert.doesNotMatch(t, /PRESIDENTE/i);
});

test('senza tecnico e senza telefono la frase resta in piedi', () => {
  const t = paragrafiAccessoNegato(caso, { termine: '2026-10-02' }).join('\n');
  assert.match(t, /il nostro tecnico non ha potuto/);
  assert.doesNotMatch(t, /tecnico di zona/);
  assert.doesNotMatch(t, /undefined|null/);
});

test('il sollecito cita il protocollo della lettera che sollecita', () => {
  const t = paragrafiSollecito(caso, { sigla: '2590/2026', data_prot: '2026-09-17' }, { ...opz, termine: '2026-10-17' }).join('\n');
  assert.match(t, /Facendo seguito alla nostra comunicazione Prot\. 2590\/2026 del 17\/09\/2026/);
  assert.match(t, /non ci risultano a oggi Vostri contatti/);
  assert.match(t, /entro il 17\/10\/2026/);
  assert.doesNotMatch(t, /organi dell.Ente|ulteriori iniziative/i);
});

test('mail, richiesta PEC, oggetto e nome del file', () => {
  assert.match(corpoMail(caso, opz), /^Spett\.le Impresa,/);
  assert.match(corpoMail(caso, { ...opz, saluto: 'Egr. Rossi Sig. Mario' }, true), /^Egr\. Rossi Sig\. Mario,[\s\S]*il sollecito relativo alla comunicazione/);
  assert.match(corpoRichiestaPec(caso, 'Prot. 2590/2026', 'rossi@pec.it'), /Destinatario PEC: rossi@pec\.it/);
  assert.match(corpoRichiestaPec(caso, 'Prot. 2590/2026', ''), /PEC dell'impresa non presente in anagrafica/);
  assert.equal(oggettoLettera(caso), 'Tentativo di visita in cantiere del 17/09/2026 — Via Olmo snc, Campodarsego.');
  assert.equal(nomeFileLettera(caso, '2026-09-17'), '2026_09_17_COMU_Rossi-Costruzioni-S-r-l_accesso-negato-cantiere-n12.pdf');
  assert.equal(nomeFileLettera(caso, '2026-10-05', true, 'CAMPODARSEGO'), '2026_10_05_COMU_Rossi-Costruzioni-S-r-l_sollecito-accesso-negato-cantiere-CAMPODARSEGO-n12.pdf');
  assert.equal(slug('Società Edile «Àncora» & C.'), 'Societa-Edile-Ancora-C');
});
