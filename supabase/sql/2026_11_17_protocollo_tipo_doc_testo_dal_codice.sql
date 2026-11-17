-- 17/11/2026 — Il tipo di documento del protocollo si vede sempre.
--
-- Il caso: l'utente nota che molti protocolli non hanno il tipo di documento.
-- Ce l'avevano, ma solo come codice (tipo_doc_id): l'app mostra il testo
-- (tipo_doc_txt, in elenco, dettaglio e ordinamento di js/protocollo.js), e
-- chi crea il protocollo con s_crea_protocollo dal database passava solo il
-- codice. Nell'esercizio 26-27 erano 18 protocolli, riempiti a mano dal catalogo
-- lo stesso giorno.
--
-- Il trigger riempie il testo dal catalogo s_tipo_doc per qualunque strada
-- di inserimento (maschera, funzioni, SQL). Regole:
--   - testo vuoto e codice presente: il testo è la descrizione del catalogo;
--   - testo scritto a mano: resta com'è (ci sono testi storici diversi dal
--     catalogo, per esempio 16 «Comunicazione», e testi senza codice come
--     «Lettera di affiancamento»);
--   - si cambia il codice senza toccare il testo: se il testo era quello del
--     vecchio codice segue il nuovo, altrimenti resta.
--
-- Già applicato in produzione come migrazione `protocollo_tipo_doc_testo_dal_codice`.
-- Questo file è la documentazione. Prova: tests-db/52_protocollo_tipo_testo.sql.

create or replace function public.s_protocollo_tipo_txt_trg()
returns trigger language plpgsql set search_path = public as $$
declare
  v_nuovo text;
  v_vecchio text;
begin
  if new.tipo_doc_id is null then
    return new;
  end if;
  select descrizione into v_nuovo from public.s_tipo_doc where id_doc = new.tipo_doc_id;
  if v_nuovo is null then
    return new;
  end if;
  if nullif(trim(new.tipo_doc_txt), '') is null then
    /* il testo manca: lo prende dal catalogo */
    new.tipo_doc_txt := v_nuovo;
  elsif tg_op = 'UPDATE' and new.tipo_doc_id is distinct from old.tipo_doc_id
        and new.tipo_doc_txt is not distinct from old.tipo_doc_txt then
    /* cambia il codice ma non il testo: se il testo era quello del vecchio codice, segue il nuovo */
    select descrizione into v_vecchio from public.s_tipo_doc where id_doc = old.tipo_doc_id;
    if old.tipo_doc_txt is not distinct from v_vecchio then
      new.tipo_doc_txt := v_nuovo;
    end if;
  end if;
  return new;
end $$;

comment on function public.s_protocollo_tipo_txt_trg() is
  '17/11/2026: l''app mostra il tipo di documento dal testo (tipo_doc_txt). Chi crea un protocollo col solo tipo_doc_id (SQL, funzioni) lasciava la colonna vuota. Il testo scritto a mano resta com''è.';

drop trigger if exists s_protocollo_tipo_txt on public.s_protocollo;
create trigger s_protocollo_tipo_txt
  before insert or update of tipo_doc_id, tipo_doc_txt on public.s_protocollo
  for each row execute function public.s_protocollo_tipo_txt_trg();
