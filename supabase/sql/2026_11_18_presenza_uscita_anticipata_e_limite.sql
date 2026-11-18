-- ════════════════════════════════════════════════════════════════════════
-- Firma di presenza: uscita anticipata e «niente limite di invii» (18/11/2026)
-- Dall'utente, dopo la prova del corso 336:
-- 1. chi ha già firmato l'entrata e va via prima di metà turno deve poter
--    firmare l'uscita: il telefono chiede «Stai uscendo in anticipo?». Qui il
--    server: una firma che per l'ora sarebbe un'entrata, da chi ha già
--    un'entrata valida di quel turno da più di 10 minuti, diventa USCITA
--    segnata fuori orario («uscita anticipata»), da guardare. Entro 10 minuti
--    resta un doppione (doppio tocco all'arrivo) e il trigger la respinge.
-- 2. una spunta nel corso toglie il limite di invii all'ora del portale per le
--    sue firme (molte persone sulla stessa rete): s_corsi.pres_senza_limite,
--    pubblicata come senza_limite e letta da portale-ricevi.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare d text; a text := 'v_dec := public.pres_decidi(g.data, g.dalle, g.alle, g.dalle2, g.alle2, now());';
begin
  d := pg_get_functiondef('public.pres_registra'::regproc);
  if position('uscita anticipata' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'pres_registra: punto di innesto non trovato'; end if;
  d := replace(d, a, a || '
  /* (18/11/2026) uscita anticipata: chi ha già l''entrata di questo turno da più
     di 10 minuti e firma di nuovo sta andando via prima di metà turno */
  if v_dec ->> ''tipo'' = ''entrata'' and exists (
       select 1 from public.s_corsi_firme_presenza f
        where f.iscritto_id = i.id and f.giornata_id = g.id and f.tipo = ''entrata''
          and f.turno is not distinct from (v_dec ->> ''turno'')::smallint
          and f.stato in (''ricevuta'', ''confermata'')
          and f.ora_server < now() - interval ''10 minutes'') then
    v_dec := jsonb_build_object(''tipo'', ''uscita'', ''turno'', (v_dec ->> ''turno'')::int,
      ''ora_turno'', to_char(case when v_dec ->> ''turno'' = ''2'' then g.alle2 else g.alle end, ''HH24:MI''),
      ''fuori_orario'', true, ''motivo'', ''uscita anticipata'');
  end if;');
  execute d;
end $$;

alter table public.s_corsi add column if not exists pres_senza_limite boolean not null default false;
comment on column public.s_corsi.pres_senza_limite is
  'Firme dal QR: il portale non applica il limite di invii all''ora (stessa rete). Spunta nella sezione firme del corso (18/11/2026).';

do $$
declare d text; a text := '''persone'',   v_pers);';
begin
  d := pg_get_functiondef('public.pres_pubblicazione'::regproc);
  if position('senza_limite' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'pres_pubblicazione: punto di innesto non trovato'; end if;
  d := replace(d, a, '''persone'',   v_pers,
    ''senza_limite'', coalesce((select c.pres_senza_limite from public.s_corsi c where c.id = r.id), false));');
  execute d;
end $$;
