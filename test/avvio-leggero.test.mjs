// Accensione più leggera (17/11/2026, l'utente: «l'accensione delle app tramite cellulare è lentissima»).
//  · sw.js: copie dei file legate alla versione pubblicata; moduli di due versioni mai insieme;
//  · la pubblicazione scrive la versione in sw.js e nella pagina;
//  · le letture dell'avvio partono insieme; il registro si carica mentre si apre il cruscotto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const qui = path.dirname(fileURLToPath(import.meta.url));
const leggi = (f) => readFileSync(path.join(qui, '..', f), 'utf8').replace(/\r\n/g, '\n');
const sw = leggi('sw.js');
const index = leggi('index.html');
const app = leggi('js/app.js');
const wf = leggi('.github/workflows/deploy-pages.yml');

/* un service worker in una scatola: rete e contenitori finti */
function scatola(sorgente, { versione, rete }) {
  const ascolta = {};
  const contenitori = new Map();
  const chiamate = [];
  const apri = async (nome) => {
    if (!contenitori.has(nome)) contenitori.set(nome, new Map());
    const m = contenitori.get(nome);
    return {
      match: async (req) => m.get(typeof req === 'string' ? req : req.url),
      put: async (req, r) => { m.set(req.url, r); },
    };
  };
  const caches = {
    open: apri,
    keys: async () => [...contenitori.keys()],
    delete: async (k) => contenitori.delete(k),
    match: async (req, opz = {}) => {
      const senza = (u) => (opz.ignoreSearch ? u.split('?')[0] : u);
      for (const m of contenitori.values()) for (const [k, r] of m) if (senza(k) === senza(req.url)) return r;
    },
  };
  const risposta = (corpo) => ({ ok: true, type: 'basic', corpo, clone() { return risposta(corpo); }, text: async () => corpo });
  const fetch = async (req) => { chiamate.push(req.url); if (!rete.on) throw new Error('rete assente'); return risposta(rete.file[req.url] ?? ''); };
  const self = { addEventListener: (t, f) => { ascolta[t] = f; }, location: { origin: 'https://x.github.io' }, skipWaiting() {}, clients: { claim: async () => {} } };
  const src = versione ? sorgente.replace("const VERSIONE = 'locale';", `const VERSIONE = '${versione}';`) : sorgente;
  vm.runInNewContext(src, { self, caches, fetch, URL, console });
  const chiedi = async (url, mode = 'no-cors') => {
    let p = null;
    ascolta.fetch({ request: { method: 'GET', mode, url }, respondWith: (x) => { p = x; } });
    return p ? (await p).corpo : 'NON INTERCETTATA';
  };
  return { chiedi, chiamate, contenitori, attiva: () => new Promise((ok) => ascolta.activate({ waitUntil: (p) => p.then(ok) })) };
}

const PAG = 'https://x.github.io/segreteria/';
const MOD = 'https://x.github.io/segreteria/js/home.js';
const pagina = (v) => `<html><head><meta name="versione-app" content="${v}"></head></html>`;

test('stessa versione: il modulo viene dalla copia, la pagina sempre dalla rete', async () => {
  const rete = { on: true, file: { [PAG]: pagina('abc'), [MOD]: 'home v1' } };
  const s = scatola(sw, { versione: 'abc', rete });
  assert.equal(await s.chiedi(PAG, 'navigate'), pagina('abc'));
  assert.equal(await s.chiedi(MOD), 'home v1');            // prima volta: rete, e copia
  rete.file[MOD] = 'home CAMBIATO SENZA PUBBLICARE';
  assert.equal(await s.chiedi(PAG, 'navigate'), pagina('abc'));
  const prima = s.chiamate.length;
  assert.equal(await s.chiedi(MOD), 'home v1', 'seconda volta: dalla copia, senza rete');
  assert.equal(s.chiamate.length, prima);
  assert.ok(s.contenitori.has('segreteria-abc'), 'il contenitore porta la versione nel nome');
});

test('pagina più nuova del service worker: tutto dalla rete, niente copie mescolate', async () => {
  const rete = { on: true, file: { [PAG]: pagina('abc'), [MOD]: 'home v1' } };
  const s = scatola(sw, { versione: 'abc', rete });
  await s.chiedi(PAG, 'navigate'); await s.chiedi(MOD);   // copia di v1
  rete.file[PAG] = pagina('def'); rete.file[MOD] = 'home v2';   // nuova pubblicazione
  assert.equal(await s.chiedi(PAG, 'navigate'), pagina('def'));
  assert.equal(await s.chiedi(MOD), 'home v2', 'con la pagina nuova il modulo è quello nuovo');
});

