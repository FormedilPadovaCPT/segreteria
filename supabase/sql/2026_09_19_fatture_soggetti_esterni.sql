/* ============================================================
   FATTURE DI SOGGETTI ESTERNI (docenti, relatori, ospiti)
   Chiesto dall'utente il 19/09/2026, subito dopo la modifica
   degli incarichi di docenza: «quando un docente o persona con
   compenso è un tecnico nostro questi importi vanno in
   riepilogo da fatturare, se sono esterni son comunque fatture
   da ricevere che però entrano nel mandato all'amministrazione
   quando devono essere pagate».

   Che cosa c'era già, e non si tocca:
   - il TECNICO dell'ente: la docenza entra da sola nel riepilogo
     attività da fatturare (s_prestazioni_calcola legge
     s_corsi_incarichi e la abbina al tecnico), poi fattura →
     verifica → approvazione → mandato → pagata;
   - il MANDATO prende tutte le fatture in stato «approvata»,
     senza guardare il tecnico: una fattura di un esterno ci
     entra già, purché la si possa registrare.

   Che cosa mancava: la maschera «Registra fattura ricevuta»
   aveva solo la tendina dei tecnici, quindi la fattura di un
   esterno non si poteva nemmeno aprire. Tre colonne:
   - esterno:            dichiara che il soggetto non è un tecnico
                         dell'ente (niente riepilogo da fatturare:
                         il riepilogo è il documento che l'ente
                         manda al proprio tecnico);
   - persona_id:         l'esterno in anagrafica, quando c'è;
   - soggetto_email:     dove mandare l'avviso di avvenuto
                         pagamento, che per i tecnici viene da
                         anagrafica tecnici;
   - corso_incarico_id:  che cosa paga quella fattura, cioè la
                         riga di s_corsi_incarichi — per i tecnici
                         lo dice s_prestazioni.corso_incarico_id,
                         per gli esterni non c'è prestazione.

   ⚠️ Lo storico NON viene marcato: fra le 270 fatture senza
   tecnico_id convivono tecnici cessati (Bortolami, Migliolaro,
   Chiffi…) e veri esterni (Scudier Avv. Giovanni), e riga per
   riga non si può dire quale sia quale senza indovinare. Restano
   tutte «esterno = false», che è ciò che il dato sa.
   ============================================================ */

alter table public.s_fatture_tecnici
  add column if not exists esterno boolean not null default false,
  add column if not exists persona_id uuid references public.persone(persona_id),
  add column if not exists soggetto_email text,
  add column if not exists corso_incarico_id bigint references public.s_corsi_incarichi(id) on delete set null;

create index if not exists s_fatture_tecnici_corso_incarico_idx
  on public.s_fatture_tecnici(corso_incarico_id) where corso_incarico_id is not null;

comment on column public.s_fatture_tecnici.esterno is
  'La fattura è di un soggetto che NON è un tecnico dell''ente (docente, relatore, ospite): niente riepilogo da fatturare, ma entra nel mandato come le altre. Lo storico importato è tutto false, anche dove il soggetto era esterno: non si può dire riga per riga.';
comment on column public.s_fatture_tecnici.soggetto_email is
  'Indirizzo per l''avviso di avvenuto pagamento quando il soggetto non è in anagrafica tecnici.';
comment on column public.s_fatture_tecnici.corso_incarico_id is
  'La riga di s_corsi_incarichi che questa fattura paga (per i tecnici lo dice s_prestazioni.corso_incarico_id).';
