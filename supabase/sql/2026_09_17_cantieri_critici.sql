-- ============================================================
-- CANTIERI CRITICI — registro unico (17/09/2026, deciso dall'utente)
--
-- Due porte d'ingresso, un registro solo:
--   accesso_negato        il tecnico lo segnala dal bottone in dashboard
--                         del gestionale visite (dal 16/09/2026);
--   proposta_segnalazione il tecnico spunta nel verbale «Propongo
--                         segnalazione a SPISAL / ITL» (visite.segnalazione):
--                         fin qui la spunta restava dentro il verbale e
--                         non avvisava nessuno (2 casi su 2.338 visite);
--   manuale               la segreteria apre il caso a mano.
--
-- Perché un registro solo: le strade d'uscita sono le stesse — ulteriore
-- visita, proposta di conferenza di cantiere all'impresa (che non è
-- obbligata), Presidenza / Commissione Sicurezza, segnalazione a SPISAL
-- e/o ITL — e un accesso negato che non si risolve può finire anch'esso
-- agli organi di vigilanza.
--
-- La tabella s_dinieghi_accesso del 16/09 viene RINOMINATA e allargata.
-- Al suo posto resta una vista con lo stesso nome e le stesse colonne:
-- le app già online continuano a funzionare finché non sono aggiornate.
-- La vista si toglie quando gestionale e segreteria leggono la tabella
-- nuova.
--
-- La cronologia (s_cantieri_critici_eventi) si scrive e non si riscrive:
-- chi, quando, che cosa (regola d'oro 7). Il campo gestione_note resta
-- quello che vede il tecnico come risposta dell'ufficio.
-- ============================================================

alter table public.s_dinieghi_accesso rename to s_cantieri_critici;
alter table public.s_cantieri_critici rename column data_diniego to data_evento;

alter table public.s_cantieri_critici
  add column if not exists origine text not null default 'accesso_negato'
    check (origine in ('accesso_negato', 'proposta_segnalazione', 'manuale')),
  add column if not exists visita_id text references public.visite(visita_id) on update cascade on delete set null,
  add column if not exists motivo text check (motivo in ('rifiutato', 'nessuno_presente', 'altro')),
  add column if not exists presente_titolo text,
  add column if not exists presente_nome text,
  add column if not exists presente_cognome text,
  add column if not exists presente_qualifica text,
  add column if not exists presente_tel text,
  add column if not exists termine_il date,
  add column if not exists esito text
    check (esito in ('risolta_visita', 'risolta_altro', 'segnalata_organi', 'non_risolta', 'nessuna_azione')),
  add column if not exists esito_visita_id text references public.visite(visita_id) on update cascade on delete set null;

alter table public.s_cantieri_critici drop constraint if exists s_dinieghi_accesso_stato_check;
alter table public.s_cantieri_critici add constraint s_cantieri_critici_stato_check
  check (stato in ('nuovo', 'in_gestione', 'attesa_impresa', 'attesa_decisione', 'chiuso'));

comment on table public.s_cantieri_critici is 'Cantieri critici: accessi negati al tecnico e proposte di segnalazione a SPISAL/ITL dai verbali. Registro unico gestito da segreteria e coordinatore (17/09/2026)';
comment on column public.s_cantieri_critici.origine is 'accesso_negato = bottone del gestionale; proposta_segnalazione = spunta nel verbale (visite.segnalazione); manuale = aperto dalla segreteria';
comment on column public.s_cantieri_critici.data_evento is 'Data del diniego, o della visita in cui il tecnico ha proposto la segnalazione';
comment on column public.s_cantieri_critici.motivo is 'Solo accesso negato: rifiutato = una persona ha negato l''accesso; nessuno_presente = cantiere chiuso o nessuno con cui parlare';
comment on column public.s_cantieri_critici.stato is 'nuovo; in_gestione = presa in carico; attesa_impresa = comunicazione inviata, corre il termine (termine_il); attesa_decisione = demandata a Presidenza/Commissione Sicurezza o in attesa del Direttore; chiuso = con esito e nota';
comment on column public.s_cantieri_critici.termine_il is 'Entro quando si aspetta che l''impresa ricontatti (15 giorni dalla comunicazione): dopo, il cruscotto propone il sollecito';
comment on column public.s_cantieri_critici.gestione_note is 'La risposta dell''ufficio: la vede anche il tecnico';

alter index if exists s_dinieghi_accesso_stato_idx rename to s_cantieri_critici_stato_idx;
alter index if exists s_dinieghi_accesso_impresa_idx rename to s_cantieri_critici_impresa_idx;
alter index if exists s_dinieghi_accesso_cantiere_idx rename to s_cantieri_critici_cantiere_idx;
-- una proposta per verbale: il trigger sulle visite non ne apre due
create unique index if not exists s_cantieri_critici_visita_uidx
  on public.s_cantieri_critici (visita_id) where origine = 'proposta_segnalazione';

-- ---------- RLS ----------
drop policy if exists s_dinieghi_accesso_ins on public.s_cantieri_critici;
drop policy if exists s_dinieghi_accesso_sel on public.s_cantieri_critici;
drop policy if exists s_dinieghi_accesso_upd on public.s_cantieri_critici;

-- Il tecnico apre solo accessi negati, a nome suo. Le proposte dal verbale
-- le apre il trigger sulle visite; i casi manuali segreteria e coordinatore.
create policy s_cantieri_critici_ins on public.s_cantieri_critici for insert to authenticated
  with check ((select is_personale()) and not (select is_viewer())
              and (origine = 'accesso_negato' or (select is_segreteria()) or (select is_coordinatore())));

create policy s_cantieri_critici_sel on public.s_cantieri_critici for select to authenticated
  using (segnalato_da = lower(coalesce((select auth.jwt() ->> 'email'), ''))
         or (select is_segreteria()) or (select is_coordinatore()) or (select is_direttore()));

-- Gestiscono segreteria e coordinatore (è lui che risponde al tecnico nel merito).
create policy s_cantieri_critici_upd on public.s_cantieri_critici for update to authenticated
  using ((select is_segreteria()) or (select is_coordinatore()))
  with check ((select is_segreteria()) or (select is_coordinatore()));

-- Nessuna policy di delete: un caso non si cancella, si chiude.

-- ---------- prima di scrivere ----------
create or replace function public.s_cantieri_critici_prepara()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_ufficio boolean := pg_trigger_depth() > 1 or coalesce(is_segreteria(), false) or coalesce(is_coordinatore(), false);
begin
  if tg_op = 'INSERT' then
    new.stato := 'nuovo';
    new.gestione_note := null; new.gestito_da := null; new.gestito_il := null;
    new.esito := null; new.esito_visita_id := null; new.termine_il := null;
    if new.tecnico_id is not null and v_ufficio then
      -- aperto dall'ufficio o dal verbale: il tecnico è quello indicato, e
      -- segnalato_da è la SUA mail, così il caso compare nel suo elenco;
      -- chi l'ha aperto davvero resta nell'evento di apertura
      select trim(concat_ws(' ', t.tecnico_cognome, t.titolo, t.tecnico_nome)), nullif(lower(t.email), '')
        into new.tecnico_nome, new.segnalato_da
        from public.tecnici t where t.tecnico_id = new.tecnico_id;
    else
      -- il tecnico scrive a nome suo: chi segnala non si sceglie
      new.origine := case when v_ufficio then new.origine else 'accesso_negato' end;
      new.segnalato_da := coalesce(nullif(v_email, ''), new.segnalato_da);
      select t.tecnico_id, trim(concat_ws(' ', t.tecnico_cognome, t.titolo, t.tecnico_nome))
        into new.tecnico_id, new.tecnico_nome
        from public.tecnici t where lower(t.email) = v_email
        order by t.attivo desc nulls last limit 1;
    end if;
    new.segnalato_da := coalesce(new.segnalato_da, '');
    if new.data_evento > current_date then
      raise exception 'La data non può essere nel futuro';
    end if;
  else
    -- quello che ha scritto il tecnico non si riscrive: si gestisce accanto
    new.origine := old.origine; new.visita_id := old.visita_id;
    new.segnalato_da := old.segnalato_da; new.tecnico_id := old.tecnico_id; new.tecnico_nome := old.tecnico_nome;
    new.created_at := old.created_at; new.data_evento := old.data_evento;
    new.impresa_nome := old.impresa_nome; new.cantiere_desc := old.cantiere_desc; new.note := old.note;
    new.motivo := old.motivo;
    new.presente_titolo := old.presente_titolo; new.presente_nome := old.presente_nome;
    new.presente_cognome := old.presente_cognome; new.presente_qualifica := old.presente_qualifica;
    new.presente_tel := old.presente_tel;
    if new.stato = 'chiuso' and nullif(trim(coalesce(new.gestione_note, '')), '') is null then
      raise exception 'Per chiudere il caso va scritto com''è stato gestito';
    end if;
    if new.stato <> 'chiuso' then new.esito := null; new.esito_visita_id := null; end if;
    if new.stato <> 'attesa_impresa' and old.stato = 'attesa_impresa' then new.termine_il := null; end if;
    if new.stato is distinct from old.stato or new.gestione_note is distinct from old.gestione_note
       or new.esito is distinct from old.esito or new.termine_il is distinct from old.termine_il then
      new.gestito_da := nullif(v_email, ''); new.gestito_il := now();
    end if;
  end if;
  new.impresa_nome := trim(new.impresa_nome);
  new.cantiere_desc := trim(new.cantiere_desc);
  new.note := trim(new.note);
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.s_cantieri_critici_prepara() from public, anon, authenticated;
grant execute on function public.s_cantieri_critici_prepara() to service_role;

drop trigger if exists trg_s_dinieghi_accesso_prepara on public.s_cantieri_critici;
drop trigger if exists trg_s_cantieri_critici_prepara on public.s_cantieri_critici;
create trigger trg_s_cantieri_critici_prepara before insert or update on public.s_cantieri_critici
  for each row execute function public.s_cantieri_critici_prepara();
drop function if exists public.s_dinieghi_accesso_prepara();

revoke all on public.s_cantieri_critici from anon;
grant select, insert, update on public.s_cantieri_critici to authenticated;

-- ---------- cronologia ----------
create table if not exists public.s_cantieri_critici_eventi (
  id                bigint generated always as identity primary key,
  critico_id        bigint not null references public.s_cantieri_critici(id) on delete cascade,
  created_at        timestamptz not null default now(),
  autore            text,
  tipo              text not null check (tipo in (
                      'apertura', 'stato', 'nota',
                      'lettera_impresa', 'sollecito', 'pec_richiesta',
                      'contatto_impresa', 'visita_riprogrammata', 'visita_successiva',
                      'decisione', 'risposta_tecnico', 'conferenza_proposta',
                      'demandata', 'decisione_organo', 'autorizzazione_direttore',
                      'segnalazione_organi', 'riscontro_organo')),
  testo             text,
  visibile_tecnico  boolean not null default false,
  protocollo_id     bigint references public.s_protocollo(id) on delete set null,
  dati              jsonb
);
comment on table public.s_cantieri_critici_eventi is 'Cronologia dei cantieri critici: si aggiunge, non si riscrive e non si cancella';
comment on column public.s_cantieri_critici_eventi.visibile_tecnico is 'true = il tecnico che ha segnalato lo vede nel gestionale (decisioni e risposte); il resto è dell''ufficio';
create index if not exists s_cantieri_critici_eventi_idx on public.s_cantieri_critici_eventi (critico_id, created_at);

alter table public.s_cantieri_critici_eventi enable row level security;

drop policy if exists s_cantieri_critici_eventi_sel on public.s_cantieri_critici_eventi;
create policy s_cantieri_critici_eventi_sel on public.s_cantieri_critici_eventi for select to authenticated
  using ((select is_segreteria()) or (select is_coordinatore()) or (select is_direttore())
         or (visibile_tecnico and exists (select 1 from public.s_cantieri_critici c
               where c.id = critico_id and c.segnalato_da = lower(coalesce((select auth.jwt() ->> 'email'), '')))));

drop policy if exists s_cantieri_critici_eventi_ins on public.s_cantieri_critici_eventi;
create policy s_cantieri_critici_eventi_ins on public.s_cantieri_critici_eventi for insert to authenticated
  with check ((select is_segreteria()) or (select is_coordinatore()));
-- niente update né delete: la cronologia non si riscrive

create or replace function public.s_cantieri_critici_eventi_prepara()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if pg_trigger_depth() <= 1 then new.autore := nullif(v_email, ''); end if;
  new.created_at := now();
  new.testo := nullif(trim(coalesce(new.testo, '')), '');
  return new;
end $$;
revoke execute on function public.s_cantieri_critici_eventi_prepara() from public, anon, authenticated;
grant execute on function public.s_cantieri_critici_eventi_prepara() to service_role;
drop trigger if exists trg_s_cantieri_critici_eventi_prepara on public.s_cantieri_critici_eventi;
create trigger trg_s_cantieri_critici_eventi_prepara before insert on public.s_cantieri_critici_eventi
  for each row execute function public.s_cantieri_critici_eventi_prepara();

revoke all on public.s_cantieri_critici_eventi from anon;
grant select, insert on public.s_cantieri_critici_eventi to authenticated;

-- Apertura e cambi di stato finiscono in cronologia da soli: valgono anche
-- per chi gestisce dalla versione dell'app che non scrive ancora gli eventi.
create or replace function public.s_cantieri_critici_traccia()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  if tg_op = 'INSERT' then
    insert into public.s_cantieri_critici_eventi (critico_id, autore, tipo, testo, visibile_tecnico)
    values (new.id, coalesce(v_email, new.segnalato_da), 'apertura',
            case new.origine when 'accesso_negato' then 'Accesso negato segnalato dal tecnico'
                             when 'proposta_segnalazione' then 'Proposta di segnalazione a SPISAL / ITL dal verbale'
                             else 'Caso aperto dall''ufficio' end, true);
  elsif new.stato is distinct from old.stato or new.gestione_note is distinct from old.gestione_note
        or new.esito is distinct from old.esito then
    insert into public.s_cantieri_critici_eventi (critico_id, autore, tipo, testo, visibile_tecnico, dati)
    values (new.id, v_email, 'stato',
            case when new.stato is distinct from old.stato then 'Stato: ' || old.stato || ' → ' || new.stato else 'Risposta dell''ufficio aggiornata' end
              || case when new.gestione_note is distinct from old.gestione_note and new.gestione_note is not null
                      then E'\n' || new.gestione_note else '' end,
            true,
            jsonb_build_object('stato_da', old.stato, 'stato_a', new.stato, 'esito', new.esito, 'termine_il', new.termine_il));
  end if;
  return null;
end $$;
revoke execute on function public.s_cantieri_critici_traccia() from public, anon, authenticated;
grant execute on function public.s_cantieri_critici_traccia() to service_role;
drop trigger if exists trg_s_cantieri_critici_traccia on public.s_cantieri_critici;
create trigger trg_s_cantieri_critici_traccia after insert or update on public.s_cantieri_critici
  for each row execute function public.s_cantieri_critici_traccia();

-- ---------- dal verbale al registro ----------
-- 1) il tecnico spunta «Propongo segnalazione a SPISAL / ITL» → nasce il caso;
-- 2) entra un verbale su un cantiere con un accesso negato ancora aperto →
--    in cronologia compare la visita successiva: la segreteria decide se è
--    la soluzione (non si chiude da solo).
-- Un errore qui non deve mai bloccare il salvataggio di un verbale.
create or replace function public.s_cantieri_critici_da_visita()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_imp text; v_cant text; r record;
begin
  begin
    if coalesce(new.elimina, 0) = 0 and coalesce(new.segnalazione, false)
       and (tg_op = 'INSERT' or not coalesce(old.segnalazione, false) or coalesce(old.elimina, 0) <> 0)
       and not exists (select 1 from public.s_cantieri_critici c
                        where c.visita_id = new.visita_id and c.origine = 'proposta_segnalazione') then
      select i.impresa_nome into v_imp from public.imprese i where i.impresa_id = new.impresa_id;
      select trim(both ', ' from concat_ws(', ',
               nullif(trim(concat_ws(' ', c.cantiere_indirizzo, c.cantiere_civico)), ''), c.comune_nome))
        into v_cant from public.cantieri c where c.cantiere_id = new.cantiere_id;
      insert into public.s_cantieri_critici
        (origine, visita_id, tecnico_id, data_evento, impresa_id, impresa_nome, cantiere_id, cantiere_desc, note,
         presente_titolo, presente_nome, presente_cognome)
      values ('proposta_segnalazione', new.visita_id, new.tecnico_id, least(new.data_visita, current_date),
              new.impresa_id, coalesce(nullif(v_imp, ''), 'impresa non indicata'),
              new.cantiere_id, coalesce(nullif(v_cant, ''), 'cantiere non indicato'),
              'Nel verbale ' || coalesce(new.nr_verbale, '(senza numero)') || ' del ' || to_char(new.data_visita, 'DD/MM/YYYY')
                || ' il tecnico propone la segnalazione a SPISAL / ITL.',
              new.ppre_titolo, new.ppre_nome, new.ppre_cog);
    end if;

    if tg_op = 'UPDATE' and coalesce(old.segnalazione, false) and not coalesce(new.segnalazione, false) then
      insert into public.s_cantieri_critici_eventi (critico_id, tipo, testo)
      select c.id, 'nota', 'Il tecnico ha tolto dal verbale la proposta di segnalazione.'
        from public.s_cantieri_critici c
       where c.visita_id = new.visita_id and c.origine = 'proposta_segnalazione' and c.stato <> 'chiuso';
    end if;

    if tg_op = 'INSERT' and coalesce(new.elimina, 0) = 0 and new.cantiere_id is not null then
      for r in select c.id from public.s_cantieri_critici c
                where c.cantiere_id = new.cantiere_id and c.origine = 'accesso_negato'
                  and c.stato <> 'chiuso' and new.data_visita >= c.data_evento loop
        insert into public.s_cantieri_critici_eventi (critico_id, tipo, testo, visibile_tecnico, dati)
        values (r.id, 'visita_successiva',
                'Sul cantiere è entrato il verbale ' || coalesce(new.nr_verbale, '(senza numero)')
                  || ' del ' || to_char(new.data_visita, 'DD/MM/YYYY') || '.',
                true, jsonb_build_object('visita_id', new.visita_id, 'nr_verbale', new.nr_verbale, 'data_visita', new.data_visita));
      end loop;
    end if;
  exception when others then
    raise warning 's_cantieri_critici_da_visita: %', sqlerrm;
  end;
  return null;
