// Supabase Edge Function – documenti-corso
// I DOCUMENTI DEL FASCICOLO CORSO, GENERATI IN UN POSTO SOLO (13/10/2026,
// lotti 2 e 3 del fascicolo corso digitale).
//
// Perché una funzione e non corsi-doc.js della segreteria: la scheda
// formativa, il progetto formativo e il verbale li compila il responsabile
// del progetto formativo (RPF) nel GESTIONALE, che è un'app a script
// classici senza pdf-lib; la segreteria li manda in firma dalla SUA app. Lo
// stesso PDF deve uscire da tutte e due, e l'impronta che il registro delle
// firme ricontrolla dev'essere quella di un documento generato una volta
// sola. Quindi il generatore sta qui, con la stessa carta «ciclo» di
// attestati e registro (banda arancione, logo in alto a destra, griglie a
// filetti) rifatta in Deno con pdf-lib.
//
//   { azione: 'scheda_formativa', id }   la scheda formativa (versione) di
//        una tipologia (lotto 2). Firme: delegato (se c'è), poi RPF.
//   { azione: 'progetto_formativo', id } il progetto formativo dell'EDIZIONE
//        (Allegato 3: dichiarazione dell'RPF, programma, analisi aula), id =
//        corso (lotto 3). Firma: RPF.
//   { azione: 'verbale_verifica', id }   il verbale di verifica finale
//        (Allegato 4), id = s_corsi_verbali_verifica (lotto 3). Firme:
//        esaminatori, poi RPF.
//   { azione: 'accettazione_incarico', id } l'accettazione dell'incarico di
//        docenza (lotto 5), id = s_corsi_incarichi. Firma: il docente.
//   { azione: 'registro_giornata', id }  il registro presenze di UNA giornata
//        (Allegato 2, lotto 5), id = s_corsi_giornate: docenti con gli
//        argomenti svolti, allievi con entrate e uscite — «firmato dal
//        telefono alle 8:31 (XK7P2)» dove la firma dal QR è confermata,
//        l'orario «su carta» dove la presenza è segnata a mano, «assente».
//        Firme: i docenti della giornata, chi chiama per primo.
//   Risposta: PDF in base64, nome del file a convenzione, i RIQUADRI delle
//   firme (coordinate PDF) e i FIRMATARI pronti per `firma-documenti`.
//   Chi può: i documenti si leggono COL TOKEN DI CHI CHIAMA, quindi vale
//   la RLS (personale; il delegato per la sua scheda; i docenti del corso).
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
/* il soggetto formatore, com'è scritto nei modelli dell'Ufficio Corsi (13/10/2026) */
const ENTE = {
  nome: 'FORMEDIL PADOVA', sotto: 'Scuola Costruzioni Giuseppe Jappelli', area: 'Area Sicurezza e Salute',
  indirizzo: 'Via Basilicata 10 - 35127 Padova (PD)', tel: '049 761168', email: 'cpt@formedilpadova.it', web: 'www.formedilpadova.it',
  cf: '80006850285', piva: '02585760289', rea: 'CCIAA PD n. REA 294715',
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
const oraHm = (t?: string | null) => t ? String(t).slice(0, 5) : ''
const oggiRoma = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' })
const b64 = (byte: Uint8Array) => {
  let bin = ''
  for (let i = 0; i < byte.length; i += 0x8000) bin += String.fromCharCode(...byte.subarray(i, i + 0x8000))
  return btoa(bin)
}
const pulito = (s: string) => testoPdf(String(s || '')).replace(/[^\w.\-]+/g, '-').replace(/^-+|-+$/g, '')
const MODALITA: Record<string, string> = { aula: 'in presenza, in aula', presenza: 'in presenza', cantiere: 'in presenza, in cantiere', impresa: 'in presenza, in impresa', videoconferenza: 'videoconferenza sincrona', pratica: 'spazi dedicati alla pratica', mista: 'mista', elearning: 'e-learning' }
const ATTESTATO: Record<string, string> = { partecipazione: 'partecipazione', frequenza: 'regolare frequenza', frequenza_verifica: 'frequenza e verifica finale' }

type Riquadro = { pagina: number; x: number; y: number; w: number; h: number }
type Voce = { k?: string; testo?: string; on?: boolean }
type Unita = { unita?: string; argomenti?: string; ore?: number | string }
type Riga = Record<string, any>
type Firmatario = { ruolo: string; email?: string; persona_id?: string; riquadro: Riquadro }

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
  spazio(h: number) { if (this.y - h < BASSO) this.pagina() }
  intestazione(titolo: string, sotto: string, righeTitolo: string[], righeSotto: string[], stato: string) {
    const { F, C } = this
    this.T(titolo, SX, this.y, 15, F.b, C.grigio); this.y -= 20
    this.T(sotto, SX, this.y, 10.5, F.r, C.arancio); this.y -= 18
    for (const r of righeTitolo) for (const rr of this.righe(r, F.b, 12.5, W)) { this.T(rr, SX, this.y, 12.5, F.b, C.nero); this.y -= 16 }
    for (const r of righeSotto) for (const rr of this.righe(r, F.r, 9, W)) { this.T(rr, SX, this.y, 9, F.r, C.grigio); this.y -= 12 }
    if (stato) this.T(stato, DX, this.y + 12, 9, F.b, C.arancio, 'r')
    this.y -= 2
  }
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
  puntato(voci: string[], size = 9) {
    for (const v of voci) {
      const rr = this.righe(v, this.F.r, size, W - 14)
      rr.forEach((r, i) => { this.spazio(size + 4); if (!i) this.T('-', SX + 2, this.y, size, this.F.r, this.C.arancio); this.T(r, SX + 14, this.y, size, this.F.r, this.C.nero); this.y -= size + 3.4 })
    }
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
  tabella(int: string[], righeDati: string[][], pesi: number[], size = 9) {
    const tot = pesi.reduce((a, b) => a + b, 0)
    const larg = pesi.map((p) => W * p / tot)
    const riga = (celle: string[], f: PDFFont, sz: number, sfondo?: ReturnType<typeof rgb>) => {
      const rr = celle.map((c, i) => this.righe(c, f, sz, larg[i] - 10))
      const h = Math.max(...rr.map((x) => x.length)) * (sz + 3) + 8
      this.spazio(h + 2)
      if (sfondo) this.pg.drawRectangle({ x: SX, y: this.y - h + 4, width: W, height: h, color: sfondo })
      let x = SX
      rr.forEach((lines, i) => {
        lines.forEach((l, j) => this.T(l, x + 5, this.y - 6 - j * (sz + 3), sz, f, this.C.nero))
        x += larg[i]
      })
      this.y -= h
      this.pg.drawLine({ start: { x: SX, y: this.y + 4 }, end: { x: DX, y: this.y + 4 }, color: this.C.linea, thickness: 0.6 })
    }
    this.pg.drawLine({ start: { x: SX, y: this.y + 4 }, end: { x: DX, y: this.y + 4 }, color: this.C.linea, thickness: 0.6 })
    riga(int, this.F.b, 8, this.C.zebra)
    for (const r of righeDati) riga(r, this.F.r, size)
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
  /* una fila di riquadri di firma, due per riga; torna i riquadri nell'ordine dato */
  firme(voci: { etichetta: string; nome: string }[]): Riquadro[] {
    const out: Riquadro[] = []
    const mezzo = (W - 20) / 2
    for (let i = 0; i < voci.length; i += 2) {
      this.spazio(100)
      this.y -= 10
      out.push(this.firma(SX, mezzo, voci[i].etichetta, voci[i].nome))
      if (voci[i + 1]) out.push(this.firma(SX + mezzo + 20, mezzo, voci[i + 1].etichetta, voci[i + 1].nome))
      this.y -= 80
    }
    return out
  }
  dataRiga(testo: string) { this.spazio(30); this.y -= 12; this.T(testo, SX, this.y, 9, this.F.r, this.C.grigio); this.y -= 6 }
}

const vociOn = (v: unknown): Voce[] => Array.isArray(v) ? (v as Voce[]) : []

/* ══════════════ 1. LA SCHEDA FORMATIVA (lotto 2) ══════════════ */
export async function disegnaScheda(s: Riga, t: Riga, conf: Record<string, string>, compilatore: string) {
  const rpf = String(conf.responsabile_formativo_nome || '').trim()
  const k = new Carta()
  await k.apri(`Scheda formativa - ${t.titolo} - versione ${s.versione}`)
  const { F, C } = k
  k.intestazione('PROGETTAZIONE DIDATTICA', 'Scheda formativa', [t.titolo], t.riferimento_normativo ? [t.riferimento_normativo] : [],
    s.stato === 'firmata' ? '' : s.stato === 'in_firma' ? 'IN FIRMA' : 'BOZZA')
  const sottotitolo = [
    `Versione ${s.versione}`,
    s.stato === 'firmata' ? `firmata il ${dataIt(s.firmata_il)}` : s.stato === 'superata' ? 'superata' : s.stato === 'in_firma' ? 'in firma' : 'bozza',
    compilatore ? `compilata da ${compilatore}` : rpf ? `compilata dal responsabile del progetto formativo ${rpf}` : '',
    s.compilata_il ? `il ${dataIt(s.compilata_il)}` : '',
  ].filter(Boolean).join(' · ')
  k.T(sottotitolo, SX, k.y, 8, F.i, C.tenue); k.y -= 10

  k.titoloSez('Il percorso formativo')
  const mod = (t.modalita_ammesse || []).map((m: string) => MODALITA[m] || m).join(', ')
  k.tabella(['Elemento', 'Dettaglio'], [
    ['Riferimento normativo', t.riferimento_normativo || '—'],
    ['Durata minima', t.ore_minime ? `${t.ore_minime} ore` : '—'],
    ['Validità e aggiornamento', [t.validita_anni ? `validità ${t.validita_anni} anni` : '', t.aggiornamento_ore ? `aggiornamento ${t.aggiornamento_ore} ore${t.aggiornamento_anni ? ` ogni ${t.aggiornamento_anni} anni` : ''}` : ''].filter(Boolean).join('; ') || '—'],
    ['Modalità di erogazione ammesse', mod || '—'],
    ['Frequenza minima e discenti', `frequenza almeno ${t.perc_freq_min}%; al massimo ${t.max_discenti} discenti${t.rapporto_pratica ? `; pratica: ${t.rapporto_pratica}` : ''}`],
    ['Verifica finale e gradimento', `${t.test_previsto ? 'verifica finale prevista' : 'senza verifica finale'}; ${t.questionario_previsto ? 'questionario di gradimento' : 'senza questionario'}; attestato di ${ATTESTATO[t.tipo_attestato] || t.tipo_attestato}`],
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
  k.titoloSez('Durata e modalità di erogazione'); k.caselle(vociOn(s.modalita))
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

  k.dataRiga(`Data: ${s.stato === 'firmata' ? dataIt(s.firmata_il) : '______________'}`)
  const voci = [
    ...(compilatore ? [{ etichetta: 'Firma del formatore che ha compilato la scheda', nome: compilatore }] : []),
    { etichetta: 'Firma del responsabile del progetto formativo', nome: rpf || '—' },
  ]
  const rq = k.firme(voci)
  const firmatari: Firmatario[] = [
    ...(compilatore ? [{ ruolo: 'docente', email: String(s.delegata_a).toLowerCase(), riquadro: rq[0] }] : []),
    { ruolo: 'rpf', riquadro: rq[rq.length - 1] },
  ]
  const byte = await k.doc.save()
  const nome = `${oggiRoma().replace(/-/g, '_')}_REL_Formedil-Padova_scheda-formativa_${pulito(t.codice)}_v${s.versione}.pdf`
  return { byte, nome, firmatari, pagine: k.n, titolo: `Scheda formativa «${t.titolo}» v${s.versione}` }
}

/* ══════════════ 2. IL PROGETTO FORMATIVO DELL'EDIZIONE (lotto 3, Allegato 3) ══════════════ */
export async function disegnaProgetto(c: Riga, t: Riga | null, s: Riga | null, giornate: Riga[], interventi: Riga[], iscritti: Riga[], conf: Record<string, string>) {
  const rpf = String(c.responsabile_formativo || conf.responsabile_formativo_nome || '').trim()
  const k = new Carta()
  await k.apri(`Progetto formativo - corso n. ${c.id} - ${c.titolo}`)
  const { F, C } = k
  k.intestazione('FASCICOLO DEL CORSO', 'Allegato 3 - Progetto formativo e programma del corso', [c.titolo],
    [t ? `Tipologia: ${t.titolo}${t.riferimento_normativo ? ` - ${t.riferimento_normativo}` : ''}` : 'Corso fuori catalogo'],
    c.progetto_stato === 'firmato' ? '' : c.progetto_stato === 'in_firma' ? 'IN FIRMA' : 'BOZZA')

  k.titoloSez('Dati del corso')
  const date = c.data_inizio ? `${dataIt(c.data_inizio)}${c.data_fine && c.data_fine !== c.data_inizio ? ` - ${dataIt(c.data_fine)}` : ''}` : '—'
  k.tabella(['Elemento', 'Dettaglio'], [
    ['Ente attuatore (soggetto formatore)', `${ENTE.nome} ${ENTE.sotto}`],
    ['Codice corso', `n. ${c.id}${c.codice_socrate ? ` (Socrate ${c.codice_socrate})` : ''}`],
    ['Titolo corso', c.titolo],
    ['Sede di svolgimento', c.sede || '—'],
    ['Date', date],
    ['Durata', c.durata_ore ? `${c.durata_ore} ore` : '—'],
    ['Modalità di erogazione', MODALITA[c.modalita] || c.modalita || '—'],
    ['Numero partecipanti', String(iscritti.length)],
    ['Responsabile del progetto formativo', rpf || '—'],
    ['Rappresentante legale', String(c.rappresentante_legale || conf.presidente_nome || '—')],
    ...(s ? [['Scheda formativa', `versione ${s.versione}${s.firmata_il ? `, firmata il ${dataIt(s.firmata_il)}` : ' (non ancora firmata)'}`]] : [['Scheda formativa', 'nessuna versione congelata sul corso']]),
  ], [1, 2.4])

  k.titoloSez('Premessa')
  k.para(`Ai sensi del Nuovo Accordo Stato-Regioni del 17/04/2025 (parte I punto 1.3), ${ENTE.nome} ${ENTE.sotto} è soggetto formatore quale struttura di diretta emanazione dell'associazione sindacale dei datori di lavoro. Per il presente corso il soggetto formatore ha: predisposto il progetto formativo secondo la parte IV punto 2.6; ammesso un numero massimo di partecipanti nel limite di 30 discenti; tenuto, per le attività pratiche, il rapporto docente/discente non superiore a 1 a 6; tenuto il registro di presenza dei partecipanti; verificato, ai fini dell'ammissione alla verifica finale, la frequenza di almeno il ${c.perc_freq_min || 90}% delle ore previste; predisposto il verbale della verifica finale; predisposto l'attestato di formazione.`, 8.8)
  k.titoloSez('Il progetto formativo')
  k.para('Come previsto dal Nuovo Accordo Stato-Regioni del 17/04/2025 nella parte IV punto 2.6, il presente progetto formativo riporta nel dettaglio le informazioni e gli elementi che caratterizzano l\'azione formativa e risponde ai requisiti di:', 8.8)
  k.puntato([
    'conformità, intesa come rispondenza ai vincoli normativi e legislativi, alle specifiche e a eventuali standard di riferimento;',
    'coerenza, intesa come adeguatezza dal punto di vista metodologico, tecnico e delle scelte progettuali, organizzative e gestionali in rapporto agli obiettivi formativi;',
    'pertinenza, intesa come adeguatezza di risposta alle finalità della formazione nel campo della salute e sicurezza nei luoghi di lavoro;',
    'efficacia, intesa come capacità del progetto di realizzare i risultati attesi dal punto di vista didattico e delle competenze professionali, con particolare riferimento al ruolo che il destinatario della formazione riveste nel contesto dell\'organizzazione aziendale.',
  ], 8.8)
  k.para(`La micro-progettazione — specifiche del percorso formativo (analisi dei fabbisogni, traguardi di competenza, abilità, conoscenze, argomenti), specifiche di realizzazione (strategia formativa, metodologia, modalità di erogazione, materiali e strumenti) e specifiche per il controllo e la verifica — è riportata nella scheda formativa della tipologia${s ? ` (versione ${s.versione})` : ''}, parte integrante del presente progetto.`, 8.8)

  k.titoloSez('Programma del corso')
  const giornoDi = Object.fromEntries(giornate.map((g) => [g.id, g]))
  const righeProg: string[][] = []
  for (const g of giornate) {
    const ore = [g.dalle && g.alle ? `${oraHm(g.dalle)}-${oraHm(g.alle)}` : '', g.dalle2 && g.alle2 ? `${oraHm(g.dalle2)}-${oraHm(g.alle2)}` : ''].filter(Boolean).join(' e ')
    const int = interventi.filter((i) => i.giornata_id === g.id)
    if (!int.length) righeProg.push([dataIt(g.data), ore, '—', '—'])
    for (const i of int) righeProg.push([dataIt(g.data), i.dalle && i.alle ? `${oraHm(i.dalle)}-${oraHm(i.alle)}` : ore, i.nominativo || '—', [i.materia, i.argomenti].filter(Boolean).join(': ') || '—'])
  }
  for (const i of interventi.filter((x) => !x.giornata_id || !giornoDi[x.giornata_id])) righeProg.push(['—', '', i.nominativo || '—', [i.materia, i.argomenti].filter(Boolean).join(': ') || '—'])
  if (righeProg.length) k.tabella(['Giornata', 'Orario', 'Docente', 'Argomenti'], righeProg, [0.7, 0.9, 1.1, 2.2], 8.5)
  else k.para('Giornate e docenti da definire.', 9, F.i, C.tenue)

  k.titoloSez('Analisi aula discenti')
  k.tabella(['N', 'Azienda partecipante', 'Cognome e nome', 'Mansione'],
    iscritti.map((i, n) => [String(n + 1), i.impresa_txt || '—', i.nominativo || '—', i.mansione || '(da indicare)']), [0.3, 1.6, 1.5, 1.2], 8.5)
  if (c.analisi_aula_note) { k.sotto('Note'); k.para(c.analisi_aula_note, 8.6) }

  k.dataRiga(`Data: ${c.progetto_stato === 'firmato' ? dataIt(c.progetto_firmato_il) : '______________'}`)
  const rq = k.firme([{ etichetta: 'Il responsabile del progetto formativo (timbro e firma)', nome: rpf || '—' }])
  const byte = await k.doc.save()
  const nome = `${(c.data_inizio || oggiRoma()).replace(/-/g, '_')}_REL_Formedil-Padova_progetto-formativo_corso-${c.id}.pdf`
  return { byte, nome, firmatari: [{ ruolo: 'rpf', riquadro: rq[0] }] as Firmatario[], pagine: k.n, titolo: `Progetto formativo — corso n. ${c.id} «${c.titolo}»` }
}

/* ══════════════ 3. IL VERBALE DI VERIFICA FINALE (lotto 3, Allegato 4) ══════════════ */
export async function disegnaVerbale(v: Riga, c: Riga, t: Riga | null, giornate: Riga[], interventi: Riga[], conf: Record<string, string>) {
  const rpf = String(c.responsabile_formativo || conf.responsabile_formativo_nome || '').trim()
  const k = new Carta()
  await k.apri(`Verbale di verifica finale - corso n. ${c.id} - ${c.titolo}`)
  const { F, C } = k
  k.intestazione('FASCICOLO DEL CORSO', 'Allegato 4 - Verbale di verifica finale', [c.titolo],
    [t ? `Tipologia: ${t.titolo}${t.riferimento_normativo ? ` - ${t.riferimento_normativo}` : ''}` : 'Corso fuori catalogo', `Versione ${v.versione} del verbale`],
    v.stato === 'firmato' ? '' : v.stato === 'in_firma' ? 'IN FIRMA' : 'BOZZA')
  k.para('Come previsto dal Nuovo Accordo Stato-Regioni del 17/04/2025 nella parte I punto 5, in tutti i corsi di formazione ed aggiornamento il soggetto formatore redige il verbale delle verifiche finali, con i seguenti elementi minimi.', 8.8)

  k.titoloSez('Dati identificativi del soggetto formatore')
  k.tabella(['Elemento', 'Dettaglio'], [
    ['Ragione sociale', `${ENTE.nome} ${ENTE.sotto}`], ['Sede legale', ENTE.indirizzo], ['Codice fiscale', ENTE.cf], ['Partita IVA', ENTE.piva], ['Numero REA', ENTE.rea],
  ], [1, 2.4])
  k.titoloSez('Dati del corso')
  const scr = (Array.isArray(v.scrutinio) ? v.scrutinio : []) as Riga[]
  const oreTot = scr[0]?.ore_totali ?? c.durata_ore
  k.tabella(['Elemento', 'Dettaglio'], [
    ['Codice corso', `n. ${c.id}${c.codice_socrate ? ` (Socrate ${c.codice_socrate})` : ''}`],
    ['Tipologia e durata', `${t ? t.titolo : c.titolo}${oreTot ? ` - ${oreTot} ore` : ''}`],
    ['Giornate e moduli', giornate.map((g) => `${dataIt(g.data)} ${[g.dalle && g.alle ? `${oraHm(g.dalle)}-${oraHm(g.alle)}` : '', g.dalle2 && g.alle2 ? `${oraHm(g.dalle2)}-${oraHm(g.alle2)}` : ''].filter(Boolean).join(' e ')}`).join('; ') || '—'],
    ['Docenti', [...new Set(interventi.map((i) => i.nominativo).filter(Boolean))].join(', ') || '—'],
  ], [1, 2.4])

  k.titoloSez('Scrutinio di ammissione')
  k.para(`All'esame finale sono ammessi gli allievi del corso che comprendono la lingua veicolare della formazione (${v.lingua || 'italiano'}), sia scritta che orale, e che a seguito dello scrutinio di ammissione hanno frequentato almeno il ${c.perc_freq_min || 90}% delle ore di formazione del corso e superato le verifiche intermedie. Gli allievi non ammessi sono stati avvisati dalla segreteria.`, 8.8)
  const esitoV = (r: Riga) => r.verifica === 'positivo' ? 'positivo' : r.verifica === 'negativo' ? 'negativo' : r.verifica === 'colloquio' ? 'colloquio' : 'non sostenuta'
  const ammessi = scr.filter((r) => r.ammesso)
  const nonAmmessi = scr.filter((r) => !r.ammesso)
  k.sotto('Elenco ammessi alla verifica e relativo esito')
  if (ammessi.length) k.tabella(['N', 'Cognome e nome', 'Codice fiscale', 'Azienda', 'Assenze', 'Esito'],
    ammessi.map((r, n) => [String(n + 1), r.nominativo || '—', r.cf || '—', r.impresa || '—', r.perc_assenze != null ? `${r.perc_assenze}%` : '—', esitoV(r)]), [0.3, 1.5, 1.2, 1.3, 0.6, 0.8], 8.3)
  else k.para('Nessun ammesso.', 9, F.i, C.tenue)
  if (nonAmmessi.length) {
    k.sotto('Non ammessi')
    k.tabella(['N', 'Cognome e nome', 'Codice fiscale', 'Frequenza', 'Motivo'],
      nonAmmessi.map((r, n) => [String(n + 1), r.nominativo || '—', r.cf || '—', r.perc_frequenza != null ? `${r.perc_frequenza}%` : '—', r.motivo || '—']), [0.3, 1.6, 1.3, 0.7, 1.6], 8.3)
  }
  if (v.argomenti_colloquio) { k.sotto('Argomenti trattati nel colloquio'); k.para(v.argomenti_colloquio, 8.8) }
  if (v.annotazioni) { k.sotto('Annotazioni'); k.para(v.annotazioni, 8.8) }

  k.titoloSez('Luogo e data della verifica finale')
  k.tabella(['Elemento', 'Dettaglio'], [
    ['Ente attuatore', `${ENTE.nome} ${ENTE.sotto}`],
    ['Sede di svolgimento', v.luogo || c.sede || '—'],
    ['Data verifica finale', v.data_verifica ? dataIt(v.data_verifica) : '—'],
    ['Modalità di erogazione', MODALITA[v.modalita_erogazione] || v.modalita_erogazione || MODALITA[c.modalita] || c.modalita || '—'],
    ['Lingua veicolare del corso', v.lingua || 'italiano'],
  ], [1, 2.4])
  k.titoloSez('Esiti documentati')
  k.para('Gli esiti documentati delle prove teoriche e pratiche effettuate dai partecipanti sono conservati nel fascicolo del corso (prove della verifica finale); si dichiarano superate le prove con valutazione complessiva pari o superiore alla soglia prevista, nel rispetto dei pesi indicati nelle linee guida. Non si emettono attestati con valutazioni inferiori. Gli esiti dei questionari di gradimento sono conservati nel fascicolo del corso.', 8.6, F.r, C.grigio)
  k.titoloSez('La verifica di efficacia della formazione')
  k.para('L\'Accordo del 17 aprile 2025 pone in capo al datore di lavoro, in collaborazione con RSPP e preposto, la verifica di efficacia della formazione: distinta dalla verifica finale dell\'apprendimento, misura a distanza di tempo (indicativamente fra 6 e 12 mesi) l\'impatto della formazione sui comportamenti e sulla cultura della sicurezza in azienda. Il soggetto formatore lo ha ricordato ai partecipanti al termine del corso.', 8.4, F.r, C.grigio)

  k.dataRiga(`Luogo e data: ${v.luogo || c.sede || '—'}, ${v.stato === 'firmato' ? dataIt(v.firmato_il) : (v.data_verifica ? dataIt(v.data_verifica) : '______________')}`)
  const esaminatori = (Array.isArray(v.esaminatori) ? v.esaminatori : []) as Riga[]
  const voci = [
    ...esaminatori.map((e) => ({ etichetta: 'Docente esaminatore', nome: String(e.nominativo || '—') })),
    { etichetta: 'Il responsabile del progetto formativo (timbro e firma)', nome: rpf || '—' },
  ]
  const rq = k.firme(voci)
  const firmatari: Firmatario[] = [
    ...esaminatori.map((e, i) => ({ ruolo: 'docente', persona_id: e.persona_id ? String(e.persona_id) : undefined, email: e.email ? String(e.email).toLowerCase() : undefined, riquadro: rq[i] })),
    { ruolo: 'rpf', riquadro: rq[rq.length - 1] },
  ]
  const byte = await k.doc.save()
  const nome = `${(v.data_verifica || c.data_fine || c.data_inizio || oggiRoma()).replace(/-/g, '_')}_VERB_Formedil-Padova_verbale-verifica-finale_corso-${c.id}_v${v.versione}.pdf`
  return { byte, nome, firmatari, pagine: k.n, titolo: `Verbale di verifica finale — corso n. ${c.id} «${c.titolo}» v${v.versione}` }
}

/* ══════════════ 4. L'ACCETTAZIONE DELL'INCARICO (lotto 5) ══════════════ */
const QUALITA: Record<string, string> = { docente: 'docente', codocente: 'codocente', relatore: 'relatore', tutor: 'tutor' }
/* il codice del registro unico porta già «Prot_» (Prot_26-27_0031): non si raddoppia; lo storico «1234-out» prende «Prot.» davanti */
const protTxt = (p: string) => /^prot/i.test(p) ? p : `Prot. ${p}`
export async function disegnaAccettazione(inc: Riga, c: Riga, docente: { nome: string; email: string }, protocollo: string | null) {
  const k = new Carta()
  await k.apri(`Accettazione dell'incarico di docenza - corso n. ${c.id} - ${c.titolo}`)
  const { F, C } = k
  k.intestazione('FASCICOLO DEL CORSO', 'Accettazione dell\'incarico di docenza', [c.titolo],
    [`Corso n. ${c.id}${c.codice_socrate ? ` (Socrate ${c.codice_socrate})` : ''}`], inc.accettato_il ? '' : 'DA FIRMARE')
  k.titoloSez('L\'incarico')
  const date = c.data_inizio ? `${dataIt(c.data_inizio)}${c.data_fine && c.data_fine !== c.data_inizio ? ` - ${dataIt(c.data_fine)}` : ''}` : '—'
  k.tabella(['Elemento', 'Dettaglio'], [
    ['Docente', docente.nome || inc.nominativo || '—'],
    ['In qualità di', QUALITA[String(inc.qualita || 'docente')] || String(inc.qualita || 'docente')],
    ['Corso', `n. ${c.id} - ${c.titolo}`],
    ['Date e sede', [date, c.sede].filter(Boolean).join(' - ')],
    ['Ore di docenza', inc.ore != null ? `${inc.ore}` : '—'],
    ['Lettera di incarico', protocollo ? `${protTxt(protocollo)}${inc.data_incarico ? ` del ${dataIt(inc.data_incarico)}` : ''}` : (inc.data_incarico ? `del ${dataIt(inc.data_incarico)}` : '—')],
  ], [1, 2.4])
  k.titoloSez('Dichiarazione')
  k.para(`Il sottoscritto ${docente.nome || inc.nominativo || '________________'}, presa visione della lettera di incarico${protocollo ? ` ${protTxt(protocollo)}` : ''} conferita da ${ENTE.nome} ${ENTE.sotto}, dichiara di accettare l'incarico di docenza per il corso sopra indicato e di possedere i requisiti di docente formatore previsti dal D.I. 06/03/2013 e dall'Accordo Stato-Regioni del 17/04/2025.`, 9.2)
  k.para('Si impegna a compilare e firmare di propria responsabilità il registro delle presenze della giornata e i documenti gestionali e didattici del fascicolo del corso per la parte di competenza, a svolgere gli argomenti previsti dal programma e a segnalare alla segreteria ogni variazione.', 9.2)
  k.dataRiga(`Data: ${inc.accettato_il ? dataIt(inc.accettato_il) : '______________'}`)
  const rq = k.firme([{ etichetta: 'Il docente, per accettazione', nome: docente.nome || inc.nominativo || '—' }])
  const byte = await k.doc.save()
  const nome = `${oggiRoma().replace(/-/g, '_')}_DICH_Formedil-Padova_accettazione-incarico_corso-${c.id}_${pulito(String(docente.nome || inc.nominativo || 'docente')).slice(0, 40)}.pdf`
  return { byte, nome, firmatari: [{ ruolo: 'docente', email: docente.email || undefined, riquadro: rq[0] }] as Firmatario[], pagine: k.n, titolo: `Accettazione dell'incarico — corso n. ${c.id} «${c.titolo}»` }
}

/* ══════════════ 5. IL REGISTRO DELLA GIORNATA (lotto 5, Allegato 2) ══════════════ */
export async function disegnaRegistroGiornata(g: Riga, c: Riga, interventi: Riga[], iscritti: Riga[], docenti: { nominativo: string; persona_id?: string; email?: string }[], firmatoIl: string | null) {
  const k = new Carta()
  await k.apri(`Registro presenze - giornata del ${dataIt(g.data)} - corso n. ${c.id} - ${c.titolo}`)
  const { F, C } = k
  const fasce = [g.dalle && g.alle ? `${oraHm(g.dalle)}-${oraHm(g.alle)}` : '', g.dalle2 && g.alle2 ? `${oraHm(g.dalle2)}-${oraHm(g.alle2)}` : ''].filter(Boolean).join(' e ')
  k.intestazione('FASCICOLO DEL CORSO', 'Allegato 2 - Registro presenze della giornata', [c.titolo],
    [`Corso n. ${c.id}${c.codice_socrate ? ` (Socrate ${c.codice_socrate})` : ''} - giornata del ${dataIt(g.data)}${fasce ? ` - ${fasce}` : ''}${g.aula || g.sede || c.sede ? ` - ${g.aula || g.sede || c.sede}` : ''}`],
    firmatoIl ? '' : 'DA FIRMARE')

  k.titoloSez('Docenti della giornata e argomenti svolti')
  if (interventi.length) {
    k.tabella(['Docente', 'In qualità di', 'Orario', 'Materia e argomenti svolti'],
      interventi.map((i) => [i.nominativo || '—', QUALITA[String(i.qualita || 'docente')] || String(i.qualita || ''), i.dalle && i.alle ? `${oraHm(i.dalle)}-${oraHm(i.alle)}` : fasce || '—', [i.materia, i.argomenti].filter(Boolean).join(': ') || '—']), [1.2, 0.7, 0.8, 2.3], 8.5)
  } else k.para('Nessun docente nel programma di questa giornata.', 9, F.i, C.tenue)

  k.titoloSez('Allievi: entrate e uscite')
  const due = !!(g.dalle2 && g.alle2)
  const cella = (i: Riga, tipo: string, turno: number, col: string) => {
    const f = (Array.isArray(i.firme) ? i.firme : []).find((x: Riga) => x.stato === 'confermata' && x.tipo === tipo && Number(x.turno) === turno)
    const p = i.presenza as Riga | null
    if (f) return `tel. ${new Date(f.ora_server).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' })} (${i.test_codice || '—'})`
    if (p && p.presente === false) return 'assente'
    if (p && p[col]) return `${oraHm(p[col])} su carta`
    return ''
  }
  const int = ['N', 'Cognome e nome', 'Codice fiscale', 'Impresa', 'Entrata', 'Uscita', ...(due ? ['Entrata 2', 'Uscita 2'] : [])]
  const righe = iscritti.map((i, n) => [String(n + 1), i.nominativo || '—', i.cf || '—', i.impresa_txt || '—',
    cella(i, 'entrata', 1, 'ingresso1'), cella(i, 'uscita', 1, 'uscita1'), ...(due ? [cella(i, 'entrata', 2, 'ingresso2'), cella(i, 'uscita', 2, 'uscita2')] : [])])
  if (righe.length) k.tabella(int, righe, [0.3, 1.4, 1.5, 1.2, 0.85, 0.85, ...(due ? [0.85, 0.85] : [])], 7.6)
  else k.para('Nessun iscritto.', 9, F.i, C.tenue)
  const presenti = iscritti.filter((i) => (i.presenza as Riga | null)?.presente === true).length
  const assenti = iscritti.filter((i) => (i.presenza as Riga | null)?.presente === false).length
  const tel = iscritti.reduce((a, i) => a + (Array.isArray(i.firme) ? i.firme.filter((x: Riga) => x.stato === 'confermata').length : 0), 0)
  k.para(`Presenti ${presenti} su ${iscritti.length} iscritti, assenti ${assenti}${iscritti.length - presenti - assenti ? `, senza presenza segnata ${iscritti.length - presenti - assenti}` : ''}. Firme dal telefono confermate dal docente: ${tel}; «su carta» = firma apposta sul registro stampato, conservato nel fascicolo.`, 8.4, F.r, C.grigio)
  k.para('Le firme dal telefono sono apposte dall\'allievo col proprio codice personale dalla pagina del portale servizi, con l\'ora di arrivo al servizio; valgono come presenza solo dopo la conferma del docente, che le vede nell\'app insieme alle firme fuori orario.', 8.2, F.i, C.tenue)

  k.dataRiga(`Data: ${firmatoIl ? dataIt(firmatoIl) : dataIt(g.data)}`)
  const voci = docenti.length ? docenti.map((d) => ({ etichetta: 'Il docente della giornata', nome: d.nominativo || '—' })) : [{ etichetta: 'Il docente della giornata', nome: '—' }]
  const rq = k.firme(voci)
  const firmatari: Firmatario[] = docenti.map((d, i) => ({ ruolo: 'docente', persona_id: d.persona_id, email: d.email, riquadro: rq[i] }))
  const byte = await k.doc.save()
  const nome = `${String(g.data).replace(/-/g, '_')}_REGP_Formedil-Padova_registro-giornata_corso-${c.id}.pdf`
  return { byte, nome, firmatari, pagine: k.n, titolo: `Registro della giornata del ${dataIt(g.data)} — corso n. ${c.id} «${c.titolo}»` }
}

/* ══════════════ il servizio ══════════════ */
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
    const { data: cfg } = await sb.from('s_config').select('chiave, valore').in('chiave', ['responsabile_formativo_nome', 'presidente_nome'])
    const conf: Record<string, string> = Object.fromEntries((cfg || []).map((r: Riga) => [r.chiave, r.valore]))
    /* nome e indirizzo di un docente dalla persona (tecnico o accesso docente), o dall'indirizzo di chi chiama */
    const docenteDi = async (sbS: any, personaId: string | null, emailRiserva: string): Promise<{ nome: string; email: string }> => {
      if (personaId) {
        const { data: t } = await sbS.from('tecnici').select('titolo, tecnico_nome, tecnico_cognome, email').eq('persona_id', personaId).limit(1)
        if (t?.[0]) return { nome: [t[0].titolo, t[0].tecnico_nome, t[0].tecnico_cognome].filter(Boolean).join(' '), email: String(t[0].email || '').toLowerCase() }
        const { data: a } = await sbS.from('app_ruoli').select('nome, email').eq('persona_id', personaId).eq('stato', 'attivo').limit(1)
        if (a?.[0]) return { nome: String(a[0].nome || ''), email: String(a[0].email || '').toLowerCase() }
        const { data: p } = await sbS.from('persone').select('titolo, nome, cognome').eq('persona_id', personaId).maybeSingle()
        if (p) return { nome: [p.titolo, p.nome, p.cognome].filter(Boolean).join(' '), email: emailRiserva.toLowerCase() }
      }
      return { nome: emailRiserva ? await nomeDi(emailRiserva) : '', email: emailRiserva.toLowerCase() }
    }
    const nomeDi = async (email: string) => {
      const lett = email.toLowerCase().replace(/[\\%_]/g, (c: string) => '\\' + c)
      const { data: tec } = await sb.from('tecnici').select('titolo, tecnico_nome, tecnico_cognome').ilike('email', lett).limit(1)
      if (tec?.[0]) return [tec[0].titolo, tec[0].tecnico_nome, tec[0].tecnico_cognome].filter(Boolean).join(' ')
      const { data: a } = await sb.from('app_ruoli').select('nome').ilike('email', lett).limit(1)
      return String(a?.[0]?.nome || email)
    }
    /* il corso e il suo contorno, col token di chi chiama (RLS) */
    const corsoEContorno = async (corsoId: number) => {
      const { data: c, error: eC } = await sbUtente.from('s_corsi').select('*').eq('id', corsoId).maybeSingle()
      if (eC) throw new Error('Non sono riuscito a leggere il corso: ' + eC.message)
      if (!c) return null
      const [{ data: t }, { data: s }, { data: g }, { data: i }, { data: isc }] = await Promise.all([
        c.tipologia_id ? sb.from('s_corsi_tipologie').select('*').eq('id', c.tipologia_id).maybeSingle() : Promise.resolve({ data: null }),
        c.scheda_formativa_id ? sb.from('s_corsi_schede_formative').select('id, versione, stato, firmata_il').eq('id', c.scheda_formativa_id).maybeSingle() : Promise.resolve({ data: null }),
        sb.from('s_corsi_giornate').select('*').eq('corso_id', corsoId).order('data'),
        sb.from('s_corsi_interventi').select('*').eq('corso_id', corsoId).order('giornata_id').order('ordine').order('dalle'),
        sb.from('s_corsi_iscritti').select('id, nominativo, cf, impresa_txt, mansione, esito').eq('corso_id', corsoId).order('nominativo'),
      ])
      return { c, t, s, giornate: g || [], interventi: i || [], iscritti: (isc || []).filter((x: Riga) => !['annullato', 'sostituito'].includes(x.esito || '')) }
    }

    let out: { byte: Uint8Array; nome: string; firmatari: Firmatario[]; pagine: number; titolo: string }
    if (azione === 'scheda_formativa') {
      const { data: s, error: eS } = await sbUtente.from('s_corsi_schede_formative').select('*').eq('id', id).maybeSingle()
      if (eS) throw new Error('Non sono riuscito a leggere la scheda: ' + eS.message)
      if (!s) return json({ error: 'Scheda non trovata, o non la puoi vedere.' }, 404)
      const { data: t } = await sb.from('s_corsi_tipologie').select('*').eq('id', s.tipologia_id).maybeSingle()
      if (!t) throw new Error('Tipologia della scheda non trovata.')
      const compilatore = s.delegata_a ? await nomeDi(String(s.delegata_a)) : ''
      out = await disegnaScheda(s, t, conf, compilatore)
    } else if (azione === 'progetto_formativo') {
      const k = await corsoEContorno(id)
      if (!k) return json({ error: 'Corso non trovato, o non lo puoi vedere.' }, 404)
      out = await disegnaProgetto(k.c, k.t, k.s, k.giornate, k.interventi, k.iscritti, conf)
    } else if (azione === 'verbale_verifica') {
      const { data: v, error: eV } = await sbUtente.from('s_corsi_verbali_verifica').select('*').eq('id', id).maybeSingle()
      if (eV) throw new Error('Non sono riuscito a leggere il verbale: ' + eV.message)
      if (!v) return json({ error: 'Verbale non trovato, o non lo puoi vedere.' }, 404)
      const k = await corsoEContorno(Number(v.corso_id))
      if (!k) return json({ error: 'Corso del verbale non trovato.' }, 404)
      /* gli esaminatori senza persona: l'indirizzo lo cerca firma-documenti, qui si lascia il nome */
      out = await disegnaVerbale(v, k.c, k.t, k.giornate, k.interventi, conf)
    } else if (azione === 'accettazione_incarico') {
      /* l'incarico si legge col token di chi chiama: la RLS dà al docente solo il suo */
      const { data: inc, error: eI } = await sbUtente.from('s_corsi_incarichi').select('*').eq('id', id).maybeSingle()
      if (eI) throw new Error('Non sono riuscito a leggere l\'incarico: ' + eI.message)
      if (!inc) return json({ error: 'Incarico non trovato, o non è il tuo.' }, 404)
      const { data: c } = await sb.from('s_corsi').select('*').eq('id', inc.corso_id).maybeSingle()
      if (!c) throw new Error('Corso dell\'incarico non trovato.')
      const doc = await docenteDi(sb, inc.persona_id ? String(inc.persona_id) : null, String(u.user.email))
      let prot: string | null = null
      if (inc.protocollo_out_id) { const { data: pr } = await sb.from('s_protocollo').select('codice').eq('id', inc.protocollo_out_id).maybeSingle(); prot = pr?.codice ? String(pr.codice) : null }
      out = await disegnaAccettazione(inc, c, { nome: doc.nome || String(inc.nominativo || ''), email: doc.email }, prot)
    } else if (azione === 'registro_giornata') {
      const { data: g, error: eG } = await sbUtente.from('s_corsi_giornate').select('*').eq('id', id).maybeSingle()
      if (eG) throw new Error('Non sono riuscito a leggere la giornata: ' + eG.message)
      if (!g) return json({ error: 'Giornata non trovata, o non la puoi vedere.' }, 404)
      const { data: c } = await sb.from('s_corsi').select('*').eq('id', g.corso_id).maybeSingle()
      if (!c) throw new Error('Corso della giornata non trovato.')
      const [{ data: iv }, { data: isc }, { data: pres }, { data: firme }] = await Promise.all([
        sb.from('s_corsi_interventi').select('*').eq('giornata_id', id).order('ordine').order('dalle').order('id'),
        sb.from('s_corsi_iscritti').select('id, nominativo, cf, impresa_txt, mansione, esito, test_codice, persona_id').eq('corso_id', g.corso_id).order('nominativo'),
        sb.from('s_corsi_presenze').select('*').eq('giornata_id', id),
        sb.from('s_corsi_firme_presenza').select('id, iscritto_id, tipo, turno, ora_server, stato').eq('giornata_id', id).eq('stato', 'confermata'),
      ])
      const iscritti = ((isc || []) as Riga[]).filter((x) => !['annullato', 'sostituito'].includes(x.esito || '')).map((x) => ({
        ...x,
        presenza: ((pres || []) as Riga[]).find((p) => p.iscritto_id === x.id) || null,
        firme: ((firme || []) as Riga[]).filter((f) => f.iscritto_id === x.id),
      }))
      /* i docenti della giornata firmano: chi chiama per primo, così la catena parte da lui */
      const io = String(u.user.email).toLowerCase()
      const visti = new Set<string>()
      const docenti: { nominativo: string; persona_id?: string; email?: string }[] = []
      for (const x of (iv || []) as Riga[]) {
        if (!['docente', 'codocente', 'relatore'].includes(String(x.qualita || 'docente'))) continue
        const chiave = x.persona_id ? String(x.persona_id) : String(x.nominativo || '').toLowerCase()
        if (!chiave || visti.has(chiave)) continue
        visti.add(chiave)
        const d = await docenteDi(sb, x.persona_id ? String(x.persona_id) : null, '')
        docenti.push({ nominativo: d.nome || String(x.nominativo || ''), persona_id: x.persona_id ? String(x.persona_id) : undefined, email: d.email || undefined })
      }
      docenti.sort((a, b) => Number((b.email || '').toLowerCase() === io) - Number((a.email || '').toLowerCase() === io))
      const { data: fr } = await sb.from('s_firme').select('firmata_il').eq('tipo', 'registro_giornata').eq('rif', `giornata:${id}`).eq('stato', 'firmata').order('firmata_il').limit(1)
      out = await disegnaRegistroGiornata(g, c, (iv || []) as Riga[], iscritti, docenti, fr?.[0]?.firmata_il ? String(fr[0].firmata_il) : null)
    } else {
      return json({ error: 'Azione non prevista' }, 400)
    }
    return json({ ok: true, pdf_base64: b64(out.byte), nome_file: out.nome, firmatari: out.firmatari, pagine: out.pagine, titolo: out.titolo })
  } catch (e) {
    console.error('documenti-corso:', e)
    return json({ error: (e as Error).message }, 400)
  }
})