test('in locale niente copie; senza rete la copia fa da ripiego', async () => {
  const rete = { on: true, file: { [PAG]: pagina('locale'), [MOD]: 'a' } };
  const s = scatola(sw, { rete });
  await s.chiedi(PAG, 'navigate'); await s.chiedi(MOD);
  rete.file[MOD] = 'b';
  assert.equal(await s.chiedi(MOD), 'b', 'in locale si legge sempre il file appena scritto');
  const r2 = { on: true, file: { [PAG]: pagina('abc'), [MOD]: 'home v1' } };
  const s2 = scatola(sw, { versione: 'abc', rete: r2 });
  await s2.chiedi(PAG, 'navigate'); await s2.chiedi(MOD);
  r2.on = false;
  assert.equal(await s2.chiedi(PAG + '?x=1', 'navigate'), pagina('abc'), 'pagina salvata se la rete manca');
  assert.equal(await s2.chiedi(MOD), 'home v1');
});

test('richieste esterne non si toccano; all\'attivazione via le copie delle altre versioni', async () => {
  const rete = { on: true, file: {} };
  const s = scatola(sw, { versione: 'abc', rete });
  assert.equal(await s.chiedi('https://cdn.jsdelivr.net/npm/x.js'), 'NON INTERCETTATA');
  s.contenitori.set('segreteria-vecchia', new Map()); s.contenitori.set('segreteria-v1', new Map()); s.contenitori.set('altro', new Map());
  s.contenitori.set('segreteria-abc', new Map());
  await s.attiva();
  assert.deepEqual([...s.contenitori.keys()].sort(), ['altro', 'segreteria-abc']);
});

test('la pubblicazione scrive la versione in sw.js e nella pagina, e lo verifica', () => {
  assert.match(sw, /^const VERSIONE = 'locale';/m);
  assert.match(index, /<meta name="versione-app" content="locale">/);
  assert.match(wf, /sed -i "s\/\^const VERSIONE = 'locale';\/const VERSIONE = '\$V';\/" _site\/sw\.js/);
  assert.match(wf, /content=\\"locale\\">\/<meta name=\\"versione-app\\" content=\\"\$V\\">\/" _site\/index\.html/);
  assert.match(wf, /grep -q "\^const VERSIONE = '\$V';" _site\/sw\.js/);
});

test('avvio: letture insieme, registro mentre si apre il cruscotto', () => {
  const avvio = app.slice(app.indexOf('state.email = session.user.email'), app.indexOf("const { data: abilitato"));
  for (const q of ["sb.rpc('is_segreteria')", "sb.rpc('deve_cambiare_password')", "sb.from('s_tipo_doc')", "import('./cambio-password.js')"]) {
    assert.ok(avvio.includes(q), 'parte all\'avvio: ' + q);
  }
  assert.ok(!/await /.test(avvio), 'nessuna attesa prima che siano partite tutte');
  assert.match(app, /obbligaCambioPassword\(pPassword\)/);
  assert.match(leggi('js/cambio-password.js'), /await \(pronta \|\| sb\.rpc\('deve_cambiare_password'\)\)/);
  assert.match(app, /const pInit = mod\.protocollo\.init\(\);/);
  assert.doesNotMatch(app, /await mod\.protocollo\.init\(\);/, 'il cruscotto non aspetta più il registro');
  const iInit = app.indexOf('const pInit = mod.protocollo.init();');
  const iHome = app.indexOf("await vaiA('home');", iInit);
  assert.ok(iInit > 0 && iHome > iInit, 'il ramo del cruscotto c\'è');
  const primaDelCruscotto = app.slice(iInit, iHome).replace(/if \(hashImpresa\) \{[\s\S]*?\n        \} else if \(hashPratica \|\| hashVista\) \{[^\n]*\}/, '');
  assert.doesNotMatch(primaDelCruscotto, /await pInit/, 'prima di aprire il cruscotto non si aspetta il registro');
  assert.match(app, /pInit\.catch\(\(e\) => \{[\s\S]{0,200}Registro non caricato/, 'un errore del registro resta scritto');
});
