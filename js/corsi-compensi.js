/* ============================================================
   COMPENSI DEGLI INCARICHI DI DOCENZA — le poche regole che
   decidono un numero, tenute fuori dalla maschera perché siano
   provabili.

   ⚠️ La tariffa NON è € 65 per tutti. In s_tariffe la docenza da
   contratto vale € 50/h e la conferenza di cantiere € 50/h; i
   € 65 di s_config.docenza_tariffa_default valgono per i
   PROGETTI FINANZIATI, dove la tariffa cambia da progetto a
   progetto e si scrive sull'incarico (regola del 17/09/2026 nel
   CLAUDE.md). Fino al 19/09/2026 la proposta scriveva 65 a
   chiunque: sulle conferenze di cantiere era il doppio di quel
   che l'ente paga davvero.

   ⚠️ Il COMPENSO FORFETTARIO non ha una colonna sua: è la riga
   con il corrispettivo ma senza ore o senza tariffa oraria —
   il caso dell'ospite pagato a intervento.
   ============================================================ */

/** Riga a forfait: c'è il compenso ma non il conto ore × tariffa. */
export const forfait = (k) => k && k.corrispettivo != null && (k.ore == null || k.tariffa_oraria == null);

/** Corrispettivo da ore × tariffa; null se manca uno dei due (il forfait si scrive a mano). */
export function calcolaCorrispettivo(ore, tariffa) {
  if (ore == null || ore === '' || tariffa == null || tariffa === '') return null;
  const o = Number(ore); const t = Number(tariffa);
  if (!Number.isFinite(o) || !Number.isFinite(t)) return null;
  return Math.round(o * t * 100) / 100;
}

/* stessa scelta di public.s_tariffa: vale la riga valida a quella
   data, con precedenza a quella intestata al tecnico */
export function tariffaDaTabella(tariffe, codice, data, tecnicoId) {
  const g = data || new Date().toISOString().slice(0, 10);
  const buone = (tariffe || []).filter((t) => t.codice === codice
    && String(t.valido_dal) <= g
    && (!t.valido_al || String(t.valido_al) >= g)
    && (!t.tecnico_id || t.tecnico_id === tecnicoId));
  buone.sort((a, b) => (b.tecnico_id ? 1 : 0) - (a.tecnico_id ? 1 : 0)
    || String(b.valido_dal).localeCompare(String(a.valido_dal)));
  return buone.length ? Number(buone[0].importo) : null;
}

/**
 * Che tariffa oraria proporre, e perché — il «perché» finisce nel
 * toast e nella maschera: chi corregge deve sapere da dove viene
 * il numero che sta correggendo.
 */
export function proponiTariffa({ corso, progetto, tariffe, tariffaContratto, tariffaDefault, data }) {
  const def = Number(tariffaDefault || 65);
  const finanziato = progetto && Number(progetto.finanziamento) > 0;
  if (finanziato) {
    return { importo: def, motivo: `progetto finanziato «${String(progetto.titolo || '').slice(0, 40)}»: tariffa da confermare sul progetto` };
  }
  if (corso && corso.tipo === 'conferenza_cantiere') {
    const t = tariffaDaTabella(tariffe, 'conferenza_ora', data);
    if (t != null) return { importo: t, motivo: 'conferenza di cantiere, tariffa di contratto' };
  }
  if (tariffaContratto != null && Number(tariffaContratto) > 0) {
    return { importo: Number(tariffaContratto), motivo: 'contratto del tecnico' };
  }
  const t = tariffaDaTabella(tariffe, 'docenza_ora', data);
  if (t != null) return { importo: t, motivo: 'docenza, tariffa di contratto' };
  return { importo: def, motivo: 'tariffa predefinita' };
}

const eur = (v) => (v == null ? '—' : `€ ${Number(v).toFixed(2).replace('.', ',')}`);

/**
 * Riga da aggiungere in note quando si corregge una riga la cui
 * lettera è GIÀ USCITA protocollata: il foglio in mano al docente
 * dice un'altra cifra, e la correzione non deve cancellare quel
 * fatto (regola d'oro 7 — il fatto si aggiunge).
 * Restituisce null se non è cambiato niente di economico.
 */
export function variazioneNote(prima, dopo, utente, oggi, protocolloTxt) {
  const campi = [['ore', 'ore', (v) => (v == null ? '—' : String(v))],
    ['tariffa_oraria', 'tariffa', eur], ['corrispettivo', 'corrispettivo', eur]];
  const pezzi = [];
  for (const [col, etichetta, fmt] of campi) {
    const a = prima?.[col] == null ? null : Number(prima[col]);
    const b = dopo?.[col] == null ? null : Number(dopo[col]);
    if (a !== b) pezzi.push(`${etichetta} ${fmt(a)} → ${fmt(b)}`);
  }
  if (!pezzi.length) return null;
  return `${oggi} ${utente}: ${pezzi.join(', ')} dopo la lettera ${protocolloTxt || 'già protocollata'}.`;
}

/**
 * La frase dei compensi nella lettera di incarico. A ore è quella
 * di sempre; a forfait NON si può scrivere «per ogni ora di
 * docenza», che direbbe una cosa che non è stata pattuita.
 */
export function testoCompenso(incarico) {
  const k = incarico || {};
  const nome = k.nominativo || '';
  if (forfait(k)) {
    return `A titolo di compenso e corrispettivo per l'attività svolta, ${nome} riceverà un compenso forfettario di ${eur(k.corrispettivo)} oneri e IVA esclusi${k.ore != null ? ` per n. ${k.ore} ore di attività` : ''}.`;
  }
  const tariffa = k.tariffa_oraria != null ? eur(k.tariffa_oraria) : '€ ______';
  const totale = k.corrispettivo != null
    ? ` (corrispettivo complessivo per ${k.ore ?? '—'} ore: ${eur(k.corrispettivo)})` : '';
  return `A titolo di compenso e corrispettivo per le docenze svolte, il Docente ${nome} riceverà per ogni ora di docenza, teorica o pratica, effettiva, un compenso pari a ${tariffa} oneri e IVA esclusi${totale}.`;
}
