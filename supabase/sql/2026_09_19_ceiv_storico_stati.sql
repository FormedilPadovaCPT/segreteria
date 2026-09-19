/* ============================================================================
   LISTA CEIV: LO STATO IN CASSA DI UN'IMPRESA HA UNA STORIA        (19/09/2026)

   Applicato in produzione sul GESTIONALE (utdantrfugnmqsuujxbe) con la
   migrazioni  ceiv_storico_stati_2026_09_19,
   ceiv_storico_aggancio_veloce_2026_09_19 e
   ceiv_storico_lista_monca_ferma_tutto_2026_09_19 (qui c'è la forma finale).

   DA DOVE VIENE. L'utente, prima di caricare la lista di settembre: «un'impresa
   rimane traccia storica dei suoi stati in cassa? Da non iscritta a iscritta e
   viceversa o a sospesa?» — e, saputa la risposta: «io pensavo ci fosse già».
   Non c'era. `ceiv_applica` SOVRASCRIVEVA `imprese.stato_cassa`, `ceiv_lista`
   viene sostituita in blocco a ogni caricamento, e `s_impresa_audit` la scrivono
   solo le maschere. Caricando la lista nuova, lo stato del mese prima spariva.
   È la regola d'oro 7 (il fatto si aggiunge, non si sovrascrive) che mancava
   proprio sul dato che decide la precedenza nei servizi.

   CHE COSA SI TIENE. Una riga per PERIODO: stato, codice CEIV, la prima lista
   in cui quello stato risulta (`visto_dal`) e l'ultima che lo conferma
   (`visto_fino`). ⚠️ Non sono le date vere del cambio: di un passaggio da Attiva
   a Sospesa si sa solo FRA QUALI DUE LISTE è avvenuto. I nomi delle colonne lo
   dicono apposta («visto»), e la scheda impresa lo scrive.

   TRE FONTI, dichiarate sulla riga:
     lista       lo dice una lista CEIV caricata
     anagrafica  era scritto in anagrafica prima dello storico (import Access o
                 lista di cui non si è tenuta traccia): vale come «prima», non
                 come dato verificato
     manuale     cambiato a mano da una maschera

   «NON PIÙ IN LISTA» NON È UNO STATO DELL'IMPRESA: è un fatto sulla lista. Chi
   sparisce dalla lista NON viene toccato in anagrafica (l'assenza non è una
   prova: regola del 30/08) — ma lo storico lo annota, perché «dal 30/09 non
   compare più» è un'informazione, e finora si perdeva.
     ⚠️ Rete di sicurezza: se la lista caricata aggancia meno del 70 % delle
     imprese che avevano un periodo da lista, lo storico NON SI TOCCA e il
     risultato lo dice. Una lista troncata da un caricamento fallito non deve
     marcare migliaia di imprese come uscite, né far «peggiorare» chi ha più
     posizioni.

   UNA LISTA PIÙ VECCHIA DELL'ULTIMA non riscrive la storia: lo storico la
   salta e lo dice (l'anagrafica si aggiorna come prima).

   L'AGGANCIO SI ALLARGA A `imprese.piva`. Prima: chiave = CF o P.IVA della
   lista. Ma da quando le chiavi si riportano al codice fiscale
   (`s_cambia_id_impresa`, 08/09) la P.IVA resta nella colonna `piva`, e 22
   imprese non si agganciavano più: sarebbero state le prime «non più in lista»,
   a torto. Ora vale anche `imprese.piva = lista.piva`.

   FUSIONE DI DUE SCHEDE (`fondi_imprese`): la scheda doppia viene cancellata e
   il suo storico va con lei (ON DELETE CASCADE). Si accetta perché le due
   schede agganciavano la stessa riga di lista: la principale ha il suo.
   CAMBIO DI CHIAVE (`s_cambia_id_impresa`): la colonna si chiama `impresa_id`
   apposta, così la funzione la trova dal catalogo e la sposta da sola.

   SCRIVE SOLO IL DATABASE: RLS attiva, lettura al personale come `imprese`,
   nessuna policy di scrittura. Le funzioni sono chiuse a public, anon e
   authenticated (una è di trigger, l'altra la chiama solo `ceiv_applica`).
   ========================================================================== */

