/* ============================================================
   Kit per l'agenzia: che cosa si allega (17/11/2026).

   Chiesto dall'utente: «nel kit dell'agenzia deve essere completo
   con le immagini, eventualmente anche i video». Prima il kit era
   una bozza .eml coi soli testi, e immagini e video si allegavano
   a mano in Outlook.

   Il kit allega, in quest'ordine:
     1) le immagini del post (copertina e carosello), quelle che
        vanno anche su Telegram e nell'app servizi;
     2) il video per Telegram, se c'è ancora (dopo la pubblicazione
        sul canale il file si cancella da solo);
     3) il MATERIALE PER L'AGENZIA (s_post.kit_allegati): file
        caricati apposta nei formati di Instagram, Facebook e
        LinkedIn, in dimensione originale. Non vanno né su Telegram
        né nell'app servizi.

   Qui solo funzioni pure, provate in test/kit-agenzia.test.mjs:
   lo scaricamento dei file lo fa comunicazione.js.
   ============================================================ */

export const KIT_MIME = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4'];
export const KIT_MAX_FILE = 50 * 1024 * 1024;          // limite del bucket social-kit
export const KIT_AVVISO_TOTALE = 20 * 1024 * 1024;     // oltre, molte caselle rifiutano la mail

const EST = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4' };

/* nome di file pulito: niente percorso, niente spazi né accenti, estensione minuscola */
export function nomeSicuro(nome) {
  const base = String(nome || 'file').split(/[\\/]/).pop();
  const punto = base.lastIndexOf('.');
  const corpo = (punto > 0 ? base.slice(0, punto) : base)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'file';
  const est = punto > 0 ? base.slice(punto + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return (corpo.slice(0, 110) + (est ? '.' + est : ''));
}

/* dove si salva un file del materiale per l'agenzia: post-<id>/<istante>-<nome> */
export function percorsoKit(postId, nome, istante = Date.now()) {
  return `post-${Number(postId)}/${istante}-${nomeSicuro(nome)}`;
}

/* il file si può caricare? restituisce il motivo del rifiuto, o '' se va bene */
export function motivoRifiuto(file) {
  if (!file) return 'nessun file';
  if (file.type && !KIT_MIME.includes(file.type)) return `${file.name}: si caricano solo immagini JPG, PNG, WEBP o video MP4`;
  if (file.size > KIT_MAX_FILE) return `${file.name}: ${(file.size / 1048576).toFixed(1)} MB, il massimo è 50 MB`;
  return '';
}

function estDaUrl(url, ripiego) {
  const m = String(url || '').split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  return m ? m[1].toLowerCase() : ripiego;
}

/* l'elenco di ciò che va nel kit, coi nomi che vedrà l'agenzia */
export function elencoKit(post) {
  const id = post?.id;
  const out = [];
  const imm = Array.isArray(post?.immagini) && post.immagini.length
    ? post.immagini.map((x) => (typeof x === 'string' ? x : x?.url)).filter(Boolean)
    : (post?.immagine_url ? [post.immagine_url] : []);
  imm.forEach((url, i) => {
    const n = String(i + 1).padStart(2, '0');
    out.push({ origine: 'immagine', url, nome: `post-${id}_${n}_${i === 0 ? 'copertina' : 'carosello'}.${estDaUrl(url, 'jpg')}` });
  });
  if (post?.video_file_url) {
    out.push({ origine: 'video', url: post.video_file_url, nome: `post-${id}_video.${estDaUrl(post.video_file_url, 'mp4')}`, mime: 'video/mp4' });
  }
  (Array.isArray(post?.kit_allegati) ? post.kit_allegati : []).forEach((a) => {
    if (!a?.path) return;
    out.push({ origine: 'agenzia', path: a.path, nome: nomeSicuro(a.nome || a.path.split('/').pop()), mime: a.mime || '', dimensione: a.dimensione || 0 });
  });
  /* nomi doppi: l'agenzia riceverebbe due file con lo stesso nome */
  const visti = new Map();
  for (const x of out) {
    const k = x.nome.toLowerCase();
    if (!visti.has(k)) { visti.set(k, 1); continue; }
    const v = visti.get(k) + 1; visti.set(k, v);
    const p = x.nome.lastIndexOf('.');
    x.nome = p > 0 ? `${x.nome.slice(0, p)}_${v}${x.nome.slice(p)}` : `${x.nome}_${v}`;
  }
  return out;
}

export function mimeDaNome(nome) {
  const est = String(nome).split('.').pop().toLowerCase();
  return Object.keys(EST).find((m) => EST[m] === est || (est === 'jpeg' && m === 'image/jpeg')) || 'application/octet-stream';
}

export function pesoLeggibile(byte) {
  const b = Number(byte) || 0;
  return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

/* le righe dell'elenco allegati nel corpo della mail */
export function righeAllegati(allegati) {
  if (!allegati.length) return ['Allegati: nessuno.'];
  const etichetta = { immagine: 'immagine del post', video: 'video', agenzia: 'per i vostri canali' };
  return ['Allegati:', ...allegati.map((a) => `- ${a.nome} (${etichetta[a.origine] || a.origine}, ${pesoLeggibile(a.byte?.length ?? a.dimensione)})`)];
}

/* due allegati identici byte per byte (per esempio lo stesso video caricato per Telegram
   e nel materiale per l'agenzia) si mandano una volta sola: resta il primo, coi nomi
   dei doppioni tolti restituiti a parte per poterlo dire */
export function togliDoppi(allegati) {
  const tenuti = [], tolti = [];
  for (const a of allegati) {
    const uguale = tenuti.find((b) => b.byte.length === a.byte.length && b.byte.every((v, i) => v === a.byte[i]));
    if (uguale) tolti.push(a.nome); else tenuti.push(a);
  }
  return { tenuti, tolti };
}
