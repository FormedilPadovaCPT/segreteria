-- ============================================================
-- Redazione automatica social — Area Sicurezza e Salute (06/09/2026)
--
-- Una routine cloud settimanale legge la «materia prima» che l'ufficio
-- produce già (aggregati delle visite, circolari protocollate, corsi in
-- apertura, campagne) tramite la funzione s_redazione_materia(), scrive
-- le bozze dei post in s_post, e la segreteria le approva dalla pagina
-- «Comunicazione» dell'app. Il confine è quello di sempre: l'AI prepara,
-- la persona decide che cosa esce.
--
-- Niente dati personali nella materia prima: solo aggregati, e le
-- circolari degli enti. Mai nomi di imprese, cantieri o persone.
-- ============================================================

create table if not exists public.s_post (
  id                bigserial primary key,
  giro              text,                       -- identificativo del giro della routine (es. 2026-W37)
  pilastro          text not null default 'cantiere'
                    check (pilastro in ('cantiere','normativa','servizi','formazione','rassegna','avviso')),
  titolo            text not null,              -- titolo di lavoro, per riconoscerlo in coda
  gancio            text,                       -- prima riga / apertura proposta
  fonte             text,                       -- da dove viene (aggregato visite, circolare N, articolo)
  fonte_url         text,
  norma             text,                       -- riferimento normativo citato
  testo_telegram    text,
  testo_app         text,                       -- notizia estesa per l'app servizi
  testo_linkedin    text,
  testo_instagram   text,
  hashtag           text,
  immagine_suggerita text,                      -- che grafica accompagnerebbe il post
  verifica          text,                       -- cosa l'umano deve controllare prima di approvare
  stato             text not null default 'bozza'
                    check (stato in ('bozza','approvato','pubblicato','scartato')),
  data_programmata  date,
  scarto_motivo     text,                       -- serve a rieducare la routine (lo rilegge)
  canali_pubblicati jsonb not null default '{}'::jsonb,
  pubblicato_il     timestamptz,
  creato_da         text not null default 'routine',
  aggiornato_da     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.s_post is
  'Bozze e post della redazione automatica social dell''Area Sicurezza e Salute. Scritte dalla routine cloud (via redazione-social), approvate dalla segreteria. canali_pubblicati: {telegram:{message_id,at}, app:{notizia_id,at}, linkedin:{at}, instagram:{at}}';

create index if not exists s_post_stato_idx on public.s_post (stato, created_at desc);

alter table public.s_post enable row level security;

drop policy if exists sgr_post_all on public.s_post;
create policy sgr_post_all on public.s_post
  for all to authenticated
  using (is_segreteria()) with check (is_segreteria());

-- updated_at
create or replace function public.s_post_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists s_post_touch on public.s_post;
create trigger s_post_touch before update on public.s_post
  for each row execute function public.s_post_touch();

-- ------------------------------------------------------------
-- Chiavi di configurazione
--   redazione_token     parola d'ordine della routine (si cambia quando si vuole)
--   redazione_linee     indicazioni libere per la prossima redazione, scritte dalla segreteria
--   telegram_canale     @username o chat_id del canale pubblico (NON quello dei tecnici)
-- ------------------------------------------------------------
insert into public.s_config (chiave, valore, descrizione) values
  ('redazione_token', 'DA-IMPOSTARE', 'Parola d''ordine con cui la routine cloud chiama redazione-social. Cambiarla invalida la routine finché non si aggiorna anche lì.'),
  ('redazione_linee', 'Nessuna indicazione particolare.', 'Indicazioni libere per la prossima redazione automatica (temi da trattare, cose da evitare). La routine le legge a ogni giro.'),
  ('telegram_canale', '@ScuolaEdileCPTPadova', 'Canale Telegram pubblico dell''Area Sicurezza e Salute (username o chat_id). Il bot deve esserne amministratore.')
on conflict (chiave) do nothing;

-- ------------------------------------------------------------
-- La materia prima per la redazione: SOLO aggregati e documenti di enti.
-- security definer perché la chiama la funzione edge col service role,
-- ma è comunque letta anche dall'app (is_segreteria) per mostrare
-- «con che numeri ha lavorato la routine».
-- ------------------------------------------------------------
create or replace function public.s_redazione_materia(p_mesi int default 12)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with v as (
  select * from visite
  where data_visita >= (current_date - (p_mesi || ' months')::interval)
    and coalesce(elimina,0) = 0 and coalesce(is_clone,false) = false
),
mese_prec as (
  select * from visite
  where data_visita >= date_trunc('month', current_date) - interval '1 month'
    and data_visita <  date_trunc('month', current_date)
    and coalesce(elimina,0) = 0 and coalesce(is_clone,false) = false
),
nc as (
  select cv.codice, cv.zona_etichetta, cv.descrizione, cv.articolo, cv.importo_sanzione,
         count(*) filter (where vc.valore in ('NC+','NC-')) n,
         count(*) filter (where vc.valore = 'NC+') n_gravi
  from visite_checklist vc
  join v on v.visita_id = vc.visita_id
  join checklist_voci cv on cv.codice = vc.codice
  where vc.valore in ('NC+','NC-')
  group by 1,2,3,4,5
  order by n desc limit 15
),
nc_mese as (
  select cv.zona_etichetta, cv.descrizione, cv.articolo, count(*) n
  from visite_checklist vc
  join mese_prec m on m.visita_id = vc.visita_id
  join checklist_voci cv on cv.codice = vc.codice
  where vc.valore in ('NC+','NC-')
  group by 1,2,3 order by n desc limit 6
),
zone as (
  select cv.zona_etichetta, count(*) n
  from visite_checklist vc join v on v.visita_id = vc.visita_id
  join checklist_voci cv on cv.codice = vc.codice
  where vc.valore in ('NC+','NC-') group by 1 order by n desc
)
select jsonb_build_object(
  'generato_il', now(),
  'periodo', jsonb_build_object(
      'dal', to_char(current_date - (p_mesi || ' months')::interval, 'YYYY-MM-DD'),
      'al', to_char(current_date, 'YYYY-MM-DD'), 'mesi', p_mesi),
  'totali', (select jsonb_build_object(
      'visite', count(*), 'imprese', count(distinct impresa_id), 'cantieri', count(distinct cantiere_id),
      'lavoratori_incontrati', coalesce(sum(nr_lavoratori),0), 'tecnici', count(distinct tecnico_id),
      'nc_gravi', coalesce(sum(ipc_nc_plus),0), 'nc_lievi', coalesce(sum(ipc_nc_minus),0),
      'osservazioni', coalesce(sum(ipc_oss),0),
      'ipc', jsonb_build_object(
        'basso', count(*) filter (where ipc = 'BASSO'), 'medio', count(*) filter (where ipc = 'MEDIO'),
        'alto', count(*) filter (where ipc = 'ALTO'), 'non_rilevato', count(*) filter (where ipc = 'NR' or ipc is null)),
      'esito_osserv_1_2_3', jsonb_build_object(
        '1', count(*) filter (where esito_osserv = 1), '2', count(*) filter (where esito_osserv = 2),
        '3', count(*) filter (where esito_osserv = 3)),
      'nota_esito', 'esito_osserv: 1/2/3 — lettura come buono/sufficiente/insufficiente DA CONFERMARE prima di usarla in un post')
    from v),
  'mese_precedente', (select jsonb_build_object(
      'mese', to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM'),
      'visite', count(*), 'imprese', count(distinct impresa_id), 'lavoratori_incontrati', coalesce(sum(nr_lavoratori),0),
      'ipc_alto', count(*) filter (where ipc = 'ALTO'), 'ipc_medio', count(*) filter (where ipc = 'MEDIO'),
      'nc_top', (select coalesce(jsonb_agg(to_jsonb(nc_mese)), '[]'::jsonb) from nc_mese))
    from mese_prec),
  'non_conformita_frequenti', (select coalesce(jsonb_agg(to_jsonb(nc)), '[]'::jsonb) from nc),
  'non_conformita_per_zona', (select coalesce(jsonb_agg(to_jsonb(zone)), '[]'::jsonb) from zone),
  'circolari_e_normativa_recenti', (
    select coalesce(jsonb_agg(jsonb_build_object(
        'protocollo', p.codice, 'data', p.data_prot, 'ente', p.impresa_nome, 'oggetto', p.oggetto,
        'tipo', p.tipo_doc_txt, 'sintesi', p.sintesi, 'scadenze', p.scadenze, 'vostro_protocollo', p.vostro_protocollo)
        order by p.data_prot desc), '[]'::jsonb)
    from (
      select * from s_protocollo
      where direzione = 'IN' and coalesce(annullato,false) = false
        and data_prot >= current_date - interval '45 days'
        and (tipo_doc_txt ilike '%circolar%' or tipo_doc_txt ilike '%normativ%' or tipo_doc_txt ilike '%ordinanz%'
             or oggetto ilike '%circolare%' or oggetto ilike '%ordinanza%' or oggetto ilike '%decreto%'
             or oggetto ilike '%d.lgs%' or oggetto ilike '%accordo stato%' or oggetto ilike '%patente%')
      order by data_prot desc limit 20) p),
  'scadenze_dal_protocollo', (
    select coalesce(jsonb_agg(jsonb_build_object('protocollo', codice, 'data', data_prot, 'oggetto', oggetto, 'scadenze', scadenze)
        order by data_prot desc), '[]'::jsonb)
    from (select * from s_protocollo where scadenze is not null and scadenze <> ''
          and data_prot >= current_date - interval '60 days' order by data_prot desc limit 15) s),
  'corsi_in_apertura', (
    select coalesce(jsonb_agg(jsonb_build_object(
        'titolo', titolo, 'tipo', tipo, 'modalita', modalita, 'data_inizio', data_inizio, 'data_fine', data_fine,
        'durata_ore', durata_ore, 'sede', sede, 'normativa', normativa, 'validita', validita_txt,
        'riconosciuto_regione', riconosciuto_regione) order by data_inizio), '[]'::jsonb)
    from s_corsi
    where data_inizio between current_date and current_date + interval '75 days'
      and coalesce(stato,'') not in ('annullato','scartato')
      and conferenza_id is null),
  'campagne_attive', (
    select coalesce(jsonb_agg(jsonb_build_object('titolo', titolo, 'testo', testo, 'dal', dal, 'al', al,
        'link', link1_url, 'link_label', link1_label)), '[]'::jsonb)
    from campagne where attivo and (al is null or al >= current_date - interval '15 days')),
  'post_recenti', (
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'giro', giro, 'pilastro', pilastro, 'titolo', titolo,
        'stato', stato, 'scarto_motivo', scarto_motivo, 'creato', created_at::date) order by created_at desc), '[]'::jsonb)
    from (select * from s_post where created_at >= now() - interval '120 days' order by created_at desc limit 60) r),
  'linee_della_segreteria', (select valore from s_config where chiave = 'redazione_linee'),
  'servizi_area', jsonb_build_array(
    'Visite di sopralluogo ordinarie (gratuite per le imprese iscritte alla Cassa Edile CEIV)',
    'Visita o serie di visite su richiesta dell''impresa',
    'Consulenza e informazione in materia di sicurezza (telefono, mail, sportello, in sede o in cantiere)',
    'Conferenza di cantiere: formazione/informazione ai lavoratori di una singola impresa, direttamente in cantiere',
    'Servizio RLST (Rappresentante dei Lavoratori per la Sicurezza Territoriale)',
    'Anagrafe RLS aziendali (CCPL 3/3/2022)',
    'Asseverazione del modello di organizzazione e gestione della sicurezza (D.Lgs. 81/08 art. 51 c. 3-bis, procedura FORMEDIL)',
    'Attestazione DM 132/2024: consulenza e monitoraggio con esito positivo per i crediti aggiuntivi della patente a crediti (servizio nuovo, iscrizione CEIV e regolarità versamenti)',
    'Notifica di apertura cantiere al CPT («segnala un cantiere»)'
  ),
  'portale_servizi', 'https://formedilpadovacpt.github.io/servizi/'
);
$$;

-- corretto il 07/09/2026: senza «anon» il grant di default di Supabase resta (vedi 2026_09_07_revoke_anon_redazione_social.sql)
revoke all on function public.s_redazione_materia(int) from public, anon;
grant execute on function public.s_redazione_materia(int) to authenticated, service_role;

-- 07/09/2026: i calendari Google letti dalla redazione (eventi pubblici dei prossimi 60 giorni)
insert into public.s_config (chiave, valore, descrizione) values
  ('redazione_calendari', 'c_ec5b2c076b35c3d0a8f2ca66fb6ba8fc1b502c9fed4dce653807edb93e26adf0@group.calendar.google.com, c_vv6fllsnnvgb9s7tgpttn9bjt8@group.calendar.google.com', 'Calendari Google letti dalla redazione social (id separati da virgola): eventi pubblici dei prossimi 60 giorni. Oggi «Convegni» e «Calendario corsi e attività - Scuola Edile CPT». L''agenda della segreteria resta fuori.')
on conflict (chiave) do nothing;
