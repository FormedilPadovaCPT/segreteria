/* ============================================================================
   PIÙ VERIFICHE IN UN CORSO, UNA PER MODULO                    (19/09/2026)

   Chiesto dall'utente subito dopo il test scritto dal docente: «nei corsi con
   più docenti o più moduli/giornate potrebbe essere che ci sono più test di
   docenti diversi». Alla domanda su come tenerli insieme ha risposto:
   **tutti e due i modi, decidendo corso per corso**.

   COM'È FATTO, in una riga: una verifica di modulo è una riga di
   `s_test_parti` col suo codice, il suo QR, la sua soglia e la sua finestra;
   `s_corsi.test_modo` dice se quel corso usa la verifica unica o quelle per
   modulo. Tutto il resto — domande, prove, inviti, proposte — prende una
   colonna `parte_id` che è NULL su tutto quello che esiste oggi.

   ⚠️ IL TEST UNICO NON CAMBIA. Chi ha già un test non se ne accorge: le
   funzioni di sempre continuano a lavorare sulle righe con parte_id nullo, e
   un corso resta «unico» finché non si crea il primo modulo.

   ⚠️ IL PORTALE NON È STATO TOCCATO, ed è il punto che ha reso fattibile la
   cosa in mezza giornata: la pagina del test legge da `test_pubblici` sul
   progetto Servizi *per codice*, e il codice di un modulo è un codice come un
   altro. Basta pubblicare la parte (`test_pubblicazione_parte` +
   `questionari-pubblica` con `cosa: 'test_parte'`) perché il QR funzioni.

   ⚠️ UN CODICE PERSONALE PER PERSONA, NON PER MODULO. Il registro si stampa
   una volta sola e il codice sta lì accanto al nome: farne uno per ogni
   verifica vorrebbe dire ristampare tutto. Quindi `test_parte_apri` riusa i
   codici già dati e ne crea solo a chi non ce l'ha.

   ⚠️ «UNA CONSEGNA PER PERSONA» DIVENTA «UNA PER PERSONA E PER MODULO», e
   l'indice unico va scritto su un'espressione: `(corso_id, iscritto_id,
   coalesce(parte_id, 0))`. Con le colonne nude non fermerebbe niente sul test
   unico, perché in SQL due NULL non si scontrano mai.

   ⚠️ L'ATTESTATO NON GUARDA PIÙ UNA PROVA SOLA. `test_valutazione_iscritto`
   compone il quadro: «Superato (3 moduli su 3)», oppure «Da completare (1 su
   3; manca: Ponteggi)». Finché una verifica prevista non è stata fatta, la
   valutazione lo dice — prima bastava l'ultima prova convalidata.

   ⚠️ SOSTITUIRE LE DOMANDE SI BLOCCA SOLO PER LA VERIFICA INTERESSATA: se
   qualcuno ha consegnato il modulo 1, il modulo 2 si può ancora rifare. La
   prima stesura guardava tutte le prove del corso e avrebbe dato un falso
   allarme su ogni corso con più moduli.

   Migrazioni applicate, in quest'ordine:
     test_per_modulo_tabelle_2026_09_19        s_test_parti, colonne, indice unico
     test_per_modulo_funzioni_2026_09_19       apri/elenco/elimina, consegna,
                                               pubblicazione, convalida, valutazione
     test_dal_docente_per_modulo_2026_09_19    l'invito sa a quale modulo si riferisce
     dtest_corrette_sono_testi_2026_09_19      vedi qui sotto

   ⚠️ LA RISPOSTA GIUSTA SI SCRIVE COL SUO TESTO, NON COL NUMERO DI RIGA.
   Trovato guardando come il corsista consegna: il portale manda il TESTO
   dell'opzione che ha scelto, e `test_consegna` lo confronta con «corrette».
   La prima versione della pagina del docente mandava gli INDICI: sarebbe
   passata da tutti i controlli e avrebbe corretto ogni prova a zero — un
   errore silenzioso, il peggiore. Ora `dtest_domande_esito` pretende che ogni
   risposta segnata sia una di quelle proposte, scritta uguale.

   PROVATO IL 19/09/2026, dal portale fino al database: modulo creato, invito
   col suo link, domanda scritta dalla pagina del docente, proposta arrivata
   con `parte_id`, «porta nel test» che la mette nel modulo con l'origine
   («PROVA TECNICA docente») e lascia vuoto il test del corso. Righe di prova
   eliminate: erano di tabelle nate oggi, senza storico da rispettare.
   ============================================================================ */

/* Il sorgente delle funzioni sta nelle migrazioni. Qui restano le decisioni,
   che è quello che fra un anno non si ricostruisce dal codice.

   s_test_parti     una verifica di modulo (titolo, docente, giornata, codice,
                    soglia, minuti, finestra, stato di pubblicazione)
   s_corsi.test_modo  'unico' | 'per_modulo'
   s_test_domande.parte_id / origine / proposta_id
   s_test_prove.parte_id
   s_test_inviti.parte_id, s_test_proposte.parte_id

   test_parte_apri(corso, titolo, docente, persona, giornata, soglia, minuti, ore, parte)
   test_parti(corso)            l'elenco con link e conteggi
   test_parte_elimina(parte)    solo se nessuno ha consegnato
   test_pubblicazione_parte(parte)
   test_consegna(...)           riconosce il codice di un modulo oltre a quello del corso
   test_convalida(...)          soglia del modulo, valutazione composta
   test_valutazione_iscritto(iscritto)
*/