-- ── 1. la tabella ───────────────────────────────────────────────────────────
create table if not exists public.imprese_cassa_storico (
  id          bigint generated always as identity primary key,
  impresa_id  text not null references public.imprese(impresa_id) on update cascade on delete cascade,
  cassa       text not null default 'C.E.I.V.',
  stato       text not null,
  cod_ceiv    text,
  visto_dal   date,          -- prima lista (o giorno) in cui lo stato risulta; null = non noto
  visto_fino  date,          -- ultima lista che lo conferma
  attuale     boolean not null default true,
  fonte       text not null check (fonte in ('lista', 'anagrafica', 'manuale')),
  nota        text,
  creato_il   timestamptz not null default now()
);
comment on table public.imprese_cassa_storico is
  'Storia degli stati in Cassa Edile di un''impresa, per periodi. visto_dal/visto_fino sono le LISTE che riportano lo stato, non le date vere del cambio: di un passaggio si sa solo fra quali due liste e'' avvenuto.';

create unique index if not exists imprese_cassa_storico_un_attuale
  on public.imprese_cassa_storico (impresa_id) where attuale;
create index if not exists imprese_cassa_storico_impresa
  on public.imprese_cassa_storico (impresa_id, visto_dal);

alter table public.imprese_cassa_storico enable row level security;
drop policy if exists imprese_cassa_storico_sel on public.imprese_cassa_storico;
create policy imprese_cassa_storico_sel on public.imprese_cassa_storico
  for select to authenticated using ((select public.is_personale()));
revoke all on public.imprese_cassa_storico from anon;
grant select on public.imprese_cassa_storico to authenticated;

-- ── 2. l'aggancio lista → anagrafica, scritto una volta sola ────────────────
/* Una riga per impresa: se più righe di lista la agganciano vince Attiva, poi
   Sospesa, poi Cessata (la stessa regola che aveva ceiv_applica).
   ⚠️ TRE GIUNZIONI PER UGUAGLIANZA, NON UN OR. La prima stesura agganciava con
   `a = x or a = y or b = y`: nessun indice, 18.000 × 24.000 confronti, e
   ceiv_applica andava in TIMEOUT. L'ha trovato la prova in transazione
   annullata, prima di qualunque caricamento vero. Così dura 1,2 secondi. */
create index if not exists imprese_piva_idx on public.imprese (piva) where piva is not null;
create or replace function public.ceiv_aggancio()
returns table (impresa_id text, codice text, stato text)
language sql stable security definer set search_path = public
as $$
  select distinct on (x.impresa_id) x.impresa_id, x.codice, coalesce(x.stato, 'Non iscritta')
  from (
    select i.impresa_id, l.codice, l.stato from public.imprese i join public.ceiv_lista l on l.cf = i.impresa_id
    union all
    select i.impresa_id, l.codice, l.stato from public.imprese i join public.ceiv_lista l on l.piva = i.impresa_id
    union all
    select i.impresa_id, l.codice, l.stato from public.imprese i join public.ceiv_lista l on l.piva = i.piva
     where i.piva is not null
  ) x
  order by x.impresa_id,
    case x.stato when 'Attiva' then 0 when 'Sospesa' then 1 when 'Cessata' then 2 else 3 end;
$$;
revoke execute on function public.ceiv_aggancio() from public, anon, authenticated;
grant  execute on function public.ceiv_aggancio() to service_role;

-- ── 3. lo storico dopo una lista ────────────────────────────────────────────
create or replace function public.ceiv_storico_aggiorna(p_data date)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ultima date;
  v_prima int; v_agganciate int;
  v_conf int := 0; v_camb int := 0; v_nuove int := 0; v_uscite int := 0; v_ancora_fuori int := 0;
