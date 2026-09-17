/* I testi che escono dall'ufficio per un accesso negato al cantiere
   (js/cantieri-critici-doc.js). Testo validato dall'utente il 17/09/2026:
   questi test tengono ferme le scelte fatte, non lo stile. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fraseMotivo, paragrafiAccessoNegato, paragrafiSollecito, corpoMail, corpoRichiestaPec,
  oggettoLettera, nomeFileLettera, slug, destinatariSegnalazione, scheletroSegnalazione, SEGNAPOSTO_MERITO,
  oggettoSegnalazione, corpoPropostaConferenza, corpoDemanda, corpoUlterioreVisita } from '../js/cantieri-critici-doc.js';

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

const contatti = { spisal: { ente: 'AZIENDA ULSS 6 EUGANEA — SPISAL', a: 'spisal@esempio.it' },
  itl: { ente: 'ITL Padova', a: 'itl@esempio.it', alla_ca: 'Gaiola Dott.ssa Sonia' }, ceiv: { ente: 'Cassa Edile', a: 'appalti@esempio.it' } };

test('segnalazione: chi va in A, chi per conoscenza, e la Cassa Edile solo se spuntata', () => {
  const d1 = destinatariSegnalazione('spisal_pc_itl', contatti);
  assert.deepEqual(d1.a, ['spisal@esempio.it']);
  assert.deepEqual(d1.cc, ['itl@esempio.it', 'appalti@esempio.it']);
  assert.match(d1.intestazione, /^Spett\.le AZIENDA ULSS 6 EUGANEA — SPISAL,\ne\.p\.c\.\nSpett\.le ITL Padova,$/);
  assert.equal(d1.allaCa, 'Gaiola Dott.ssa Sonia');
  const d2 = destinatariSegnalazione('itl', contatti, false);
  assert.deepEqual([d2.a, d2.cc], [['itl@esempio.it'], []]);
  assert.doesNotMatch(d2.intestazione, /e\.p\.c\./);
  /* configurazione vuota: nessun indirizzo inventato */
  assert.deepEqual(destinatariSegnalazione('spisal', {}).a, []);
});

test('lo scheletro porta il segnaposto del merito: non lo scrive l\'app', () => {
  const t = scheletroSegnalazione(caso, [{ nr_verbale: 'CPT/24_25/0589', data_visita: '2025-07-16' }, { nr_verbale: 'CPT/24_25/0704', data_visita: '2025-09-05' }], 'Spett.le SPISAL,');
  assert.match(t, /le relazioni relative ai 2 sopralluoghi effettuati nel cantiere di Via Olmo snc, Campodarsego/);
  assert.match(t, /verbali CPT\/24_25\/0589 del 16\/07\/2025, CPT\/24_25\/0704 del 05\/09\/2025/);
  assert.ok(t.includes(SEGNAPOSTO_MERITO));
  /* niente giudizi di responsabilità precompilati */
  assert.doesNotMatch(t, /responsabilit|superficial|grav/i);
  assert.match(scheletroSegnalazione(caso, [{ nr_verbale: 'X/1', data_visita: '2026-01-02' }], 'Spett.le ITL,'), /la relazione relativa al sopralluogo effettuato/);
  assert.equal(oggettoSegnalazione(caso), 'Invio Segnalazione criticità cantiere Via Olmo snc, Campodarsego – Impresa Rossi Costruzioni S.r.l.');
});

test('la conferenza è una proposta, il fascicolo per chi decide elenca verbali e passi fatti', () => {
  const c = corpoPropostaConferenza(caso, { termine: '2026-10-02' });
  assert.match(c, /È una proposta: l'adesione è libera/);
  assert.doesNotMatch(c, /obblig|dovrete|tenuti a/i);
  const f = corpoDemanda({ ...caso, origine: 'proposta_segnalazione', tecnico_nome: 'Camuffo Arch. Marco', note: 'nota' },
    [{ tipo: 'stato', created_at: '2026-09-17T10:00:00Z', testo: 'x' }, { tipo: 'lettera_impresa', created_at: '2026-09-17T10:00:00Z', testo: 'Comunicazione 2590-out' }],
    [{ nr_verbale: 'CPT/24_25/0704', data_visita: '2025-09-05', ipc: 'MEDIO', segnalazione: true }], 'commissione');
  assert.match(f, /^Alla Commissione Sicurezza,/);
  assert.match(f, /CPT\/24_25\/0704 del 05\/09\/2025 — IPC MEDIO — il tecnico propone la segnalazione/);
  assert.match(f, /Comunicazione 2590-out/);
  assert.doesNotMatch(f, /— x\n/);
  assert.match(corpoUlterioreVisita(caso, 'Tommaso', 'Sentire prima il capocantiere.'), /^Ciao Tommaso,[\s\S]*Sentire prima il capocantiere\./);
});
