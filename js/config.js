/* ============================================================
   Configurazione — Gestionale Segreteria Formedil Padova
   Stesso database Supabase del gestionale visite e della
   webapp asseverazione: qui si legge/scrive solo lo schema s_*.
   ============================================================ */

export const SB_URL = 'https://utdantrfugnmqsuujxbe.supabase.co';
export const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0ZGFudHJmdWdubXFzdXVqeGJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNjEzMTYsImV4cCI6MjA5MzgzNzMxNn0.L6YUgMD9rYPtqZCn5-c6hB-ok5nSCISpSolj_a-pcmM';

/* I documenti del protocollo NON stanno piu' nel bucket di Supabase:
   stanno su Google Drive, e nel database resta solo l'indice con
   l'id del file (decisione dell'utente, 28/08/2026 — vedi js/drive.js).
   Il bucket `protocollo` resta esistente ma inutilizzato: non ci e'
   mai finito niente, la tabella degli allegati era a zero righe. */

/* Righe per pagina nel registro */
export const PAGE_SIZE = 50;

/* Indirizzo pubblicato dell'app (GitHub Pages): serve per i link
   profondi nelle mail — es. «Autorizza dall'app» al Direttore. */
export const APP_URL = 'https://formedilpadovacpt.github.io/segreteria/';

/* Dati dell'ente usati nel timbro di protocollo */
export const ENTE = {
  nome: 'FORMEDIL PADOVA',
  sotto: 'Scuola Costruzioni Giuseppe Jappelli',
  area: 'Area Sicurezza e Salute',
  indirizzo: 'Via Basilicata 10 — 35127 Padova (PD)',
  tel: '049 761168',
  email: 'cpt@formedilpadova.it',
  web: 'www.formedilpadova.it',
};

/* Palette istituzionale (usata anche nei PDF) */
export const COLORI = {
  arancio: [0.906, 0.314, 0.059],   // #e7500f
  grigio:  [0.337, 0.361, 0.400],   // #565c66
  bianco:  [1, 1, 1],
};
