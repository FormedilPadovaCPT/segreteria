# App Segreteria — Formedil Padova

Webapp dell'ufficio di segreteria dell'Area Sicurezza e Salute. Sostituisce le
maschere Access, a partire dal **registro di protocollo** (entrata e uscita).

Gira su GitHub Pages come sito statico e lavora sullo **stesso database Supabase**
del gestionale visite e della webapp asseverazione, sulle tabelle `s_*`.

- Progetto Supabase: `utdantrfugnmqsuujxbe` (Gestionale)
- Pubblicazione: GitHub Pages via Actions (`.github/workflows/deploy-pages.yml`)

## Cosa c'è dentro

| File | A cosa serve |
|---|---|
| `index.html` | Struttura della pagina: accesso, barra, menu, viste, drawer |
| `css/app.css` | Aspetto, palette istituzionale, layout mobile |
| `js/app.js` | Client Supabase, accesso con magic link, controllo ruolo, navigazione |
| `js/config.js` | Chiavi Supabase e dati dell'ente |
| `js/drive.js` | I documenti su Google Drive: carica, rilegge, cestina |
| `js/lookups.js` | Tendine: uffici, mezzi, tipi che non vogliono il timbro |
| `js/cartelle-vault.js` | Le cartelle vere del vault, per la tendina di destinazione |
| `js/protocollo.js` | Registro, ricerca, dettaglio, inserimento e modifica |
| `js/timbro-disegno.js` | Disegno del timbro: geometria e testo, senza dipendenze |
| `js/anteprima-timbro.js` | Anteprima: vedi il foglio e trascini il timbro dove è bianco |
| `js/spazio.js` | Ricerca dello spazio bianco sui pixel, condivisa con gli strumenti |
| `js/timbro.js` | Lato browser del timbro: librerie, storage, scelta impaginazione |
| `js/comune.js` | Funzioni pure condivise: codice del protocollo, date, escape |
| `js/mail.js` | Avviso di protocollazione |
| `js/imprese.js` | Ricerca e scheda impresa con le sue sottoschede |
| `js/statistiche.js` | Numeri e distribuzioni del registro |
| `js/fatture-tecnici.js` | Incarichi mensili ai tecnici, chiusura del mese, fatture, mandati, prestazioni (la fattura che ha pagato ogni visita) |
| `js/fatture-tecnici-doc.js` | I tre PDF: lettera di incarico, riepilogo attività da fatturare, mandato di pagamento |
| `supabase/sql/2026_09_04_fatture_tecnici.sql` | Tabelle `s_tariffe`, `s_tecnici_fiscale`, `s_incarichi_mensili`, `s_fatture_tecnici`, `s_prestazioni`, `s_mandati_pagamento`, `s_visite_stage` e funzioni `s_prestazioni_calcola`, `s_fattura_decisione` |

| `strumenti/timbra.mjs` | Timbra un PDF da riga di comando, con lo stesso timbro |

Nessun passaggio di compilazione: sono moduli ES caricati dal browser.
Per provare in locale serve un server (i moduli non partono da `file://`):

```powershell
cd "C:\Google Drive Gsuite\9_APPLICATIVI\Gestionale_Visite_APP\segreteria-app"
python -m http.server 8080
# poi apri http://localhost:8080
```

## Timbrare da riga di comando

`strumenti/timbra.mjs` applica **lo stesso identico timbro della webapp** a un
PDF che sta su disco. Serve a due cose: timbrare in automatico un documento
appena protocollato, e **ritimbrare oggi un documento vecchio con il numero e
la data di allora** — l'unica forma di ristampa che l'ufficio ha chiesto.

I dati del protocollo si passano da fuori, non li legge dal database: così lo
strumento fa una cosa sola, non ha bisogno di credenziali e si può provare
senza rete.

```powershell
cd "C:\Google Drive Gsuite\9_APPLICATIVI\Gestionale_Visite_APP\segreteria-app"
npm --prefix strumenti install          # una volta sola
node strumenti/timbra.mjs --pdf "C:\...\documento.pdf" --json protocollo.json
```

Opzioni: `--stile blocco|minimo|striscia`, `--dove auto|<angolo>|<x,y>`,
`--out <file>`, `--sovrascrivi`, `--forza`. Senza argomenti stampa le istruzioni.

