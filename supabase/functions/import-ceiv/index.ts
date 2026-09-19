// Supabase Edge Function – import-ceiv
// Riceve l'export mensile della CEIV come CSV nel corpo della
// richiesta (POST text/csv, ~3 MB per 23.000 imprese), sostituisce
// in blocco la tabella ceiv_lista e applica la lista all'anagrafica
// imprese (cod_ceiv, stato_cassa, data della lista). Dal 19/09/2026
// `ceiv_applica` tiene anche lo STORICO degli stati.
//
// Il file NON passa da nessuna chat e da nessun foglio: parte dal
// disco dell'ufficio con curl. La data della lista arriva
// nell'intestazione X-Data-Lista (aaaa-mm-gg).
//
// ⚠️ PAROLA D'ORDINE (19/09/2026). Fino a oggi questa funzione non
// controllava CHI la chiama: `verify_jwt` chiede solo un JWT valido, e
// la chiave anon dell'app e' pubblica. Chiunque poteva sostituire la
// lista e riscrivere lo stato in Cassa di 16.000 imprese. Era sfuggita
// ai controlli del 14/09 e del 18/09 perche' il suo codice stava SOLO
// su Supabase, non nel repo: si cercava dove c'era da cercare.
// Ora serve l'intestazione X-Import-Token = s_config.ceiv_import_token,
// che si crea prima del caricamento e si CANCELLA subito dopo (stesso
// disegno di riconcilia_token). Senza token, o con la chiave vuota, la
// funzione non tocca niente.
//
// ⚠️ LA LISTA MONCA SI FERMA PRIMA DI CANCELLARE. La lista si
// sostituisce in blocco (delete + insert, non in una transazione): se
// il CSV e' troncato, dopo la pulizia non si torna indietro. Per questo
// il confronto con la lista in vigore si fa PRIMA: meno del 70% delle
// righe di prima -> si rifiuta, e la lista vecchia resta dov'e'.
//
// Colonne attese nel CSV (intestazioni della CEIV): ImpresaIscritta,
// Stato, CodiceFiscale, PartitaIVA, RagioneSociale, CodiceImpresa,
// Indirizzo, CAP, Comune, Provincia, DescrizioneContratto, Telefono,
// IndirizzoEmail. Riconosciute per nome, l'ordine non conta.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-data-lista, x-import-token',
}

const risposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

function parseCsv(testo: string): string[][] {
  const righe: string[][] = []
  let riga: string[] = []
  let campo = ''
  let dentro = false
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i]
    if (dentro) {
      if (c === '"') {
        if (testo[i + 1] === '"') { campo += '"'; i++ } else dentro = false
      } else campo += c
    } else if (c === '"') {
      dentro = true
    } else if (c === ',') {
      riga.push(campo); campo = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && testo[i + 1] === '\n') i++
      riga.push(campo); campo = ''
      righe.push(riga); riga = []
    } else campo += c
  }
  if (campo !== '' || riga.length) { riga.push(campo); righe.push(riga) }
  return righe.filter((r) => r.some((x) => x !== ''))
}

/* CF: 11 cifre con zeri se numerico, alfanumerico maiuscolo se e' un
   codice di persona fisica. P.IVA: sempre 11 cifre. */
