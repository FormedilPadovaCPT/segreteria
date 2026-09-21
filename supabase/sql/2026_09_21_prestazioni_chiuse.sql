-- ═══════════════════════════════════════════════════════════════════════
--  PRESTAZIONI CHIUSE: «non si fatturano più» (21/09/2026)
--
--  Chiesto dall'utente guardando la chiusura del mese di agosto 2026 di
--  Camuffo, dove comparivano 42 attività arretrate del vecchio Access:
--  «tutti questi incarichi che risultano ancora aperti del vecchio
--  Access segnali tutti già chiusi, perché Camuffo non ha nulla da
--  fatturare in agosto»; poi lo stesso per Caon e per De Marco.
--
--  ⚠️ NON si cancellano e NON si agganciano a una fattura inventata.
--  Sono attività svolte davvero, e la riga resta: prende una DATA DI
--  CHIUSURA e un MOTIVO scritto, e da quel momento non entra più fra le
--  arretrate della chiusura del mese né fra quelle agganciabili a una
--  fattura. È la stessa scelta dei cantieri critici (non si cancella,
--  si chiude dicendo perché) e la regola d'oro 4.
--
--  Si torna indietro: `s_prestazione_riapri` toglie la chiusura e la
--  riga torna fra le aperte.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.s_prestazioni
  add column if not exists chiusa_il     timestamptz,
  add column if not exists chiusa_da     text,
  add column if not exists chiusa_motivo text;

comment on column public.s_prestazioni.chiusa_il is
  'Quando si è deciso che questa attività non si fattura più. Vuota = aperta.';
comment on column public.s_prestazioni.chiusa_da is 'Chi ha chiuso la riga.';
comment on column public.s_prestazioni.chiusa_motivo is
  'Perché non si fattura più: è la riga che rileggerà chi si chiederà dove è finita.';

/* una chiusura senza motivo non è una chiusura, è una riga sparita */
alter table public.s_prestazioni drop constraint if exists s_prestazioni_chiusa_motivo_chk;
alter table public.s_prestazioni add constraint s_prestazioni_chiusa_motivo_chk
  check (chiusa_il is null or coalesce(btrim(chiusa_motivo), '') <> '');

/* una prestazione PAGATA non è «chiusa»: ha la sua fattura, e le due cose
   non devono poter convivere o non si capirebbe più che cos'è successo */
alter table public.s_prestazioni drop constraint if exists s_prestazioni_chiusa_o_fatturata_chk;
alter table public.s_prestazioni add constraint s_prestazioni_chiusa_o_fatturata_chk
  check (chiusa_il is null or fattura_id is null);

create index if not exists s_prestazioni_aperte_idx
  on public.s_prestazioni (tecnico_id, data)
  where fattura_id is null and chiusa_il is null;

-- ── chiudere ──────────────────────────────────────────────────────────
create or replace function public.s_prestazioni_chiudi(p_ids bigint[], p_motivo text)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_n integer; v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  if not public.is_segreteria() then
    raise exception 'Le prestazioni le chiude la segreteria';
  end if;
  if v_motivo = '' then
    raise exception 'Scrivi perché non si fatturano più: è la riga che rileggerà chi le ritrova';
  end if;
  if p_ids is null or array_length(p_ids, 1) is null then return 0; end if;

  update public.s_prestazioni
     set chiusa_il = now(),
         chiusa_da = coalesce(auth.jwt() ->> 'email', current_user),
         chiusa_motivo = left(v_motivo, 500)
   where id = any (p_ids)
     and fattura_id is null            -- una pagata non si chiude
     and chiusa_il is null;            -- e una già chiusa non si richiude
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.s_prestazioni_chiudi(bigint[], text) is
  'Segna «non si fattura più» le prestazioni indicate, con il motivo. Non tocca quelle già pagate o già chiuse; restituisce quante ne ha chiuse.';

-- ── riaprire ──────────────────────────────────────────────────────────
create or replace function public.s_prestazione_riapri(p_id bigint)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_segreteria() then
    raise exception 'Le prestazioni le riapre la segreteria';
  end if;
  update public.s_prestazioni
     set chiusa_il = null, chiusa_da = null,
         chiusa_motivo = case when chiusa_motivo is null then null
                              else left('riaperta il ' || to_char(current_date, 'DD/MM/YYYY')
                                   || ' — era chiusa: ' || chiusa_motivo, 500) end
   where id = p_id and chiusa_il is not null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

comment on function public.s_prestazione_riapri(bigint) is
  'Toglie la chiusura a una prestazione: torna fra quelle da fatturare. Il motivo di prima resta scritto in coda.';

revoke execute on function public.s_prestazioni_chiudi(bigint[], text) from public, anon;
revoke execute on function public.s_prestazione_riapri(bigint) from public, anon;
grant execute on function public.s_prestazioni_chiudi(bigint[], text) to authenticated, service_role;
grant execute on function public.s_prestazione_riapri(bigint) to authenticated, service_role;

/* ── il calcolo del mese dice anche se la riga è chiusa ──
   La funzione è lunga: si parte dal suo testo nel database e si tocca la
   sola cosa che serve (regola del 19/09/2026), con il controllo che il
   punto di innesto esista ancora. Le cinque sorgenti (visite, visite
   stage, docenze, servizi, asseverazioni) espongono tutte la stessa
   terna prestazione_id / fattura_id / incarico_mensile_id: le si allunga
   con `chiusa_il`, così la maschera sa che quella riga è stata chiusa e
   non la ripropone spuntata. */
do $$
declare def text; punto text; n int;
begin
  select pg_get_functiondef('public.s_prestazioni_calcola_interna(text,integer,integer)'::regprocedure) into def;
  punto := '''prestazione_id'', p.id, ''fattura_id'', p.fattura_id, ''incarico_mensile_id'', p.incarico_mensile_id';
  n := (length(def) - length(replace(def, punto, ''))) / length(punto);
  if n < 5 then
    raise exception 's_prestazioni_calcola_interna: trovate % sorgenti su 5, la funzione è cambiata — guardarla prima di insistere', n;
  end if;
  def := replace(def, punto, punto || ', ''chiusa_il'', p.chiusa_il');
  execute def;   -- create or replace: i permessi restano quelli di prima
end $$;