### Dopo aver toccato il disegno del timbro

```powershell
node strumenti/verifica-timbro.mjs
```

Disegna il timbro su un foglio bianco, rende la pagina e **misura il rettangolo
dell'inchiostro**: se un solo segno esce dalla cornice dichiarata, fallisce.
Non guarda il testo ma i pixel, quindi vede anche le linee.

Esiste perché il 28/08/2026 l'ultima riga del blocco è finita fuori dal
riquadro, sopra il testo del documento — 25 punti di spazio per tre righe che
ne chiedono 37. Su un timbro alto 68 punti, a occhio, non si vede.

**L'originale non viene mai toccato**: il file timbrato si affianca, con il
codice del protocollo in coda al nome.

Si rifiuta di procedere, invece di fare un danno silenzioso, quando: mancano
`numero`, `direzione` o `data_prot` (il timbro direbbe una cosa falsa); il tipo
documento è un `Attestato` (che esce già completo — serve `--forza`); il file di
destinazione esiste già.

> Il disegno del timbro **non è duplicato**: `js/timbro-disegno.js` è lo stesso
> file che usa il browser, e riceve pdf-lib e il generatore di QR dall'esterno —
> dal CDN nella webapp, da npm qui. Due copie sarebbero diventate due timbri
> diversi al primo ritocco.

## Chi può entrare

L'accesso è per invito: l'indirizzo deve stare in `app_ruoli` con
`ruolo = 'segreteria'` e `stato = 'attivo'`. Tutte le tabelle `s_*` sono protette
da RLS che chiama `is_segreteria()`: i tecnici del gestionale visite **non**
vedono il protocollo, e chi sta in segreteria non acquisisce per questo altri
permessi.

Per abilitare una persona:

```sql
insert into app_ruoli (email, ruolo, stato, nome)
values ('nome.cognome@did.formedilpadova.it', 'segreteria', 'attivo', 'Nome Cognome');
```

## Come funziona il protocollo

Il registro attraversa due epoche, e l'app le tiene distinte senza riscrivere
niente di quello che c'era.

| Fino al **30/09/2026** | Dal **01/10/2026** |
|---|---|
| due contatori, uno per entrata e uno per uscita | **un contatore solo**: entrata e uscita si dividono i numeri |
| proseguono quelli di Access (entrata 2010, uscita 2554) | riparte da 1 a ogni **1° ottobre** |
| si scrive `2554-out` | si scrive **`Prot_26-27_0001`** |

`AA-AA` è l'**esercizio dell'ente**, che va dal 1° ottobre al 30 settembre. Si
scrivono tutti e due gli anni apposta: `2026/0001` non direbbe se è l'esercizio
2026-27 o l'anno solare 2026, ed è lo stesso equivoco che il vault si porta
dietro con `ES_aaaa` dei bilanci.

- Il numero **non si sceglie**: lo assegna il database con la funzione
  `s_crea_protocollo`, che prende un lock sulla serie. Due postazioni che
  protocollano nello stesso momento non possono ottenere lo stesso numero.
- **Quale serie usare lo decide la data del protocollo**, confrontata con
  `s_config.protocollo_serie_unica_dal`. L'app non sceglie mai: chiede
  l'anteprima e la richiede daccapo se cambi la data, perché il 30 settembre e
  il 1° ottobre danno due numeri di due serie diverse.
- Le righe storiche si riconoscono perché hanno `esercizio` vuoto. La colonna
  `codice`, calcolata dal database, dà la forma giusta per l'epoca giusta:
  `2554-out` oppure `Prot_26-27_0001`.
- **Le serie parallele si chiudono qui.** DNL, RLST, RS, richieste visite e
  attestati prendevano il numero dall'`id` della propria tabella: dal passaggio
  prendono quello del registro unico.
- Un protocollo non si cancella: si **annulla** con motivazione, e resta nel
  registro barrato.
- Ogni inserimento, modifica e annullamento finisce in `s_protocollo_audit`.
- ⚠️ **Il protocollo non è un contenitore: è una mappa.** I documenti
  protocollati non restano in una cartella del protocollo — vengono **smistati
  dove devono stare**, come tutto il resto del second brain: il preventivo
  firmato nell'asseverazione di quell'impresa, la circolare in `3_RISORSE`, gli
  allegati ciascuno a casa propria. Il protocollo serve a sapere **dove sono
  andati a finire**.
