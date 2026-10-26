-- 26/10/2026 — I RINGRAZIAMENTI ARRIVATI PER MAIL DIVENTANO GRADIMENTO DELLA VISITA
-- Chiesto dall'utente: «se arriva un ringraziamento clicco io dal pulsante della mail ricevuta come fossi
-- l'impresa e compilo il questionario al loro posto per aver traccia. Vorrei che si facesse da solo, ma non
-- voglio mandare nessuna risposta a chi invia: ci pensa il tecnico visto che gli giri la mail».
-- La edge function risposte-verbali, quando la risposta al verbale è un ringraziamento, scrive una riga in
-- s_questionari_sopralluogo con fonte = 'mail', il testo di chi ha scritto e NESSUN VOTO (non l'ha dato
-- nessuno). submission_id = 'mail:<id Gmail>' la rende unica. Qui: il legame dal registro delle risposte.
alter table public.s_mail_risposte_verbali add column if not exists questionario_id bigint
  references public.s_questionari_sopralluogo(id) on delete set null;
comment on column public.s_mail_risposte_verbali.questionario_id is
  'Se la risposta è un ringraziamento, la riga di gradimento che il giro ha scritto in s_questionari_sopralluogo (fonte mail). Dal 26/10/2026.';
comment on column public.s_questionari_sopralluogo.fonte is
  'modulo = questionario compilato nel portale; mail = ringraziamento arrivato per mail a cptpd@did e registrato dal giro risposte-verbali (dal 26/10/2026): ha solo il testo, mai un voto.';
