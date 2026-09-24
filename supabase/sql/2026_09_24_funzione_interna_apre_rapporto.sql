-- La funzione interna presuppone il rapporto (24/09/2026, regola dell'utente: «al preposto,
-- se non ha un rapporto per quell'azienda, va creato»).
-- Vale per i ruoli con s_ruoli.propone_rapporto (preposto, capocantiere, caposquadra, RLS,
-- addetti alle emergenze, dirigente): quando nasce una nomina con persona
-- e impresa, e la persona non ha un rapporto con quell'impresa che copra il periodo della
-- nomina, si apre il rapporto «dipendente» con le date della nomina.
-- Un trigger solo, cosi' vale per TUTTE le strade: maschera nomine, «+ Aggiungi persona»,
-- verbali (s_nomine_da_visita), iscrizioni (iscr_nomina_da_ruolo), import futuri.
-- Scatta su INSERT e sul cambio di RUOLO, non sul cambio di persona o impresa: le unioni
-- (fondi_persone, fondi_imprese) spostano nomine e rapporti, e aprire qui un rapporto nel
-- mezzo di un'unione creerebbe un doppione.

create or replace function public.tg_nomina_apre_rapporto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.persona_id is null or new.impresa_id is null or new.ruolo_id is null then return new; end if;
  if not exists (select 1 from s_ruoli r where r.id_ruolo = new.ruolo_id and r.propone_rapporto) then return new; end if;
  if not exists (select 1 from imprese i where i.impresa_id = new.impresa_id) then return new; end if;
  -- un rapporto (di qualunque tipo) che copra la nomina: finisce dopo la nomina, o non finisce
  if exists (select 1 from persone_imprese pi
              where pi.persona_id = new.persona_id and pi.impresa_id = new.impresa_id
                and (pi.data_cessazione is null or pi.data_cessazione >= coalesce(new.data_fine, current_date))) then
    return new;
  end if;
  insert into persone_imprese (persona_id, impresa_id, tipo_rapporto, data_assunzione, data_cessazione, note)
  values (new.persona_id, new.impresa_id, 'dipendente', new.data_inizio, new.data_fine,
          'Aperto dalla nomina «' || coalesce(new.ruolo_txt, 'funzione interna') || '» n. ' || new.access_id
          || ' del ' || to_char(coalesce(new.data_reg, current_date), 'DD/MM/YYYY')
          || ': la funzione presuppone il rapporto con l''impresa.');
  return new;
end $$;
revoke execute on function public.tg_nomina_apre_rapporto() from public, anon, authenticated;
grant execute on function public.tg_nomina_apre_rapporto() to service_role;

drop trigger if exists trg_nomina_apre_rapporto on public.s_nomine;
create trigger trg_nomina_apre_rapporto
  after insert or update of ruolo_id on public.s_nomine
  for each row execute function public.tg_nomina_apre_rapporto();

-- ── storico: le nomine interne gia' registrate senza rapporto ─────────────────
-- Un rapporto per coppia persona-impresa: inizio = la prima data d'inizio nota, fine =
-- nessuna se almeno una nomina e' in corso, altrimenti l'ultima data di fine.
insert into public.persone_imprese (persona_id, impresa_id, tipo_rapporto, data_assunzione,
                                    data_cessazione, note, ext_id)
select n.persona_id, n.impresa_id, 'dipendente',
       min(n.data_inizio),
       case when bool_or(n.data_fine is null) then null else max(n.data_fine) end,
       'Aperto dalle nomine interne già registrate (' || string_agg(distinct n.ruolo_txt, ', ')
         || '; n. ' || string_agg(n.access_id::text, ', ' order by n.access_id)
         || '): la funzione presuppone il rapporto. Ricostruito il 24/09/2026.',
       'nomina:' || min(n.access_id)
  from public.s_nomine n
  join public.s_ruoli r on r.id_ruolo = n.ruolo_id and r.propone_rapporto
 where n.persona_id is not null and n.impresa_id is not null
   and exists (select 1 from public.imprese i where i.impresa_id = n.impresa_id)
   and not exists (select 1 from public.persone_imprese pi
                    where pi.persona_id = n.persona_id and pi.impresa_id = n.impresa_id)
 group by n.persona_id, n.impresa_id;