- Perciò **il link è sempre al singolo file, mai a una cartella**, e nel
  dettaglio del protocollo ogni documento mostra **in che cartella si trova
  adesso**. Funziona perché spostando un file dentro Drive **l'id non cambia**:
  lo smistamento non rompe nessun link.
- ⚠️ **Il file timbrato nasce nella stessa cartella dell'originale.** Se si
  timbra un documento già archiviato — una circolare del 2013, una scansione
  già collocata — il timbrato gli si affianca lì, e **non si sposta niente**: il
  documento sta dove le regole di smistamento hanno deciso, e il timbro non è
  una ragione per spostarlo.
- ⚠️ **Due modi di allegare, e la differenza conta.** *«Collega un documento già
  su Drive»* registra un documento che sta già nel vault: **resta dov'è** e il
  protocollo prende nota. Si sfogliano le cartelle del vault dall'app — o si
  cerca per nome — senza dover aprire Drive in un'altra scheda per copiare un
  link a mano; chi il link ce l'ha già usa il pulsante «Ho il link». *«Carica un documento nuovo»*
  serve solo per ciò che non è ancora stato processato, e finisce nella zona
  d'attesa. Senza il primo, l'unico modo di allegare era ricaricare dal PC — e
  la copia caricata finiva in `00_INBOX/_protocollo` insieme al suo timbrato,
  che è esattamente il difetto segnalato dall'utente.
- ⚠️ **Un documento nuovo si processa prima di protocollarlo**: si guarda che
  cos'è, lo si colloca dove prevedono le regole, *poi* lo si protocolla e
  timbra, così nasce già a casa propria. La cartella **`00_INBOX/_protocollo`**
  è solo per ciò che non è ancora stato processato — zona d'attesa da svuotare,
  non destinazione. Il codice del protocollo entra nel **nome** del file, così
  resta riconoscibile ovunque venga smistato.
- ⚠️ **Dopo il timbro si sceglie che fare dell'originale**, ogni volta, dal
  menu in fondo all'anteprima: di una **circolare** si tiene la sola copia
  protocollata, di un **contratto firmato o di una scansione unica** si conserva
  l'originale. Il valore predefinito è *conservo*: per buttare bisogna dirlo. E
  «cestina» significa **cestino di Drive**, da cui si recupera.
- Nel database resta l'**indice**: `s_prot_allegati` dice quali file
  appartengono al protocollo, quale è l'originale e quale il timbrato, con il
  `drive_file_id` di ciascuno.
- Tutto passa dalla edge function `allegati-protocollo`, che scrive con il
  service account dell'ente — le credenziali non arrivano mai al browser e i
  file non sono pubblici. È lo stesso meccanismo di `allegati-ass`, che fa la
  stessa cosa per le pratiche di asseverazione.
- **Spostando un file dentro Drive l'id non cambia**: quando il documento verrà
  smistato nella cartella giusta del vault, il link registrato qui continuerà a
  funzionare.
- Eliminare un allegato lo mette **nel cestino di Drive**, non lo cancella.
- Limite pratico di 12 MB per file: il passaggio via edge function tiene tutto
  in memoria. Sopra, si mette il file a mano nella cartella e si incolla il link.

### Ricollegare i documenti già in archivio

Il registro ereditato da Access aveva **4.563 righe e due soli documenti
attaccati**. I documenti però ci sono, nel vault, e quasi sempre portano il
numero di protocollo nel nome: la edge function **`riconcilia-protocollo`** li
rimette insieme, una cartella per volta.

```
{ "percorso": "3_RISORSE/Circolari_FORMEDIL_Italia" }              → prova a vuoto
{ "percorso": "...", "esegui": true, "token": "…", "giorni": 15 }  → scrive
```

- ⚠️ **Il numero da solo non basta, mai.** Sui due registri storici **2.011
  numeri su 2.554 esistono in entrambi**: `_Prot1450` può essere un documento in
  entrata del 2015 o uno in uscita del 2018. Si aggancia solo quando numero *e*
  data del nome file portano a **un candidato solo**.
