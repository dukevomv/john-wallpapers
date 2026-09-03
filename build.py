#!/usr/bin/env python3
"""
Build the wallpaper site from a folder of photographs.

    python3 build.py [source-folder]

For each photo it writes three sizes plus a colour palette, then regenerates
site/w/index.js — the single data file the site reads.

  site/w/full/   native resolution, re-encoded (what people download)
  site/w/view/   max 1080×1920 webp (what the site displays)
  site/w/thumb/  max 360px webp (grid + filmstrip)

Titles and captions live in titles.json, keyed by original filename. Anything
missing there gets a placeholder you can edit and re-run — re-running is cheap
and never touches photos that are already built unless you pass --force.

Requires Pillow:  pip3 install pillow
"""

import os, sys, io, json, base64, colorsys, re, math, hashlib
from PIL import Image, ImageFilter

ROOT   = os.path.dirname(os.path.abspath(__file__))
SRC    = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('-') else os.path.join(ROOT, 'Photos-1-001')
OUT    = os.path.join(ROOT, 'site', 'w')
FORCE  = '--force' in sys.argv
TITLES = os.path.join(ROOT, 'titles.json')
PLACES = os.path.join(ROOT, 'places.json')

VIEW_MAX  = (1080, 1920)
THUMB_MAX = (360, 360)
MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June',
          'July', 'August', 'September', 'October', 'November', 'December']
SEASON = {1:'winter', 2:'winter', 3:'early spring', 4:'spring', 5:'spring', 6:'summer',
          7:'summer', 8:'late summer', 9:'autumn', 10:'autumn', 11:'autumn', 12:'winter'}


def hex_of(c):
    return '#%02x%02x%02x' % tuple(int(max(0, min(255, v))) for v in c)


def slug_of(filename):
    """IMG20260624082111.jpg -> 2026-06-24-082111. Falls back to the bare name."""
    m = re.match(r'IMG(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})', filename)
    if m:
        y, mo, d, h, mi, s = m.groups()
        return f'{y}-{mo}-{d}-{h}{mi}{s}', f'{y}-{mo}-{d}', int(mo)
    stem = os.path.splitext(filename)[0]
    stem = re.sub(r'[^A-Za-z0-9]+', '-', stem).strip('-').lower()
    return stem, '', 0


def gps_of(im):
    """Latitude/longitude from EXIF, or None. Never written to the site — only
    used to pick a place label, so exact coordinates stay private."""
    exif = im.getexif()
    if not exif:
        return None
    tags = exif.get_ifd(0x8825)
    if not tags or 2 not in tags or 4 not in tags:
        return None

    def dms(v):
        return float(v[0]) + float(v[1]) / 60 + float(v[2]) / 3600

    lat = dms(tags[2]) * (1 if tags.get(1) == 'N' else -1)
    lon = dms(tags[4]) * (1 if tags.get(3) == 'E' else -1)
    return lat, lon


def place_of(coords, filename, places):
    """The matched place row, or {}. Returns the whole row so city and country
    come along for the 'By place' timeline."""
    if not coords:
        manual = places.get('manual', {}).get(filename, '')
        if not manual:
            return {}
        for p in places['places']:
            if p['label'] == manual:
                return p
        head, _, tail = manual.partition(',')
        return {'label': manual, 'city': head.strip(), 'country': tail.strip()}

    lat, lon = coords
    best, best_km = {}, 1e9
    for p in places['places']:
        km = math.hypot((lat - p['lat']) * 111.0,
                        (lon - p['lon']) * 111.0 * math.cos(math.radians(lat)))
        if km <= p['radiusKm'] and km < best_km:
            best, best_km = p, km
    return best


