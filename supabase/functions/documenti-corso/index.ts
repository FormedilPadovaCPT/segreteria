// Supabase Edge Function – documenti-corso
// I DOCUMENTI DEL FASCICOLO CORSO, GENERATI IN UN POSTO SOLO (13/10/2026,
// lotto 2 del fascicolo corso digitale).
//
// Perché una funzione e non corsi-doc.js della segreteria: la scheda
// formativa la compila il responsabile del progetto formativo (RPF) nel
// GESTIONALE, che è un'app a script classici senza pdf-lib; la segreteria la
// manda in firma dalla SUA app. Lo stesso PDF deve uscire da tutte e due, e
// l'impronta che il registro delle firme ricontrolla dev'essere quella di
// un documento generato una volta sola. Quindi il generatore sta qui, con
// la stessa carta «ciclo» di attestati e registro (banda arancione, logo in
// alto a destra, griglie a filetti) rifatta in Deno con pdf-lib.
//
//   { azione: 'scheda_formativa', id }  → la scheda formativa (versione) di
//        una tipologia: PDF in base64, il nome del file a convenzione e i
//        RIQUADRI delle firme (coordinate PDF) per `firma-documenti`.
//        Chi può: personale dell'ente, oppure il docente a cui la scheda
//        è delegata (è la RLS della tabella, letta col token di chi chiama).
//   (lotto 3) 'progetto_formativo', 'verbale_verifica'.
//
// Niente viene scritto: la funzione legge e disegna. A salvare (bucket
// delle firme, Drive) sono le app.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { PDFDocument, rgb, StandardFonts, PDFFont, PDFPage, PDFImage } from 'https://esm.sh/pdf-lib@1.17.1'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...CORS } })

const LOGO_URL = 'https://formedilpadovacpt.github.io/segreteria/img/logo-pdf.jpg'
const ENTE = {
  nome: 'FORMEDIL PADOVA', sotto: 'Scuola Costruzioni Giuseppe Jappelli', area: 'Area Sicurezza e Salute',
  indirizzo: 'Via Basilicata 10 - 35127 Padova (PD)', tel: '049 761168', email: 'cpt@formedilpadova.it', web: 'www.formedilpadova.it',
}
const A4: [number, number] = [595.28, 841.89]
const SX = 70, DX = 545, W = DX - SX, BASSO = 64

/* ── i caratteri che Helvetica (WinAnsi) sa scrivere: gli altri si traducono ── */
const TRAD: Record<string, string> = {
  '□': '[ ]', '☐': '[ ]', '☑': '[x]', '☒': '[x]', '✓': 'v', '✔': 'v', '❌': 'x',
  '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '●': '-', '▪': '-', '◦': '-', '─': '-', '═': '=',
  '⚠': '(!)', '❗': '(!)', '⭐': '*', ' ': ' ', '​': '', '️': '',
}
const AMMESSI = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ')
const testoPdf = (s: unknown) => String(s ?? '').replace(/[\u{100}-\u{10FFFF}]/gu, (ch) =>
  AMMESSI.has(ch) ? ch : (TRAD[ch] ?? (/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/u.test(ch) ? '' : '?')))
const dataIt = (iso?: string | null) => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : ''
const oggiRoma = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })
const b64 = (byte: Uint8Array) => {
  let bin = ''
  for (let i = 0; i < byte.length; i += 0x8000) bin += String.fromCharCode(...byte.subarray(i, i + 0x8000))
  return btoa(bin)
}
const pulito = (s: string) => testoPdf(String(s || '')).replace(/[^\w.\-]+/g, '-').replace(/^-+|-+$/g, '')

type Riquadro = { pagina: number; x: number; y: number; w: number; h: number }
type Voce = { k?: string; testo?: string; on?: boolean }
type Unita = { unita?: string; argomenti?: string; ore?: number | string }

