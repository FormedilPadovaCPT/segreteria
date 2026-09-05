// Supabase Edge Function – import-rlst
// Legge QUATTRO schede del foglio Google dei servizi CPT e importa
// le righe nuove:
//  - richieste di affidamento al servizio RLST → s_rlst_pratiche
//  - verbali di elezione dell'RLS aziendale    → s_rls_anagrafe
//    (CCPL 3/3/2022: anagrafe di categoria degli RLS eletti)
//  - segnalazioni di cantiere dall'esterno     → s_segnalazioni
//    (il servizio CPT che richiede l'autorizzazione del Direttore)
//  - richieste di consulenza                   → s_consulenze
//    (scheda riconosciuta per TITOLO, non per gid)
//  - richieste di visita e serie di visite     → s_visite_richieste
//    (scheda «Visita in Cantiere»; la serie arriva dalla stessa
//    scheda, distinta dal campo tipo o dalle note)
//  - notifiche di apertura cantiere            → s_notifiche_cantiere
//    («segnala un cantiere al CPT»: alimenta le visite ordinarie,
//    niente autorizzazione del Direttore)
//  - richieste di conferenza di cantiere       → s_conferenze_cantiere
//    (formazione/informazione ai dipendenti di una singola impresa)
//  - richieste di attestazione DM 132/2024     → s_attestazioni_dm132
//    (consulenza e monitoraggio → crediti aggiuntivi patente)
//
// La fonte dei DATI e' il foglio (gia' strutturato); il PDF di
// riepilogo resta il DOCUMENTO da protocollare. Le righe gia'
// importate non si toccano mai: l'istruttoria vive nel database.
//
// Nessun input viene onorato dalla richiesta: id e schede stanno in
// s_config (rlst_sheet_id, rlst_sheet_gid, rls_sheet_gid,
// segn_sheet_gid). Cosi' la funzione puo' girare dal cron con la
// sola chiave anon senza che nessuno possa farle leggere un foglio
// diverso.
//
// Lettura: prima l'API Sheets; se non attiva sul progetto Google, si
// ripiega sull'esportazione CSV di Drive (stesso token, scope drive).
// Le colonne si riconoscono per NOME (esatto, poi per contenimento).
//
// Pre-istruttoria: aggancio impresa per P.IVA (11 cifre), esito CEIV
// (impresa non censita → da_verificare, mai non_iscritta: l'assenza
// non e' una prova), aggancio persona per CF. Per le segnalazioni:
// proposta del tecnico di zona da tecnici_zone sul comune del
// cantiere — solo se il candidato e' UNO (con due non si sceglie).
//
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON (lo stesso di allegati-protocollo)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

import { getAccessToken } from '../_shared/google.ts'
// (audit 05/09/2026: il token Google viene dal modulo condiviso, non piu' copiato qui)

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
  return righe
}

async function leggiFoglio(token: string, sheetId: string, gid: number):
  Promise<{ righe: string[][]; scheda: string; via: string }> {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } })
  const meta = await metaRes.json()
  if (!meta.error) {
    const scheda = (meta.sheets || []).map((s: { properties: { sheetId: number; title: string } }) => s.properties)
      .find((p: { sheetId: number }) => p.sheetId === gid)
    if (!scheda) throw new Error(`Nessuna scheda con gid ${gid} nel foglio`)
    const valRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(`'${scheda.title}'!A1:AZ100000`)}`,
      { headers: { Authorization: `Bearer ${token}` } })
    const val = await valRes.json()
    if (val.error) throw new Error('Valori non leggibili: ' + JSON.stringify(val.error))
    return { righe: val.values || [], scheda: scheda.title, via: 'sheets-api' }
  }
  const expRes = await fetch(
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (!expRes.ok) {
    throw new Error(`Foglio non leggibile: API Sheets dice "${meta.error?.message || JSON.stringify(meta.error)}", esportazione CSV risponde HTTP ${expRes.status}`)
  }
  return { righe: parseCsv(await expRes.text()), scheda: `gid ${gid}`, via: 'export-csv' }
}

/* Trova il gid di una scheda dal titolo (anche parziale): piu' robusto
   del gid scritto in configurazione, regge se la scheda si sposta. */
async function gidPerTitolo(token: string, sheetId: string, titolo: string): Promise<number> {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } })
  const meta = await metaRes.json()
  if (meta.error) throw new Error('Metadati del foglio non leggibili: ' + JSON.stringify(meta.error))
  const t = titolo.toUpperCase()
  const s = (meta.sheets || []).map((x: { properties: { sheetId: number; title: string } }) => x.properties)
    .find((p: { title: string }) => p.title.toUpperCase().includes(t))
  if (!s) throw new Error(`Nessuna scheda col titolo «${titolo}» nel foglio`)
  return s.sheetId
}

function parseData(s: string): string | null {
  const t = String(s || '').trim()
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}
function parseTimestamp(s: string): string | null {
  const t = String(s || '').trim()
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2})[.:](\d{2})[.:](\d{2})/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:${m[6]}+02:00`
  return parseData(t)
}
function pivaNorm(s: string): string | null {
  const t = String(s || '')
  const m = t.match(/\d{10,11}/)
  if (m) return m[0].padStart(11, '0')
  const cifre = t.replace(/\D/g, '')
  if (cifre.length >= 8 && cifre.length <= 11) return cifre.padStart(11, '0')
  return null
}
/* Le colonne FIGURE JSON / IMPRESE JSON della notifica: un JSON non
   leggibile non blocca l'import della riga, si perde solo l'elenco. */
