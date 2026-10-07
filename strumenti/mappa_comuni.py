"""Prepara i contorni dei comuni della provincia di Padova per la mappa delle aree dei tecnici (07/10/2026).

Fonte: openpolis/geojson-italy, limits_P_28_municipalities.geojson (confini ISTAT, licenza CC BY 4.0), salvato in
strumenti/dati/. Esce img/mappa-comuni-pd.json: per ogni comune il percorso SVG già proiettato e semplificato, e il punto
dove scrivere il nome. Così il browser non deve fare calcoli né caricare 370 KB di coordinate.

    python strumenti/mappa_comuni.py
"""
import json, math, os, re, unicodedata

QUI = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(QUI, 'dati', 'limits_P_28_municipalities.geojson')
OUT = os.path.join(QUI, '..', 'img', 'mappa-comuni-pd.json')
LARGO = 1000
TOLL = 0.9   # tolleranza della semplificazione, in unità della mappa (1000 = larghezza)


def norm(s):
    s = unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'[^A-Z0-9]+', ' ', s.upper()).strip()


def dp(pts, toll):
    """Douglas-Peucker: toglie i punti che non cambiano la forma oltre la tolleranza."""
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    lung = math.hypot(dx, dy) or 1e-9
    imax, dmax = 0, 0.0
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        d = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / lung
        if d > dmax:
            imax, dmax = i, d
    if dmax <= toll:
        return [pts[0], pts[-1]]
    return dp(pts[:imax + 1], toll)[:-1] + dp(pts[imax:], toll)


def area_anello(p):
    return sum(p[i][0] * p[i - 1][1] - p[i - 1][0] * p[i][1] for i in range(len(p))) / 2


def centro(p):
    a = area_anello(p) or 1e-9
    cx = sum((p[i][0] + p[i - 1][0]) * (p[i][0] * p[i - 1][1] - p[i - 1][0] * p[i][1]) for i in range(len(p))) / (6 * a)
    cy = sum((p[i][1] + p[i - 1][1]) * (p[i][0] * p[i - 1][1] - p[i - 1][0] * p[i][1]) for i in range(len(p))) / (6 * a)
    return cx, cy


g = json.load(open(SRC, encoding='utf-8'))
poligoni = []
for f in g['features']:
    geo = f['geometry']
    polys = geo['coordinates'] if geo['type'] == 'MultiPolygon' else [geo['coordinates']]
    poligoni.append((f['properties'], polys))

tutti = [pt for _, polys in poligoni for poly in polys for ring in poly for pt in ring]
lat0 = sum(p[1] for p in tutti) / len(tutti)
k = math.cos(math.radians(lat0))
xs = [p[0] * k for p in tutti]; ys = [-p[1] for p in tutti]
x0, y0 = min(xs), min(ys)
scala = LARGO / (max(xs) - x0)
alto = round((max(ys) - y0) * scala, 1)
proietta = lambda p: ((p[0] * k - x0) * scala, (-p[1] - y0) * scala)

comuni = []
for prop, polys in poligoni:
    pezzi, grande = [], None
    for poly in polys:
        for j, ring in enumerate(poly):
            # un anello chiuso ha primo e ultimo punto uguali: si semplifica in due metà, se no sparisce
            pp = [proietta(p) for p in ring]
            m = len(pp) // 2
            pts = dp(pp[:m + 1], TOLL)[:-1] + dp(pp[m:], TOLL)
            if len(pts) < 4:
                continue
            pezzi.append('M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in pts[:-1]) + 'Z')
            if j == 0 and (grande is None or abs(area_anello(pts)) > abs(area_anello(grande))):
                grande = pts
    cx, cy = centro(grande)
    comuni.append({'nome': prop['name'], 'norm': norm(prop['name']), 'istat': prop['com_istat_code'],
                   'd': ''.join(pezzi), 'x': round(cx, 1), 'y': round(cy, 1)})

comuni.sort(key=lambda c: c['nome'])
json.dump({'fonte': 'Confini ISTAT da openpolis/geojson-italy (CC BY 4.0)', 'larghezza': LARGO, 'altezza': alto,
           'comuni': comuni}, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(comuni), 'comuni,', os.path.getsize(OUT) // 1024, 'KB, altezza', alto)
