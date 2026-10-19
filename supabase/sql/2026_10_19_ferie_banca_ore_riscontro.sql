-- Richieste di recupero: da quali ore si scala, e il riscontro per l'Amministrazione
-- (19/10/2026, dai due rilievi del Direttore sulla richiesta n° 3)
--
-- (a) «manca il riferimento a quando sono maturate le ore da scalare, oppure
--     l'ammontare della banca ore». La richiesta porta ora una FOTOGRAFIA delle
--     righe di ore supplementari da cui si recupera e del saldo della banca ore
--     in quel momento. Sta sulla richiesta e non si ricalcola dalle tabelle delle
--     presenze perché il Direttore e l'Amministrazione quelle tabelle non le
--     leggono (policy sgr_presenze_extra_all: solo segreteria). È la riga
--     «(ID 1207 un'ora effettuata il 16.02.2026)» del vecchio modulo di carta.
--
-- (b) «Patrizia non ha alcuna documentazione di riscontro». L'Amministrazione
--     vede le richieste APPROVATE (in sola lettura) e ne registra la presa
--     visione con s_ferie_presa_visione, come per i mandati di pagamento.

alter table public.s_ferie_richieste
  add column if not exists banca_righe jsonb,
  add column if not exists banca_saldo_prima_min integer,
  add column if not exists banca_fotografia_il timestamptz,
  add column if not exists amm_visto_il timestamptz,
  add column if not exists amm_visto_da text,
  add column if not exists amm_visto_nome text;

comment on column public.s_ferie_richieste.banca_righe is
  'Recupero: righe di ore supplementari da cui si scala, fotografate quando la segreteria le sceglie: [{id, data, ore_min, note}]. Le legge anche chi non vede le tabelle delle presenze (Direttore, Amministrazione).';
comment on column public.s_ferie_richieste.banca_saldo_prima_min is
  'Recupero: saldo della banca ore da recuperare (minuti) nel momento della fotografia, prima di questa richiesta.';
comment on column public.s_ferie_richieste.amm_visto_il is
  'Presa visione dell''Amministrazione della richiesta approvata (s_ferie_presa_visione).';

-- l'Amministrazione legge le richieste approvate, nient'altro
drop policy if exists sgr_ferie_amm_sel on public.s_ferie_richieste;
create policy sgr_ferie_amm_sel on public.s_ferie_richieste
  for select to authenticated
  using (public.is_amministrazione() and aut_stato = 'approvata');

create or replace function public.s_ferie_presa_visione(p_id bigint)
returns public.s_ferie_richieste
language plpgsql
security definer
set search_path to 'public'
as $$
declare v public.s_ferie_richieste; v_chi text := coalesce(auth.jwt() ->> 'email', '');
begin
  if not public.is_amministrazione() then
    raise exception 'La presa visione della richiesta la registra l''Amministrazione';
  end if;
  update public.s_ferie_richieste
     set amm_visto_il = coalesce(amm_visto_il, now()),
         amm_visto_da = coalesce(amm_visto_da, v_chi),
         amm_visto_nome = coalesce(amm_visto_nome, (select valore from public.s_config where chiave = 'amministrazione_nome'), v_chi)
   where id = p_id and aut_stato = 'approvata'
  returning * into v;
  if v.id is null then raise exception 'Richiesta % non trovata o non approvata', p_id; end if;
  return v;
end $$;

revoke all on function public.s_ferie_presa_visione(bigint) from public, anon;
grant execute on function public.s_ferie_presa_visione(bigint) to authenticated;
