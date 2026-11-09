// Video breve per Telegram (09/11/2026, scelta dell'utente «YouTube + Telegram»):
// il MP4 si carica solo per il canale e si cancella dopo la pubblicazione.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const com = readFileSync(new URL('../js/comunicazione.js', import.meta.url), 'utf8');
const fn = readFileSync(new URL('../supabase/functions/redazione-social/index.ts', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase/sql/2026_11_09c_post_video_telegram.sql', import.meta.url), 'utf8');

test('il video si carica direttamente nel bucket social-video con un indirizzo firmato', () => {
  assert.match(com, /op: 'video_carica', id/);
  assert.match(com, /sb\.storage\.from\('social-video'\)\.uploadToSignedUrl\(d1\.path, d1\.token, file/);
  assert.match(com, /op: 'video_registra', id, path: d1\.path/);
  assert.match(com, /file\.size > 20 \* 1024 \* 1024/, 'oltre 20 MB Telegram non lo accetta da un indirizzo');
  assert.match(fn, /createSignedUploadUrl\(path\)/);
});

test('su Telegram esce il video vero, e dopo la pubblicazione il file si cancella', () => {
  assert.match(fn, /if \(post\.video_file_url\) \{[\s\S]*?'sendVideo'/, 'col video caricato si usa sendVideo');
  assert.match(fn, /post\.video_url && !post\.video_file_url && !testo\.includes/, 'col video vero il link YouTube non si aggiunge');
  assert.match(fn, /storage\.from\('social-video'\)\.remove\(\[post\.video_file_path\]\)\s*\n\s*videoTolto = !eRm/, 'dopo la pubblicazione il MP4 si cancella');
  assert.match(fn, /videoTolto \? \{ video_file_url: null, video_file_path: null \}/);
});

test('il bucket dei video accetta solo MP4 fino a 20 MB, separato da quello delle immagini', () => {
  assert.match(sql, /'social-video', 'social-video', true, 20971520, array\['video\/mp4'\]/);
});
