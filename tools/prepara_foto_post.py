# -*- coding: utf-8 -*-
"""Archivio delle foto per l'«Immagine proposta» dei post (pagina Comunicazione).

Le foto stanno in 5_MEDIA/FOTO del vault; l'app gira nel browser e non le vede.
Questo script ne copia una scelta in img/foto-post/ (lato lungo 1600 px, JPEG 82),
così l'app le serve dalla sua stessa origine (il canvas resta esportabile) e scrive
img/foto-post/archivio.json con la descrizione e le parole che la proposta usa
per scegliere la foto dalla «Grafica suggerita» della redazione.
Foto ammesse: tutte quelle di 5_MEDIA (utente, 09/11/2026); personale e allievi
Tagliani col volto hanno la liberatoria. Sul gilet del ritratto del personale il
logo vecchio è sostituito con quello ufficiale FORMEDIL PADOVA.
Uso: python tools/prepara_foto_post.py   (rifà tutto)"""
import json, os, sys
from PIL import Image, ImageOps

QUI = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(QUI, "..", "img", "foto-post")
FOTO = r"C:\Google Drive Gsuite\5_MEDIA\FOTO"
ST = r"Tagliani\2025_05_Servizio-Stanghella\2025_05_29_IMG_servizio-Stanghella-"
PD = r"Tagliani\2025_06_Servizio-Padova\2025_06_05_IMG_servizio-Padova-"
DS = r"2009_Servizio-fotografico-De-Sandre\Alta_risoluzione_JPG\GDS03CANBW"
IC = "Immagini_cantiere\\"

# nome, sorgente, descrizione, parole chiave (minuscole) per la scelta automatica, fonte
ARCHIVIO = [
    ("istruttore-planimetria", ST + "DSCF0041.jpg", "Istruttore che illustra una planimetria", ["planimetria", "istruttore", "progetto", "pos", "formazione"], "Tagliani, Stanghella 29/05/2025"),
    ("istruttore-indica-lavoro", ST + "DSCF9915.jpg", "Istruttore che indica il lavoro agli allievi", ["istruttore", "allievi", "indica", "conferenza"], "Tagliani, Stanghella 29/05/2025"),
    ("istruttore-livella", ST + "DSCF9946.jpg", "Istruttore con la livella", ["livella", "istruttore", "verifica"], "Tagliani, Stanghella 29/05/2025"),
    ("lavoratori-di-spalle", ST + "DSCF0025.jpg", "Lavoratori di spalle col casco", ["lavoratori", "rlst", "rls", "spalle"], "Tagliani, Stanghella 29/05/2025"),
    ("escavatore", ST + "DSCF0013.jpg", "Escavatore del cantiere scuola", ["escavatore", "scavo", "macchine"], "Tagliani, Stanghella 29/05/2025"),
    ("armadietti-imbracature", PD + "DSCF0702.jpg", "Armadietti con attrezzi e imbracature", ["armadietti", "imbracature", "attrezzi", "dpi", "smerigliatrice", "anticaduta"], "Tagliani, Padova 05/06/2025"),
    ("allievi-cantiere-scuola", PD + "DSCF0698.jpg", "Allievi al lavoro nel cantiere scuola", ["allievi", "cantiere-scuola", "cantiere scuola", "postura"], "Tagliani, Padova 05/06/2025"),
    ("allievo-carriola", PD + "DSCF0690.jpg", "Allievo con la carriola nel cantiere scuola", ["carriola", "movimentazione", "carichi"], "Tagliani, Padova 05/06/2025"),
    ("tecnico-casco-gilet", r"Tagliani\2026_05_Ritratti-personale-Padova\2026_05_05_IMG_ritratto-personale-Padova-6.jpg", "Tecnico col casco e il gilet FORMEDIL PADOVA in laboratorio", ["tecnico", "casco", "gilet", "laboratorio"], "Tagliani, ritratti del personale 05/05/2026"),
    ("galleria-controluce", DS + "4631c.jpg", "Operai in galleria, controluce (bianco e nero)", ["nero", "lavoro nero", "galleria", "ombra"], "De Sandre 2009"),
    ("trave-alla-gru", DS + "5007cc.jpg", "Trave sollevata dalla gru, operaio che la guida (bianco e nero)", ["gru", "trave", "sollevamento", "coordinatore", "cse"], "De Sandre 2009"),
    ("muratore-filo", DS + "4388.jpg", "Muratore col filo a piombo (bianco e nero)", ["muratore", "filo", "piombo", "muratura"], "De Sandre 2009"),
    ("mani-casco", DS + "5251.jpg", "Mani che reggono il casco (bianco e nero)", ["mani", "casco", "dpi"], "De Sandre 2009"),
    ("rete-alla-gru", DS + "5289.jpg", "Rete elettrosaldata appesa alla gru (bianco e nero)", ["rete", "gru", "carico sospeso"], "De Sandre 2009"),
    ("edificio-ponteggio", IC + "IMG_edificio-con-ponteggio.jpg", "Edificio col ponteggio", ["ponteggio", "facciata", "edificio", "notifica", "cantiere"], "Immagini_cantiere (archivio)"),
    ("mani-progetto-casco", IC + "IMG_mani-su-progetto-con-casco.jpg", "Mani sul progetto e casco giallo", ["progetto", "crediti", "patente", "recupero"], "Immagini_cantiere (archivio)"),
    ("due-operai-progetto", IC + "IMG_due-operai-con-progetto.jpg", "Due operai che guardano un progetto", ["tecnico risponde", "domanda", "progetto"], "Immagini_cantiere (archivio)"),
    ("cantiere-squadra-ai", IC + "IMG_immagine-AI-marzo-2026-1.png", "Squadra col casco davanti a uno scavo (immagine AI)", ["controlli", "ispettorato", "squadra", "scavo"], "immagine AI, marzo 2026"),
    ("casco-sul-cantiere-ai", IC + "IMG_immagine-AI-casco-su-cantiere.png", "Casco e planimetria su un banco, cantiere sullo sfondo (immagine AI)", ["sopralluogo", "visita", "casco"], "immagine AI"),
]

def tecnico_col_logo_nuovo(im):
    sys.path.insert(0, r"C:\Google Drive Gsuite\5_MEDIA\PUBBLICAZIONI\2026_11_Patente-a-crediti-nuovi-requisiti")
    from importlib import import_module
    m = import_module("2026_11_09_logo_su_gilet")
    return m.sostituisci_logo(im, (1760, 3390, 2290, 3690), centro=(2030, 3550), larghezza=540, angolo=-2)

def main():
    os.makedirs(OUT, exist_ok=True)
    righe = []
    for nome, src, descr, parole, fonte in ARCHIVIO:
        im = ImageOps.exif_transpose(Image.open(os.path.join(FOTO, src))).convert("RGB")
        if nome == "tecnico-casco-gilet":
            im = tecnico_col_logo_nuovo(im)
        im.thumbnail((1600, 1600), Image.LANCZOS)
        im.save(os.path.join(OUT, nome + ".jpg"), quality=82, optimize=True, progressive=True)
        righe.append({"nome": nome, "file": f"img/foto-post/{nome}.jpg", "descrizione": descr, "parole": parole, "fonte": fonte,
                      "larghezza": im.width, "altezza": im.height})
        print(nome, im.size)
    with open(os.path.join(OUT, "archivio.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(righe, f, ensure_ascii=False, indent=1)
        f.write("\n")

if __name__ == "__main__":
    main()