begin
  select max(visto_fino) into v_ultima from imprese_cassa_storico where fonte = 'lista';
  if v_ultima is not null and p_data < v_ultima then
    return jsonb_build_object('saltato', true,
      'motivo', 'la lista del ' || to_char(p_data, 'DD/MM/YYYY') || ' è più vecchia dell''ultima registrata nello storico (' || to_char(v_ultima, 'DD/MM/YYYY') || '): la storia non si riscrive');
  end if;

  create temp table _ceiv_m on commit drop as select * from ceiv_aggancio();
  create index on _ceiv_m (impresa_id);
  select count(*) into v_agganciate from _ceiv_m;

  -- la rete di sicurezza sta IN TESTA: con una lista monca non sono false solo
  -- le «scomparse», anche i cambi (chi ha più posizioni perde la riga migliore
  -- e sembra peggiorare: 6 casi nella prova con 100 righe)
  select count(*) into v_prima from imprese_cassa_storico
   where attuale and fonte = 'lista' and stato <> 'Non più in lista';
  if v_prima > 0 and v_agganciate < 0.7 * v_prima then
    drop table if exists _ceiv_m;
    return jsonb_build_object('saltato', true,
      'motivo', 'lista troppo corta: ' || v_agganciate || ' imprese agganciate contro ' || v_prima
             || ' che erano in lista. Lo storico NON è stato toccato: controllare il file caricato.');
  end if;

  -- (a) stesso stato: la lista lo conferma
  update imprese_cassa_storico s
     set visto_fino = p_data, cod_ceiv = m.codice
    from _ceiv_m m
   where s.attuale and s.impresa_id = m.impresa_id and s.stato = m.stato
     and (s.visto_fino is distinct from p_data or s.cod_ceiv is distinct from m.codice);
  get diagnostics v_conf = row_count;

  -- (b) stato diverso: si chiude il periodo e se ne apre uno
  create temp table _ceiv_cambiati on commit drop as
    select m.impresa_id, m.codice, m.stato, s.stato as prima
      from _ceiv_m m join imprese_cassa_storico s on s.impresa_id = m.impresa_id and s.attuale
     where s.stato <> m.stato;
  update imprese_cassa_storico s set attuale = false
    from _ceiv_cambiati c where s.attuale and s.impresa_id = c.impresa_id;
  insert into imprese_cassa_storico (impresa_id, stato, cod_ceiv, visto_dal, visto_fino, fonte, nota)
  select impresa_id, stato, codice, p_data, p_data, 'lista', 'prima: ' || prima from _ceiv_cambiati;
  get diagnostics v_camb = row_count;

  -- (c) mai vista prima
  insert into imprese_cassa_storico (impresa_id, stato, cod_ceiv, visto_dal, visto_fino, fonte)
  select m.impresa_id, m.stato, m.codice, p_data, p_data, 'lista'
    from _ceiv_m m
   where not exists (select 1 from imprese_cassa_storico s where s.impresa_id = m.impresa_id and s.attuale);
  get diagnostics v_nuove = row_count;

  -- (d) chi era in lista e non c'è più
  update imprese_cassa_storico s set visto_fino = p_data
   where s.attuale and s.stato = 'Non più in lista' and s.visto_fino is distinct from p_data
     and not exists (select 1 from _ceiv_m m where m.impresa_id = s.impresa_id);
  get diagnostics v_ancora_fuori = row_count;

  create temp table _ceiv_uscite on commit drop as
    select s.impresa_id, s.cod_ceiv, s.stato as prima
      from imprese_cassa_storico s
     where s.attuale and s.fonte = 'lista' and s.stato <> 'Non più in lista'
       and not exists (select 1 from _ceiv_m m where m.impresa_id = s.impresa_id);
  update imprese_cassa_storico s set attuale = false
    from _ceiv_uscite u where s.attuale and s.impresa_id = u.impresa_id;
  insert into imprese_cassa_storico (impresa_id, stato, cod_ceiv, visto_dal, visto_fino, fonte, nota)
  select impresa_id, 'Non più in lista', cod_ceiv, p_data, p_data, 'lista',
         'prima: ' || prima || '. In anagrafica lo stato NON è stato cambiato: l''assenza dalla lista non è una prova.'
    from _ceiv_uscite;
  get diagnostics v_uscite = row_count;

  drop table if exists _ceiv_m; drop table if exists _ceiv_cambiati; drop table if exists _ceiv_uscite;
  return jsonb_build_object('confermate', v_conf, 'cambiate', v_camb, 'nuove', v_nuove,
    'non_piu_in_lista', v_uscite, 'ancora_fuori_lista', v_ancora_fuori);
