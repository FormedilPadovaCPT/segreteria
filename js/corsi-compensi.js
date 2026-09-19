/* ============================================================
   COMPENSI DEGLI INCARICHI DI DOCENZA — le poche regole che
   decidono un numero, tenute fuori dalla maschera perché siano
   provabili.

   ⚠️ La tariffa di contratto è € 50/h — docenza e conferenza di
   cantiere — e vale anche per la formazione interna ai tecnici
   (precisato dall'utente il 19/09/2026: «in contratto per docenze
   ai tecnici viene riconosciuto 50, i 65 erano solo casi
   particolari di progetti passati»; i contratti saranno rifatti
   tutti, come chiesto dal Direttore). Fino a quel giorno la
   proposta scriveva € 65 a chiunque, cioè il valore di certi
   progetti passati applicato come se fosse la regola.

   ⚠️ Nei PROGETTI FINANZIATI la tariffa la decide il progetto:
   in archivio ci sono 52, 60, 65, 90 e 100 €/h. Non esiste «la
   tariffa dei progetti», quindi non se ne propone una: si propone
   quella di contratto e si dichiara che lì va confermata.

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
  const finanziato = progetto && Number(progetto.finanziamento) > 0;
  const codice = corso && corso.tipo === 'conferenza_cantiere' ? 'conferenza_ora' : 'docenza_ora';
  const base = (tariffaContratto != null && Number(tariffaContratto) > 0)
    ? { importo: Number(tariffaContratto), motivo: 'contratto del tecnico' }
    : (() => {
      const t = tariffaDaTabella(tariffe, codice, data);
      if (t != null) {
        return { importo: t, motivo: codice === 'conferenza_ora' ? 'conferenza di cantiere, tariffa di contratto' : 'docenza, tariffa di contratto' };
      }
      return { importo: Number(tariffaDefault || 50), motivo: 'tariffa predefinita' };
    })();
  /* ⚠️ Nei progetti finanziati la tariffa può essere un'altra — nello storico
     ci sono 52, 60, 65, 90, 100 € — ma NON esiste «la tariffa dei progetti»:
     è decisa progetto per progetto. Quindi si propone quella di contratto e
     si dichiara che va confermata, invece di scrivere un numero inventato
     (precisato dall'utente il 19/09/2026: da contratto la docenza ai tecnici
     vale 50 €/h, i 65 erano casi particolari di progetti passati). */
  if (finanziato) {
    return {
      importo: base.importo,
      motivo: `${base.motivo}; progetto finanziato «${String(progetto.titolo || '').slice(0, 40)}»: se lì la tariffa è un'altra, va corretta a mano`,
    };
  }
  return base;
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
