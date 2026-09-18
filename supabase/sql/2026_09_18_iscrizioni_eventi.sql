/* ============================================================================
   ISCRIZIONI A UN EVENTO — un motore solo                      (18/09/2026)

   Già applicato in produzione con le migrazioni:
     GESTIONALE (utdantrfugnmqsuujxbe)
       iscrizioni_eventi_tabelle_2026_09_18
       iscrizioni_eventi_funzioni_2026_09_18
       iscr_pubblicazione_giornate_2026_09_18
       iscrizioni_istruttoria_e_conferma_2026_09_18
       iscr_verifica_2026_09_18
       iscr_istruttoria_colonne_imprese_2026_09_18
       flussi_uso_iscrizioni_2026_09_18
     SERVIZI (qcvwrgjldbdoxcfdsvkq)
       iscrizioni_pubbliche_2026_09_18
       cassetta_tipo_isc_2026_09_18

   Questo file NON si riesegue: sta qui perché la decisione e le ragioni
   restino scritte accanto al codice, come per le altre del 18/09.
   ----------------------------------------------------------------------------

   LA DECISIONE (riferita dall'utente il 18/09/2026, due punti):
     «questo modulo deve portare i dati al gestionale, era già stato deciso che
      così si controllavano eventuali inserimenti come nuove anagrafiche, ditte
      in modo da non registrare doppioni e gli iscritti popolavano il corso o la
      conferenza per cui era stato inviato il modello»
     «i dati vanno richiesti tutti subito»
   e poi, sulla forma: un motore solo per l'iscrizione ai progetti finanziati e
   per il modulo anagrafiche delle conferenze, con la possibilità che **anche un
   singolo si iscriva per sé**.

   PERCHÉ UN MOTORE SOLO. Lavorandoci è venuto fuori che l'iscrizione a una
   lezione di un progetto e il modulo anagrafiche di una conferenza chiedono la
   stessa cosa — l'anagrafica completa di chi partecipa, che deve finire nel
   corso giusto senza creare doppioni. Cambia la porta d'ingresso, non la
   domanda: l'elenco pubblico del portale, oppure un link targato.

   LO STATO DI PARTENZA, misurato prima di scrivere una riga: il modulo
   formedilpadovacpt.github.io/conferenza-cantiere/ scriveva su un foglio
   Google che **nessuno importava** (in `corsi.js` non compare, e il foglio era
   fermo al 6 luglio con la sola compilazione di prova di marzo). Questa
   tabella è dove quei dati avrebbero dovuto arrivare.

   ── I QUATTRO PUNTI CHE REGGONO IL DISEGNO ────────────────────────────────

   1. UNA RICHIESTA NON È UN ISCRITTO.
      Le iscrizioni arrivano in `s_iscrizioni`; la segreteria guarda e
      CONFERMA, e solo allora nascono le righe di `s_corsi_iscritti` e, se
      servono, le anagrafiche. È qui che si fermano i doppioni: chi compila
      non sa se in anagrafica c'è già — e non lo può sapere, perché
      l'anagrafica non gliela facciamo vedere.

   2. L'ISTRUTTORIA PROPONE, NON SCEGLIE.
      `iscr_istruttoria` dà un semaforo per ogni persona: verde (nessun
      riscontro), giallo (un candidato in anagrafica, da confermare), rosso
      (già iscritta a questo evento). Il codice fiscale è una corrispondenza
      forte, il nominativo una somiglianza — la stessa distinzione delle
      nomine dai verbali e del tecnico di zona.
      ⚠️ L'anagrafica nuova nasce SOLO se la segreteria lo chiede: crearla da
      soli rifarebbe il doppione che tutto questo serve a evitare.

   3. DUE PORTE, DUE PROVE, SCRITTE DUE VOLTE.
      Link targato → la firma deve tornare. Elenco pubblico → niente firma, ma
      l'evento dev'essere `iscr_pubblico`. Il controllo sta sia in
      `apri_iscrizione` (Servizi) sia in `iscr_verifica` (Gestionale): i due
      lati non si fidano l'uno dell'altro.
      ⚠️ La firma ha il prefisso PROPRIO ('iscr:'): stesso segreto, tre usi —
      'evento:', 'test:' e 'iscr:' — così un link d'iscrizione non apre il
      questionario dello stesso evento.

   4. CHIUSE O PIENE, L'ISCRIZIONE ENTRA LO STESSO.
      Con `oltre_tetto` e il motivo scritto. Perdere chi ha fatto in tempo per
      un secondo sarebbe il modo peggiore di sbagliare (regola del 04/09).

   ── QUELLO CHE ESCE VERSO IL PORTALE ──────────────────────────────────────
   `iscrizioni_pubbliche` sul progetto Servizi contiene solo che cos'è
   l'evento, quando, dove e quanti posti restano. Della firma c'è la sola
   impronta sha256. NESSUN dato di persona: non chi si è iscritto, non il
   referente, non l'impresa che ha chiesto la conferenza.
   ⚠️ I posti liberi sono un numero che invecchia: chi legge vede quelli
   dell'ultima pubblicazione. Per questo l'app ripubblica a ogni conferma,
   a ogni cambio di vetrina e alla chiusura.

   ── DUE COSE IMPARATE PROVANDO ────────────────────────────────────────────
   · In `imprese` il nome sta in `impresa_nome`. Il suggerimento di Postgres
     («Perhaps you meant ragione_sociale2») portava fuori strada.
   · `extensions.http` si ferma a 5 secondi e la transazione muore con lei: se
     una chiamata alla edge function va in timeout, l'UPDATE fatto nella stessa
     transazione viene annullato. Le due cose vanno separate.

   ── DA FARE PRIMA DEL PRIMO USO VERO ──────────────────────────────────────
   · `s_progetti_formativi.pubblicato` è **false su tutto**, ed è voluto: fra
     gli «attivi» ci sono voci che sono categorie di prestazione («Visite
     ordinarie», «Conferenza di cantiere», «Preverifica asseverazione»), non
     progetti a cui un'impresa si iscrive. Si spunta a mano quello che va in
     vetrina, e gli si scrive una `desc_pubblica`: `desc_breve` contiene sigle
     da gestionale (CAM52, SPISAL SOFT-SKILLS) che fuori non dicono niente.
   · Il modulo conferenza-cantiere su GitHub Pages resta dov'è: adesso la
     stessa cosa la fa il portale, e quel repo andrà spento o fatto puntare qui
     — deciderlo quando la prima conferenza vera passerà da questa strada.
   ============================================================================ */