- ⚠️ **La finestra stretta è meglio di quella larga**, e non per prudenza:
  sull'asseverazione, passando da 60 a 15 giorni, gli agganci sono **saliti** da
  360 a 386 e gli ambigui crollati da 56 a 3. Con la finestra larga entrambi i
  registri cadevano dentro il periodo e il caso veniva scartato per doppio
  candidato. **15 giorni** è il valore predefinito.
- ⚠️ **Chi resta fuori non è un caso dubbio: è il protocollo del mittente.** Nei
  nomi convivono due numerazioni, la nostra e quella di chi scrive
  (`Circ. 448/2025` di FORMEDIL). Agganciarli legherebbe una circolare del 2025 a
  un nostro numero del 2014 — è l'errore che il controllo sulla data esiste per
  evitare.
- **Gli attestati restano fuori**: la loro serie (`3xxx`-`4xxx`) nel database non
  esiste — il registro si ferma a 2554. Non c'è a cosa collegarli.
- **Non tocca nessun file**: scrive solo righe in `s_prot_allegati`. Niente si
  sposta e niente si rinomina.
- **Senza `esegui: true` non scrive nulla** e dice solo cosa farebbe: la prova a
  vuoto si guarda sempre prima. Per scrivere pretende la parola d'ordine di
  `s_config.riconcilia_token`, che si crea prima del lotto e **si cancella
  subito dopo** — la chiave anon dell'app sta in un repository pubblico.

### Timbro

Due impaginazioni, come in Access:

- **blocco** — riquadro in alto a sinistra della prima pagina;
- **striscia** — fascia verticale sul bordo sinistro di tutte le pagine.

### Ristampare il timbro su un protocollo vecchio

Nel dettaglio di **qualunque** protocollo — anche del 2013 — c'è l'azione
**«Timbra un documento»**. Chiede quale documento timbrare fra quelli allegati,
oppure permette di caricarne uno nuovo (la scansione appena fatta), e poi apre
l'anteprima.

**Il timbro porta il numero e la data del protocollo, non quelli di oggi**: è
esattamente ciò che serve quando il documento cartaceo salta fuori dopo, o lo si
digitalizza adesso.

Serve perché l'archivio ereditato da Access ha **4.563 protocolli e zero
allegati**: senza un'azione dichiarata, l'unica strada era allegare un file e poi
accorgersi di un pulsante piccolo in fondo all'elenco.

Un documento già timbrato si può timbrare di nuovo — utile per spostare il
timbro — ma il secondo timbro si aggiunge al primo: meglio ripartire
dall'originale, che nell'elenco resta accanto.

### L'anteprima

Premendo «Timbra» su un allegato PDF si apre l'anteprima: si vede la pagina
vera, il timbro ci sta sopra come un riquadro che si **trascina col mouse o col
dito**, e «Trova il bianco» lo mette da solo dove la pagina è libera. Solo
premendo «Applica» il file viene scritto.

Il timbro che si vede e si trascina **è il timbro vero**: viene disegnato da
pdf-lib su una paginetta grande quanto lui e reso con pdf.js. Non è un riquadro
finto in HTML che gli somiglia — quello divergerebbe dal risultato al primo
ritocco.

Per provare l'anteprima fuori dall'app c'è `_prova_anteprima.html` (non viene
pubblicata: il workflow copia solo `index.html`, `css`, `js`, `img`). Va aperta
in un browser **visibile**: pdf.js disegna il testo con i font caricati, e in
una pagina mai dipinta il testo non compare.

**Sugli attestati il timbro non si mette.** L'attestato di asseverazione esce
già completo di protocollo proprio, validità e firma: la spunta «timbra» si
toglie da sola quando il tipo di documento è `Attestato`, e la maschera dice
perché. Resta cliccabile — la regola sta nel codice per non doversene
ricordare, non per impedire un'eccezione. L'attestato **si protocolla lo
stesso**: è il timbro sul foglio che non ci va.

Il disegno del timbro sta in `js/timbro-disegno.js` e non carica niente:
riceve pdf-lib e il generatore di QR dall'esterno, così lo stesso identico
timbro può girare anche fuori dal browser.

Il QR contiene `Prot_<codice> <data> <oggetto> <nominativo>` ed è disegnato come
vettore, quindi resta nitido in stampa. Il file timbrato si affianca
all'originale, che non viene toccato.

