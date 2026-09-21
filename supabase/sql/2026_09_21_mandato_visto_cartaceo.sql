-- ═══════════════════════════════════════════════════════════════════════
--  IL VISTO DELL'AMMINISTRAZIONE ARRIVATO SU CARTA (21/09/2026)
--
--  Chiesto dall'utente: «nel mandato 1 puoi impostare che l'Amministrazione
--  lo ha visto cartaceo». Il mandato n° 1 (07/09/2026, quattro fatture,
--  9.481,68 €) è stato firmato e pagato prima che Patrizia entrasse
--  nell'app: il visto c'è, ma su carta, e nel database mancava.
--
--  È la stessa doppia strada già in uso per le autorizzazioni del
--  Direttore (segnalazioni, consulenze, ferie): o si fa dall'app, o si
--  fa il giro di carta e lo si REGISTRA dicendo che è stato di carta.
--  `visto_fonte` è il campo che tiene la differenza: senza, una firma
--  su carta si confonderebbe con una presa visione fatta nell'app.
--
--  ⚠️ Per un visto su carta NON si genera il PDF col visto digitale:
--  il documento firmato è il foglio, e stamparne un secondo con un
--  visto che nessuno ha messo nell'app direbbe una cosa non vera.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.s_mandati_pagamento
  add column if not exists visto_fonte text;

alter table public.s_mandati_pagamento drop constraint if exists s_mandati_visto_fonte_chk;
alter table public.s_mandati_pagamento add constraint s_mandati_visto_fonte_chk
  check (visto_fonte is null or visto_fonte in ('app', 'carta'));

comment on column public.s_mandati_pagamento.visto_fonte is
  'Da dove viene la presa visione: «app» (l''Amministrazione l''ha messa dal suo accesso) o «carta» (mandato firmato a mano, registrato dalla segreteria). Vuoto sulle righe anteriori al 21/09/2026.';

/* le prese visione già registrate vengono tutte dall'app: è l'unico modo
   che c'era di metterle (il pulsante è del 16/09/2026) */
update public.s_mandati_pagamento
   set visto_fonte = 'app'
 where visto_il is not null and visto_fonte is null;

create or replace function public.s_mandato_visto_cartaceo(
  p_id bigint, p_nome text, p_data date default null)
returns public.s_mandati_pagamento
language plpgsql security definer set search_path = public as $$
declare v_m public.s_mandati_pagamento; v_nome text := btrim(coalesce(p_nome, ''));
begin
  if not public.is_segreteria() then
    raise exception 'Il visto su carta lo registra la segreteria';
  end if;
  if v_nome = '' then
    raise exception 'Scrivi chi ha firmato il mandato: senza un nome il visto non dice niente';
  end if;
  if coalesce(p_data, current_date) > current_date then
    raise exception 'La data del visto non può essere nel futuro';
  end if;

  select * into v_m from public.s_mandati_pagamento where id = p_id for update;
  if v_m.id is null then raise exception 'Mandato % non trovato', p_id; end if;
  if v_m.visto_il is not null then
    raise exception 'Il mandato % ha già la presa visione del %', p_id, to_char(v_m.visto_il, 'DD/MM/YYYY');
  end if;

  update public.s_mandati_pagamento
     set visto_il = coalesce(p_data, current_date)::timestamptz,
         visto_da = coalesce(auth.jwt() ->> 'email', current_user),
         visto_nome = left(v_nome, 120),
         visto_fonte = 'carta'
   where id = p_id
  returning * into v_m;
  return v_m;
end $$;

comment on function public.s_mandato_visto_cartaceo(bigint, text, date) is
  'Registra la presa visione arrivata SU CARTA: chi ha firmato, quando, e che è stata di carta. La mette la segreteria; quella dall''app resta s_mandato_presa_visione, che solo l''Amministrazione può chiamare.';

revoke execute on function public.s_mandato_visto_cartaceo(bigint, text, date) from public, anon;
grant execute on function public.s_mandato_visto_cartaceo(bigint, text, date) to authenticated, service_role;