/* ── la carta «ciclo» e un cursore che va a capo da solo ── */
class Carta {
  doc!: PDFDocument; F!: { r: PDFFont; b: PDFFont; i: PDFFont }; logo: PDFImage | null = null
  C = {
    arancio: rgb(0.906, 0.314, 0.059), grigio: rgb(0.337, 0.361, 0.4), nero: rgb(0.1, 0.1, 0.1),
    tenue: rgb(0.545, 0.569, 0.6), linea: rgb(0.835, 0.847, 0.863), bordo: rgb(0.62, 0.64, 0.67), zebra: rgb(0.965, 0.965, 0.97),
  }
  pg!: PDFPage; y = 0; n = 0; titolo = ''
  async apri(titolo: string) {
    this.titolo = titolo
    this.doc = await PDFDocument.create()
    this.F = {
      r: await this.doc.embedFont(StandardFonts.Helvetica),
      b: await this.doc.embedFont(StandardFonts.HelveticaBold),
      i: await this.doc.embedFont(StandardFonts.HelveticaOblique),
    }
    try {
      const r = await fetch(LOGO_URL)
      if (r.ok) this.logo = await this.doc.embedJpg(new Uint8Array(await r.arrayBuffer()))
    } catch (e) { console.warn('logo non letto:', (e as Error).message) }
    this.pagina()
  }
  pagina() {
    this.pg = this.doc.addPage(A4); this.n += 1
    const H = A4[1]
    this.pg.drawRectangle({ x: 0, y: 0, width: 34, height: H, color: this.C.arancio })
    if (this.logo) {
      const w = this.n === 1 ? 150 : 90
      const h = w * this.logo.height / this.logo.width
      this.pg.drawImage(this.logo, { x: DX - w, y: H - 40 - h, width: w, height: h })
    }
    if (this.n === 1) {
      let yy = H - 52
      for (const [s, f, sz] of [[ENTE.nome, this.F.b, 7], [ENTE.sotto, this.F.r, 6.2], [ENTE.area, this.F.r, 6.2],
        [ENTE.indirizzo, this.F.r, 6.2], [`Tel. ${ENTE.tel} - ${ENTE.email} - ${ENTE.web}`, this.F.r, 6.2]] as [string, PDFFont, number][]) {
        this.T(s, SX, yy, sz, f, this.C.tenue); yy -= 8.4
      }
      this.y = H - 118
    } else {
      this.T(this.titolo, SX, H - 48, 7.5, this.F.r, this.C.tenue)
      this.y = H - 72
    }
    /* piè di pagina: numero e data */
    this.T(`Pagina ${this.n}`, DX, 40, 7, this.F.r, this.C.tenue, 'r')
    this.T(`${ENTE.nome} - ${ENTE.area} - generato il ${dataIt(oggiRoma())}`, SX, 40, 7, this.F.r, this.C.tenue)
  }
  T(s: unknown, x: number, y: number, size: number, f: PDFFont, color: ReturnType<typeof rgb>, al: 'l' | 'r' | 'c' = 'l') {
    const t = testoPdf(s).replace(/\s*[\r\n\t]+\s*/g, ' ')
    const w = f.widthOfTextAtSize(t, size)
    const xx = al === 'r' ? x - w : al === 'c' ? x - w / 2 : x
    this.pg.drawText(t, { x: xx, y, size, font: f, color })
    return w
  }
  righe(s: unknown, f: PDFFont, size: number, largo: number): string[] {
    const out: string[] = []
    for (const par of testoPdf(s).replace(/\r\n/g, '\n').split('\n')) {
      let r = ''
      for (const p of par.replace(/\s+/g, ' ').trim().split(' ')) {
        const prova = r ? `${r} ${p}` : p
        if (r && f.widthOfTextAtSize(prova, size) > largo) { out.push(r); r = p } else r = prova
      }
      out.push(r)
    }
    return out.length ? out : ['']
  }
  /* serve spazio: altrimenti pagina nuova */
  spazio(h: number) { if (this.y - h < BASSO) this.pagina() }
  titoloSez(s: string) {
    this.spazio(34)
    this.y -= 14
    this.pg.drawRectangle({ x: SX, y: this.y - 4, width: W, height: 15, color: this.C.zebra })
    this.T(s.toUpperCase(), SX + 5, this.y, 8.2, this.F.b, this.C.arancio)
    this.y -= 15
  }
  sotto(s: string) { this.spazio(16); this.y -= 2; this.T(s, SX, this.y, 8.6, this.F.b, this.C.grigio); this.y -= 12 }
  para(s: unknown, size = 9, f = this.F.r, color = this.C.nero, rientro = 0) {
    const rr = this.righe(s, f, size, W - rientro)
    for (const r of rr) { this.spazio(size + 4); this.T(r, SX + rientro, this.y, size, f, color); this.y -= size + 3.4 }
    this.y -= 3
  }
  caselle(voci: Voce[]) {
    if (!voci.length) { this.para('—', 9, this.F.i, this.C.tenue); return }
    for (const v of voci) {
      const segno = v.on ? '[x]' : '[  ]'
      const rr = this.righe(v.testo || v.k || '', this.F.r, 9, W - 24)
      this.spazio(13)
      this.T(segno, SX, this.y, 9, this.F.b, v.on ? this.C.arancio : this.C.tenue)
      rr.forEach((r, i) => { if (i) { this.spazio(13); } this.T(r, SX + 22, this.y, 9, this.F.r, v.on ? this.C.nero : this.C.grigio); this.y -= 12.4 })
    }
    this.y -= 3
  }
  tabella(int: string[], righeDati: string[][], pesi: number[]) {
    const tot = pesi.reduce((a, b) => a + b, 0)
    const larg = pesi.map((p) => W * p / tot)
    const riga = (celle: string[], f: PDFFont, size: number, sfondo?: ReturnType<typeof rgb>) => {
      const rr = celle.map((c, i) => this.righe(c, f, size, larg[i] - 10))
      const h = Math.max(...rr.map((x) => x.length)) * (size + 3) + 8
      this.spazio(h + 2)
      if (sfondo) this.pg.drawRectangle({ x: SX, y: this.y - h + 4, width: W, height: h, color: sfondo })
      let x = SX
      rr.forEach((lines, i) => {
        lines.forEach((l, j) => this.T(l, x + 5, this.y - 6 - j * (size + 3), size, f, this.C.nero))
        x += larg[i]
      })
      this.y -= h
      this.pg.drawLine({ start: { x: SX, y: this.y + 4 }, end: { x: DX, y: this.y + 4 }, color: this.C.linea, thickness: 0.6 })
    }
    this.pg.drawLine({ start: { x: SX, y: this.y + 4 }, end: { x: DX, y: this.y + 4 }, color: this.C.linea, thickness: 0.6 })
    riga(int, this.F.b, 8, this.C.zebra)
    for (const r of righeDati) riga(r, this.F.r, 9)
    this.y -= 6
  }
  /* un riquadro di firma: etichetta sopra, rettangolo tratteggiato; torna le coordinate */
  firma(x: number, w: number, etichetta: string, nome: string): Riquadro {
    const h = 54
    this.T(etichetta, x, this.y, 7.2, this.F.r, this.C.tenue)
    this.T(nome, x, this.y - 10, 8.6, this.F.b, this.C.grigio)
    const y0 = this.y - 16 - h
    this.pg.drawRectangle({ x, y: y0, width: w, height: h, borderColor: this.C.bordo, borderWidth: 0.6, borderDashArray: [3, 2] })
    return { pagina: this.n - 1, x: x + 4, y: y0 + 4, w: w - 8, h: h - 8 }
  }
}

