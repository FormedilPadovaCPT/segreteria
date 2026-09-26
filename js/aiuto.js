/* ============================================================
   AIUTO AL PASSAGGIO DEL MOUSE — App segreteria
   (23/09/2026, chiesto dall'utente: «in Access, fermandomi col
   mouse su un tasto, si apriva un pop che spiegava che cosa
   succedeva se lo premevo»)

   Ci si ferma mezzo secondo col mouse su un pulsante o su una voce
   del menu e compare una nuvoletta di due righe che dice CHE COSA
   SUCCEDE se si preme. Sul telefono si tiene premuto il dito. Non
   cambia niente del funzionamento.

   Da dove viene il testo, in quest'ordine: data-aiuto sull'elemento;
   il dizionario per id; il dizionario per testo («t:» + testo senza
   emoji, minuscolo); per prefisso del testo («p:», per i pulsanti il
   cui testo cambia); l'attributo title. Per aggiungere una
   spiegazione basta una riga nel dizionario. Il motore è lo stesso
   del gestionale visite (aiuto.js) e dell'asseverazione (Aiuto.tsx).
   ============================================================ */

window.AIUTO_TESTI = {
  /* ── menu ── */
  't:cruscotto': 'La pagina iniziale: che cosa aspetta una risposta, le scadenze vicine, la posta letta dall\'app e i moduli arrivati dal portale.',
  't:registro protocollo': 'Il registro unico dell\'ente: cerca un numero, apri il documento su Drive, timbra, invia, inoltra. Un numero, un documento.',
  't:nuovo protocollo in': 'Registra un documento arrivato: prende il primo numero libero in entrata (dal 1° ottobre un contatore solo). Il file si collega o si carica su Drive.',
  't:nuovo protocollo out': 'Registra un documento che esce dall\'ufficio: prende il numero in uscita e prepara timbro e bozza mail. Si fa quando il documento è pronto per uscire.',
  't:imprese': 'L\'anagrafica delle imprese: partita IVA come chiave, codici CEIV e ATECO, sedi, persone e tutto ciò che l\'ente ha con quell\'impresa.',
  't:documenti tecnici': 'I documenti dei tecnici con una scadenza (attestati, idoneità, nomine): l\'app avvisa prima che scadano.',
  't:pratiche rlst': 'Le richieste di affidamento al servizio RLST: dalla richiesta dell\'impresa alla risposta protocollata.',
  't:anagrafe rls': 'Le comunicazioni di nomina dei RLS aziendali e l\'anagrafe delle persone nominate.',
  't:segnalazioni cantiere': 'Le segnalazioni di cantiere arrivate al CPT (dai sindacati, dalle imprese, dai tecnici): richiedono l\'autorizzazione del Direttore prima di mandare un tecnico.',
  't:consulenze': 'Le richieste di consulenza delle imprese: quesito, risposta del coordinatore, eventuale uscita in cantiere da autorizzare.',
  't:richieste visita': 'Le richieste di visita o di serie di visite: dalla richiesta all\'autorizzazione del Direttore e all\'incarico al tecnico nel gestionale.',
  't:stage allievi': 'Gli abbinamenti allievi-aziende mandati dalla Scuola: dall\'elenco nascono gli incarichi di visita ai tecnici, senza passare dal Direttore.',
  't:cantieri notificati': 'Le notifiche preliminari di cantiere arrivate: si protocollano e si risponde a chi le manda.',
  't:conferenze cantiere': 'Le conferenze di cantiere chieste dalle imprese: formazione in cantiere ai dipendenti di una sola impresa, da autorizzare.',
  't:attestazioni dm 132': 'Le richieste di attestazione ai sensi del DM 132/2024: autorizzazione, rilascio protocollato e mail all\'impresa.',
  't:questionari sopralluogo': 'I questionari di gradimento compilati dalle imprese dopo il sopralluogo, con il riepilogo.',
  't:corsi e formazione': 'Corsi, giornate, docenti, iscritti, presenze e attestati; iscrizioni agli eventi, questionari e test.',
  't:persone': 'L\'anagrafica delle persone: lavoratori, referenti, RLS, docenti. Una persona sola anche se compare in più imprese.',
  't:nomine': 'Le nomine delle figure della sicurezza (RSPP, addetti emergenza, RLS…) con inizio e fine, per impresa e per persona.',
  't:presenze e ferie': 'Il foglio presenze mensile del personale interno e le richieste di ferie e permessi, con il giro di approvazione del Direttore.',
  't:incarichi e fatture tecnici': 'Gli incarichi mensili di visita ai tecnici, le prestazioni fatte, le fatture ricevute e il loro giro: verifica, approvazione del coordinatore, mandato.',
  't:amministrazione — mandati': 'I mandati di pagamento delle fatture dei tecnici: PDF, firma dell\'Amministrazione, registrazione del pagamento e avviso automatico al tecnico.',
  't:comunicazione': 'La redazione dei post: bozze proposte dal lunedì, approvazione, pubblicazione su Telegram e nel portale, kit per l\'agenzia.',
  't:statistiche': 'I numeri dell\'attività: protocollo, servizi, visite, formazione.',
  'nav-manuali': 'Scarica i manuali d\'uso nell\'ultima versione pubblicata. Non serve tenerne una copia.',
  'logout-btn': 'Esci dall\'app su questo dispositivo.',
  'veste-cerca': 'Cerca in tutta l\'app: una pagina, un numero di protocollo, un\'impresa. Da tastiera: Ctrl+K.',

  /* ── registro protocollo ── */
  't:nuovo out': 'Registra un documento in uscita: prende il numero adesso, quindi si fa quando il documento è pronto.',
  't:nuovo in': 'Registra un documento arrivato.',
  'f-reset': 'Toglie tutti i filtri del registro.',
  'btn-salva': 'Salva la registrazione. Se è un protocollo nuovo, il numero viene preso dal registro in questo momento e non si restituisce.',
  't:timbra un documento': 'Mette il timbro di protocollo (numero, data, QR) sul PDF: scegli tu dove, sulla pagina. L\'originale resta su Drive accanto al timbrato.',
  't:invia protocollato': 'Prepara la bozza di mail in Outlook con il documento timbrato allegato e la firma dell\'ufficio. L\'invio lo fai tu.',
  't:avviso al mittente': 'Prepara la mail che avvisa chi ha mandato il documento che è stato protocollato, con numero e data.',
  't:segna come inviato oggi': 'Segna che la mail è partita oggi, senza preparare niente: per quando l\'hai già mandata da Outlook.',
  't:l’ho inviata': 'Conferma che la bozza preparata è stata spedita: il protocollo passa a «inviato».',
  't:inoltra': 'Prepara la mail per inoltrare il documento a un altro destinatario (un tecnico, un ente), con il protocollo in oggetto.',
  't:duplica come nuovo': 'Apre un protocollo nuovo già compilato con i dati di questo: comodo per le lettere in serie.',
  't:annulla protocollo': 'Annulla la registrazione: il numero resta bruciato e la riga resta visibile come annullata. Non si cancella niente.',
  't:collega un documento già su drive': 'Aggancia al protocollo un file che sta già nella cartella giusta su Drive, senza copiarlo.',
  't:carica un documento nuovo': 'Carica il file dal computer nella cartella scelta su Drive e lo aggancia al protocollo.',
  't:scheda impresa': 'Apre la scheda dell\'impresa collegata a questo protocollo.',
  't:correggi il testo': 'Corregge oggetto o note del protocollo. Il numero e la data non si toccano.',

  /* ── imprese e persone ── */
  'imp-nuova': 'Crea un\'impresa nuova. Prima cerca per partita IVA: se esiste, l\'app ti porta sulla scheda invece di fare un doppione.',
  'imp-nuova2': 'Crea un\'impresa nuova. Prima cerca per partita IVA.',
  'ni-crea': 'Crea la scheda e la apre. CAP, provincia e forma giuridica li completa l\'app da sola.',
  'ia-salva': 'Salva le modifiche all\'anagrafica dell\'impresa.',
  'ia-cambia-chiave': 'Cambia il codice fiscale che identifica l\'impresa: da fare solo se è sbagliato, perché tutto il resto ci si aggancia.',
  't:ufficiocamerale.it': 'Apre il sito con cui si verificano i dati camerali e l\'ATECO dell\'impresa.',
  'pe-nuova': 'Crea una persona nuova. Cerca prima per cognome: una persona sola anche se lavora per più imprese.',
  'pe-nuova2': 'Crea una persona nuova. Cerca prima per cognome.',
  'pe-nomina': 'Registra una nomina per questa persona (RSPP, RLS, addetto…), con la data di inizio.',
  'nm-nuova': 'Registra una nomina nuova.',
  'nm-elenco': 'Stampa l\'elenco delle nomine in PDF.',
  'nm-presenze': 'Stampa il foglio presenze per la riunione del ruolo scelto.',
  'fn-chiudi': 'Chiude la nomina a oggi: resta nello storico, non compare più fra quelle in corso.',
  'fn-salva': 'Registra la nomina. Se il ruolo è Dipendente, Titolare, Socio, Apprendista o Tirocinante registra invece il rapporto; per preposto, capocantiere, RLS e le altre funzioni interne apre anche il rapporto, se manca.',
  'imp-agg-persona': 'Aggiunge una persona a questa impresa: la scegli dall\'anagrafica o la crei, con il rapporto e le sue funzioni in un colpo solo.',
  'imp-nuova-nomina': 'Registra una nomina per questa impresa, anche di una figura esterna (medico, RSPP di uno studio, coordinatore).',
  'ap-salva': 'Registra persona, rapporto e nomine. Non crea doppioni: stesso codice fiscale = stessa persona, rapporto o nomina già in corso = non se ne apre un altro.',
  'rp-salva': 'Salva tipo, qualifica, mansione e data di assunzione del rapporto.',
  'rp-cessa': 'Chiude il rapporto alla data scritta: resta nello storico. Con la spunta chiude alla stessa data anche le nomine della persona per questa impresa.',

  /* ── servizi alle imprese (segnalazioni, consulenze, visite, conferenze, attestazioni) ── */
  'p:crea la pratica': 'Apre la pratica con i dati inseriti: da qui il giro è sempre lo stesso, richiesta di autorizzazione al Direttore, esito, esecuzione.',
  'p:richiesta di autorizzazione (pdf': 'Prepara la richiesta di autorizzazione al Direttore in PDF e la bozza mail. Nessuna uscita in cantiere parte senza la sua firma.',
  'p:approva (direttore)': 'Registra l\'approvazione del Direttore: la pratica passa a «autorizzata» e si può assegnare al tecnico.',
  't:chiudi cantiere': 'Chiude il cantiere proposto dal tecnico: si chiudono anche le sue visite ed esce dalle scadenze e dai cantieri attivi. La proposta risulta accolta.',
  't:respingi proposta': 'Il cantiere resta aperto. Chiede il motivo, che resta scritto accanto alla proposta per il tecnico che l\'ha fatta.',
  't:respingi': 'Registra il diniego del Direttore, con il motivo. La pratica si chiude e resta nello storico.',
  'p:registra l\'esito del giro cartaceo': 'Per quando il Direttore ha firmato su carta: registri l\'esito con la data, senza rifare il giro nell\'app.',
  'p:protocolla la richiesta (in)': 'Prende il numero in entrata per la richiesta arrivata e la collega alla pratica.',
  'p:protocolla la segnalazione (in)': 'Prende il numero in entrata per la segnalazione e la collega alla pratica.',
  'p:protocolla la notifica (in)': 'Prende il numero in entrata per la notifica preliminare.',
  'p:protocolla la comunicazione (in)': 'Prende il numero in entrata per la comunicazione di nomina.',
  'p:mail di conferma all\'impresa': 'Prepara la bozza mail che conferma all\'impresa che la richiesta è stata presa in carico.',
  'vs-incarico': 'Crea l\'incarico al tecnico nel gestionale visite: lui lo trova nei suoi incarichi e, se ha le notifiche, riceve l\'avviso.',
  'cn-conferma': 'Prepara la bozza di conferma all\'impresa (tecnico incaricato, data se c\'è) e segna nella pratica che la conferma è partita. L\'invio lo fai tu da Outlook.',
  'cn-lettera': 'Crea l\'incarico al tecnico nel gestionale (se manca) e prepara la bozza della lettera di incarico, con l\'autorizzazione del Direttore allegata. L\'invio lo fai tu da Outlook.',
  'vs-lettera': 'Crea l\'incarico al tecnico nel gestionale (se manca) e prepara la bozza della lettera di incarico, con l\'autorizzazione del Direttore allegata. L\'invio lo fai tu da Outlook.',
  'cf-lettera': 'Crea l\'incarico al tecnico nel gestionale (se manca) e prepara la bozza della lettera di incarico, con l\'autorizzazione del Direttore allegata. L\'invio lo fai tu da Outlook.',
  'sg-lettera': 'Crea l\'incarico al tecnico nel gestionale (se manca) e prepara la bozza della lettera di incarico, con l\'autorizzazione del Direttore allegata. L\'invio lo fai tu da Outlook.',
  'p:🎓 formazione mancante segnalata': 'Le segnalazioni partite da sole all\'ufficio corsi dai verbali con «contattare l\'ufficio corsi». Dalla tendina registri com\'è andata (contattata, iscritta, non interessata).',
  'cn-gira': 'Prepara la mail con il quesito per chi hai scelto nella tendina (di norma il coordinatore; un altro tecnico se lui lo chiede). La pratica passa «girata» a quella persona e la data riparte.',
  'cn-gira-a': 'A chi girare il quesito: coordinatore, tecnici in servizio, rubrica interna o un altro indirizzo.',
  'cn-trasmetti': 'Prepara la mail con la risposta del coordinatore all\'impresa.',
  'cn-uscita': 'La consulenza richiede un sopralluogo: apre la richiesta di autorizzazione al Direttore, come per una visita.',
  'cn-protout': 'Prende il numero in uscita per la risposta e prepara la bozza mail.',
  'at-rilascia': 'Rilascia l\'attestazione: prende il numero in uscita, genera il PDF e prepara la mail all\'impresa. Dopo non si modifica.',
  'p:scarica di nuovo la bozza': 'Riprepara la bozza mail già generata, se l\'hai persa o chiusa senza mandarla.',
  'p:protocolla e prepara': 'Prende il numero in uscita per la lettera, la genera in PDF e prepara la bozza mail. Il numero non si restituisce.',
  'p:esito: scarica di nuovo': 'Riprepara la bozza mail dell\'esito.',
  'p:presa in carico: scarica': 'Riprepara la bozza mail della presa in carico.',
  'p:storico access': 'Le pratiche registrate nel vecchio database Access, solo in lettura.',
  'cf-corso': 'Apre il corso collegato alla conferenza: giornate, docenti, iscritti, presenze e attestati.',
  'nt-grazie': 'Prepara la mail di ringraziamento a chi ha mandato la notifica.',
  'nt-riscontro': 'Prende il numero in uscita e prepara la lettera di riscontro completa.',
  'nt-anteprima': 'Mostra la lettera in PDF senza prendere nessun numero.',
  'nt-riepilogo': 'Genera il riepilogo della notifica in PDF.',
  'rc-riscontro': 'Prende il numero in uscita e prepara il riscontro alla comunicazione di nomina.',
  'rl-risposta': 'Prende il numero in uscita e prepara la risposta all\'impresa sull\'affidamento RLST.',
  'st-manuale': 'Registra un elenco di abbinamenti scrivendolo a mano, quando la Scuola non manda il file Excel.',

  /* ── cantieri critici ── */
  'cc-nuovo': 'Apre un caso di cantiere critico: accesso negato o situazione da segnalare agli organi di vigilanza.',
  'cc-incarico': 'Prendi in gestione il caso: da qui in poi le decisioni e le lettere partono da te.',
  'cc-d-visita': 'Decide un\'ulteriore visita: nasce l\'incarico al tecnico.',
  'cc-d-conf': 'Propone all\'impresa una conferenza di cantiere invece della segnalazione.',
  'cc-d-demanda': 'Passa il caso a Presidenza o Commissione: la decisione non è più della segreteria.',
  'cc-d-organo': 'Registra la decisione o la conferma arrivata dall\'organo a cui il caso era stato demandato.',
  'cc-d-dir': 'Chiede al Direttore di confermare la segnalazione agli organi di vigilanza prima che parta.',
  'cc-d-segnala': 'Prepara la segnalazione a SPISAL o Ispettorato: si protocolla e la mail la mandi tu.',
  'cc-risolta': 'Chiude il caso come risolto con questo verbale.',
  'cm-vai': 'Prende il numero in uscita e prepara le bozze delle lettere.',
  'cm-anteprima': 'Mostra la lettera in PDF senza prendere nessun numero.',
  'cd-si': 'Registra che il Direttore conferma la segnalazione: può partire.',
  'cd-no': 'Registra che il Direttore non conferma: la segnalazione non parte e il motivo resta scritto.',

  /* ── corsi e formazione ── */
  'co-nuovo': 'Crea un corso nuovo: poi giornate, docenti, iscritti e presenze.',
  'co-addg': 'Aggiunge una giornata al calendario del corso.',
  'co-addint': 'Aggiunge un intervento con il suo docente.',
  'co-geninc': 'Propone gli incarichi di docenza a partire dai docenti messi nel programma.',
  'co-addiscr': 'Iscrive una persona che è già in anagrafica.',
  'co-calcola': 'Calcola le frequenze di ogni iscritto dalle presenze registrate: serve per sapere chi ha diritto all\'attestato.',
  'co-registro': 'Stampa il registro presenze in PDF, da far firmare in aula.',
  'p:genera attestati': 'Genera gli attestati del corso, uno per iscritto con la frequenza sufficiente, con la numerazione in serie. I dati mancanti bloccano l\'attestato di quella persona.',
  'co-copia-dati': 'Copia nel corso i dati anagrafici degli iscritti già presenti.',
  'co-chiedi-dati': 'Prepara la mail per chiedere all\'impresa i dati anagrafici mancanti per gli attestati.',
  'pr-salva': 'Salva le presenze della giornata.',
  'iz-apri': 'Apre le iscrizioni all\'evento: nasce il modulo pubblico sul portale.',
  'iz-manda': 'Prepara la mail al referente con il modulo di iscrizione da far girare.',
  'iz-copia': 'Copia negli appunti il link del modulo di iscrizione.',
  'iz-ripubblica': 'Rimanda al portale i dati aggiornati dell\'evento.',
  'iz-mano': 'Registra un\'iscrizione arrivata per mail o a voce, come se venisse dal modulo.',
  'iz-chiudi': 'Chiude le iscrizioni: il modulo sul portale non accetta più risposte.',
  'iz-conferma': 'Conferma le iscrizioni selezionate e prepara le mail di conferma.',
  'qz-apri': 'Apre il questionario di gradimento dell\'evento, con il QR da proiettare o stampare.',
  'qz-foglio': 'Stampa il foglio con il QR del questionario.',
  'qz-cartaceo': 'Stampa il questionario da compilare a mano.',
  'qz-carta': 'Registra le risposte di un questionario compilato su carta.',
  'tz-apri': 'Apre il test di verifica finale: ogni iscritto ha il suo codice personale.',
  'tz-codici': 'Mostra i codici personali da consegnare agli iscritti.',
  'td-invita': 'Chiede a un docente di preparare le domande del test del suo modulo.',
  'tc-salva': 'Convalida il test: il risultato entra nella scheda dell\'iscritto.',
  'pg-nuovo': 'Crea un progetto finanziato a cui collegare corsi e spese.',
  'rd-pdf': 'Genera la rendicontazione del progetto in PDF.',

  /* ── incarichi, fatture, mandati, presenze ── */
  'p:chiudi il mese': 'Chiude il mese del tecnico: calcola le prestazioni fatte dai verbali e prepara il riepilogo per la fattura. Dopo la chiusura le prestazioni non cambiano.',
  'di-fatt': 'Registra la fattura arrivata per questo mese e la aggancia alle prestazioni.',
  'fi-pdf': 'Mostra la lettera di incarico del mese in PDF, senza protocollare.',
  'p:prepara integrazione': 'La lettera è già protocollata: prepara l\'integrazione con le visite aggiunte dopo.',
  'cm-chiudi-arr': 'Chiude le prestazioni arretrate senza spunta: non verranno più fatturate.',
  'cm-congela': 'Congela le prestazioni del mese, protocolla il riepilogo e prepara la mail al tecnico: da qui il mese non si tocca più.',
  'ff-nuova': 'Registra una fattura ricevuta da un tecnico.',
  'ff-annulla': 'Annulla la fattura: resta visibile come annullata, le prestazioni tornano da fatturare.',
  'df-prot': 'Apre il protocollo in entrata già compilato con i dati della fattura.',
  'df-aggancia': 'Aggancia alla fattura le prestazioni ancora aperte del tecnico.',
  'df-verif': 'Segna la fattura come verificata dalla segreteria: importi e prestazioni tornano.',
  'df-appr': 'Approva la fattura come coordinatore: va all\'Amministrazione per il mandato.',
  'df-standby': 'Mette la fattura in stand-by: il mandato non si genera finché non si risolve l\'anomalia sui verbali. Il motivo resta scritto.',
  'p:avvisa': 'Manda al coordinatore l\'avviso che c\'è una fattura da approvare: è una delle due mail che l\'app spedisce da sola.',
  'df-pagata': 'Segna la fattura come pagata, con la data. Al tecnico parte l\'avviso automatico di avvenuto pagamento.',
  'md-nuovo': 'Crea un mandato di pagamento con le fatture approvate non ancora pagate.',
  'mp-pdf': 'Genera il mandato in PDF, da firmare.',
  'mp-visto': 'L\'Amministrazione firma il mandato dall\'app: la firma resta registrata con data e ora.',
  'mp-carta': 'Registra che il visto è arrivato firmato su carta.',
  'mp-rigenera': 'Rigenera il PDF del mandato con il visto stampato sopra.',
  'p:pagato tutto il mandato': 'Segna pagate tutte le fatture del mandato: ai tecnici parte l\'avviso automatico.',
  'mp-paga-sel': 'Segna pagate solo le fatture spuntate.',
  'p:invia l\'avviso ai tecnici': 'Manda l\'avviso di pagamento ai tecnici che non l\'hanno ancora ricevuto.',
  'pr-nuova': 'Aggiunge una prestazione a mano, non nata da un verbale.',
  'pp-riapri': 'Riporta la prestazione fra quelle da fatturare.',
  'pp-chiudi': 'Segna che la prestazione non si fattura più.',
  'pz-nuovo': 'Registra una giornata di presenza del personale.',
  'pz-pdf': 'Genera il foglio presenze del mese in PDF.',
  'pz-chiudi': 'Chiude il mese: genera il foglio e prepara la mail all\'Amministrazione.',
  'fe-nuova': 'Apre una richiesta di ferie o permesso.',
  'fe-genera': 'Genera le righe dei giorni richiesti, una per giorno.',
  'fe-pdf': 'Scarica il modulo della richiesta in PDF.',
  'fe-manda': 'Prepara modulo e mail per il Direttore, dall\'app.',
  'fe-approva': 'Registra l\'approvazione del Direttore.',

  /* ── documenti tecnici, comunicazione ── */
  'dt-avviso': 'Prepara la bozza mail al tecnico per il documento in scadenza.',
  'dt-protocolla': 'Apre un protocollo in uscita già compilato con i dati del documento.',
  'cm-nuovo': 'Apre un post nuovo in bozza.',
  'cm-linee': 'Le indicazioni per la prossima redazione automatica del lunedì.',
  'cm-materia': 'I numeri con cui la redazione lavora: visite, corsi, eventi del periodo.',
  'pd-approva': 'Approva il post: da qui si può pubblicare.',
  'pd-bozza': 'Riporta il post a bozza.',
  'pd-scarta': 'Scarta il post scrivendo il motivo: la redazione impara da qui.',
  'pd-prova': 'Manda il post al canale Telegram di prova, per vederlo com\'è.',
  'pd-tg': 'Pubblica il post sul canale Telegram dell\'Area. Dopo, non si ritira dall\'app.',
  'pd-notizia': 'Pubblica il post come notizia nell\'app servizi: chi ha attivato gli avvisi riceve la notifica.',
  'pd-kit': 'Prepara la mail per l\'agenzia con testo e immagini del post.',
  'hm-respinte-cerca': 'Rilegge adesso i rapporti di mancata consegna delle mail dei verbali.',

  /* ── cruscotto: titoli delle tessere e pastiglie «A posto» (26/09/2026).
     Le spiegazioni che prima stavano scritte in fondo alle tessere. La
     chiave è hm-<k>, dove k è l'opzione passata a card() in home.js ── */
  'hm-aposto': 'Aree senza niente in sospeso. Clic su una pastiglia per aprire la sua pagina. Il cruscotto conta le righe delle tabelle, non tiene una lista sua: le pratiche chiuse e scartate non compaiono.',
  'hm-non-letto': 'Non sono riuscito a leggere questi dati: il numero non si conosce, non vuol dire che non ci sia niente. Ricarica la pagina; se resta così, avvisa chi segue l\'app.',
  'hm-giorni': 'Giorni passati da quando la richiesta è arrivata. Oltre 60 la cifra diventa rossa.',
  'hm-direttore': 'Pratiche dei servizi CPT che aspettano l\'autorizzazione del Direttore. Finché non c\'è, non si lavorano.',
  'hm-rifiutati': 'Il tecnico ha dichiarato di non essere disponibile. «Riassegna» passa l\'incarico a un altro tecnico, per il quale torna «da vedere».',
  'hm-proposte': 'Il tecnico dice che il cantiere è finito. Chiudendolo si chiudono anche le sue visite ed esce dalle scadenze; respingendo, il motivo resta scritto per chi l\'ha proposto.',
  'hm-formazione': 'Partono da sole quando il tecnico manda un verbale con «contattare l\'ufficio corsi». L\'ufficio corsi (corsi@formedilpadova.it) chiama l\'impresa; l\'esito lo registri tu dalla tendina.',
  'hm-critici': 'Accessi negati segnalati dal tecnico e proposte di segnalazione a SPISAL / ITL dai verbali. Clic sulla pastiglia: tutti i casi, anche chiusi, e nuovo caso.',
  'hm-questionari': 'Questionari arrivati dopo il sopralluogo, da leggere: prima i voti bassi e chi chiede di essere richiamato.',
  'hm-iscrizioni': 'Iscrizioni arrivate dal portale e non ancora confermate. Finché restano in coda occupano il posto nel conteggio dei liberi.',
  'hm-eseguire': 'Pratiche autorizzate e non ancora svolte. Sotto ogni riga, il passo del tecnico; a destra, da quanti giorni è arrivata la richiesta.',
  'hm-consulenze': 'Le consulenze della corsia immediata: quesito girato al coordinatore, risposta, trasmissione all\'impresa.',
  'hm-segnalazioni': 'Le segnalazioni di cantiere aperte, dall\'arrivo alla chiusura.',
  'hm-eseguite': 'Visite eseguite nel gestionale, in attesa della chiusura della segreteria: da qui si decide se e a chi comunicare l\'esito.',
  'hm-canale': 'Il portale servizi funziona: il battito lo scrive ogni notte un controllo automatico, e serve a distinguere «nessuno ha inviato» da «il canale è rotto». Se qualcosa non va, compare una tessera rossa.',
  'hm-rlst': 'Le richieste di affidamento al servizio RLST non ancora chiuse.',
  'hm-documenti': 'Per ogni tecnico e ogni requisito conta il documento più recente, con la stessa regola della pagina Documenti tecnici (rinnovo tacito compreso). «Mai registrati» sono i requisiti per cui la pagina non ha nessun documento.',
  'hm-corsi': 'Corsi non ancora chiusi né annullati.',
  'hm-fatture': 'Mesi passati ancora aperti, fatture da verificare o approvare, approvate da mettere in mandato, stand-by e avvisi automatici non partiti.',
  'hm-flussi': 'Flussi mai usati su un caso vero: vanno provati prima che servano, con un caso di prova da annullare subito dopo. Lo storico importato e gli annullati non contano.',
  'hm-agenda': 'Gli eventi dei calendari dell\'ufficio nei prossimi giorni, letti dall\'app dal lunedì al giovedì alle 8.',
  'hm-posta': 'Le mail che le regole hanno segnato come importanti. Si aprono in Gmail; l\'app non risponde e non archivia. Il numero a destra è il punteggio delle regole.',
  'hm-respinte': 'Il rapporto di mancata consegna torna alla casella dell\'ufficio. Quelli definitivi (5.x.x) fanno partire da soli l\'avviso al tecnico; i rinvii (4.x.x) si registrano e basta. L\'indirizzo lo corregge il tecnico.',
  't:aggiorna adesso': 'Rilegge adesso posta e calendario invece di aspettare il giro automatico.',
  'ant-ok': 'Applica il timbro nel punto scelto e salva il PDF timbrato su Drive.',
  'ant-auto': 'Cerca da solo uno spazio bianco sulla pagina dove mettere il timbro.',
  'm-invia': 'Apre in Outlook la bozza pronta, con allegati e firma: l\'invio lo fai tu.',
};

