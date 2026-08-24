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
| `js/config.js` | Chiavi Supabase, bucket, dati dell'ente |
| `js/lookups.js` | Tendine (uffici, mezzi) e modelli di lettera |
| `js/protocollo.js` | Registro, ricerca, dettaglio, inserimento e modifica |
| `js/timbro.js` | Timbro sul PDF con QR, nelle due impaginazioni |
| `js/mail.js` | Avviso di protocollazione |
| `js/lettere.js` | Lettere di incarico su carta intestata |
| `js/statistiche.js` | Numeri e distribuzioni del registro |

Nessun passaggio di compilazione: sono moduli ES caricati dal browser.
Per provare in locale serve un server (i moduli non partono da `file://`):

```powershell
cd "C:\Google Drive Gsuite\9_APPLICATIVI\Gestionale_Visite_APP\segreteria-app"
python -m http.server 8080
# poi apri http://localhost:8080
```

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

- Registro unico con **numerazione separata IN / OUT**, che prosegue quella di
  Access (entrata da 2010, uscita da 2554).
- Il numero **non si sceglie**: lo assegna il database con la funzione
  `s_crea_protocollo`, che prende un lock sulla direzione. Due postazioni che
  protocollano nello stesso momento non possono ottenere lo stesso numero.
- Un protocollo non si cancella: si **annulla** con motivazione, e resta nel
  registro barrato.
- Ogni inserimento, modifica e annullamento finisce in `s_protocollo_audit`.
- I documenti stanno nel bucket privato `protocollo`, in cartelle
  `anno/direzione/numero/`.

### Timbro

Due impaginazioni, come in Access:

- **blocco** — riquadro in alto a sinistra della prima pagina;
- **striscia** — fascia verticale sul bordo sinistro di tutte le pagine.

Il QR contiene `Prot_<numero> <data> <oggetto> <nominativo>` ed è disegnato come
vettore, quindi resta nitido in stampa. Il file timbrato si affianca
all'originale, che non viene toccato.

### Avviso di protocollazione

Edge function `send-protocollo`: manda una mail di riepilogo (con l'allegato
scelto) tramite Gmail API con il service account già usato per i verbali.
Richiede il secret `GOOGLE_SERVICE_ACCOUNT_JSON`.

### Lettere di incarico

Sono i pulsanti colorati della vecchia maschera USCITA. Il flusso è unico:
compili i campi → l'app protocolla in uscita → genera il PDF su carta intestata
con numero e data già stampati → lo allega al protocollo.

> ⚠️ I testi delle lettere in `js/lettere.js` sono una **prima stesura**. Vanno
> confrontati con i modelli Word dell'ufficio prima dell'uso in produzione.

## Da fare

- [ ] Modelli Word ufficiali delle lettere di incarico
- [ ] Scheda impresa d'ufficio (dati Access: PEC, ANCE, CCNL, INPS/INAIL, Socrate)
- [ ] Scheda persona con storico nomine (`s_nomine`, 7.496 righe)
- [ ] Aggancio dei vecchi documenti su Drive (`drive_file_id` / `drive_url`)
- [ ] Rubriche (Enti, Fornitori, Sindacati, Stampa, ANCE)
