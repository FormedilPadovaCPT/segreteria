// node test/mail-mandato-pulsante.test.mjs
// (12/10/2026, chiesto da Patrizia) Nella mail del mandato il pulsante per la presa visione viene subito dopo il
// saluto, a tutta riga e in un riquadro col bordo arancione; elenco delle fatture e totale vengono dopo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const js = fs.readFileSync(new URL('../js/fatture-tecnici-mandati.js', import.meta.url), 'utf8');
assert.ok(/import \{ corpoInHtml, paginaHtml, bloccoAzioneMail \} from '\.\/firma\.js'/.test(js), 'usa il blocco del pulsante');
assert.ok(/border:3px solid #e7500f/.test(js) && /larga: true/.test(js), 'riquadro arancione, pulsante a tutta riga');
assert.ok(/html: paginaHtml\(\[corpoInHtml\(sopra\), riquadro, corpoInHtml\(sotto\)\]/.test(js), 'pulsante fra il saluto e l\'elenco');
assert.ok(/corpo: `\$\{sopra\}\\n\\n>>> \$\{azione\.etichetta\}/.test(js), 'anche nel testo semplice il link viene subito');
// il pulsante si compone davvero: etichetta, freccia, indirizzo di riserva
const { bloccoAzioneMail } = await import('../js/firma.js');
const h = bloccoAzioneMail({ titolo: '👉 Mandato n° 14 da firmare', testo: 'Si apre nell’app', href: 'https://x.it/#mandato-14', etichetta: '✍️ Apri il mandato n° 14 e firma', larga: true });
assert.match(h, /✍️ Apri il mandato n° 14 e firma &rarr;/);
assert.match(h, /width="100%"/);
console.log('ok — mail del mandato col pulsante in evidenza');
