// posta-locale — il ponte fra il database e il PC con Outlook aperto (25/09/2026)
//
// L'app segreteria gira nel browser e non può toccare Outlook. Il controllo
// della posta di cpt@formedilpadova.it lo fa il PC dell'ufficio: lo script
// _SISTEMA/scripts/outlook/bozze_outlook.ps1, acceso accanto a Outlook, chiama
// questa funzione ogni 20 secondi. Il tasto «📬 Controlla posta» dell'app scrive
// una riga in s_posta_giri; il PC la prende, lancia Claude sul vault e riporta
// qui l'esito e le proposte di protocollo.
// ⚠️ 25/09/2026: NON IN USO. L'avvio automatico di Claude sulla posta in arrivo
// (dal tasto o da un task programmato) è stato bloccato dai permessi della
// sessione; la decisione su se e come autorizzarlo è dell'utente.
//
// Azioni (POST JSON, intestazione X-Posta-Token):
//   prendi  {pc}          battito del PC; crea il giro delle 8/13/17 se è l'ora;
//                         prende la richiesta più vecchia in coda
//   battito {pc, id}      il lavoro è ancora in corso
//   chiudi  {pc, id, esito}  esito del giro, proposte di protocollo
//
// La chiave: in s_config.posta_locale_token_hash c'è un array JSON di
// {pc, hash} con lo SHA-256 della chiave di ogni PC. La chiave vera sta solo
// sul PC (%LOCALAPPDATA%\FormedilBozzeOutlook). verify_jwt = false di
// proposito: lo script non ha un utente, ha la chiave.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'

const risposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

async function sha256(testo: string) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(testo))
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// ora di Roma: i giri seguono l'orario d'ufficio, non UTC
function oraRoma(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d).map((x) => [x.type, x.value]))
  return { data: `${p.year}-${p.month}-${p.day}`, ora: Number(p.hour), minuti: Number(p.minute), giorno: p.weekday }
}
const ORE_GIRI = [8, 13, 17]
const FERIALI = ['lun', 'mar', 'mer', 'gio', 'ven']

