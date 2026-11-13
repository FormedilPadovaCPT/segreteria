-- 13/11/2026 — APPLICATA lo stesso giorno (migrazione protocollo_audit_soli_campi_cambiati_2026_11_13).
-- Il registro delle modifiche del protocollo annota SOLO I CAMPI CAMBIATI.
--
-- Prima ogni UPDATE salvava la riga intera due volte (prima e dopo), compreso il testo
-- completo della mail nel campo note: 2,2 KB a modifica, con in media 1,2 campi cambiati e
-- 17 modifiche per protocollo. Era la voce che faceva crescere il database (6 MB in sei
-- settimane). Ora un UPDATE scrive in «prima» e «dopo» i soli campi diversi (circa 0,3 KB),
-- e niente se non è cambiato nulla oltre a updated_at. INSERT e DELETE restano interi.
--
-- Non si perde niente: valore di prima e valore di dopo ci sono, per ogni campo cambiato;
-- la riga intera si ricostruisce dall'INSERT (o dalla riga viva) e dalle modifiche.
-- Le righe scritte fino a oggi NON si toccano: restano intere. Nessuna app legge il registro.
-- Provata prima in transazione annullata: un campo cambiato → una riga col solo campo;
-- nessun cambio → nessuna riga; un campo portato a NULL → chiave presente con valore null.
-- Rieseguibile.
create or replace function public.s_protocollo_audit_trg() returns trigger
language plpgsql security definer set search_path to 'public' as $f$
declare v_prima jsonb; v_dopo jsonb;
begin
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(o.key, o.value), jsonb_object_agg(n.key, n.value)
      into v_prima, v_dopo
      from jsonb_each(to_jsonb(old)) o
      join jsonb_each(to_jsonb(new)) n on n.key = o.key
     where n.value is distinct from o.value and o.key <> 'updated_at';
    if v_dopo is null then return new; end if;
    insert into public.s_protocollo_audit(protocollo_id, azione, utente, prima, dopo)
    values (new.id, tg_op, coalesce(auth.jwt() ->> 'email', current_user), v_prima, v_dopo);
    return new;
  end if;
  insert into public.s_protocollo_audit(protocollo_id, azione, utente, prima, dopo)
  values (coalesce(new.id, old.id), tg_op, coalesce(auth.jwt() ->> 'email', current_user),
          case when tg_op = 'DELETE' then to_jsonb(old) end,
          case when tg_op = 'INSERT' then to_jsonb(new) end);
  return coalesce(new, old);
end $f$;
comment on table public.s_protocollo_audit is
  'Registro delle modifiche del protocollo. INSERT e DELETE: riga intera. UPDATE: fino al 13/11/2026 riga intera in «prima» e «dopo»; dal 13/11/2026 i SOLI CAMPI CAMBIATI (valore di prima e valore di dopo), e nessuna riga se cambia solo updated_at.';
