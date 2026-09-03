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
Photos/    the originals (never modified, never deployed)
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
- **`body` must never be `overflow: hidden`.** Body overflow propagates to the
  viewport, and a viewport that cannot scroll is one where Chrome switches off
  pull-to-refresh. Only the horizontal axis is clipped (`overflow-x: hidden`);
  each view is exactly `100dvh`, so nothing scrolls vertically anyway. Same for
  `overscroll-behavior`: use the `-x` longhand, since the shorthand pins the
  vertical axis that the gesture rides on.
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
- **Share** — on a phone this hands the native share sheet the *full photograph*,
  uncropped, together with its link, so the target can take whichever it wants:
  Save Image, or a URL into a message. Elsewhere it shares the link. Nothing is
  cropped on the way out — the phone crops against the real screen when the
  wallpaper is set, and it does that better than a canvas can. No browser can
  set a wallpaper directly (that API exists on neither iOS nor Android), so
  after saving, the site names the two remaining steps.

Every frame has a permalink — `#/w/2026-06-24-082111` — and opening one goes
straight to that photograph.

**Timeline** — reached by the accent-filled button in the header. One long
horizontal strip you flick or drag through, in one of two groupings:

- **By month** — running oldest to newest, left to right, so it reads as a year.
  It opens scrolled to the right-hand end, at now.
- **By place** — country headings, each broken into its cities, biggest first.
  Same layout, same sliding; a different way through the same frames. Frames stay in the order they were shot, so a burst
from one afternoon still sits side by side. No exact dates are published
anywhere; the month is as fine as it gets. Two rows, and on a wide screen a
month with an odd number of frames ends on a large card, which is what gives the
strip its rhythm. Underneath, a colour ribbon of the whole year doubles as a
scrubber.

Filter by colour family (blue, amber, rust, teal, stone), computed from the
photographs rather than tagged by hand. **Download the set** zips whatever the
filter is showing, built in the browser with no library.

Every wallpaper has its own URL (`#/w/2026-06-24-082111`), so links are shareable.

Keyboard: `←` `→` move, `G` toggles the gallery, `D` downloads, `Esc` brings the
controls back.

## Adding photographs

```sh
python3 build.py                 # defaults to Photos/
python3 build.py Photos-2027     # any folder of jpg/png
python3 build.py --force         # re-encode everything from scratch
```

Everything the site shows is derived at build time, so new photographs inherit
all of it — palettes, colour families, placeholders, timeline grouping — as long
as they arrive in a shape the parser can read. Three things it needs from you:

1. **The filename carries the date.** `IMG<YYYYMMDD><HHMMSS>.jpg`, which is what
   phones already produce. It's the only source of date, id, permalink, month
   and sort order.
2. **GPS decides the location**, matched against `places.json`. A photo from
   somewhere new is reported with no location — add a row (label, city, country,
   lat, lon, radiusKm) and re-run. No GPS at all goes in the `manual` block.
3. **Titles and captions** live in `titles.json`. The caption isn't printed —
   it's the image's alt text.

`build.py` prints exactly what's still missing after every run.

**→ [ADDING-PHOTOS.md](ADDING-PHOTOS.md) is the full contract**, including what
the build derives, why output images carry no EXIF, and what not to hand-write.

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

- `api` is live at `https://wallpapers-api.dukevomv.workers.dev`, so the counts
  on the site are **real**. They started from zero the day it went up. The
  `downloads` numbers baked into `w/index.js` are only a stand-in for previewing
  with no API configured — set `api` to `''` and you get those instead.
- `api` and `email` both empty ⇒ the "New drops" button hides itself.

Also worth editing in `index.html`: the `<title>`, the meta description, the
gallery intro paragraph, and the footer licence line (currently personal use).

## Deploying

`site/` is static — any host works. It's about 140 MB, nearly all of it the
full-resolution downloads; browsing only ever fetches the ~21 MB of `view/` and
`thumb/`.

`worker/` is deployed and live — a Cloudflare Worker on Workers KV, counting
downloads and holding the mailing list. See `worker/README.md` for the endpoints
and how to redeploy it.
