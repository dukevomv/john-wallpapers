# Adding photographs

Everything the site knows about a photograph is derived at build time by
`build.py`. Nothing is written by hand into the site itself, so a new photo
picks up all of it automatically — **provided it arrives in a shape the parser
can read**. This is that shape.

```sh
python3 build.py                 # defaults to Photos/
python3 build.py Photos-2027     # any folder of jpg/png
python3 build.py --force         # re-encode everything from scratch
```

Photos already built are skipped, so re-running is cheap. The script prints
exactly what is still missing at the end — treat that list as the to-do.

---

## 1. The filename carries the date

```
IMG20260624082111.jpg
   └──┬───┘└──┬─┘
   20260624  082111        →  2026-06-24, 08:21:11
```

`IMG<YYYYMMDD><HHMMSS>.<ext>` is the format phones already produce, and it is
the **only** source of date. From it the build derives:

- the frame's id (`2026-06-24-082111`) and therefore its permalink
- the month, which is what the timeline groups on
- the sort order — the whole set runs newest first

A file that doesn't match still builds, but it gets a slug from its bare name,
**no month, and no place on the timeline**. If you rename files, keep this
pattern.

## 2. GPS decides the location

Location comes from the photo's own EXIF GPS, matched against `places.json`.
Nothing is typed per-photo.

```json
{ "label": "Parga, Greece", "city": "Parga", "country": "Greece",
  "lat": 39.2845, "lon": 20.4030, "radiusKm": 8 }
```

- `label` is the line shown under the title.
- `city` and `country` are what the **By place** timeline groups on. They're
  stored explicitly because a country can't be parsed off a label — "Chania,
  **Crete**" is in Greece.
- `radiusKm` is how far from that point a photo still counts as being there.

**When a photo lands somewhere new**, the build reports it with no location.
Add a row and re-run. Keep labels at city/area level: the coordinates
themselves are never published, and that's deliberate.

**`manual` is an outright override**, keyed by filename, and it is checked
*before* GPS:

```json
"manual": { "IMG20260111161443.jpg": "Haarlem, Netherlands" }
```

The value must match an existing `label` so city and country come along with it.
Use it for a photo with no GPS, or to correct one whose coordinates are wrong.

> It used to be consulted only when GPS was **absent**, which meant a photo whose
> coordinates fell outside every `radiusKm` lost its location *and* couldn't be
> given one by hand. If a frame comes back unlocated, check its GPS before
> assuming it has none — the fix is usually a new row in `places`, not a manual
> entry.

## 3. Naming by filename

The simplest way to title a photograph is to put the title in the filename. Two
shapes both work:

```
IMG20260624082111 Foam.jpg          →  "Foam"
IMG20260624082111_gull-and-foam.jpg →  "Gull and Foam"
no meetings.jpg                     →  "No Meetings"
IMG20260624082111~2.jpg             →  no title (a re-export marker, ignored)
```

Separators are interchangeable, a trailing `~N` is always ignored, and the
result is title-cased — small words stay lower, a genuine acronym in mixed case
survives, and A NAME IN CAPS is calmed down.

**Dropping the timestamp is fine.** If the filename no longer carries one, the
date comes from EXIF `DateTimeOriginal` instead, so the frame keeps its id, its
permalink and its place on the timeline. A photo with neither is skipped and
reported — that's the only way to lose one.

Precedence, highest first:

1. a `titles.json` entry keyed by **this exact filename** — a deliberate
   correction, and the way to write something a filename can't hold (an
   apostrophe, or a spelling the file gets wrong)
2. the title derived from the filename
3. whatever the id already had

Captions always fall back by id, so renaming a file to name it never loses the
alt text it already had.

## 4. Titles and captions by hand

`titles.json`, keyed by the original filename:

```json
"IMG20260624082111.jpg": {
  "title": "Foam",
  "caption": "Aerial turquoise, churned white where it breaks."
}
```

A photo with no entry is titled with its slug — it builds, it just reads badly.
The **caption is never printed on the page**; it's the image's `alt` text, which
is what a screen reader announces. Write it as a description of the photograph,
not as marketing.

## 5. Everything else is derived — don't hand-write it

For each photo the build produces, into `site/w/index.js`:

| field | how it's derived |
|---|---|
| three image sizes | full (native, re-encoded), view (≤1080×1920 webp), thumb (≤360px webp) |
| `accent` `deep` `deep2` `soft` `glow` `ink` `muted` | quantise the frame, score colours by saturation × presence × mid-tone, then build the palette the whole page animates to |
| `family` | blue / teal / amber / rust / stone, judged across the whole frame, not the accent |
| `swatches` | the five most present colours |
| `lqip` | a 20px blur inlined as a data URI, so nothing pops in blank |
| `ratio` `w` `h` `mb` | measured off the encoded file |
| `series` | the month block it belongs to |
| `downloads` | a two-digit fallback derived from the id, used only when no API is set |

## 6. What the build guarantees

- **Output images carry no EXIF.** Pillow re-encodes without metadata, so none
  of the GPS that produced "Parga, Greece" is downloadable from the site. This
  is a property of going through `build.py` — a file copied into `site/w/full/`
  by hand would keep its coordinates.
- **Originals are never modified**, and `Photos/` is gitignored. They are the
  only copies that still hold GPS.
- **Ids are stable**, so permalinks and download counts survive a rebuild.

## 7. One year only

`build.py` has a `YEAR` constant. Anything whose filename date falls outside it
is skipped and reported, so a stray photo from another year can't slip into the
set. It also sweeps `site/w/` on every run: generated files whose photograph is
no longer in the source folder are deleted, so a removed frame never lingers in
the deploy.

Titles survive a re-export. If a file comes back as `IMG…~2.jpg`, the same
moment resolves to the same id, and the title is matched on that.

## 8. Shape of the photographs

Portrait 9:16 is the target — they're phone wallpapers. Landscape frames build
fine and appear throughout, but they're cropped to portrait in the viewer, the
same way a phone would crop them.

## 9. After a rebuild

`build.py` rewrites `site/w/index.js` only. Commit that alongside the new files
in `site/w/`, push, and the deploy runs itself.

The `downloads` numbers in `index.js` are only a fallback for previewing with no
API configured. The live site reads real counts from the deployed Worker, so
they are unaffected by a rebuild — the ids are stable, so a frame keeps its
tally.
