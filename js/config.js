/* ============================================================
   Configurazione — Gestionale Segreteria Formedil Padova
   Stesso database Supabase del gestionale visite e della
   webapp asseverazione: qui si legge/scrive solo lo schema s_*.
   ============================================================ */

export const SB_URL = 'https://utdantrfugnmqsuujxbe.supabase.co';
export const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0ZGFudHJmdWdubXFzdXVqeGJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNjEzMTYsImV4cCI6MjA5MzgzNzMxNn0.L6YUgMD9rYPtqZCn5-c6hB-ok5nSCISpSolj_a-pcmM';

/* Bucket Storage dei documenti protocollati */
export const BUCKET = 'protocollo';

/* Righe per pagina nel registro */
export const PAGE_SIZE = 50;

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