const normCf = (s: string) => {
  const t = String(s || '').trim().toUpperCase()
  if (!t) return null
  return /^\d+$/.test(t) ? t.padStart(11, '0') : t
}
const normPiva = (s: string) => {
  const t = String(s || '').trim()
  return /^\d{1,11}$/.test(t) ? t.padStart(11, '0') : null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    /* la parola d'ordine, prima di ogni altra cosa */
    const { data: cfg, error: eCfg } = await sb.from('s_config').select('valore').eq('chiave', 'ceiv_import_token').maybeSingle()
    const atteso = String(cfg?.valore || '').trim()
    const dato = (req.headers.get('x-import-token') || '').trim()
    if (eCfg || atteso.length < 16 || dato !== atteso) {
      return risposta({ error: 'Il caricamento della lista CEIV è chiuso o la parola d\'ordine non è valida' }, 401)
    }

    const dataLista = (req.headers.get('x-data-lista') || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dataLista)) throw new Error('Intestazione X-Data-Lista mancante o non aaaa-mm-gg')
    const testo = await req.text()
    if (testo.length < 100) throw new Error('Corpo vuoto: manda il CSV della lista CEIV')

    const righe = parseCsv(testo)
    const testata = righe[0].map((h) => h.trim())
    const idx = (nome: string) => testata.indexOf(nome)
    for (const o of ['CodiceFiscale', 'RagioneSociale', 'CodiceImpresa']) {
      if (idx(o) < 0) throw new Error(`Colonna "${o}" non trovata nel CSV`)
    }
    const v = (r: string[], nome: string) => {
      const i = idx(nome)
      return i >= 0 ? String(r[i] ?? '').trim() || null : null
    }

    const record = righe.slice(1).map((r) => ({
      codice: v(r, 'CodiceImpresa'),
      iscritta: v(r, 'ImpresaIscritta'),
      stato: v(r, 'Stato'),
      cf: normCf(v(r, 'CodiceFiscale') || ''),
      piva: normPiva(v(r, 'PartitaIVA') || ''),
      ragione_sociale: v(r, 'RagioneSociale'),
      indirizzo: v(r, 'Indirizzo'),
      cap: v(r, 'CAP'),
      comune: v(r, 'Comune'),
      prov: v(r, 'Provincia'),
      contratto: v(r, 'DescrizioneContratto'),
      telefono: v(r, 'Telefono'),
      email: v(r, 'IndirizzoEmail'),
      aggiornata_il: dataLista,
    })).filter((x) => x.cf || x.piva)

    /* lista monca: ci si ferma PRIMA di cancellare quella in vigore */
    const { count: prima, error: eCnt } = await sb.from('ceiv_lista').select('codice', { count: 'exact', head: true })
    if (eCnt) throw new Error('Non riesco a contare la lista in vigore: ' + eCnt.message)
    if ((prima || 0) > 0 && record.length < 0.7 * (prima || 0)) {
      throw new Error(`Lista troppo corta: ${record.length} imprese contro le ${prima} della lista in vigore. Non ho toccato niente: controlla il file.`)
    }
    const codici = new Set<string>()
    for (const x of record) {
      if (!x.codice) throw new Error('Una riga non ha il CodiceImpresa: non ho toccato niente.')
      if (codici.has(x.codice)) throw new Error(`CodiceImpresa ripetuto nel file (${x.codice}): non ho toccato niente.`)
      codici.add(x.codice)
    }

    /* la lista si sostituisce in blocco */
    const { error: eDel } = await sb.from('ceiv_lista').delete().gte('aggiornata_il', '1900-01-01')
    if (eDel) throw new Error('Pulizia lista non riuscita: ' + eDel.message)

    for (let i = 0; i < record.length; i += 1000) {
      const { error } = await sb.from('ceiv_lista').insert(record.slice(i, i + 1000))
      if (error) throw new Error(`Inserimento (riga ~${i}) non riuscito: ` + error.message)
    }

    /* l'applicazione all'anagrafica (e allo storico) la fa il database in un colpo solo */
    const { data: esito, error: eApp } = await sb.rpc('ceiv_applica', { p_data: dataLista })
    if (eApp) throw new Error('Applicazione non riuscita: ' + eApp.message)

    /* la data della lista resta anche in configurazione */
    await sb.from('s_config').upsert({
      chiave: 'ceiv_lista_al', valore: dataLista,
      descrizione: 'Data dell\'ultimo aggiornamento della lista CEIV (import-ceiv)',
    }, { onConflict: 'chiave' })

    return risposta({ ok: true, data_lista: dataLista, caricate: record.length, ...esito })
  } catch (e) {
    console.error('import-ceiv:', e)
    return risposta({ error: (e as Error).message }, 400)
  }
})