(function () {
  const T = window.AIUTO_TESTI || {};
  const SEL = 'button, a[href], [data-aiuto], [data-view], summary, label[for]';
  const RITARDO = 500;
  let bolla = null, timer = null, corrente = null, titoloTolto = null;

  const norm = (s) => String(s || '')
    .replace(/&[#\w]+;/g, ' ')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{25B6}\u{25C0}\u{23F8}\u{2705}\u{274C}\u{2716}\u{2714}\u{00D7}]/gu, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();

  function testoPer(el) {
    if (!el) return null;
    if (el.dataset && el.dataset.aiuto) return el.dataset.aiuto;
    if (el.id && T[el.id]) return T[el.id];
    const t = norm(el.textContent);
    if (t && T['t:' + t]) return T['t:' + t];
    if (t) for (const k in T) if (k.startsWith('p:') && t.startsWith(k.slice(2))) return T[k];
    if (el.dataset && el.dataset.view && T['v:' + el.dataset.view]) return T['v:' + el.dataset.view];
    if (el.title) return el.title;
    return null;
  }

  function creaBolla() {
    if (bolla) return bolla;
    bolla = document.createElement('div');
    bolla.id = 'aiuto-bolla';
    bolla.setAttribute('role', 'tooltip');
    bolla.style.cssText = 'position:fixed;z-index:2147483000;max-width:320px;background:#565c66;color:#fff;border-left:3px solid #e7500f;padding:8px 11px;border-radius:7px;font:12.5px/1.45 system-ui,Segoe UI,Arial,sans-serif;box-shadow:0 6px 18px rgba(0,0,0,.25);pointer-events:none;opacity:0;transition:opacity .12s;white-space:normal;text-align:left';
    document.body.appendChild(bolla);
    return bolla;
  }

  function mostra(el, testo) {
    const b = creaBolla();
    b.textContent = testo;
    if (el.title) { titoloTolto = { el, title: el.title }; el.removeAttribute('title'); }
    const r = el.getBoundingClientRect();
    b.style.left = '0px'; b.style.top = '0px'; b.style.opacity = '0';
    const w = b.offsetWidth, h = b.offsetHeight;
    let x = r.left + r.width / 2 - w / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    let y = r.bottom + 8;
    if (y + h > window.innerHeight - 8) y = r.top - h - 8;
    if (y < 8) y = 8;
    b.style.left = x + 'px'; b.style.top = y + 'px'; b.style.opacity = '1';
    corrente = el;
  }

  function nascondi() {
    clearTimeout(timer); timer = null;
    if (bolla) bolla.style.opacity = '0';
    if (titoloTolto) { titoloTolto.el.setAttribute('title', titoloTolto.title); titoloTolto = null; }
    corrente = null;
  }

  function candidato(target) {
    const el = target && target.closest ? target.closest(SEL) : null;
    if (!el || el.disabled) return null;
    return el;
  }

  document.addEventListener('mouseover', (e) => {
    const el = candidato(e.target);
    if (!el || el === corrente) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const testo = testoPer(el);
      if (testo && el.matches(':hover')) mostra(el, testo);
    }, RITARDO);
  });
  document.addEventListener('mouseout', (e) => {
    const el = candidato(e.target);
    if (!el) return;
    const verso = e.relatedTarget;
    if (verso && el.contains(verso)) return;
    nascondi();
  });
  ['mousedown', 'keydown', 'wheel', 'scroll'].forEach((ev) => document.addEventListener(ev, nascondi, { passive: true, capture: true }));

  let tocco = null;
  document.addEventListener('touchstart', (e) => {
    nascondi();
    const el = candidato(e.target);
    if (!el) return;
    tocco = setTimeout(() => { const testo = testoPer(el); if (testo) mostra(el, testo); }, 550);
  }, { passive: true });
  ['touchend', 'touchmove', 'touchcancel'].forEach((ev) => document.addEventListener(ev, () => { clearTimeout(tocco); tocco = null; }, { passive: true }));

  window.aiutoSpiega = testoPer;
})();