end $$;
revoke execute on function public.s_cantieri_critici_da_visita() from public, anon, authenticated;
grant execute on function public.s_cantieri_critici_da_visita() to service_role;
drop trigger if exists trg_visite_cantieri_critici on public.visite;
create trigger trg_visite_cantieri_critici after insert or update of segnalazione, elimina on public.visite
  for each row execute function public.s_cantieri_critici_da_visita();

-- ---------- compatibilità con le app già online ----------
-- Stesso nome e stesse colonne della tabella del 16/09: vede solo gli accessi
-- negati. security_invoker: valgono le policy della tabella, non quelle del
-- proprietario della vista. DA TOGLIERE quando gestionale e segreteria
-- leggono s_cantieri_critici.
create or replace view public.s_dinieghi_accesso with (security_invoker = true) as
  select id, created_at, segnalato_da, tecnico_id, tecnico_nome, data_evento as data_diniego,
         impresa_id, impresa_nome, cantiere_id, cantiere_desc, note,
         stato, gestione_note, gestito_da, gestito_il, updated_at
    from public.s_cantieri_critici
   where origine = 'accesso_negato';
comment on view public.s_dinieghi_accesso is 'Compatibilità con le app online prima del 17/09/2026: gli accessi negati di s_cantieri_critici. Da togliere dopo il deploy.';
revoke all on public.s_dinieghi_accesso from anon;
grant select, insert, update on public.s_dinieghi_accesso to authenticated;

