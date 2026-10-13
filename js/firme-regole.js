/* La CATENA delle firme ridotta a una riga (13/10/2026). Modulo puro: niente
   DOM, niente database — lo usa js/firme.js e lo provano i test.

   Un documento a più firme ha in `s_firme` una riga per firmatario, con
   `ordine`. Qui si risponde: a che punto è? chi deve firmare adesso? qual è
   il PDF che conta (quello dell'ULTIMA firma, e solo a catena completa)? */

export function riassuntoCatena(righe) {
  const cat = [...(righe || [])].sort((a, b) => (a.ordine || 1) - (b.ordine || 1));
  if (!cat.length) return null;
  const ultima = cat[cat.length - 1];
  const firmate = cat.filter((r) => r.stato === 'firmata').length;
  const rimandata = cat.find((r) => r.stato === 'rimandata');
  const inAttesa = cat.find((r) => r.stato === 'in_attesa');
  const stato = rimandata ? 'rimandata'
    : cat.every((r) => r.stato === 'firmata') ? 'firmata'
    : cat.every((r) => r.stato === 'ritirata') ? 'ritirata'
    : 'in_attesa';
  const base = stato === 'firmata' ? ultima : (rimandata || inAttesa || ultima);
  return {
    ...base, stato, catena: cat, firmate, totale: cat.length,
    prossimo: inAttesa ? { email: inAttesa.firmatario_email, ruolo: inAttesa.firmatario_ruolo } : null,
    file_firmato: stato === 'firmata' ? ultima.file_firmato : null,
    firmata_il: stato === 'firmata' ? ultima.firmata_il : null,
    usata_il: ultima.usata_il, autografo_il: ultima.autografo_il, id: ultima.id,
  };
}