function jsonSafe(s: string): unknown | null {
  const t = String(s || '').trim()
  if (!t) return null
  try { const v = JSON.parse(t); return Array.isArray(v) && v.length ? v : null } catch { return null }
}

/* accesso ai campi per nome di intestazione: esatto, poi contenimento */
function accessore(testataGrezza: string[]) {
  const testata = testataGrezza.map((h) => String(h || '').trim().toUpperCase())
  const candidate = (nome: string) => {
    const esatte: number[] = []
    const larghe: number[] = []
    testata.forEach((h, i) => {
      if (h === nome) esatte.push(i)
      else if (h.includes(nome)) larghe.push(i)
    })
    return [...esatte, ...larghe]
  }
  const v = (r: string[], nome: string) => {
    for (const i of candidate(nome)) {
      const val = String(r[i] ?? '').trim()
      if (val) return val
    }
    return null
  }
  return { candidate, v }
}

type SB = ReturnType<typeof createClient>

async function agganciImpresaPersona(sb: SB, piva: string | null, cf: string | null) {
  let impresaId: string | null = null
  let esito = 'da_verificare'
  if (piva) {
    const { data: imp } = await sb.from('imprese')
      .select('impresa_id, cod_ceiv, stato_cassa').eq('impresa_id', piva).maybeSingle()
    if (imp) {
      impresaId = imp.impresa_id
      const ceivOk = !!(imp.cod_ceiv && String(imp.cod_ceiv).trim())
      const attiva = /attiv/i.test(imp.stato_cassa || '')
      esito = ceivOk && attiva ? 'iscritta' : 'non_iscritta'
    }
  }
  let personaId: string | null = null
  if (cf && /^[A-Z0-9]{16}$/.test(cf)) {
    const { data: per } = await sb.from('persone').select('persona_id').eq('cf', cf).limit(2)
    if (per && per.length === 1) personaId = per[0].persona_id as string
  }
  return { impresaId, esito, personaId }
}

/* Il comune del modulo puo' portare la parentesi dei quartieri
   («PADOVA - Q3 EST (Brenta - Venezia, ...)»); in tecnici_zone la
   stessa zona e' scritta senza («PADOVA - Q3 Est»). Confronto a
   maiuscole, parentesi tolta. */