-- ---------- aggiunte dello stesso giorno ----------
-- Priorità, come nello storico Access delle comunicazioni INS (Normale / Alta):
-- alta = caso critico, in testa al cruscotto; per la lettera si propone anche
-- l'inoltro dalla PEC aziendale tramite l'Amministrazione.
alter table public.s_cantieri_critici
  add column if not exists priorita text not null default 'normale' check (priorita in ('normale', 'alta'));

-- Tipi di documento del protocollo per le due lettere che escono da qui.
insert into public.s_tipo_doc (id_doc, descrizione) values
  (67, 'Accesso negato al cantiere — comunicazione all''impresa'),
  (68, 'Segnalazione a organi di vigilanza (SPISAL / ITL)')
on conflict (id_doc) do nothing;

-- ---------- tappa 3 e storico (stesso giorno) ----------
-- Esito «non_registrato» per i casi dello storico Access chiusi senza dire come;
-- stato «annullato» per ciò che è stato aperto per errore o per prova (non si
-- cancella, ma non compare negli elenchi e non conta); riferimento e riga
-- originale dello storico delle comunicazioni INS (13 casi 2018-2025 importati
-- il 17/09/2026 dall'export consegnato dall'utente).
alter table public.s_cantieri_critici drop constraint if exists s_cantieri_critici_esito_check;
alter table public.s_cantieri_critici add constraint s_cantieri_critici_esito_check
  check (esito in ('risolta_visita', 'risolta_altro', 'segnalata_organi', 'non_risolta', 'nessuna_azione', 'non_registrato'));
