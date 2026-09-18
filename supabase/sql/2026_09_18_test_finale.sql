/* ============================================================================
   IL TEST DI VERIFICA FINALE                                  (18/09/2026)

   Chiesto dall'utente mentre si costruiva il questionario: «se nel tipo di
   formazione è previsto un test bisognerà mettere un qr anche per quello», e
   «i test li valuta sulle risposte corrette il coordinatore; ora abbiamo un
   correttore, ma inserendo le risposte corrette tra quelle proposte si
   potrebbe correggere da solo calcolando il punteggio».

   È L'OPPOSTO DEL QUESTIONARIO, e le due cose non si devono somigliare:
     · il questionario è ANONIMO e misura il gradimento;
     · il test è NOMINATIVO, perché l'esito vale per l'attestato. Qui l'ora si
       registra: serve a sapere quanto è durata la prova, e non c'è niente da
       proteggere — il nome c'è già.

   IL CORRETTORE DI OGGI è una coppia di file Word gemelli (il test e il test
   con le risposte segnate): due documenti da tenere allineati a mano, e se il
   test cambia e il correttore no si corregge con la griglia sbagliata. Qui la
   risposta giusta sta DENTRO la domanda, e il correttore sparisce.

   COME SI DICE CHI SI È: col CODICE PERSONALE, stampato accanto al proprio
   nome sul registro — non scegliendo da un elenco di nomi, che si vedrebbero
   tutti e da cui chiunque potrebbe prendere il posto di un altro. Al portale
   arrivano solo l'IMPRONTA del codice e le INIZIALI, come per la verifica
   pubblica degli attestati.

   ⚠️ LE RISPOSTE GIUSTE NON ESCONO MAI VERSO IL PORTALE: test_pubblicazione
   non le seleziona nemmeno, e la funzione che riceve dall'altra parte rifiuta
   qualunque campo non previsto nelle domande.

   ⚠️ L'app CORREGGE, NON DECIDE: il testo libero lo valuta una persona, e
   l'esito lo convalida il docente o il coordinatore — come oggi firma il
   foglio corretto. Senza convalida l'attestato non esce.

   Migrazioni applicate (in quest'ordine):
     test_finale_tabelle_2026_09_18          tabelle, colonne, RLS
     test_finale_funzioni_2026_09_18         apri/pubblica/consegna/convalida
     test_codice_personale_per_riga_2026_09_18   ⚠️ vedi sotto
     test_prove_colonne_portale_2026_09_18   fonte e timestamp_modulo
     quest_link_anche_test_2026_09_18        il link per ristampare i fogli
   e sul progetto SERVIZI: test_pubblici_2026_09_18, cassetta_tipo_tst_2026_09_18.

   ⚠️ UNA SOTTOQUERY NON CORRELATA SI VALUTA UNA VOLTA SOLA. La prima versione
   assegnava i codici personali con
       update ... set test_codice = (select string_agg(...) from generate_series(1,5))
   e li dava TUTTI UGUALI: PostgreSQL valuta quell'espressione una volta e la
   riusa per ogni riga. È lo stesso inganno del `(funzione(...)).*` che il
   09/09 bruciò 32 numeri di protocollo. Quando serve un valore DIVERSO per
   ogni riga, lo si genera per riga — con ritentativo sulla collisione, perché
   «improbabile» non è «impossibile».

   Il sorgente completo delle funzioni è nelle migrazioni; qui restano le
   decisioni, che è quello che fra un anno non si ricostruisce dal codice.
   ============================================================================ */
