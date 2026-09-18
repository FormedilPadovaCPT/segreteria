-- ════════════════════════════════════════════════════════════════════
-- Pagina Comunicazione: carosello e video nei post  (18/09/2026)
--
-- Applicata a mano su Supabase (progetto Gestionale) come migrazione
-- «s_post_carosello_e_video_2026_09_18»; questo file la conserva nel repo,
-- come prescrive la regola del CLAUDE.md.
--
-- Perché: la pagina Comunicazione dell'app segreteria è il posto da cui
-- l'ufficio scrive davvero (più comoda della pagina admin delle notizie,
-- parole dell'utente), ma reggeva UNA sola immagine e nessun video. Ora un
-- post può avere un carosello e il link a un video di YouTube, e quando si
-- pubblica nell'app servizi entrambi finiscono nella notizia.
--
-- I video NON si caricano da nessuna parte: stanno sul canale dell'Area
-- (@formedilpadova_areasicurezza) e ne viaggia solo il link — scelta
-- dell'utente del 18/09/2026, perché il piano Supabase è gratuito e la
-- banda è condivisa con tutta l'app.
-- ════════════════════════════════════════════════════════════════════

alter table public.s_post
  add column if not exists immagini  jsonb,
  add column if not exists video_url text;

comment on column public.s_post.immagini is
  'Carosello: [{"url":...,"path":...}, ...] oltre alla copertina, che resta in immagine_url. Vuoto = una sola immagine, come i post anteriori al 18/09/2026. Nell app servizi diventa la colonna notizie.immagini; su Telegram un album (sendMediaGroup).';

comment on column public.s_post.video_url is
  'Link al video su YouTube (canale @formedilpadova_areasicurezza). I video non si caricano da nessuna parte: nell app servizi la notizia mostra copertina e tasto play, su Telegram il link nel testo fa l anteprima. Scelta dell utente 18/09/2026.';

-- Nessun cambio di permessi: le colonne stanno dentro s_post, che ha già la
-- sua policy (sgr_post_all, solo segreteria).