alter table public.s_cantieri_critici drop constraint if exists s_cantieri_critici_stato_check;
alter table public.s_cantieri_critici add constraint s_cantieri_critici_stato_check
  check (stato in ('nuovo', 'in_gestione', 'attesa_impresa', 'attesa_decisione', 'chiuso', 'annullato'));
alter table public.s_cantieri_critici
  add column if not exists storico_rif text,
  add column if not exists storico jsonb;
create unique index if not exists s_cantieri_critici_storico_uidx on public.s_cantieri_critici (storico_rif) where storico_rif is not null;

create or replace view public.s_dinieghi_accesso with (security_invoker = true) as
  select id, created_at, segnalato_da, tecnico_id, tecnico_nome, data_evento as data_diniego,
         impresa_id, impresa_nome, cantiere_id, cantiere_desc, note,
         stato, gestione_note, gestito_da, gestito_il, updated_at
    from public.s_cantieri_critici
   where origine = 'accesso_negato' and stato <> 'annullato';

-- Destinatari della segnalazione agli organi di vigilanza: stanno in s_config
-- (chiave organi_vigilanza_contatti: spisal, itl, ceiv — indicati dall'utente),
-- non nel codice. La Cassa Edile va in copia SOLO sulla segnalazione.

-- ---------- la conferma del Direttore, dall'app ----------
-- La cronologia la scrivono solo segreteria e coordinatore: il Direttore passa
-- da qui, e può scrivere SOLO questo evento, a nome suo (link #critico-<id>).
create or replace function public.s_critico_conferma_direttore(p_id bigint, p_cosa text, p_nota text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_stato text; v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_ev bigint;
begin
  if not coalesce(is_direttore(), false) then
    raise exception 'La conferma è riservata al Direttore';
  end if;
  if p_cosa not in ('segnalare', 'non_segnalare') then
    raise exception 'Conferma non valida: %', p_cosa;
  end if;
  select stato into v_stato from s_cantieri_critici where id = p_id;
  if v_stato is null then raise exception 'Caso % non trovato', p_id; end if;
  if v_stato in ('chiuso', 'annullato') then raise exception 'Il caso % è già %', p_id, v_stato; end if;
  insert into s_cantieri_critici_eventi (critico_id, tipo, testo, visibile_tecnico, dati)
  values (p_id, 'autorizzazione_direttore',
          'Direttore, dall''app il ' || to_char(now() at time zone 'Europe/Rome', 'DD/MM/YYYY "alle" HH24:MI') || ': '
            || case p_cosa when 'segnalare' then 'CONFERMA la segnalazione agli organi di vigilanza' else 'NON conferma la segnalazione' end
            || case when nullif(trim(coalesce(p_nota, '')), '') is not null then '. ' || trim(p_nota) else '.' end,
          true, jsonb_build_object('chi', 'Direttore', 'cosa', p_cosa, 'via', 'app', 'utente', v_email))
  returning id into v_ev;
  return jsonb_build_object('evento_id', v_ev, 'cosa', p_cosa);
end $$;
revoke execute on function public.s_critico_conferma_direttore(bigint, text, text) from public, anon;
grant execute on function public.s_critico_conferma_direttore(bigint, text, text) to authenticated, service_role;

-- ---------- il testo di merito lo scrive il coordinatore, dal gestionale ----------
-- Il coordinatore non entra nell'app Segreteria: lavora dal riquadro «Cantieri
-- critici» della dashboard del gestionale visite (cantieri-critici-coord.js).
-- La segreteria ritrova il testo nella maschera «Segnala a SPISAL / ITL» al
-- posto del segnaposto. Chi e quando restano scritti; ogni modifica lascia una
-- riga in cronologia, non visibile al tecnico.
alter table public.s_cantieri_critici
  add column if not exists testo_merito text,
  add column if not exists merito_da text,
  add column if not exists merito_il timestamptz;

create or replace function public.s_cantieri_critici_merito()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text := nullif(lower(coalesce(auth.jwt() ->> 'email', '')), '');
begin
  new.testo_merito := nullif(trim(coalesce(new.testo_merito, '')), '');
  if new.testo_merito is distinct from old.testo_merito then
    new.merito_da := v_email; new.merito_il := now();
    insert into public.s_cantieri_critici_eventi (critico_id, autore, tipo, testo, visibile_tecnico)
    values (new.id, v_email, 'nota',
            case when new.testo_merito is null then 'Testo di merito della segnalazione tolto.'
                 when old.testo_merito is null then 'Scritto il testo di merito della segnalazione agli organi di vigilanza.'
                 else 'Aggiornato il testo di merito della segnalazione agli organi di vigilanza.' end, false);
  else
    new.merito_da := old.merito_da; new.merito_il := old.merito_il;
  end if;
  if new.stato = 'annullato' and old.stato <> 'annullato' and nullif(trim(coalesce(new.gestione_note, '')), '') is null then
    raise exception 'Per annullare il caso va scritto perché';
  end if;
  return new;
end $$;
revoke execute on function public.s_cantieri_critici_merito() from public, anon, authenticated;
grant execute on function public.s_cantieri_critici_merito() to service_role;
drop trigger if exists trg_s_cantieri_critici_merito on public.s_cantieri_critici;
create trigger trg_s_cantieri_critici_merito before update on public.s_cantieri_critici
  for each row execute function public.s_cantieri_critici_merito();
