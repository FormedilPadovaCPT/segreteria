-- ════════════════════════════════════════════════════════════════════
-- Canale Telegram di PROVA  (18/09/2026)
--
-- Applicata a mano su Supabase (progetto Gestionale) come migrazione
-- «telegram_canale_prova_2026_09_18»; questo file la conserva nel repo.
--
-- Perche': l'utente, prima di pubblicare sul canale pubblico, mandava
-- ogni post in un canale di prova per vedere come usciva, e solo se
-- andava bene lo pubblicava davvero. Il passaggio ora e' nell'app: la
-- prova passa dalla STESSA funzione di invio della pubblicazione, su un
-- altro canale, e non tocca ne' lo stato del post ne' «uscito su».
--
-- Il bot e' lo stesso del canale pubblico e deve essere AMMINISTRATORE
-- anche del canale di prova. La riga nasce vuota: l'id si imposta dalla
-- pagina Comunicazione, con «Canale di prova...», che elenca i canali
-- che il bot ha visto di recente (getUpdates).
-- ════════════════════════════════════════════════════════════════════

insert into public.s_config (chiave, valore, descrizione)
values (
  'telegram_canale_prova',
  '',
  'Canale Telegram di PROVA (username @nome oppure chat_id numerico, es. -1001234567890). Serve a vedere come esce un post prima di pubblicarlo sul canale pubblico: si manda li, si guarda, e solo dopo si pubblica davvero. Lo usa lo stesso bot, che deve essere amministratore anche di questo canale. Vuoto = la prova non e disponibile.'
)
on conflict (chiave) do nothing;

-- Niente policy nuove: s_config la legge e la aggiorna gia' la segreteria
-- (s_config_sel / s_config_upd). L'INSERT non le e' permesso, ed e' il
-- motivo per cui la riga si crea qui e non dall'app.
