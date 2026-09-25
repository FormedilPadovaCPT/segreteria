-- ============================================================
-- LA FORMAZIONE MANCANTE RILEVATA IN CANTIERE DIVENTA LAVORO PER
-- L'UFFICIO CORSI E UN'OFFERTA PER L'IMPRESA (25/09/2026, idea
-- dell'utente: «invio automatico all'ufficio corsi delle segnalazioni che
-- i tecnici fanno quando spuntano "contattare l'ufficio corsi", con i dati
-- delle note e i contatti dell'impresa; e nella mail del verbale proporre le
-- date in calendario per i corsi che mancano, facendo capire che con
-- l'iscrizione alla Cassa quel corso sarebbe gratuito»).
--
-- Quattro pezzi:
--   1. formazione_catalogo   — il listino dell'ufficio corsi, un corso per
--                              codice, con quota CEIV (o gratuito) e di listino;
--   2. formazione_calendario — le edizioni in programma, con le date;
--   3. formazione_tipi       — l'elenco BREVE che il tecnico spunta nel verbale
--                              (l'utente: «altrimenti perde la voglia»), ogni
--                              voce mappata sui codici del catalogo;
--   4. s_formazione_segnalazioni — il registro: una riga per verbale con la
--                              spunta, la mail all'ufficio corsi e l'ESITO
--                              (contattata, iscritta, non interessata), così fra
--                              tre mesi si sa che cosa ne è uscito.
-- La mail all'ufficio corsi parte da sola (comunicazione INTERNA, testo letto
-- dal database: terza eccezione della stessa famiglia dell'avviso di
-- pagamento e dell'avviso al coordinatore). Quella all'impresa è la mail del
-- verbale, che il tecnico manda dall'app dopo l'anteprima.
-- ============================================================

-- ── 1. catalogo ──────────────────────────────────────────────────
create table if not exists public.formazione_catalogo (
  codice          text primary key,          -- codice corso dell'ufficio corsi (100, 113, 155118…)
  titolo          text not null,
  ore             numeric(5,1),
  max_allievi     int,
  validita        text,                      -- «3 ANNI», «MAI»…
  ceiv_gratuito   boolean not null default false,
  quota_ceiv      numeric(8,2),              -- se non gratuito: quota per le imprese iscritte CEIV
  quota_listino   numeric(8,2),              -- quota per le altre imprese
  diritti_segreteria numeric(6,2) not null default 30,  -- «per ogni iscritto ai corsi gratuiti € 30 di diritti di segreteria»
  attivo          boolean not null default true,
  aggiornato_il   timestamptz not null default now()
);
comment on table public.formazione_catalogo is 'Listino corsi a catalogo dell''ufficio corsi (importato da _SISTEMA/scripts/importa_programmazione_corsi.py). 25/09/2026.';

-- ── 2. calendario ────────────────────────────────────────────────
create table if not exists public.formazione_calendario (
  id              bigserial primary key,
  codice          text not null references public.formazione_catalogo(codice),
  titolo_programmazione text,
  data_inizio     date not null,
  data_fine       date,
  giornate        jsonb,                     -- elenco delle date
  sede            text,
  fonte           text not null,             -- «OTT-DIC 2026»: la programmazione da cui viene
  importato_il    timestamptz not null default now()
);
create index if not exists formazione_calendario_data_idx on public.formazione_calendario (codice, data_inizio);
comment on table public.formazione_calendario is 'Edizioni in programma dell''ufficio corsi, per fonte (programmazione trimestrale). Si sostituiscono per fonte a ogni importazione. 25/09/2026.';

-- ── 3. i tipi che spunta il tecnico (elenco breve, dieci voci) ────
create table if not exists public.formazione_tipi (
  codice          text primary key,
  etichetta       text not null,
  ordine          int not null,
  codici_catalogo text[] not null,           -- quali corsi del catalogo propone
  attivo          boolean not null default true
);
insert into public.formazione_tipi (codice, etichetta, ordine, codici_catalogo) values
  ('base',          'Formazione base lavoratori (art. 37)', 1, array['104','102','103','101','105']),
  ('preposto',      'Preposto',                             2, array['108','109']),
  ('primo_soccorso','Primo soccorso',                       3, array['113','115','114','116']),
  ('antincendio',   'Antincendio',                          4, array['118','117','155118','155117']),
  ('quota',         'Lavori in quota / DPI 3ª cat.',        5, array['125','155125']),
  ('ponteggi',      'Ponteggi e trabattelli',               6, array['127','128','161','155161']),
  ('attrezzature',  'Macchine e attrezzature (MMT, PLE, gru, carrelli)', 7, array['137','138','139','140','141','142','143','144','148','149','155137','155141','155144','155148','155149']),
  ('confinati',     'Ambienti confinati',                   8, array['126','155126']),
  ('datore',        'Datore di lavoro / RSPP',              9, array['119','120','121','122','155119','155121']),
  ('rls',           'RLS',                                 10, array['110','111','112'])
on conflict (codice) do nothing;

-- ── il verbale: quali tipi mancano ───────────────────────────────
alter table public.visite add column if not exists note_for_tipi text[];
comment on column public.visite.note_for_tipi is 'Tipi di formazione mancante spuntati dal tecnico (codici di formazione_tipi). Con note_for_sn = true parte la segnalazione all''ufficio corsi. 25/09/2026.';

-- ── 4. il registro delle segnalazioni ────────────────────────────
create table if not exists public.s_formazione_segnalazioni (
  id              bigserial primary key,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  visita_id       text,
  nr_verbale      text,
  data_visita     date,
  tecnico_id      text,
  tecnico_nome    text,
  impresa_id      text,
  impresa_nome    text,
  partita_iva     text,
  ceiv            text check (ceiv in ('si', 'no', 'da_verificare')),
  cantiere_desc   text,
  referente       text,                      -- chi c'era in cantiere (nome, qualifica)
  telefono        text,
  email           text,
  tipi            text[],                    -- codici di formazione_tipi
  nota            text,                      -- la nota del tecnico
  mail_a          text,                      -- a chi è andata la mail (ufficio corsi)
  mail_inviata_il timestamptz,
  mail_esito      text,                      -- «inviata» o il motivo per cui non è partita
  stato           text not null default 'inviata'
                  check (stato in ('inviata', 'contattata', 'iscritta', 'non_interessata', 'chiusa')),
  esito_note      text,
  esito_da        text,
  esito_il        timestamptz
);
create unique index if not exists s_formazione_segnalazioni_visita_ux on public.s_formazione_segnalazioni (visita_id) where visita_id is not null;
comment on table public.s_formazione_segnalazioni is 'Una riga per verbale con «contattare l''ufficio corsi»: la mail all''ufficio corsi e l''esito del contatto. 25/09/2026.';

create or replace function public.s_formazione_segnalazioni_tg() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.stato is distinct from old.stato then
    new.esito_da := lower(coalesce(auth.jwt() ->> 'email', new.esito_da, '')); new.esito_il := now();
  end if;
  return new;
end $$;
drop trigger if exists trg_s_formazione_segnalazioni on public.s_formazione_segnalazioni;
create trigger trg_s_formazione_segnalazioni before update on public.s_formazione_segnalazioni for each row execute function public.s_formazione_segnalazioni_tg();

-- ── policy ────────────────────────────────────────────────────────
alter table public.formazione_catalogo enable row level security;
alter table public.formazione_calendario enable row level security;
alter table public.formazione_tipi enable row level security;
alter table public.s_formazione_segnalazioni enable row level security;
drop policy if exists fcat_sel on public.formazione_catalogo;
create policy fcat_sel on public.formazione_catalogo for select to authenticated using ((select public.is_personale()));
drop policy if exists fcat_write on public.formazione_catalogo;
create policy fcat_write on public.formazione_catalogo for all to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
drop policy if exists fcal_sel on public.formazione_calendario;
create policy fcal_sel on public.formazione_calendario for select to authenticated using ((select public.is_personale()));
drop policy if exists fcal_write on public.formazione_calendario;
create policy fcal_write on public.formazione_calendario for all to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
drop policy if exists ftipi_sel on public.formazione_tipi;
create policy ftipi_sel on public.formazione_tipi for select to authenticated using ((select public.is_personale()));
drop policy if exists ftipi_write on public.formazione_tipi;
create policy ftipi_write on public.formazione_tipi for all to authenticated using ((select public.is_segreteria())) with check ((select public.is_segreteria()));
drop policy if exists fseg_sel on public.s_formazione_segnalazioni;
create policy fseg_sel on public.s_formazione_segnalazioni for select to authenticated using (
  (select public.is_segreteria()) or (select public.is_coordinatore()) or (select public.is_direttore())
  or tecnico_id = (select public.s_mio_tecnico_id())
);
drop policy if exists fseg_upd on public.s_formazione_segnalazioni;
create policy fseg_upd on public.s_formazione_segnalazioni for update to authenticated
  using ((select public.is_segreteria()) or (select public.is_coordinatore()))
  with check ((select public.is_segreteria()) or (select public.is_coordinatore()));
drop policy if exists fseg_ins on public.s_formazione_segnalazioni;
create policy fseg_ins on public.s_formazione_segnalazioni for insert to authenticated with check ((select public.is_segreteria()));
grant select on public.formazione_catalogo, public.formazione_calendario, public.formazione_tipi to authenticated;
grant insert, update, delete on public.formazione_catalogo, public.formazione_calendario, public.formazione_tipi to authenticated;
grant select, insert, update on public.s_formazione_segnalazioni to authenticated;
grant usage, select on sequence public.s_formazione_segnalazioni_id_seq, public.formazione_calendario_id_seq to authenticated;
revoke all on public.formazione_catalogo, public.formazione_calendario, public.formazione_tipi, public.s_formazione_segnalazioni from anon;

-- ── configurazione ───────────────────────────────────────────────
insert into public.s_config (chiave, valore, descrizione) values
  ('ufficio_corsi_email', 'corsi@formedilpadova.it', 'La casella condivisa dell''Ufficio Corsi Sicurezza (Giulia Sanavio, Paolo Zoggia, Silvia Friso): destinataria delle segnalazioni di formazione mancante dai verbali.'),
  ('ufficio_corsi_nomi', 'Ufficio Corsi Sicurezza', 'Come si chiama nelle mail il destinatario delle segnalazioni di formazione.'),
  ('formazione_programmazione_url', 'https://www.formedilpadova.it/', 'Dove l''impresa trova la programmazione completa dei corsi (link nella mail del verbale).'),
  ('formazione_avviso_giorni', '45', 'Se l''ultima data in calendario è più vicina di così, la segreteria vede l''avviso «aggiorna la programmazione corsi».')
on conflict (chiave) do nothing;

-- ── le proposte per la mail: i corsi dei tipi spuntati, con le date ──
create or replace function public.formazione_proposte(p_tipi text[], p_da date default current_date)
returns jsonb language sql stable security definer set search_path = public as $$
  with tipi as (
    select t.codice, t.etichetta, t.ordine, unnest(t.codici_catalogo) as cod, generate_subscripts(t.codici_catalogo, 1) as pos
      from formazione_tipi t where t.codice = any(p_tipi) and t.attivo
  ),
  corsi as (
    select ti.codice as tipo, ti.etichetta, ti.ordine, ti.pos, c.codice, c.titolo, c.ore, c.validita, c.ceiv_gratuito, c.quota_ceiv, c.quota_listino, c.diritti_segreteria,
           (select jsonb_agg(jsonb_build_object('inizio', e.data_inizio, 'fine', e.data_fine, 'sede', e.sede) order by e.data_inizio)
              from (select * from formazione_calendario e where e.codice = c.codice and e.data_inizio >= p_da order by e.data_inizio limit 3) e) as date
      from tipi ti join formazione_catalogo c on c.codice = ti.cod and c.attivo
  )
  select coalesce(jsonb_agg(jsonb_build_object('tipo', tipo, 'etichetta', etichetta, 'codice', codice, 'titolo', titolo, 'ore', ore, 'validita', validita,
           'ceiv_gratuito', ceiv_gratuito, 'quota_ceiv', quota_ceiv, 'quota_listino', quota_listino, 'diritti_segreteria', diritti_segreteria, 'date', coalesce(date, '[]'::jsonb))
         order by ordine, (date is null), pos), '[]'::jsonb)
  from corsi;
$$;
revoke all on function public.formazione_proposte(text[], date) from public, anon;
grant execute on function public.formazione_proposte(text[], date) to authenticated, service_role;

-- ── lo stato della programmazione, per l'avviso alla segreteria ──
create or replace function public.formazione_programmazione_stato()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ultima_data', (select max(data_inizio) from formazione_calendario),
    'edizioni_future', (select count(*) from formazione_calendario where data_inizio >= current_date),
    'fonte', (select fonte from formazione_calendario order by importato_il desc limit 1),
    'importato_il', (select max(importato_il) from formazione_calendario),
    'avviso_giorni', (select valore::int from s_config where chiave = 'formazione_avviso_giorni'),
    'catalogo_corsi', (select count(*) from formazione_catalogo where attivo));
$$;
revoke all on function public.formazione_programmazione_stato() from public, anon;
grant execute on function public.formazione_programmazione_stato() to authenticated;

-- ── il flusso entra nel riquadro «flussi mai usati» ──────────────
do $$
declare def text; punto text;
begin
  select pg_get_functiondef('public.s_flussi_uso()'::regprocedure) into def;
  punto := 'union all select ''Tecnici'', ''stage_senza_verbale''';
  if position(punto in def) = 0 then
    raise exception 's_flussi_uso: non trovo il punto di innesto (%). Guardare la funzione prima di insistere.', punto;
  end if;
  if position('formazione_segnalazione' in def) > 0 then return; end if;
  def := replace(def, punto,
    'union all select ''Formazione'', ''formazione_segnalazione'', ''Segnalazione all''''ufficio corsi dal verbale'', created_at::date from public.s_formazione_segnalazioni ' || punto);
  execute def;
end $$;