def palette(im):
    """An accent colour plus the dark tints the page animates between."""
    small = im.copy(); small.thumbnail((160, 160))
    q = small.convert('RGB').quantize(colors=12, method=Image.MEDIANCUT)
    pal, counts = q.getpalette(), sorted(q.getcolors(), reverse=True)
    total = sum(c for c, _ in counts)

    entries = []
    for count, idx in counts:
        r, g, b = pal[idx * 3: idx * 3 + 3]
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        entries.append({'rgb': (r, g, b), 'w': count / total, 'h': h, 'l': l, 's': s})

    # the accent wants to be vivid, mid-toned, and actually present in the frame
    def score(e):
        return (e['s'] ** 1.2) * (e['w'] ** 0.35) * max(1 - abs(e['l'] - 0.55) * 1.1, 0.12)

    accent = max(entries, key=score)
    h, _, s = colorsys.rgb_to_hls(*[c / 255 for c in accent['rgb']])

    def hls(lightness, sat):
        return hex_of([c * 255 for c in colorsys.hls_to_rgb(h, lightness, sat)])

    return {
        'accent': hls(0.70, max(s, 0.55)),
        'glow'  : hls(0.52, min(max(s, 0.50), 0.85)),
        'deep'  : hls(0.055, min(max(s, 0.35), 0.62)),
        'deep2' : hex_of([c * 255 for c in colorsys.hls_to_rgb((h + 0.045) % 1, 0.135, min(max(s, 0.32), 0.55))]),
        'soft'  : hls(0.34, min(max(s, 0.35), 0.60)),
        'ink'   : hls(0.90, min(s, 0.35)),
        'muted' : hls(0.66, min(s * 0.6, 0.22)),
        'hue'   : round(h * 360),
        'sat'   : round(s * 100),
        'swatches': [hex_of(e['rgb']) for e in entries[:5]],
    }


def family(thumb_path):
    """Which colour shelf the photo belongs on, judged across the whole frame."""
    im = Image.open(thumb_path).convert('RGB'); im.thumbnail((110, 110))
    q = im.quantize(colors=18, method=Image.MEDIANCUT)
    pal, total = q.getpalette(), sum(c for c, _ in q.getcolors())
    buckets, colorful = {}, 0.0
    for count, idx in q.getcolors():
        r, g, b = pal[idx * 3: idx * 3 + 3]
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        weight = (count / total) * s * (1 - abs(l - 0.5) * 0.9)
        colorful += weight
        if s < 0.10:
            continue
        deg = h * 360
        if   195 <= deg < 250: k = 'blue'
        elif 165 <= deg < 195: k = 'teal'
        elif  70 <= deg < 165: k = 'teal'      # foliage greens shelve with teal
        elif  28 <= deg <  70: k = 'amber'
        else:                  k = 'rust'
        buckets[k] = buckets.get(k, 0) + weight
    if colorful < 0.032 or not buckets:
        return 'stone'
    return max(buckets, key=buckets.get)


def placeholder_downloads(slug):
    """Two-digit stand-ins until the Worker is counting for real. Derived from
    the id so they hold still across rebuilds instead of jumping each time."""
    h = int(hashlib.sha1(slug.encode()).hexdigest()[:8], 16)
    return 10 + h % 90


def lqip(im):
    """A 20px blur, inlined as a data URI, so nothing ever pops in blank."""
    t = im.copy(); t.thumbnail((20, 20))
    t = t.filter(ImageFilter.GaussianBlur(0.6))
    buf = io.BytesIO(); t.convert('RGB').save(buf, 'JPEG', quality=42)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