function normComune(s: string): string {
  return String(s || '').toUpperCase().replace(/\(.*$/, '').replace(/\s+/g, ' ').trim()
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const SA_JSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
    if (!SA_JSON) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON non configurato')
    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { data: cfg } = await sb.from('s_config').select('chiave, valore')
      .in('chiave', ['rlst_sheet_id', 'rlst_sheet_gid', 'rls_sheet_gid', 'segn_sheet_gid', 'cons_sheet_titolo', 'visita_sheet_titolo', 'serie_sheet_titolo', 'notif_sheet_titolo', 'confcant_sheet_titolo', 'attest_sheet_titolo'])
    const conf = Object.fromEntries((cfg || []).map((r) => [r.chiave, r.valore]))
    const sheetId = conf.rlst_sheet_id
    if (!sheetId) throw new Error('rlst_sheet_id mancante in s_config')
    const token = await getAccessToken(JSON.parse(SA_JSON))

    const esiti: Record<string, unknown> = { ok: true }

    /* i titoli di tutte le schede: guidano il riconoscimento per
       titolo e aiutano a capire al volo che cosa c'e' nel foglio */
    try {
      const metaRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties`,
        { headers: { Authorization: `Bearer ${token}` } })
      const meta = await metaRes.json()
      if (!meta.error) esiti.schede = (meta.sheets || []).map((s: { properties: { title: string } }) => s.properties.title)
    } catch (_e) { /* solo diagnostica */ }

    /* zone dei tecnici: la proposta serve a segnalazioni e visite.
       Vince la zona PIU' SPECIFICA: per i quartieri di Padova le
       righe generiche «PADOVA» non devono battere «PADOVA - Q3 Est»
       (bug trovato il 31/08 sulle prime 4 richieste importate). */
    const { data: zone } = await sb.from('tecnici_zone').select('email, comune_nome')
    const propostaTecnico = (comune: string | null): string | null => {
      const c = normComune(comune || '')
      if (!c) return null
      const match = (zone || []).filter((z) => {
        const zc = normComune(z.comune_nome as string)
        return zc === c || c.startsWith(zc + ' ') || zc.startsWith(c + ' ')
      })
      if (!match.length) return null
      const maxLen = Math.max(...match.map((z) => normComune(z.comune_nome as string).length))
      const migliori = match.filter((z) => normComune(z.comune_nome as string).length === maxLen)
      const email = [...new Set(migliori.map((z) => z.email as string))]
      return email.length === 1 ? email[0] : null   // con due candidati alla pari non si sceglie
    }

    /* ── scheda RLST: richieste di affidamento ── */
    if (conf.rlst_sheet_gid) {
      const { righe, scheda, via } = await leggiFoglio(token, sheetId, Number(conf.rlst_sheet_gid))
      let nuove = 0
      const dettagli: unknown[] = []
      if (righe.length > 1) {
        const { candidate, v } = accessore(righe[0])
        for (const o of ['PROGRESSIVO', 'RAGIONE SOCIALE', 'PARTITA IVA']) {
          if (!candidate(o).length) throw new Error(`Colonna "${o}" non trovata nella scheda ${scheda}`)
        }
        const { data: esistenti } = await sb.from('s_rlst_pratiche').select('progressivo')
        const gia = new Set((esistenti || []).map((r) => r.progressivo))
        for (const r of righe.slice(1)) {
          const prog = Number(v(r, 'PROGRESSIVO'))
          if (!prog || gia.has(prog)) continue
          gia.add(prog)
          const piva = pivaNorm(v(r, 'PARTITA IVA') || '') || pivaNorm(v(r, 'CF IMPRESA') || '')
          const cfGrezzo = (v(r, 'RL CF') || '').toUpperCase()
          const rlCf = /^[A-Z0-9]{16}$/.test(cfGrezzo) ? cfGrezzo : null
          const agg = await agganciImpresaPersona(sb, piva, rlCf)
          const riga = {
            progressivo: prog,
            timestamp_modulo: parseTimestamp(v(r, 'TIMESTAMP') || ''),
            data_comp: parseData(v(r, 'DATA COMP.') || ''),
            ragione_sociale: v(r, 'RAGIONE SOCIALE'),
            codice_ceiv_dich: v(r, 'CODICE CEIV') || v(r, 'CASSA EDILE'),
            partita_iva: piva || v(r, 'PARTITA IVA'),
            cf_impresa: v(r, 'CF IMPRESA'),
            n_lavoratori: Number((v(r, 'N. LAVORATORI') || '').replace(/\D/g, '')) || null,
            ccnl: v(r, 'CCNL'),
            telefono: v(r, 'TELEFONO'),
            cellulare: v(r, 'CELLULARE'),
            email: v(r, 'E-MAIL'),
            ind_sede_legale: v(r, 'IND. SEDE LEGALE') || v(r, 'SEDE LEGALE'),
            comune_legale: v(r, 'COMUNE LEGALE'),
            ind_sede_amm: v(r, 'IND. SEDE AMM.') || v(r, 'SEDE AMMINISTRATIVA'),
            comune_amm: v(r, 'COMUNE AMM.'),
            rl_titolo: v(r, 'RL TITOLO'),
            rl_nome: v(r, 'RL NOME'),
            rl_cognome: v(r, 'RL COGNOME'),
            rl_cf: rlCf,
            rspp_nome: v(r, 'RSPP NOME') || v(r, 'RSPP'),
            rspp_ruolo: v(r, 'RSPP RUOLO'),
            data_verbale: v(r, 'DATA VERBALE'),
            luogo_riunione: v(r, 'LUOGO RIUNIONE'),
            verbale_url: v(r, 'VERBALE URL'),
            note_modulo: v(r, 'NOTE'),
            impresa_id: agg.impresaId,
            persona_id: agg.personaId,
            esito_ceiv: agg.esito,
            ceiv_verificato_il: new Date().toISOString(),
          }
          const { error } = await sb.from('s_rlst_pratiche').insert(riga)
          if (error) throw new Error(`RLST riga ${prog} non inserita: ` + error.message)
          nuove++
          dettagli.push({ progressivo: prog, ragione_sociale: riga.ragione_sociale, esito_ceiv: agg.esito })
        }
      }
      esiti.rlst = { scheda, via, totali: Math.max(0, righe.length - 1), nuove, dettagli }
    }

    /* ── scheda RLS: verbali di elezione dell'RLS aziendale ── */
    if (conf.rls_sheet_gid) {
      const { righe, scheda, via } = await leggiFoglio(token, sheetId, Number(conf.rls_sheet_gid))
      let nuove = 0
      const dettagli: unknown[] = []
      if (righe.length > 1) {
        const { candidate, v } = accessore(righe[0])
        for (const o of ['PROGRESSIVO', 'RAGIONE SOCIALE']) {
          if (!candidate(o).length) throw new Error(`Colonna "${o}" non trovata nella scheda ${scheda}`)
        }
        const { data: esistenti } = await sb.from('s_rls_anagrafe').select('progressivo').not('progressivo', 'is', null)
        const gia = new Set((esistenti || []).map((r) => r.progressivo))
        for (const r of righe.slice(1)) {
          const prog = Number(v(r, 'PROGRESSIVO'))
          if (!prog || gia.has(prog)) continue
          gia.add(prog)
          const piva = pivaNorm(v(r, 'PARTITA IVA') || '') || pivaNorm(v(r, 'CF IMPRESA') || '')
          const rlsCfGrezzo = (v(r, 'RLS CF') || '').toUpperCase()
          const rlsCf = /^[A-Z0-9]{16}$/.test(rlsCfGrezzo) ? rlsCfGrezzo : null
          const agg = await agganciImpresaPersona(sb, piva, rlsCf)
          const riga = {
            fonte: 'modulo',
            progressivo: prog,
            timestamp_modulo: parseTimestamp(v(r, 'TIMESTAMP') || ''),
            ragione_sociale: v(r, 'RAGIONE SOCIALE'),
            codice_ceiv_dich: v(r, 'CODICE CEIV'),
            partita_iva: piva || v(r, 'PARTITA IVA'),
            cf_impresa: v(r, 'CF IMPRESA'),
            ind_sede: v(r, 'IND. SEDE'),
            telefono: v(r, 'TELEFONO'),
            email: v(r, 'E-MAIL'),
            lr_titolo: v(r, 'LR TITOLO'),
            lr_nome: v(r, 'LR NOME'),
            lr_cognome: v(r, 'LR COGNOME'),
            lr_cf: v(r, 'LR CF'),
            tipo_elezione: v(r, 'ELEZIONE'),
            data_verbale: v(r, 'DATA VERBALE'),
            protocollo_verbale: v(r, 'PROTOCOLLO'),
            verbale_url: v(r, 'VERBALE URL'),
            rls_titolo: v(r, 'RLS TITOLO'),
            rls_nome: v(r, 'RLS NOME'),
            rls_cognome: v(r, 'RLS COGNOME'),
            rls_cf: rlsCf,
            nato_a: v(r, 'NATO A'),
            nato_il: v(r, 'NATO IL'),
            residenza: v(r, 'RESIDENZA'),
            comune_res: v(r, 'COMUNE RES.'),
            rls_tel: v(r, 'RLS TEL'),
            rls_email: v(r, 'RLS EMAIL'),
            indeterminato: v(r, 'INDETERMINATO'),
            lul: v(r, 'LUL'),
            ceiv_operaio: v(r, 'CEIV OPERAIO'),
            altra_ce: v(r, 'ALTRA CE'),
            mansione: v(r, 'MANSIONE'),
            data_assunzione: v(r, 'DATA ASSUNZIONE'),
            livello_ccnl: v(r, 'LIVELLO CCNL'),
            ente_corso: v(r, 'ENTE CORSO'),
            op_provincia: v(r, 'OP PROVINCIA'),
            formazione_url: v(r, 'FORMAZIONE URL'),
            decorrenza: parseData(v(r, 'DATA VERBALE') || ''),
            impresa_id: agg.impresaId,
            persona_id: agg.personaId,
          }
          const { error } = await sb.from('s_rls_anagrafe').insert(riga)
          if (error) throw new Error(`RLS riga ${prog} non inserita: ` + error.message)
          nuove++
          dettagli.push({ progressivo: prog, ragione_sociale: riga.ragione_sociale, rls: [riga.rls_cognome, riga.rls_nome].filter(Boolean).join(' ') })
        }
      }
      esiti.rls = { scheda, via, totali: Math.max(0, righe.length - 1), nuove, dettagli }
    }

    /* ── scheda SEGNALAZIONI: cantieri segnalati dall'esterno ── */
    if (conf.segn_sheet_gid) {
      const { righe, scheda, via } = await leggiFoglio(token, sheetId, Number(conf.segn_sheet_gid))
      let nuove = 0
      const dettagli: unknown[] = []
      if (righe.length > 1) {
        const { candidate, v } = accessore(righe[0])
        for (const o of ['PROGRESSIVO', 'NOTIFICANTE', 'MOTIVO']) {
          if (!candidate(o).length) throw new Error(`Colonna "${o}" non trovata nella scheda ${scheda}`)
        }
        const { data: esistenti } = await sb.from('s_segnalazioni').select('progressivo').not('progressivo', 'is', null)
        const gia = new Set((esistenti || []).map((r) => r.progressivo))

        for (const r of righe.slice(1)) {
          const prog = Number(v(r, 'PROGRESSIVO'))
          if (!prog || gia.has(prog)) continue
          gia.add(prog)
          const comune = v(r, 'COMUNE CANTIERE')
          const riga = {
            fonte: 'modulo',
            progressivo: prog,
            timestamp_modulo: parseTimestamp(v(r, 'TIMESTAMP') || ''),
            notificante: v(r, 'NOTIFICANTE'),
            telefono: v(r, 'TELEFONO'),
            email: v(r, 'E-MAIL'),
            ind_cantiere: v(r, 'IND. CANTIERE'),
            comune_cantiere: comune,
            motivo: v(r, 'MOTIVO'),
            stato_lavori: v(r, 'STATO LAVORI'),
            imprese_presenti: v(r, 'IMPRESE PRESENTI'),
            note_modulo: v(r, 'NOTE'),
            foto_urls: v(r, 'FOTO'),
            privacy: v(r, 'PRIVACY'),
            tecnico_proposto: propostaTecnico(comune),
          }
          const { error } = await sb.from('s_segnalazioni').insert(riga)
          if (error) throw new Error(`Segnalazione riga ${prog} non inserita: ` + error.message)
          nuove++
          dettagli.push({ progressivo: prog, notificante: riga.notificante, comune: riga.comune_cantiere, tecnico_proposto: riga.tecnico_proposto })
        }
      }
      esiti.segnalazioni = { scheda, via, totali: Math.max(0, righe.length - 1), nuove, dettagli }
    }

    /* ── scheda CONSULENZE: richieste di consulenza dalle imprese ── */
    if (conf.cons_sheet_titolo) {
      const gid = await gidPerTitolo(token, sheetId, conf.cons_sheet_titolo)
      const { righe, scheda, via } = await leggiFoglio(token, sheetId, gid)
      let nuove = 0
      const dettagli: unknown[] = []
      if (righe.length > 1) {
        const { candidate, v } = accessore(righe[0])
        for (const o of ['PROGRESSIVO', 'RAGIONE SOCIALE']) {
          if (!candidate(o).length) throw new Error(`Colonna "${o}" non trovata nella scheda ${scheda}`)
        }
        const { data: esistenti } = await sb.from('s_consulenze').select('progressivo').not('progressivo', 'is', null)
        const gia = new Set((esistenti || []).map((r) => r.progressivo))
        for (const r of righe.slice(1)) {
          const prog = Number(v(r, 'PROGRESSIVO'))
          if (!prog || gia.has(prog)) continue
          gia.add(prog)
          const piva = pivaNorm(v(r, 'PARTITA IVA') || '') || pivaNorm(v(r, 'CF IMPRESA') || '')
          const cfGrezzo = (v(r, 'RL CF') || '').toUpperCase()
          const rlCf = /^[A-Z0-9]{16}$/.test(cfGrezzo) ? cfGrezzo : null
          const agg = await agganciImpresaPersona(sb, piva, rlCf)
          const riga = {
            fonte: 'modulo',
            progressivo: prog,
            timestamp_modulo: parseTimestamp(v(r, 'TIMESTAMP') || ''),
            ragione_sociale: v(r, 'RAGIONE SOCIALE'),
            codice_ceiv_dich: v(r, 'CODICE CEIV'),
            partita_iva: piva || v(r, 'PARTITA IVA'),
            cf_impresa: v(r, 'CF IMPRESA'),
            rl_titolo: v(r, 'RL TITOLO'),
            rl_nome: v(r, 'RL NOME'),
            rl_cognome: v(r, 'RL COGNOME'),
            rl_cf: rlCf,
            cellulare: v(r, 'CELLULARE'),
            email: v(r, 'E-MAIL'),
            rspp_ruolo: v(r, 'RSPP RUOLO'),
            tipi_consulenza: v(r, 'TIPI CONSULENZA'),
            note_modulo: v(r, 'NOTE'),
            quesito: v(r, 'NOTE'),
            privacy: v(r, 'PRIVACY'),
            impresa_id: agg.impresaId,
            persona_id: agg.personaId,
            esito_ceiv: agg.esito,
            ceiv_verificato_il: new Date().toISOString(),
          }
          const { error } = await sb.from('s_consulenze').insert(riga)
          if (error) throw new Error(`Consulenza riga ${prog} non inserita: ` + error.message)
          nuove++
          dettagli.push({ progressivo: prog, ragione_sociale: riga.ragione_sociale, esito_ceiv: agg.esito })
        }
      }
      esiti.consulenze = { scheda, via, totali: Math.max(0, righe.length - 1), nuove, dettagli }
    }

    /* ── schede VISITE: visita singola e serie di visite ──
       Confluiscono nella stessa tabella s_visite_richieste, con
       tab_origine visita|serie. Ogni blocco e' protetto: una scheda
       che manca non ferma le altre. */
    const importaVisite = async (titolo: string, origine: 'visita' | 'serie') => {
      const gid = await gidPerTitolo(token, sheetId, titolo)
      const { righe, scheda, via } = await leggiFoglio(token, sheetId, gid)
      let nuove = 0
      const dettagli: unknown[] = []
      if (righe.length > 1) {
        const { candidate, v } = accessore(righe[0])
        for (const o of ['PROGRESSIVO', 'RAGIONE SOCIALE']) {
          if (!candidate(o).length) throw new Error(`Colonna "${o}" non trovata nella scheda ${scheda}`)
        }
        const { data: esistenti } = await sb.from('s_visite_richieste')
          .select('progressivo').eq('tab_origine', origine).not('progressivo', 'is', null)
        const gia = new Set((esistenti || []).map((r) => r.progressivo))
        for (const r of righe.slice(1)) {
          const prog = Number(v(r, 'PROGRESSIVO'))
          if (!prog || gia.has(prog)) continue
          gia.add(prog)
          const piva = pivaNorm(v(r, 'PARTITA IVA') || '') || pivaNorm(v(r, 'CF IMPRESA') || '')
          const cfGrezzo = (v(r, 'RL CF') || '').toUpperCase()
          const rlCf = /^[A-Z0-9]{16}$/.test(cfGrezzo) ? cfGrezzo : null
          const agg = await agganciImpresaPersona(sb, piva, rlCf)

          /* i cantieri: uno solo nella visita, fino a 4 nella serie */
          const cantieri: Record<string, string | null>[] = []
          if (origine === 'serie') {
            for (const n of ['C1', 'C2', 'C3', 'C4']) {
              const c = {
                indirizzo: v(r, `${n} INDIRIZZO`),
                comune: v(r, `${n} COMUNE`),
                importo: v(r, `${n} IMPORTO`),
                committente: v(r, `${n} COMMITTENTE`),
                durata: v(r, `${n} DURATA`),
                qualita: v(r, `${n} QUALITÀ`),
              }
              if (Object.values(c).some(Boolean)) cantieri.push(c)
            }
          } else {
            const c = { indirizzo: v(r, 'IND. CANTIERE'), comune: v(r, 'COMUNE CANTIERE') }
            if (c.indirizzo || c.comune) cantieri.push(c)
          }
          const primoComune = cantieri[0]?.comune || null

          const riga = {
            fonte: 'modulo',
            tab_origine: origine,
            tipo_richiesta: origine,
            progressivo: prog,
            timestamp_modulo: parseTimestamp(v(r, 'TIMESTAMP') || ''),
            ragione_sociale: v(r, 'RAGIONE SOCIALE'),
            codice_ceiv_dich: v(r, 'CODICE CEIV') || v(r, 'CASSA EDILE'),
            partita_iva: piva || v(r, 'PARTITA IVA'),
            cf_impresa: v(r, 'CF IMPRESA'),
            ind_legale: v(r, 'IND. LEGALE') || v(r, 'INDIRIZZO'),
            ind_amm: v(r, 'IND. AMM.'),
            telefono: v(r, 'TELEFONO'),
            cellulare: v(r, 'CELLULARE'),
            email: v(r, 'E-MAIL'),
            rl_titolo: v(r, 'RL TITOLO'),
            rl_nome: v(r, 'RL NOME'),
            rl_cognome: v(r, 'RL COGNOME'),
            rl_cf: rlCf,
            rspp_ruolo: v(r, 'RSPP RUOLO'),
            tipo_visita: v(r, 'TIPO VISITA') || v(r, 'TIPO RICHIESTA'),
            cantieri: cantieri.length ? cantieri : null,
            ref_titolo: v(r, 'REF TITOLO'),
            ref_nome: v(r, 'REF. NOME'),
            ref_cognome: v(r, 'REF. COGNOME'),
            ref_tel: v(r, 'REF. TEL') || v(r, 'REF. CELL'),
            decl_contributi: v(r, 'DECL. CONTRIBUTI'),
            decl_sicurezza: v(r, 'DECL. SICUREZZA'),
            decl_obblighi: v(r, 'DECL. OBBLIGHI'),
            note_modulo: v(r, 'NOTE'),
            privacy: v(r, 'PRIVACY'),
            impresa_id: agg.impresaId,
            persona_id: agg.personaId,
            esito_ceiv: agg.esito,
            ceiv_verificato_il: new Date().toISOString(),
            tecnico_proposto: propostaTecnico(primoComune),
          }
          const { error } = await sb.from('s_visite_richieste').insert(riga)
          if (error) throw new Error(`Visita (${origine}) riga ${prog} non inserita: ` + error.message)
          nuove++
          dettagli.push({ progressivo: prog, ragione_sociale: riga.ragione_sociale, cantieri: cantieri.length, esito_ceiv: agg.esito, tecnico_proposto: riga.tecnico_proposto })
        }
      }
      return { scheda, via, totali: Math.max(0, righe.length - 1), nuove, dettagli }
    }
    if (conf.visita_sheet_titolo) {
      try { esiti.visite = await importaVisite(conf.visita_sheet_titolo, 'visita') }
      catch (e) { esiti.visite = { error: (e as Error).message } }
    }
    if (conf.serie_sheet_titolo) {
      try { esiti.serie = await importaVisite(conf.serie_sheet_titolo, 'serie') }
      catch (e) { esiti.serie = { error: (e as Error).message } }
    }

    /* ── scheda NOTIFICA CANTIERE: «segnala un cantiere al CPT» ──
       Chi comunica l'apertura di un cantiere: dati cantiere,
       committente, responsabile dei lavori. Aggancio anagrafica
       tentato sulla P.IVA del committente; tecnico di zona proposto
       dal comune del cantiere. */
    if (conf.notif_sheet_titolo) {
      try {
        const gid = await gidPerTitolo(token, sheetId, conf.notif_sheet_titolo)
        const { righe, scheda, via } = await leggiFoglio(token, sheetId, gid)
        let nuove = 0
        const dettagli: unknown[] = []
        if (righe.length > 1) {
          const { candidate, v } = accessore(righe[0])
          for (const o of ['PROGRESSIVO', 'COMUNE CANTIERE']) {
            if (!candidate(o).length) throw new Error(`Colonna "${o}" non trovata nella scheda ${scheda}`)
          }
          const { data: esistenti } = await sb.from('s_notifiche_cantiere').select('progressivo').not('progressivo', 'is', null)
          const gia = new Set((esistenti || []).map((r) => r.progressivo))
          for (const r of righe.slice(1)) {
            const prog = Number(v(r, 'PROGRESSIVO'))
            if (!prog || gia.has(prog)) continue
            gia.add(prog)
            const comune = v(r, 'COMUNE CANTIERE')
            const piva = pivaNorm(v(r, 'COMM. PIVA') || '')
            const agg = await agganciImpresaPersona(sb, piva, null)
            const riga = {
              fonte: 'modulo',
              progressivo: prog,
              timestamp_modulo: parseTimestamp(v(r, 'TIMESTAMP') || ''),
              data_com: parseData(v(r, 'DATA COM.') || ''),
              ragione_sociale: v(r, 'RAGIONE SOC.'),
              seg_titolo: v(r, 'TITOLO'),
              seg_cognome: v(r, 'COGNOME'),
              seg_nome: v(r, 'NOME'),
              seg_cf: v(r, 'CF'),
              email: v(r, 'E-MAIL'),
              telefono: v(r, 'TELEFONO'),
              ind_cantiere: v(r, 'IND. CANTIERE'),
              comune_cantiere: comune,
              data_inizio: parseData(v(r, 'DATA INIZIO') || ''),
              data_fine: parseData(v(r, 'DATA FINE') || ''),
              importo: v(r, 'IMPORTO'),
              durata_gg: v(r, 'DURATA GG'),
              max_lavoratori: v(r, 'MAX LAV.'),
              n_imprese: v(r, 'N. IMPRESE'),
              n_autonomi: v(r, 'N. AUTONOMI'),
              note_cantiere: v(r, 'NOTE CANTIERE'),
              comm_tipo: v(r, 'COMM. TIPO'),
              comm_ragione_sociale: v(r, 'COMM. RAG. SOC.'),
              comm_piva: piva || v(r, 'COMM. PIVA'),
              comm_cf: v(r, 'COMM. CF'),
              comm_indirizzo: v(r, 'COMM. IND.'),
              comm_tel: v(r, 'COMM. TEL'),
              comm_email: v(r, 'COMM. EMAIL'),
              comm_titolo: v(r, 'COMM. TITOLO'),
              comm_cognome: v(r, 'COMM. COGNOME'),
              comm_nome: v(r, 'COMM. NOME'),
              comm_cf2: v(r, 'COMM. CF2'),
              comm_ind2: v(r, 'COMM. IND2'),
              comm_com2: v(r, 'COMM. COM2'),
              comm_tel2: v(r, 'COMM. TEL2'),
              rl_titolo: v(r, 'RL TITOLO'),
              rl_nome: v(r, 'RL NOME'),
              rl_cognome: v(r, 'RL COGNOME'),
              rl_cf: v(r, 'RL CF'),
              rl_indirizzo: v(r, 'RL IND.'),
              rl_comune: v(r, 'RL COMUNE'),
              rl_note: v(r, 'RL NOTE'),
              figure: jsonSafe(v(r, 'FIGURE JSON')),
              imprese: jsonSafe(v(r, 'IMPRESE JSON')),
              privacy: v(r, 'PRIVACY'),
              impresa_id: agg.impresaId,
              esito_ceiv: agg.esito,
              ceiv_verificato_il: new Date().toISOString(),
              tecnico_proposto: propostaTecnico(comune),
            }
            const { error } = await sb.from('s_notifiche_cantiere').insert(riga)
            if (error) throw new Error(`Notifica riga ${prog} non inserita: ` + error.message)
            nuove++
            dettagli.push({ progressivo: prog, comune: riga.comune_cantiere, committente: riga.comm_ragione_sociale || [riga.comm_cognome, riga.comm_nome].filter(Boolean).join(' '), tecnico_proposto: riga.tecnico_proposto })
          }
        }
        esiti.notifiche = { scheda, via, totali: Math.max(0, righe.length - 1), nuove, dettagli }
      } catch (e) { esiti.notifiche = { error: (e as Error).message } }
    }

    /* ── scheda CONFERENZA DI CANTIERE: formazione/informazione in
       cantiere ai dipendenti di una singola impresa ── */
    if (conf.confcant_sheet_titolo) {
      try {
        const gid = await gidPerTitolo(token, sheetId, conf.confcant_sheet_titolo)
        const { righe, scheda, via } = await leggiFoglio(token, sheetId, gid)
        let nuove = 0
        const dettagli: unknown[] = []
        if (righe.length > 1) {
          const { candidate, v } = accessore(righe[0])
          for (const o of ['PROGRESSIVO', 'RAGIONE SOCIALE']) {
            if (!candidate(o).length) throw new Error(`Colonna "${o}" non trovata nella scheda ${scheda}`)
          }
          const { data: esistenti } = await sb.from('s_conferenze_cantiere').select('progressivo').not('progressivo', 'is', null)
          const gia = new Set((esistenti || []).map((r) => r.progressivo))
          for (const r of righe.slice(1)) {
            const prog = Number(v(r, 'PROGRESSIVO'))
            if (!prog || gia.has(prog)) continue
            gia.add(prog)
            const piva = pivaNorm(v(r, 'PARTITA IVA') || '') || pivaNorm(v(r, 'CF IMPRESA') || '')
            const cfGrezzo = (v(r, 'RL CF') || '').toUpperCase()
            const rlCf = /^[A-Z0-9]{16}$/.test(cfGrezzo) ? cfGrezzo : null
            const agg = await agganciImpresaPersona(sb, piva, rlCf)
            const comune = v(r, 'COMUNE CANTIERE')
            const riga = {
              fonte: 'modulo',
              progressivo: prog,
              timestamp_modulo: parseTimestamp(v(r, 'TIMESTAMP') || ''),
              ragione_sociale: v(r, 'RAGIONE SOCIALE'),
              codice_ceiv_dich: v(r, 'CODICE CEIV'),
              partita_iva: piva || v(r, 'PARTITA IVA'),
              cf_impresa: v(r, 'CF IMPRESA'),
              ind_legale: v(r, 'IND. LEGALE'),
              ind_amm: v(r, 'IND. AMM.'),
              telefono: v(r, 'TELEFONO'),
              cellulare: v(r, 'CELLULARE'),
              email: v(r, 'E-MAIL'),
              rl_titolo: v(r, 'RL TITOLO'),
              rl_nome: v(r, 'RL NOME'),
              rl_cognome: v(r, 'RL COGNOME'),
              rl_cf: rlCf,
              rspp_ruolo: v(r, 'RSPP RUOLO'),
              tipo_richiesta: v(r, 'TIPO RICHIESTA'),
              ind_cantiere: v(r, 'IND. CANTIERE'),
              comune_cantiere: comune,
              ref_titolo: v(r, 'REF TITOLO'),
              ref_nome: v(r, 'REF. NOME'),
              ref_cognome: v(r, 'REF. COGNOME'),
              ref_tel: v(r, 'REF. CELL') || v(r, 'REF. TEL'),
              note_modulo: v(r, 'NOTE'),
              privacy: v(r, 'PRIVACY'),
              impresa_id: agg.impresaId,
              persona_id: agg.personaId,
              esito_ceiv: agg.esito,
              ceiv_verificato_il: new Date().toISOString(),
              tecnico_proposto: propostaTecnico(comune),
            }
            const { error } = await sb.from('s_conferenze_cantiere').insert(riga)
            if (error) throw new Error(`Conferenza riga ${prog} non inserita: ` + error.message)
            nuove++
            dettagli.push({ progressivo: prog, ragione_sociale: riga.ragione_sociale, comune: riga.comune_cantiere, esito_ceiv: agg.esito, tecnico_proposto: riga.tecnico_proposto })
          }
        }
        esiti.conferenze = { scheda, via, totali: Math.max(0, righe.length - 1), nuove, dettagli }
      } catch (e) { esiti.conferenze = { error: (e as Error).message } }
    }

    /* ── scheda ATTESTAZIONE DM 132/2024: consulenza e monitoraggio
       per i crediti aggiuntivi della patente (circ. 69/2025) ── */
    if (conf.attest_sheet_titolo) {
      try {
        const gid = await gidPerTitolo(token, sheetId, conf.attest_sheet_titolo)
        const { righe, scheda, via } = await leggiFoglio(token, sheetId, gid)
        let nuove = 0
        const dettagli: unknown[] = []
        if (righe.length > 1) {
          const { candidate, v } = accessore(righe[0])
          for (const o of ['PROGRESSIVO', 'RAGIONE SOCIALE']) {
            if (!candidate(o).length) throw new Error(`Colonna "${o}" non trovata nella scheda ${scheda}`)
          }
          const { data: esistenti } = await sb.from('s_attestazioni_dm132').select('progressivo').not('progressivo', 'is', null)
          const gia = new Set((esistenti || []).map((r) => r.progressivo))
          for (const r of righe.slice(1)) {
            const prog = Number(v(r, 'PROGRESSIVO'))
            if (!prog || gia.has(prog)) continue
            gia.add(prog)
            const piva = pivaNorm(v(r, 'PARTITA IVA') || '') || pivaNorm(v(r, 'CF IMPRESA') || '')
            const cfGrezzo = (v(r, 'RL CF') || '').toUpperCase()
            const rlCf = /^[A-Z0-9]{16}$/.test(cfGrezzo) ? cfGrezzo : null
            const agg = await agganciImpresaPersona(sb, piva, rlCf)
            const cantieri: Record<string, string | null>[] = []
            for (const n of ['C1', 'C2', 'C3', 'C4']) {
              const c = {
                indirizzo: v(r, `${n} INDIRIZZO`),
                comune: v(r, `${n} COMUNE`),
                importo: v(r, `${n} IMPORTO`),
                committente: v(r, `${n} COMMITTENTE`),
                durata: v(r, `${n} DURATA`),
                qualita: v(r, `${n} QUALITÀ`),
              }
              if (Object.values(c).some(Boolean)) cantieri.push(c)
            }
            const primoComune = cantieri[0]?.comune || null
            const riga = {
              fonte: 'modulo',
              progressivo: prog,
              timestamp_modulo: parseTimestamp(v(r, 'TIMESTAMP') || ''),
              ragione_sociale: v(r, 'RAGIONE SOCIALE'),
              codice_ceiv_dich: v(r, 'CODICE CEIV'),
              cassa_edile_prov: v(r, 'CASSA EDILE PROV.') || v(r, 'CASSA EDILE'),
              partita_iva: piva || v(r, 'PARTITA IVA'),
              cf_impresa: v(r, 'CF IMPRESA'),
              indirizzo: v(r, 'INDIRIZZO'),
              comune: v(r, 'COMUNE'),
              telefono: v(r, 'TELEFONO'),
              email: v(r, 'E-MAIL'),
              rl_titolo: v(r, 'RL TITOLO'),
              rl_nome: v(r, 'RL NOME'),
              rl_cognome: v(r, 'RL COGNOME'),
              rl_cf: rlCf,
              cantieri: cantieri.length ? cantieri : null,
              decl_contributi: v(r, 'DECL. CONTRIBUTI'),
              decl_sicurezza: v(r, 'DECL. SICUREZZA'),
              decl_obblighi: v(r, 'DECL. OBBLIGHI'),
              privacy: v(r, 'PRIVACY'),
              impresa_id: agg.impresaId,
              persona_id: agg.personaId,
              esito_ceiv: agg.esito,
              ceiv_verificato_il: new Date().toISOString(),
              tecnico_proposto: propostaTecnico(primoComune),
            }
            const { error } = await sb.from('s_attestazioni_dm132').insert(riga)
            if (error) throw new Error(`Attestazione riga ${prog} non inserita: ` + error.message)
            nuove++
            dettagli.push({ progressivo: prog, ragione_sociale: riga.ragione_sociale, cantieri: cantieri.length, esito_ceiv: agg.esito, tecnico_proposto: riga.tecnico_proposto })
          }
        }
        esiti.attestazioni = { scheda, via, totali: Math.max(0, righe.length - 1), nuove, dettagli }
      } catch (e) { esiti.attestazioni = { error: (e as Error).message } }
    }

    return new Response(JSON.stringify(esiti),
      { headers: { 'Content-Type': 'application/json', ...CORS } })
  } catch (e) {
    console.error('import-rlst:', e)
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }
})
