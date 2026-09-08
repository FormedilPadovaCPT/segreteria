-- ============================================================================
-- 2026-09-08 — Un CNCE può stare su più cantieri, se sono LOTTI dello stesso complesso
--
-- Chiesto dall'utente («si potrebbe assegnare il CNCE a più cantieri? è una
-- situazione che può succedere»), dal caso di via Boccaccio a Padova: cinque
-- lotti di Furlan Costruzioni con un'unica notifica preliminare (un solo CNCE),
-- visitati con verbali separati (0796 lotto 1, 0797 lotto 3, 0798 lotto 4,
-- 0799 lotto 5). Tre stavano sullo stesso cantiere e lo scadenzario ne vedeva
-- uno solo; il quarto aveva un cantiere suo ma senza CNCE.
--
-- Il CNCE identifica la NOTIFICA, cioè il complesso; il cantiere del gestionale
-- è il luogo che il tecnico visita. Quando il complesso ha più lotti visitati
-- separatamente, sono più cantieri con lo stesso CNCE — e non sono doppioni.
-- L'indice unico del 16/07/2026 (ux_cantieri_cnce_attivi) era nato contro i
-- doppioni veri dell'import CEIV (686 righe) e non distingueva i due casi.
--
-- Regola nuova: la colonna `lotto` dichiara che il cantiere è un lotto di un
-- complesso. L'unicità vale su (CNCE, lotto): due cantieri con lo stesso CNCE e
-- senza lotto restano un doppione e vengono bloccati come prima; con lotti
-- diversi sono ammessi. Chi ha lo stesso CNCE e lo stesso lotto è un doppione.
-- ============================================================================

alter table public.cantieri add column if not exists lotto text;
alter table public.cantieri drop constraint if exists cantieri_lotto_check;
alter table public.cantieri add constraint cantieri_lotto_check check (lotto is null or char_length(lotto) between 1 and 30);
comment on column public.cantieri.lotto is
  'Lotto del complesso quando più cantieri condividono lo stesso CNCE (notifica preliminare unica). Vuoto = cantiere unico. Unicità su (CNCE, lotto): stesso CNCE senza lotto = doppione.';

drop index if exists public.ux_cantieri_cnce_attivi;
create unique index ux_cantieri_cnce_lotto_attivi
  on public.cantieri (upper(cantiere_cnce), coalesce(lotto, ''))
  where elimina = 0 and cantiere_cnce ilike 'CNCE%';

-- Stesso giorno: in ricontrolli_pendenti l'etichetta del cantiere porta « – lotto N » quando c'è,
-- altrimenti i lotti dello stesso complesso nella mail del lunedì sono indistinguibili
-- (applicato come migrazione ricontrolli_pendenti_lotto_2026_09_08: ultima riga del SELECT,
--  `|| case when nullif(trim(ca.lotto),'') is not null then ' – lotto '||trim(ca.lotto) else '' end`).