### Avviso di protocollazione

Edge function `send-protocollo`: manda una mail di riepilogo (con l'allegato
scelto) tramite Gmail API con il service account già usato per i verbali.
Richiede il secret `GOOGLE_SERVICE_ACCOUNT_JSON`.

### Le lettere di incarico non stanno qui

C'era una sezione «Lettere di incarico» che generava la lettera da un modulo a
sé. È stata tolta il 28/08/2026 perché **la lettera non vive nel protocollo**:
vive nella tabella della pratica che la genera. Per l'asseverazione è la `t_ASS`,
che tiene i suoi campi — impresa, tecnico asseveratore, compenso, giorni/uomo,
periodo, firmatari — e conserva in `Prot_assInc` il numero del protocollo in
uscita con cui la lettera è stata registrata.

Il verso giusto è quindi l'opposto di quello che avevamo fatto: **la lettera si
genera dalla pratica, e dalla pratica si chiede un numero al registro**. Il
disegno della carta intestata resta nella storia del repository, in
`js/lettere.js` fino al commit `d27b428`, per quando lo si rimetterà al posto
giusto.

## Scheda impresa

Sostituisce la maschera "Imprese" di Access. Si arriva dalla voce di menu
(ricerca per ragione sociale, codice fiscale, partita IVA o codice CEIV) oppure
dal dettaglio di un protocollo agganciato a un'impresa.

Quattro sottoschede: **Anagrafica** (modificabile, con certificazioni),
**Cantieri**, **Persone** (dipendenti e nomine), **Attività** (visite, richieste,
protocolli).

### Come sono legati impresa e cantiere

Nel database non c'è un legame diretto: si ricostruisce da due parti, e la
scheda le tiene distinte con tre colori.

| Colore | Significato | Da dove arriva |
|---|---|---|
| verde | l'impresa è la **prima impresa** del cantiere | `visite_imprese_presenti.is_principale = true` |
| ambra | compare tra le **imprese successive** | `visite_imprese_presenti.is_principale = false` |
| azzurro | risulta **operante secondo CEIV** | `cantiere_imprese_previste` (con il tipo lavoro: Appalto, Subappalto, In proprio…) |

Tutta la scheda si legge con una sola chiamata (`s_scheda_impresa`, ~90 ms).
Le modifiche passano da `s_aggiorna_impresa`, che accetta solo i campi in elenco
e scrive ogni variazione in `s_impresa_audit` (campo, valore prima e dopo, autore,
data). Il codice fiscale non è modificabile: è la chiave con cui l'impresa è
collegata a visite, cantieri e protocolli.

## Da fare

- [ ] Allineare la maschera alle tendine di Access: impresa con codice e comune,
      dipendente con data di nascita e codice impresa, referente e cartelle
      d'archivio da tabella invece che da valori già usati
- [ ] Invio in uscita come il doppio clic della vecchia maschera: mail su carta
      intestata all'impresa (o al dipendente, con l'impresa in copia)
- [ ] Riferimento alla pratica sul protocollo, per ritrovare «la DNL 12/2016»
      ora che le serie parallele si chiudono
- [ ] Numero di protocollo chiesto dalla pratica: la `t_ASS` e le altre tabelle
      devono poter chiedere un numero al registro e conservarlo, meglio se con
      l'id della riga e non col solo numero
- [ ] La catena completa: documento in `00_INBOX` → protocollo → timbro →
      collocazione nel vault secondo le regole → link a Drive scritto in
      `drive_file_id` / `drive_url`. Il timbro da riga di comando è il primo
      pezzo, fatto; manca il resto
- [ ] Mail da protocollare: leggere una mail e i suoi allegati e portarli
      dentro la catena
- [ ] Protocollo in uscita che prepara la bozza di mail su carta intestata,
      come faceva il doppio clic della vecchia maschera Access — che usava
      `.Display`, non `.Send`: la mail la mandava una persona
- [ ] Scheda persona con storico nomine (`s_nomine`, 7.496 righe)
- [ ] Aggancio dei vecchi documenti su Drive (`drive_file_id` / `drive_url`)
- [ ] Rubriche (Enti, Fornitori, Sindacati, Stampa, ANCE)