end $$;
revoke execute on function public.ceiv_storico_aggiorna(date) from public, anon, authenticated;
grant  execute on function public.ceiv_storico_aggiorna(date) to service_role;

-- ── 4. ceiv_applica: come prima, più l'aggancio per piva e lo storico ───────
/* Finora stava solo nel database: da oggi è anche qui. Era `language sql` con
   un'istruzione sola; diventa plpgsql perché deve (1) dire al trigger del
   punto 5 che il cambio viene da una lista, (2) chiamare lo storico DOPO aver
   aggiornato l'anagrafica. Le quattro chiavi del risultato restano quelle che
   legge la funzione import-ceiv; si aggiunge `storico`. */
create or replace function public.ceiv_applica(p_data date)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_nuove int; v_agg int; v_storico jsonb;
begin
  perform set_config('app.ceiv_applica', '1', true);

  with nuove as (
    insert into imprese (impresa_id, impresa_nome, indirizzo, cap, comune, prov,
                         cod_ceiv, cassa_edile, stato_cassa, impresa_telefono,
                         impresa_email_ref, data_agg_access, note_access)
    select distinct on (coalesce(l.cf, l.piva))
           coalesce(l.cf, l.piva), l.ragione_sociale, btrim(l.indirizzo), l.cap,
           l.comune, l.prov, l.codice, 'C.E.I.V.', coalesce(l.stato, 'Non iscritta'),
           l.telefono, l.email, p_data,
           'Creata dall''aggiornamento lista CEIV del ' || to_char(p_data, 'DD/MM/YYYY') || ' (non era in anagrafica).'
    from ceiv_lista l
    where not exists (select 1 from imprese i where i.impresa_id = l.cf)
      and not exists (select 1 from imprese i where i.impresa_id = l.piva)
      and not exists (select 1 from imprese i where i.piva = l.piva)
    order by coalesce(l.cf, l.piva),
      case l.stato when 'Attiva' then 0 when 'Sospesa' then 1 when 'Cessata' then 2 else 3 end
    on conflict (impresa_id) do nothing
    returning impresa_id
  ) select count(*) into v_nuove from nuove;

  with agg as (
    update imprese i
       set cod_ceiv = m.codice, stato_cassa = m.stato, cassa_edile = 'C.E.I.V.', data_agg_access = p_data
      from ceiv_aggancio() m where i.impresa_id = m.impresa_id
    returning i.impresa_id
  ) select count(*) into v_agg from agg;
  v_agg := v_agg - v_nuove;   -- le appena create non sono «aggiornate»: il conto resta quello di prima

  v_storico := ceiv_storico_aggiorna(p_data);

  return jsonb_build_object(
    'lista_totale', (select count(*) from ceiv_lista),
    'lista_attive', (select count(*) from ceiv_lista where stato = 'Attiva'),
    'aggiornate_in_anagrafica', v_agg,
    'create_in_anagrafica', v_nuove,
    'storico', v_storico);
end $$;
revoke execute on function public.ceiv_applica(date) from public, anon, authenticated;
grant  execute on function public.ceiv_applica(date) to service_role;

