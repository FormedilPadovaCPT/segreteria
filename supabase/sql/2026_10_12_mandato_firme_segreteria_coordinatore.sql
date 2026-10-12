-- 2026-10-12 — Mandato di pagamento: firme della Segreteria e del Coordinatore
--
-- Chiesto dall'utente sul mandato n° 12: nel riquadro firme, una sopra
-- l'altra, «Visto e approvato — La Segreteria» con la firma della segreteria
-- e «Il Coordinatore» con la firma del coordinatore; a destra «Per ricevuta
-- Amministrazione» resta bianco (lo riempie la presa visione di Patrizia).
--
-- Le firme stanno su Drive in _SISTEMA/firme/ come quelle del Direttore e
-- del Presidente, lette dall'app con leggiByte(). NON dal bucket
-- «firme-tecnici»: quello lo legge solo il personale (is_personale), e
-- l'Amministrazione non lo è — il PDF col visto, che si rigenera dal suo
-- accesso, avrebbe perso le due firme.

insert into public.s_config (chiave, valore, descrizione, updated_by) values
  ('segreteria_firma_id', '18GNQRcEVZo3u_x3xAk841KtxKii7vpqs',
   'Firma della segreteria (Renato Squizzato) per il «Visto e approvato» del mandato di pagamento: id Drive di _SISTEMA/firme/firma_segreteria_Squizzato-Renato.jpg', 'assistente, per cptpd@did.formedilpadova.it'),
  ('segreteria_firma_nome', 'Renato Squizzato',
   'Nome stampato sotto la firma della segreteria nel mandato di pagamento', 'assistente, per cptpd@did.formedilpadova.it'),
  ('coordinatore_firma_id', '1bgqNbIxl4Ce0li5UrZAYCDc9eqMCGGDl',
   'Firma del coordinatore (Arch. Nicola De Marco) per il mandato di pagamento: id Drive di _SISTEMA/firme/firma_coordinatore_De-Marco-Nicola.png', 'assistente, per cptpd@did.formedilpadova.it')
on conflict (chiave) do update set valore = excluded.valore, descrizione = excluded.descrizione,
  updated_at = now(), updated_by = excluded.updated_by;

-- L'Amministrazione legge anche le quattro voci che servono al mandato
-- (due id Drive e due nomi), e nient'altro della configurazione.
drop policy if exists s_config_sel on public.s_config;
create policy s_config_sel on public.s_config for select using (
  is_segreteria()
  or (is_direttore() and chiave = any (array['direttore_email','direttore_nome','direttore_firma_id']))
  or (is_amministrazione() and chiave = any (array['amministrazione_email','amministrazione_nome','amministrazione_firma_id',
                                                   'segreteria_firma_id','segreteria_firma_nome','coordinatore_firma_id','coordinatore_nome']))
  or ((select auth.uid()) is not null and chiave = any (array['didattica_referenti','stage_relazione_cc','stage_relazione_cartella']))
);
