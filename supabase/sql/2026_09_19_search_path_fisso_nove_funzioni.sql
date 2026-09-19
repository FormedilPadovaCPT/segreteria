/* ============================================================================
   SEARCH_PATH FISSO SULLE NOVE FUNZIONI CHE NE ERANO PRIVE        (19/09/2026)

   Già applicato in produzione sul GESTIONALE (utdantrfugnmqsuujxbe) con la
   migrazione  search_path_fisso_nove_funzioni_2026_09_19.

   DA DOVE VIENE. Controllo generale del 18/09/2026: l'advisor di Supabase
   segnalava `function_search_path_mutable` su nove funzioni di `public` (erano
   quattro il 14/09: le altre cinque sono nate coi questionari e le iscrizioni).
   Nessuna era raggiungibile da anon, quindi è igiene e non un buco: una
   funzione senza search_path fisso risolve i nomi secondo il percorso di chi la
   chiama, e il resto del progetto (153 funzioni) lo fissa a `public`.

   PERCHÉ ALTER E NON CREATE OR REPLACE. `alter function … set` tocca solo
   l'impostazione: corpo, permessi e trigger restano quelli. Nessuna delle nove
   cambia comportamento, perché usano solo funzioni di sistema o nomi già
   scritti per esteso (`public.comune_norm`, `public.s_quest_domande`).

   ⚠️ ATTENZIONE AL ROVESCIO: un `create or replace function` SENZA la clausola
   `set search_path` RIAZZERA l'impostazione. Per questo, nello stesso giro, la
   clausola è stata aggiunta anche alle definizioni d'origine nel repo
   (2026_09_06_redazione_social, 2026_09_08_anagrafiche_autocompletamento,
   2026_09_18_questionario_visita, 2026_09_18_questionario_evento): rieseguirle
   non deve riaprire l'avviso. `iscr_impresa_di_riga` e `s_iscrizioni_touch` nel
   repo non hanno una definizione rieseguibile (il file delle iscrizioni è
   narrativo): per loro vale solo questa riga.

   VERIFICATO DOPO: zero funzioni di `public` senza search_path; le cinque
   funzioni di calcolo danno gli stessi risultati; `s_post_touch` aggiorna la
   data e `s_quest_tronco_fermo` ferma la cancellazione (provati in una
   transazione annullata); i permessi non sono cambiati.
   ========================================================================== */

alter function public.comune_norm(text)                 set search_path = public;
alter function public.comune_norm_base(text)            set search_path = public;
alter function public.forma_giuridica_da_nome(text)     set search_path = public;
alter function public.url_encode_semplice(text)         set search_path = public;
alter function public.iscr_impresa_di_riga(jsonb, text) set search_path = public;
alter function public.s_post_touch()                    set search_path = public;
alter function public.s_iscrizioni_touch()              set search_path = public;
alter function public.s_quest_domande_limite()          set search_path = public;
alter function public.s_quest_tronco_fermo()            set search_path = public;