def main():
    if not os.path.isdir(SRC):
        sys.exit(f'No such folder: {SRC}')
    for sub in ('full', 'view', 'thumb'):
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)

    titles = json.load(open(TITLES)) if os.path.exists(TITLES) else {}
    places = json.load(open(PLACES)) if os.path.exists(PLACES) else {'places': [], 'manual': {}}
    files = sorted(f for f in os.listdir(SRC) if f.lower().endswith(('.jpg', '.jpeg', '.png')))
    if not files:
        sys.exit(f'No photographs in {SRC}')

    data, built = [], 0
    for filename in files:
        slug, date, month = slug_of(filename)
        full  = os.path.join(OUT, 'full',  slug + '.jpg')
        view  = os.path.join(OUT, 'view',  slug + '.webp')
        thumb = os.path.join(OUT, 'thumb', slug + '.webp')

        source = Image.open(os.path.join(SRC, filename))
        coords = gps_of(source)
        im = source.convert('RGB')
        width, height = im.size

        if FORCE or not (os.path.exists(full) and os.path.exists(view) and os.path.exists(thumb)):
            im.save(full, 'JPEG', quality=88, optimize=True, progressive=True, subsampling=1)
            v = im.copy(); v.thumbnail(VIEW_MAX, Image.LANCZOS)
            v.save(view, 'WEBP', quality=80, method=5)
            t = im.copy(); t.thumbnail(THUMB_MAX, Image.LANCZOS)
            t.save(thumb, 'WEBP', quality=72, method=5)
            built += 1
            print(f'  built  {slug}')

        meta = titles.get(filename) or {}
        where = place_of(coords, filename, places)
        entry = {
            'id': slug, 'src': filename, 'w': width, 'h': height,
            'date': date, 'month': month, 'monthName': MONTHS[month] if month else '',
            'season': SEASON.get(month, ''),
            'orient': 'portrait' if height >= width else 'landscape',
            'ratio': round(width / height, 4),
            'mb': round(os.path.getsize(full) / 1048576, 2),
            'title': meta.get('title') or slug,
            'caption': meta.get('caption') or '',
            'place': meta.get('place') or where.get('label', ''),
            'city': where.get('city', ''),
            'country': where.get('country', ''),
            'family': family(thumb),
            # Placeholder download counts until the Worker is wired up. Derived
            # from the id so they're stable across rebuilds rather than jumping
            # every time the site is built.
            'downloads': placeholder_downloads(slug),
            'lqip': lqip(im),
        }
        entry.update(palette(im))
        data.append(entry)

    data.sort(key=lambda x: x['id'], reverse=True)   # newest first

    # Grouped by month. Frames stay in the order they were shot, so a burst from
    # one afternoon still sits side by side — but the timeline reads in months,
    # not days, and no exact date is ever published.
    series, current = [], None
    for entry in data:
        if current is None or current['month'] != entry['month']:
            current = {'month': entry['month'], 'monthName': entry['monthName'], 'ids': []}
            series.append(current)
        current['ids'].append(entry['id'])
        entry['series'] = len(series) - 1

    # Country -> city, biggest first at both levels. Frames keep their shot
    # order inside a city.
    by_country = {}
    for entry in data:
        if not entry['country']:
            continue
        by_country.setdefault(entry['country'], {}).setdefault(entry['city'], []).append(entry['id'])

    countries = []
    for country, cities in by_country.items():
        blocks = [{'city': c, 'ids': list(reversed(ids))} for c, ids in cities.items()]
        blocks.sort(key=lambda b: -len(b['ids']))
        countries.append({'country': country,
                          'count': sum(len(b['ids']) for b in blocks),
                          'cities': blocks})
    countries.sort(key=lambda c: -c['count'])

    with open(os.path.join(OUT, 'index.js'), 'w') as f:
        f.write('window.WALLPAPERS=' + json.dumps(data, separators=(',', ':')) + ';\n')
        f.write('window.SERIES=' + json.dumps(series, separators=(',', ':')) + ';\n')
        f.write('window.PLACES=' + json.dumps(countries, separators=(',', ':')) + ';\n')

    print(f'\n{len(data)} wallpapers · {len(series)} months · {len(countries)} countries · {built} newly built · index.js written')

    for label, key, where in (('title/caption', 'caption', 'titles.json'),
                              ('location', 'place', 'places.json ("manual")')):
        missing = [x['src'] for x in data if not x[key]]
        if missing:
            print(f'\n{len(missing)} with no {label} — add them to {where}:')
            for m in missing:
                print('   ' + m)


if __name__ == '__main__':
    main()
