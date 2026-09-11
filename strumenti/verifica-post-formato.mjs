/* ============================================================
   verifica-post-formato.mjs — chi tocca js/post-formato.js esegue questo.

   1. Controlla che la COPIA dentro supabase/functions/redazione-social/
      sia identica all'originale (con --sincronizza la riallinea: è
      `npm run post-formato-sync`).
   2. Prova il convertitore sui casi che contano: i tre formati, i tag
      sempre annidati bene (Telegram rifiuta il messaggio intero se non
      lo sono), gli indirizzi con `__` dentro, i link verso javascript:
      che non devono diventare link, il testo con < > & ripulito.
   Esce con errore se un controllo fallisce.
   ============================================================ */
import { readFileSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const qui = dirname(fileURLToPath(import.meta.url));
const radice = join(qui, '..');
const sincronizza = process.argv.includes('--sincronizza');

let errori = 0;
const ko = (m) => { errori++; console.error('✗ ' + m); };
const ok = (m) => console.log('✓ ' + m);

const orig = join(radice, 'js', 'post-formato.js');
const copia = join(radice, 'supabase', 'functions', 'redazione-social', 'post-formato.js');
{
  const o = readFileSync(orig, 'utf8');
  const k = existsSync(copia) ? readFileSync(copia, 'utf8') : null;
  if (k === o) ok('copia allineata: redazione-social/post-formato.js');
  else if (sincronizza) { copyFileSync(orig, copia); ok('copia rigenerata: redazione-social/post-formato.js'); }
  else ko(`redazione-social/post-formato.js ${k === null ? 'manca' : 'diverge da js/post-formato.js'} — esegui: npm run post-formato-sync`);
}

const F = await import('../js/post-formato.js');
const uguale = (nome, avuto, atteso) => (avuto === atteso ? ok(nome) : ko(`${nome}\n    atteso: ${JSON.stringify(atteso)}\n    avuto:  ${JSON.stringify(avuto)}`));

uguale('telegram: grassetto e corsivo',
  F.postInTelegramHtml('**Titolo** e __norma__'), '<b>Titolo</b> e <i>norma</i>');
uguale('telegram: sottolineato e barrato',
  F.postInTelegramHtml('++sotto++ ~~via~~'), '<u>sotto</u> <s>via</s>');
uguale('telegram: annidato bene (corsivo dentro grassetto)',
  F.postInTelegramHtml('**a __b__ c**'), '<b>a <i>b</i> c</b>');
uguale('telegram: incrociato non produce tag rotti',
  F.postInTelegramHtml('__a **b** c__'), '__a <b>b</b> c__');
uguale('telegram: escape di < > &',
  F.postInTelegramHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
uguale('telegram: link con testo',
  F.postInTelegramHtml('[portale servizi](https://formedilpadovacpt.github.io/servizi/)'),
  '<a href="https://formedilpadovacpt.github.io/servizi/">portale servizi</a>');
uguale('telegram: __ dentro un indirizzo nudo non diventa corsivo',
  F.postInTelegramHtml('vedi https://x.it/a__b__c fine'), 'vedi https://x.it/a__b__c fine');
uguale('telegram: javascript: non diventa link',
  F.postInTelegramHtml('[clic](javascript:alert(1))'), '[clic](javascript:alert(1))');
uguale('telegram: citazione su più righe',
  F.postInTelegramHtml('prima\n> uno\n> due\ndopo'), 'prima\n<blockquote>uno\ndue</blockquote>\ndopo');
uguale('telegram: segno non chiuso resta com\'è',
  F.postInTelegramHtml('**aperto'), '**aperto');
uguale('telegram: emoji e a capo intatti',
  F.postInTelegramHtml('📋 **TITOLO**\n📖 art. 146'), '📋 <b>TITOLO</b>\n📖 art. 146');

uguale('notizia: paragrafi, a capo, link nudo cliccabile',
  F.postInHtmlNotizia('**Uno**\nriga\n\nvai su https://x.it'),
  '<p><strong>Uno</strong><br>riga</p><p>vai su <a href="https://x.it" target="_blank" rel="noopener">https://x.it</a></p>');
uguale('notizia: citazione',
  F.postInHtmlNotizia('> art. 146'),
  '<blockquote style="margin:8px 0;padding:4px 0 4px 12px;border-left:3px solid #e7500f">art. 146</blockquote>');
uguale('notizia: script ripulito',
  F.postInHtmlNotizia('<script>x</script>'), '<p>&lt;script&gt;x&lt;/script&gt;</p>');

uguale('testo semplice: segni tolti, link come testo (indirizzo)',
  F.postInTestoSemplice('**A** __b__ ++c++ ~~d~~ [e](https://x.it)\n> f'), 'A b c d e (https://x.it)\nf');
uguale('testo semplice: __ negli indirizzi resta',
  F.postInTestoSemplice('https://x.it/a__b__c'), 'https://x.it/a__b__c');
uguale('incolla Telegram: restano ** e __, via ++ e citazione',
  F.postPerIncollaTelegram('**A** __b__ ++c++\n> d [e](https://x.it)'), '**A** __b__ c\nd e: https://x.it');
uguale('lunghezza visibile: senza segni e col solo testo del link',
  F.lunghezzaVisibile('**abc** [de](https://x.it)'), 6);

if (errori) { console.error(`\n${errori} controlli falliti`); process.exit(1); }
console.log('\ntutto a posto');
