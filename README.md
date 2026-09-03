# 2026 — Wallpapers

A single-page site for handing out this year's photographs as phone wallpapers.
The site itself is static — no build step, no dependencies. A small optional
Cloudflare Worker adds download counts and the mailing list.

```
site/            the website (this is what you deploy)
  index.html
  app.css
  app.js         ← the SITE block at the top is the only thing you must edit
  w/
    index.js     generated: titles, places, palettes, sizes, series, placeholders
    full/        native resolution, re-encoded — what people download
    view/        ≤1080×1920 webp — what the site shows
    thumb/       ≤360px webp — gallery and filmstrip
build.py         regenerates everything above from a folder of photos
titles.json      titles and captions, keyed by original filename
places.json      GPS → place-name lookup, plus manual entries for photos with no GPS
worker/          optional API: download counts + new-drops signup
Photos-1-001/    the originals (never modified, never deployed)
```

## Running it locally

Serve it over http — not as a `file://` path. The screen-fitting and zip tools
read photos into a canvas, which browsers block on local files.

```sh
cd site && python3 -m http.server 8000
# then open http://localhost:8000
```

## What it does

**Viewer** — one wallpaper filling the screen, newest first. Swipe, drag, arrow
keys or a trackpad move between them, one at a time. As the photo changes the
whole page re-tints: background, glow, accent and text colours interpolate to
the palette sampled from that photograph, and a blurred copy of it crossfades in
behind everything. Tap the photo to clear the UI away entirely.

The phone transition is a cross-dissolve with a little parallax and depth, built
from `transform` and `opacity` alone — both run on the compositor, so it holds
frame rate while a finger is moving. The filmstrip is desktop-only; on a phone
you just swipe.

Keeping it smooth turned out to be less about the swipe than about what runs
*after* it, and the mobile block at the bottom of `app.css` exists entirely for
that. If you edit it, the rules to be careful with:

- **Nothing that animates may carry a `filter`.** Animating `transform` on a
  blurred layer re-rasterises that blur every frame. The ambient wash layers are
  `display:none` on mobile — the photo is full-bleed and opaque there, so they
  were being computed underneath something that completely covers them.
- **`backdrop-filter` re-blurs its backdrop every frame.** Over a photo moving
  under a finger, that is the whole budget. The buttons use flat translucent
  fills on mobile instead.
- **The animated colour properties drive ~45 `color-mix()` calls.** Each is a
  repaint per frame for the length of `--tint`. Large surfaces (the wash, the
  scrims) use static `rgba()` on mobile so they stay out of it, and `--tint` is
  shortened there.
- **`.gallery[hidden]` needs its own rule.** `.gallery` sets `display:flex`,
  which beats the browser's `[hidden]` rule — without it the whole gallery stays
  laid out below the fold and keeps re-animating on every swipe.

The visible cost of all this is that on a phone the colour swap lives in the
accent — the download button, the swatch bar, the tint behind the dissolve —
rather than in a full ambient wash. Desktop keeps the wash.

Each frame shows its title and the place it was taken. Locations come from the
photo's own GPS, matched to a name in `places.json` at city/area level — the
coordinates themselves never reach the website.

**Tools**

- **Download** — the full frame, native resolution.
- **Lock preview** — a live clock and date over the photo, to check it doesn't
  swallow them.
- **Share** — on a phone this hands the *actual image* to the native share sheet
  (Web Share Level 2), centre-cropped to that exact screen
  (`screen.width × devicePixelRatio`) on the way out, so it's one tap to Save
  Image and it already fits. Elsewhere it shares the link. No browser can set a
  wallpaper directly — that API doesn't exist on iOS or Android — so after
  saving, the site tells the visitor the two remaining steps for their platform.

**Gallery** — reached by the accent-filled button in the header. One long
horizontal strip you flick or drag through, newest first, cut into the series
the photos were shot in (same place, same day), so near-identical frames always
sit together and in order. Vertical rules carry the place and date. Two
rows; on a wide screen a series with an odd number of frames ends on a large
card, which is what gives the strip its rhythm. Underneath, a colour ribbon of
the whole year doubles as a scrubber — drag it to fly from January to August.

Filter by colour family (blue, amber, rust, teal, stone), computed from the
photographs rather than tagged by hand. **Download the set** zips whatever the
filter is showing, built in the browser with no library.

Every wallpaper has its own URL (`#/w/2026-06-24-082111`), so links are shareable.

Keyboard: `←` `→` move, `G` toggles the gallery, `D` downloads, `Esc` brings the
controls back.

## Adding photographs

Drop new files into the folder and run:

```sh
python3 build.py                      # defaults to Photos-1-001
python3 build.py Photos-2027          # any folder of jpg/png
python3 build.py --force              # re-encode everything from scratch
```

It skips photos already built, so re-running is cheap, and it prints exactly
what's still missing. Filenames shaped like `IMG20260624082111.jpg` give the
date and time for free, and everything is sorted newest first.

New photos come out titled with their filename. Add real ones to `titles.json`:

```json
"IMG20260624082111.jpg": {
  "title": "Foam",
  "caption": "Aerial turquoise, churned white where it breaks."
}
```

Captions aren't printed on the page — they're the images' alt text, which is
what a screen reader reads out, so they're worth writing.

**Locations** are matched automatically from GPS against the list in
`places.json`. If a new photo lands somewhere new, `build.py` reports it with no
location; add a row (label, lat, lon, radius in km) and re-run. Photos with no
GPS at all go in the `manual` block, keyed by filename.

> Four January frames have no GPS: `IMG20260111161443`, `IMG20260117152951`,
> `IMG20260117172216~2`, `IMG20260129105306`. They look like Haarlem to me —
> the spire and the green dome match the GPS-tagged Haarlem set — but I haven't
> asserted that. Fill in `places.json` → `manual` and re-run.

Requires Pillow (`pip3 install pillow`). Nothing else.

## Before you publish

In `site/app.js`, the `SITE` block:

```js
const SITE = {
  author: 'Aris',     // footer + share text
  handle: '',         // optional, e.g. '@arisvom'
  link  : '',         // optional
  api   : '',         // your Worker URL — see worker/README.md
  email : ''          // fallback for the signup if you skip the Worker
};
```

- `api` empty ⇒ download counts are hidden rather than faked.
- `api` and `email` both empty ⇒ the "New drops" button hides itself.

Also worth editing in `index.html`: the `<title>`, the meta description, the
gallery intro paragraph, and the footer licence line (currently personal use).

## Deploying

`site/` is static — any host works. It's about 140 MB, nearly all of it the
full-resolution downloads; browsing only ever fetches the ~21 MB of `view/` and
`thumb/`.

For counts and the mailing list, deploy `worker/` too — see `worker/README.md`.
It's a Cloudflare Worker plus a D1 database, about five commands, free tier.
