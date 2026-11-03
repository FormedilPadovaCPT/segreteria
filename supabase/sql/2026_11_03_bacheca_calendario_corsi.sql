-- 03/11/2026 (chiesto dall'utente): nel cruscotto l'agenda mostra solo cptpd@ e «Direzione», i corsi stanno in un
-- riquadro loro («🎓 Calendario corsi»). Il calendario corsi resta fra i bacheca_calendari, perché il giro lo legga;
-- home.js lo separa da questa chiave. Il calendario «Convegni» è stato eliminato dall'utente e non si legge più.
update public.s_config set valore = 'primary,c_cf9b7b4f739cc42753f6207d36431da4dc7521c948e2e0135aa96f85e6ce5080@group.calendar.google.com,c_vv6fllsnnvgb9s7tgpttn9bjt8@group.calendar.google.com'
 where chiave = 'bacheca_calendari';
insert into public.s_config (chiave, valore, descrizione)
values ('bacheca_calendario_corsi', 'c_vv6fllsnnvgb9s7tgpttn9bjt8@group.calendar.google.com',
  'Calendario Google i cui eventi il cruscotto della segreteria mostra nel riquadro «Calendario corsi» invece che nell''agenda. Deve stare anche in bacheca_calendari.')
on conflict (chiave) do update set valore = excluded.valore, descrizione = excluded.descrizione;