-- ── 5. il cambio fatto a mano da una maschera ───────────────────────────────
/* Solo UPDATE, e solo se lo stato cambia davvero. NIENTE trigger su INSERT:
   `s_cambia_id_impresa` copia la riga con la chiave nuova e POI sposta le
   colonne impresa_id — un periodo aperto all'inserimento farebbe due «attuali»
   per la stessa impresa e il cambio di chiave fallirebbe.
   Un errore qui non deve mai bloccare il salvataggio di un'impresa: diventa un
   warning. ⚠️ Proprio per questo il trigger va PROVATO (lezione del 19/09: un
   `when others` nasconde anche gli errori di programmazione). */
create or replace function public.imprese_cassa_storico_trg()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(current_setting('app.ceiv_applica', true), '') = '1' then return new; end if;
  begin
    if not exists (select 1 from imprese_cassa_storico where impresa_id = new.impresa_id and attuale)
       and nullif(btrim(old.stato_cassa), '') is not null then
      insert into imprese_cassa_storico (impresa_id, cassa, stato, cod_ceiv, visto_dal, visto_fino, attuale, fonte, nota)
      values (new.impresa_id, coalesce(old.cassa_edile, 'C.E.I.V.'), old.stato_cassa, old.cod_ceiv,
              old.data_agg_access, old.data_agg_access, false, 'anagrafica',
              'stato scritto in anagrafica prima della modifica a mano');
    end if;
    update imprese_cassa_storico set attuale = false where impresa_id = new.impresa_id and attuale;
    if nullif(btrim(new.stato_cassa), '') is not null then
      insert into imprese_cassa_storico (impresa_id, cassa, stato, cod_ceiv, visto_dal, visto_fino, fonte, nota)
      values (new.impresa_id, coalesce(new.cassa_edile, 'C.E.I.V.'), new.stato_cassa, new.cod_ceiv,
              current_date, current_date, 'manuale',
              'modificato a mano' || coalesce(' da ' || nullif(auth.jwt() ->> 'email', ''), ''));
    end if;
  exception when others then
    raise warning 'imprese_cassa_storico_trg: % (impresa %)', sqlerrm, new.impresa_id;
  end;
  return new;
end $$;
revoke execute on function public.imprese_cassa_storico_trg() from public, anon, authenticated;
grant  execute on function public.imprese_cassa_storico_trg() to service_role;

drop trigger if exists trg_imprese_cassa_storico on public.imprese;
create trigger trg_imprese_cassa_storico
  after update of stato_cassa on public.imprese
  for each row when (old.stato_cassa is distinct from new.stato_cassa)
  execute function public.imprese_cassa_storico_trg();

-- ── 6. la semina: lo stato di OGGI è il «prima» del prossimo cambio ─────────
do $$
declare v_lista date := (select valore::date from s_config where chiave = 'ceiv_lista_al');
begin
  perform set_config('app.ceiv_applica', '1', true);

  -- sei stati scritti a mano in minuscolo: si uniformano alla tendina
  update imprese set stato_cassa = initcap(stato_cassa)
   where stato_cassa in ('attiva', 'sospesa', 'cessata');

  if exists (select 1 from imprese_cassa_storico) then return; end if;

  insert into imprese_cassa_storico (impresa_id, stato, cod_ceiv, visto_dal, visto_fino, fonte, nota)
  select impresa_id, stato, codice, v_lista, v_lista, 'lista',
         'semina: prima lista di cui lo storico tiene traccia'
    from ceiv_aggancio();

  insert into imprese_cassa_storico (impresa_id, cassa, stato, cod_ceiv, visto_dal, visto_fino, fonte, nota)
  select i.impresa_id, coalesce(i.cassa_edile, 'C.E.I.V.'), i.stato_cassa, i.cod_ceiv,
         i.data_agg_access, i.data_agg_access, 'anagrafica',
         'semina: stato scritto in anagrafica, impresa assente dalla lista del ' || to_char(v_lista, 'DD/MM/YYYY')
    from imprese i
   where nullif(btrim(i.stato_cassa), '') is not null
     and not exists (select 1 from imprese_cassa_storico s where s.impresa_id = i.impresa_id);
end $$;
