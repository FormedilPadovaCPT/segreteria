/* ============================================================================
   NOTIZIA IN EVIDENZA E CONTATORE DEL PORTALE                 (18/09/2026)

   Due cose piccole chieste dall'utente, con una regola sola in comune: quello
   che è temporaneo deve sapere quando morire, e quello che si misura si deve
   poter misurare senza chiedere il permesso a nessuno.

   1. NOTIZIA IN EVIDENZA — `notizie.evidenza_fino_al` (progetto Servizi) e
      `s_post.evidenza_fino_al` (Gestionale, dove la segreteria la decide
      prima di pubblicare). La carta compare in cima alla home dell'app, dopo
      la segnalazione e l'ultima notizia, e **sparisce da sé alla scadenza**:
      nessuno deve ricordarsi di toglierla. È la lezione del backend morto per
      cinque settimane, applicata a un riquadro.

   2. CONTATORE — `portale_visite (giorno, pagina, visite)`: aggregati, non
      visite. ⚠️ Niente indirizzo IP, niente identificatori, niente cronologia
      del singolo, e non solo per correttezza: **il portale non ha un banner
      di consenso**, e un contatore che traccia le persone ne pretenderebbe
      uno. 17 pagine per 365 giorni fanno seimila righe l'anno.
      La scrittura è pubblica (`conta_visita`, che accetta solo nomi di pagina
      plausibili); la LETTURA no — passa da `questionari-ricevi` con la parola
      d'ordine, azione «visite».
      ⚠️ Un contatore pubblico si può gonfiare: è un numero indicativo, non
      una misura da difendere.

   Migrazioni: notizie_evidenza_fino_al_2026_09_18 e portale_visite_2026_09_18
   (Servizi), post_evidenza_fino_al_2026_09_18 (Gestionale).