type Riga = Record<string, any>
const vociOn = (v: unknown): Voce[] => Array.isArray(v) ? (v as Voce[]) : []

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const auth = req.headers.get('Authorization') || ''
    if (!auth.startsWith('Bearer ')) return json({ error: 'accesso non autorizzato' }, 401)
    const sbUtente = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: auth } }, auth: { persistSession: false },
    })
    const { data: u } = await sbUtente.auth.getUser()
    if (!u?.user?.email) return json({ error: 'accesso non autorizzato' }, 401)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const corpo = await req.json().catch(() => ({}))
    const azione = String(corpo?.azione || '')
    const id = Number(corpo?.id)
    if (!Number.isInteger(id) || id <= 0) return json({ error: 'Documento non indicato' }, 400)

    if (azione !== 'scheda_formativa') return json({ error: 'Azione non prevista' }, 400)

    /* la scheda si legge COL TOKEN DI CHI CHIAMA: se la RLS non gliela dà, non la vede */
    const { data: s, error: eS } = await sbUtente.from('s_corsi_schede_formative').select('*').eq('id', id).maybeSingle()
    if (eS) throw new Error('Non sono riuscito a leggere la scheda: ' + eS.message)
    if (!s) return json({ error: 'Scheda non trovata, o non la puoi vedere.' }, 404)
    const { data: t } = await sb.from('s_corsi_tipologie').select('*').eq('id', s.tipologia_id).maybeSingle()
    if (!t) throw new Error('Tipologia della scheda non trovata.')
    const { data: cfg } = await sb.from('s_config').select('chiave, valore').in('chiave', ['responsabile_formativo_nome', 'presidente_nome'])
    const conf: Record<string, string> = Object.fromEntries((cfg || []).map((r: Riga) => [r.chiave, r.valore]))
    /* chi ha compilato: il delegato (tecnico o accesso docente) o l'RPF */
    let compilatore = ''
    if (s.delegata_a) {
      const lett = String(s.delegata_a).toLowerCase().replace(/[\\%_]/g, (c: string) => '\\' + c)
      const { data: tec } = await sb.from('tecnici').select('titolo, tecnico_nome, tecnico_cognome').ilike('email', lett).limit(1)
      if (tec?.[0]) compilatore = [tec[0].titolo, tec[0].tecnico_nome, tec[0].tecnico_cognome].filter(Boolean).join(' ')
      else {
        const { data: a } = await sb.from('app_ruoli').select('nome').ilike('email', lett).limit(1)
        compilatore = String(a?.[0]?.nome || s.delegata_a)
      }
    }
    const rpf = String(conf.responsabile_formativo_nome || '').trim()

    /* ── il PDF ── */
    const k = new Carta()
    await k.apri(`Scheda formativa - ${t.titolo} - versione ${s.versione}`)
    const { F, C } = k
    k.T('PROGETTAZIONE DIDATTICA', SX, k.y, 15, F.b, C.grigio); k.y -= 20
    k.T('Scheda formativa', SX, k.y, 10.5, F.r, C.arancio); k.y -= 18
    for (const r of k.righe(t.titolo, F.b, 12.5, W)) { k.T(r, SX, k.y, 12.5, F.b, C.nero); k.y -= 16 }
    if (t.riferimento_normativo) for (const r of k.righe(t.riferimento_normativo, F.r, 9, W)) { k.T(r, SX, k.y, 9, F.r, C.grigio); k.y -= 12 }
    k.y -= 2
    const sottotitolo = [
      `Versione ${s.versione}`,
      s.stato === 'firmata' ? `firmata il ${dataIt(s.firmata_il)}` : s.stato === 'superata' ? 'superata' : s.stato === 'in_firma' ? 'in firma' : 'bozza',
      compilatore ? `compilata da ${compilatore}` : rpf ? `compilata dal responsabile del progetto formativo ${rpf}` : '',
      s.compilata_il ? `il ${dataIt(s.compilata_il)}` : '',
    ].filter(Boolean).join(' · ')
    k.T(sottotitolo, SX, k.y, 8, F.i, C.tenue); k.y -= 10
    if (s.stato !== 'firmata') { k.T(s.stato === 'in_firma' ? 'IN FIRMA' : 'BOZZA', DX, k.y + 10, 9, F.b, C.arancio, 'r') }

    /* dati della tipologia, in griglia */
    k.titoloSez('Il percorso formativo')
    const mod = (t.modalita_ammesse || []).map((m: string) => ({ presenza: 'in presenza in aula', videoconferenza: 'videoconferenza sincrona', pratica: 'spazi dedicati alla pratica', mista: 'mista', elearning: 'e-learning' } as Record<string, string>)[m] || m).join(', ')
    k.tabella(['Elemento', 'Dettaglio'], [
      ['Riferimento normativo', t.riferimento_normativo || '—'],
      ['Durata minima', t.ore_minime ? `${t.ore_minime} ore` : '—'],
      ['Validità e aggiornamento', [t.validita_anni ? `validità ${t.validita_anni} anni` : '', t.aggiornamento_ore ? `aggiornamento ${t.aggiornamento_ore} ore${t.aggiornamento_anni ? ` ogni ${t.aggiornamento_anni} anni` : ''}` : ''].filter(Boolean).join('; ') || '—'],
      ['Modalità di erogazione ammesse', mod || '—'],
      ['Frequenza minima e discenti', `frequenza almeno ${t.perc_freq_min}%; al massimo ${t.max_discenti} discenti${t.rapporto_pratica ? `; pratica: ${t.rapporto_pratica}` : ''}`],
      ['Verifica finale e gradimento', `${t.test_previsto ? 'verifica finale prevista' : 'senza verifica finale'}; ${t.questionario_previsto ? 'questionario di gradimento' : 'senza questionario'}; attestato di ${({ partecipazione: 'partecipazione', frequenza: 'regolare frequenza', frequenza_verifica: 'frequenza e verifica finale' } as Record<string, string>)[t.tipo_attestato] || t.tipo_attestato}`],
      ...(t.vale_anche_come?.length ? [['Vale anche come', t.vale_anche_come.join(', ')]] : []),
      ...(t.crediti ? [['Crediti', String(t.crediti)]] : []),
    ], [1, 2.4])

    k.titoloSez('Obiettivi del corso')
    k.sotto('Traguardi di competenza'); k.para(s.traguardi || '—')
    k.sotto('Abilità'); k.para(s.abilita || '—')
    k.sotto('Conoscenze'); k.para(s.conoscenze || '—')

    k.titoloSez('Presentazione dei discenti')
    k.sotto('Requisiti pre-corso'); k.caselle(vociOn(s.requisiti_precorso))
    k.sotto('Discenti NAI (nuovi arrivati in Italia) / BES'); k.caselle(vociOn(s.nai_bes))

    k.titoloSez('Durata e modalità di erogazione')
    k.caselle(vociOn(s.modalita))

    k.titoloSez('Argomenti trattati')
    const unita = (Array.isArray(s.contenuti) ? s.contenuti : []) as Unita[]
    if (unita.length) {
      const tot = unita.reduce((a, u) => a + (Number(u.ore) || 0), 0)
      k.tabella(['Unità didattica', 'Contenuti e argomenti', 'Ore'], unita.map((u) => [u.unita || '', u.argomenti || '', u.ore != null && u.ore !== '' ? String(u.ore) : '']), [1.1, 2.6, 0.35])
      k.T(`Totale ore: ${tot}${t.ore_minime ? ` (minimo della tipologia: ${t.ore_minime})` : ''}`, DX, k.y + 2, 8.5, F.b, tot < Number(t.ore_minime || 0) ? C.arancio : C.grigio, 'r'); k.y -= 10
    } else k.para('—', 9, F.i, C.tenue)

    k.titoloSez('Metodologia didattica - strategia formativa'); k.caselle(vociOn(s.metodologie))
    k.titoloSez('Strumenti'); k.caselle(vociOn(s.strumenti))
    k.titoloSez('Verifica di apprendimento - valutazione di gradimento'); k.caselle(vociOn(s.verifica))

    k.titoloSez('Docenti formatori')
    k.para('Tutti i docenti sono esperti con pluriennale esperienza in salute e sicurezza sul lavoro, con competenze specifiche sugli aspetti normativi e gestionali relativi al corso. Sono in possesso delle qualifiche previste dall\'Accordo Stato-Regioni del 17/04/2025 e dal D.I. 06/03/2013.')
    k.titoloSez('Note normative obbligatorie (Accordo 17/04/2025)')
    k.para('Documento progettuale: la presente scheda, compilata dal formatore o dal responsabile del progetto formativo, costituisce parte integrante e sostanziale del progetto formativo redatto dal Responsabile del Progetto Formativo (RPF). Verbalizzazione: gli esiti di tutte le valutazioni sono formalizzati nel verbale delle verifiche finali, sottoscritto dai docenti esaminatori. Certificazione: il rilascio dell\'attestato, con validità sull\'intero territorio nazionale, è subordinato alla frequenza obbligatoria e al superamento delle prove previste. Archiviazione: tutta la documentazione (registri, test, verbali) è conservata nel «Fascicolo del corso» per almeno 10 anni.', 8.4, F.r, C.grigio)
    if (s.note_normative) { k.sotto('Note'); k.para(s.note_normative, 8.6) }

    /* le firme: in fondo, con lo spazio che serve */
    k.spazio(110)
    k.y -= 12
    k.T(`Data: ${s.stato === 'firmata' ? dataIt(s.firmata_il) : '______________'}`, SX, k.y, 9, F.r, C.grigio); k.y -= 16
    const riquadri: Record<string, Riquadro> = {}
    const mezzo = (W - 20) / 2
    if (compilatore) {
      riquadri.docente = k.firma(SX, mezzo, 'Firma del formatore che ha compilato la scheda', compilatore)
      riquadri.rpf = k.firma(SX + mezzo + 20, mezzo, 'Firma del responsabile del progetto formativo', rpf || '—')
    } else {
      riquadri.rpf = k.firma(SX + mezzo + 20, mezzo, 'Firma del responsabile del progetto formativo', rpf || '—')
    }
    k.y -= 80

    const byte = await k.doc.save()
    const nome = `${oggiRoma().replace(/-/g, '_')}_REL_Formedil-Padova_scheda-formativa_${pulito(t.codice)}_v${s.versione}.pdf`
    const firmatari = [
      ...(compilatore ? [{ ruolo: 'docente', email: String(s.delegata_a).toLowerCase(), riquadro: riquadri.docente }] : []),
      { ruolo: 'rpf', riquadro: riquadri.rpf },
    ]
    return json({ ok: true, pdf_base64: b64(byte), nome_file: nome, riquadri, firmatari, pagine: k.n, titolo: `Scheda formativa «${t.titolo}» v${s.versione}` })
  } catch (e) {
    console.error('documenti-corso:', e)
    return json({ error: (e as Error).message }, 400)
  }
})