Deno.serve(async (req) => {
  if (req.method !== 'POST') return risposta({ error: 'solo POST' }, 405)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let corpo: any
  try { corpo = await req.json() } catch { return risposta({ error: 'corpo non leggibile' }, 400) }
  const pc = String(corpo?.pc || '').slice(0, 60)

  // chiave del PC
  const chiave = (req.headers.get('x-posta-token') || '').trim()
  if (!chiave) return risposta({ error: 'chiave mancante' }, 401)
  const { data: cfg, error: eCfg } = await admin.from('s_config').select('valore').eq('chiave', 'posta_locale_token_hash').maybeSingle()
  if (eCfg) return risposta({ error: 'configurazione non leggibile: ' + eCfg.message }, 500)
  let chiavi: { pc: string; hash: string }[] = []
  try { chiavi = JSON.parse(cfg?.valore || '[]') } catch { chiavi = [] }
  const h = await sha256(chiave)
  const mia = chiavi.find((k) => k.hash === h)
  if (!mia) return risposta({ error: 'chiave non riconosciuta' }, 401)
  const nomePc = pc || mia.pc

  const adesso = new Date()
  const iso = adesso.toISOString()

  if (corpo.azione === 'prendi') {
    // battito del PC: l'app sa se c'è un PC con Outlook aperto pronto a lavorare
    const { data: bt } = await admin.from('s_config').select('valore').eq('chiave', 'posta_pc_battito').maybeSingle()
    // pronto = Outlook aperto e Claude da terminale collegato; se no si dice perché e non si prende niente
    const pronto = corpo.pronto !== false
    let battiti: Record<string, unknown> = {}
    try { battiti = JSON.parse(bt?.valore || '{}') } catch { battiti = {} }
    battiti[nomePc] = { at: iso, pronto, motivo: pronto ? null : String(corpo.motivo || 'non pronto').slice(0, 200) }
    await admin.from('s_config').upsert({ chiave: 'posta_pc_battito', valore: JSON.stringify(battiti), descrizione: 'Ultimo segnale di ogni PC con Outlook aperto e lo script bozze_outlook.ps1 acceso (posta-locale)' })

    // pulizia: un lavoro senza battito da 10 minuti è morto; una richiesta mai presa in 30 minuti è scaduta
    await admin.from('s_posta_giri').update({ stato: 'errore', finita_at: iso, errore: 'Il PC che lo stava facendo ha smesso di rispondere (nessun segnale da 10 minuti).' })
      .eq('stato', 'in_corso').lt('battito_at', new Date(adesso.getTime() - 10 * 60000).toISOString())
    await admin.from('s_posta_giri').update({ stato: 'scaduto', finita_at: iso, errore: 'Nessun PC con Outlook aperto l\'ha presa entro 30 minuti.' })
      .eq('stato', 'in_coda').lt('richiesta_at', new Date(adesso.getTime() - 30 * 60000).toISOString())

    // il giro programmato: feriali alle 8, 13 e 17 (entro il primo quarto d'ora)
    const r = oraRoma(adesso)
    if (FERIALI.includes(String(r.giorno).toLowerCase().slice(0, 3)) && ORE_GIRI.includes(r.ora) && r.minuti < 15) {
      const slot = `${r.data} ${String(r.ora).padStart(2, '0')}`
      // conflitto su slot (l'altro PC l'ha già creato) o su «uno alla volta»: va bene così
      await admin.from('s_posta_giri').insert({ origine: 'giro', slot, richiesta_da: 'giro programmato' })
    }

    if (!pronto) return risposta({ giro: null })
    const { data: coda } = await admin.from('s_posta_giri').select('id').eq('stato', 'in_coda').order('id').limit(1)
    if (!coda?.length) return risposta({ giro: null })
    const { data: preso } = await admin.from('s_posta_giri')
      .update({ stato: 'in_corso', presa_at: iso, presa_da_pc: nomePc, battito_at: iso })
      .eq('id', coda[0].id).eq('stato', 'in_coda').select().maybeSingle()
    if (!preso) return risposta({ giro: null })   // l'ha preso l'altro PC

    // il contesto per chi processa: protocolli degli ultimi 60 giorni e proposte già aperte
    const dal = new Date(adesso.getTime() - 60 * 86400000).toISOString().slice(0, 10)
    const [{ data: prot }, { data: prop }] = await Promise.all([
      admin.from('s_protocollo').select('codice, direzione, data_prot, oggetto, impresa_nome, persona, tipo_doc_txt, cartella')
        .gte('data_prot', dal).or('annullato.is.null,annullato.eq.false').order('data_prot', { ascending: false }).limit(800),
      admin.from('s_posta_proposte').select('message_id, stato, oggetto').limit(2000),
    ])
    return risposta({ giro: preso, protocolli: prot || [], proposte: prop || [] })
  }

  const id = Number(corpo.id)
  if (!id) return risposta({ error: 'id mancante' }, 400)

  if (corpo.azione === 'battito') {
    const { error } = await admin.from('s_posta_giri').update({ battito_at: iso }).eq('id', id).eq('stato', 'in_corso')
    return error ? risposta({ error: error.message }, 500) : risposta({ ok: true })
  }

  if (corpo.azione === 'chiudi') {
    const e = corpo.esito || {}
    const n = (x: unknown) => (Number.isFinite(Number(x)) ? Number(x) : null)
    const proposte = Array.isArray(e.proposte_protocollo) ? e.proposte_protocollo : []
    let nProposte = 0
    if (proposte.length) {
      const righe = proposte.filter((p: any) => p?.message_id).map((p: any) => ({
        giro_id: id,
        message_id: String(p.message_id).slice(0, 500),
        ricevuta_at: p.ricevuta_at || null,
        mittente: p.mittente || null,
        oggetto: p.oggetto || null,
        impresa_nome: p.impresa_nome || null,
        tipo_doc_proposto: p.tipo_doc_proposto || null,
        oggetto_proposto: p.oggetto_proposto || null,
        sintesi: p.sintesi || null,
        allegati: Array.isArray(p.allegati) ? p.allegati : [],
      }))
      const { data: ins, error: eIns } = await admin.from('s_posta_proposte').upsert(righe, { onConflict: 'message_id', ignoreDuplicates: true }).select('id')
      if (eIns) return risposta({ error: 'proposte non scritte: ' + eIns.message }, 500)
      nProposte = ins?.length || 0
    }
    const { error } = await admin.from('s_posta_giri').update({
      stato: corpo.errore ? 'errore' : 'fatto',
      finita_at: iso,
      errore: corpo.errore ? String(corpo.errore).slice(0, 2000) : null,
      n_arrivate: n(e.n_arrivate), n_inviate: n(e.n_inviate), n_lavoro: n(e.n_lavoro),
      n_allegati: n(e.n_allegati), n_da_decidere: n(e.n_da_decidere), n_proposte: nProposte,
      riepilogo: e.riepilogo ? String(e.riepilogo).slice(0, 4000) : null,
      esito: e,
    }).eq('id', id)
    return error ? risposta({ error: error.message }, 500) : risposta({ ok: true, proposte: nProposte })
  }

  return risposta({ error: 'azione sconosciuta' }, 400)
})
