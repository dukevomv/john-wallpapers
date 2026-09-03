/* ============================================================
   2026 Wallpapers — viewer, gallery, and the wallpaper tools
   ============================================================ */

/*  ▸▸ EDIT ME ◂◂
    author/handle/link  — shown in the footer and the share sheet.
    api                 — your deployed Worker (see worker/README.md). Until this
                          is set, download counts stay hidden.
    email               — fallback for the signup when there's no api: submitting
                          opens the visitor's mail app instead. Leave both empty
                          and the "New drops" button hides itself.                */
const SITE = {
  author: 'John Doe',
  handle: '@john_doe_on_earth',
  link  : 'https://instagram.com/john_doe_on_earth',
  api   : '',
  email : ''
};

const W = window.WALLPAPERS;
const SERIES = window.SERIES || [];
const $ = (s, r = document) => r.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const FAMILIES = {
  blue : { label: 'Blue',  dot: '#6f9fd8' },
  teal : { label: 'Teal',  dot: '#5fb8b4' },
  amber: { label: 'Amber', dot: '#d9a75f' },
  rust : { label: 'Rust',  dot: '#cf6a4c' },
  stone: { label: 'Stone', dot: '#9aa2ab' }
};

const el = {
  body: document.body,
  viewport: $('#viewport'), track: $('#track'), chrome: $('#chrome'),
  title: $('#title'), place: $('#place'), placeText: $('#placeText'), specs: $('#specs'),
  swatches: $('#swatches'), meta: $('.meta'), counter: $('#counter'),
  rail: $('#rail'), gallery: $('#gallery'), filters: $('#filters'),
  strip: $('#strip'), stripTrack: $('#stripTrack'),
  scrub: $('#scrub'), scrubBars: $('#scrubBars'), scrubWindow: $('#scrubWindow'),
  packBtn: $('#packBtn'), packLabel: $('#packLabel'),
  toast: $('#toast'), footNote: $('#footNote'),
  blurA: $('.field-blur[data-layer="a"]'), blurB: $('.field-blur[data-layer="b"]'),
  themeMeta: $('meta[name="theme-color"]'),
  lockTime: $('#lockTime'), lockDate: $('#lockDate')
};

const state = {
  index: 0,
  pos: 0,                 // fractional slide position while dragging
  view: 'stage',
  filter: 'all',
  geo: { w: 0, h: 0, gap: 0, step: 0, radius: 0, mobile: true },
  slides: new Map(),
  blurTop: 'a',
  stripScroll: null,        // null = never opened; start at 'now'
  rows: 2, heroes: true,
  counts: null            // null until the API answers; {} means "none yet"
};

const path = {
  view : id => `w/view/${id}.webp`,
  thumb: id => `w/thumb/${id}.webp`,
  full : id => `w/full/${id}.jpg`
};

/* ── geometry ────────────────────────────────────────────── */
function measure() {
  const mobile = innerWidth < 861;
  const vw = el.viewport.clientWidth;
  const vh = el.viewport.clientHeight;
  let w, h, gap, radius;

  if (mobile) {
    w = vw; h = vh; gap = 0; radius = 0;
  } else {
    const ratio = W[state.index].ratio;
    h = vh - 40;
    w = h * ratio;
    const maxW = vw * 0.66;
    if (w > maxW) { w = maxW; h = w / ratio; }
    gap = Math.max(28, w * 0.14);
    radius = 22;
  }
  // step = how far a finger travels to advance one photo. On mobile the frames
  // barely move — they dissolve — so the travel and the visible shift differ.
  state.geo = { w, h, gap, radius, mobile, step: mobile ? w : w + gap,
                boxH: vh - 40, maxW: vw * 0.66 };
  el.viewport.style.setProperty('--sw', w + 'px');
  el.viewport.style.setProperty('--sh', h + 'px');
  el.viewport.style.setProperty('--radius', radius + 'px');
}

/* each frame keeps its own aspect — the four landscape shots included */
function sizeOf(i) {
  const g = state.geo;
  if (g.mobile) return { w: g.w, h: g.h };
  const ratio = W[i].ratio;
  let w = g.boxH * ratio, h = g.boxH;
  if (w > g.maxW) { w = g.maxW; h = w / ratio; }
  return { w, h };
}

/* ── slides ──────────────────────────────────────────────── */
function slideFor(i) {
  if (state.slides.has(i)) return state.slides.get(i);
  const item = W[i];
  const node = document.createElement('div');
  node.className = 'slide';
  node.dataset.i = i;

  const lq = document.createElement('img');
  lq.className = 'lqip'; lq.src = item.lqip; lq.alt = '';

  const img = document.createElement('img');
  img.decoding = 'async';
  img.alt = item.caption || `${item.title}${item.place ? ' — ' + item.place : ''}`;
  img.src = path.view(item.id);
  img.addEventListener('load', () => node.classList.add('ready'), { once: true });
  if (img.complete) node.classList.add('ready');

  node.append(lq, img);
  el.track.appendChild(node);
  state.slides.set(i, node);
  return node;
}

function layout() {
  const { w, gap, mobile } = state.geo;
  // Only ever three full-screen layers on a phone. Seven of them, each its own
  // composited layer, is what made swiping stutter.
  const span = mobile ? 1 : 3;
  const lo = Math.max(0, Math.round(state.pos) - span);
  const hi = Math.min(W.length - 1, Math.round(state.pos) + span);

  for (const [i, node] of state.slides) {
    if (i < lo - 1 || i > hi + 1) { node.remove(); state.slides.delete(i); }
  }

  for (let i = lo; i <= hi; i++) {
    const node = slideFor(i);
    const d = i - state.pos;          // <0 already passed, >0 still coming
    const ad = Math.abs(d);
    const sz = sizeOf(i);
    let x, scale, opacity, filter = '';

    if (mobile) {
      // Transform and opacity only — both run on the compositor, so this stays
      // at frame rate while a finger is moving. No blur: it forces a repaint of
      // a full-screen layer every frame, which is what dropped the frames.
      x = d < 0 ? d * w * 0.10 : d * w * 0.20;
      scale = d < 0 ? 1 - ad * 0.02 : 1 + ad * 0.07;
      opacity = clamp(1 - ad * 1.08, 0, 1);
    } else {
      x = d * (w + gap);
      scale = 1 - Math.min(ad, 3) * 0.11;
      opacity = clamp(1 - ad * 0.42, 0, 1);
      filter = ad < 0.004 ? '' : 'brightness(.55) saturate(.75)';
    }

    node.style.setProperty('--sw', sz.w + 'px');
    node.style.setProperty('--sh', sz.h + 'px');
    node.style.setProperty('--x', x);
    node.style.setProperty('--s', scale.toFixed(4));
    node.style.setProperty('--o', opacity.toFixed(3));
    if (node.style.filter !== filter) node.style.filter = filter;
    node.classList.toggle('current', i === state.index);
    // Must stay inside 1..19: the lock-screen overlay (22), the arrows (24) and
    // the chrome (30) all sit above the slides. Going negative drops a frame
    // behind the background mid-swipe; going above 30 paints over the controls.
    node.style.zIndex = String(Math.max(1, Math.round(19 - ad * 3) - (d > 0 ? 0 : 1)));
  }

  const cur = sizeOf(state.index);
  el.viewport.style.setProperty('--sw', cur.w + 'px');
  el.viewport.style.setProperty('--sh', cur.h + 'px');
}

/* Only three slides live in the DOM on a phone, so warm the next few images
   here instead — a cached decode costs nothing, an extra layer costs a lot. */
const warmed = new Set();
function preload(centre) {
  for (let d = -2; d <= 2; d++) {
    const i = centre + d;
    if (i < 0 || i >= W.length || warmed.has(i)) continue;
    warmed.add(i);
    const img = new Image();
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.src = path.view(W[i].id);
  }
}

/* ── palette + ambient background ────────────────────────── */
function applyPalette(item) {
  const r = document.documentElement.style;
  for (const k of ['deep', 'deep2', 'soft', 'glow', 'accent', 'ink', 'muted']) {
    r.setProperty('--' + k, item[k]);
  }
  el.themeMeta.setAttribute('content', item.deep);

  if (state.geo.mobile) return;      // the wash layers are hidden on a phone
  const next = state.blurTop === 'a' ? el.blurB : el.blurA;
  const prev = state.blurTop === 'a' ? el.blurA : el.blurB;
  // The 20px placeholder blown up *is* the blur — no full-size decode, and no
  // 72px filter over the whole viewport on every change.
  next.style.backgroundImage = `url("${item.lqip}")`;
  requestAnimationFrame(() => { next.classList.add('on'); prev.classList.remove('on'); });
  state.blurTop = state.blurTop === 'a' ? 'b' : 'a';
}

/* ── the current item ────────────────────────────────────── */
function specsFor(item) {
  const bits = [`${item.monthName} 2026`, `${item.w}×${item.h}`, `${item.mb} MB`];
  const n = state.counts && state.counts[item.id];
  if (n) bits.push(`${n.toLocaleString()} download${n === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

function render(item) {
  el.title.textContent = item.title;
  el.placeText.textContent = item.place;
  el.place.hidden = !item.place;
  el.specs.textContent = specsFor(item);
  el.counter.textContent = `${String(state.index + 1).padStart(2, '0')} / ${W.length}`;

  el.swatches.innerHTML = '';
  item.swatches.forEach((c, n) => {
    const i = document.createElement('i');
    i.style.background = c;
    i.style.animationDelay = (n * 55) + 'ms';
    el.swatches.appendChild(i);
  });

  el.meta.classList.remove('swap');
  void el.meta.offsetWidth;
  el.meta.classList.add('swap');

  // the filmstrip is hidden on a phone — don't walk 61 buttons on every swipe
  if (!state.geo.mobile) {
    for (const b of el.rail.children) {
      const on = Number(b.dataset.i) === state.index;
      if (on) {
        b.setAttribute('aria-current', 'true');
        b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduce ? 'auto' : 'smooth' });
      } else b.removeAttribute('aria-current');
    }
  }
  for (const b of $('#year').children) {
    if (Number(b.dataset.m) === item.month) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  }
  $('#prevBtn').disabled = state.index === 0;
  $('#nextBtn').disabled = state.index === W.length - 1;
}

function goTo(i, { instant = false } = {}) {
  i = clamp(i, 0, W.length - 1);
  const changed = i !== state.index;
  state.index = i;
  state.pos = i;
  if (!state.geo.mobile) measure();
  if (instant) {
    el.viewport.classList.add('dragging');
    layout();
    void el.track.offsetWidth;
    el.viewport.classList.remove('dragging');
  } else layout();
  const item = W[i];
  applyPalette(item);
  render(item);
  preload(i);
  if (changed || !location.hash.startsWith('#/w/')) {
    history.replaceState(null, '', `#/w/${item.id}`);
  }
}

/* ── drag / swipe ────────────────────────────────────────── */
(function drag() {
  let id = null, x0 = 0, y0 = 0, p0 = 0, t0 = 0, axis = null;

  el.viewport.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.target.closest('.arrow')) return;
    id = e.pointerId; x0 = e.clientX; y0 = e.clientY;
    p0 = state.pos; t0 = performance.now(); axis = null;
  });

  el.viewport.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (!axis) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axis === 'x') {
        el.viewport.setPointerCapture(id);
        el.viewport.classList.add('dragging');
      } else { id = null; return; }
    }
    let p = p0 - dx / state.geo.step;
    if (p < 0) p *= 0.32;
    if (p > W.length - 1) p = (W.length - 1) + (p - (W.length - 1)) * 0.32;
    state.pos = p;
    layout();
  });

  const end = e => {
    if (e.pointerId !== id) return;
    const wasDragging = axis === 'x';
    id = null; axis = null;
    el.viewport.classList.remove('dragging');
    if (!wasDragging) return;
    const v = (e.clientX - x0) / Math.max(performance.now() - t0, 1);   // px/ms
    let target = Math.round(state.pos);
    if (Math.abs(v) > 0.45) target = v < 0 ? Math.ceil(state.pos) : Math.floor(state.pos);
    goTo(target);
  };
  el.viewport.addEventListener('pointerup', end);
  el.viewport.addEventListener('pointercancel', end);

  el.viewport.addEventListener('click', e => {
    if (e.target.closest('.arrow')) return;
    if (Math.abs(e.clientX - x0) > 6) return;
    el.body.classList.toggle('immersive');
  });
  $('#immersiveExit').addEventListener('click', e => {
    e.stopPropagation();
    el.body.classList.remove('immersive');
  });

  let wheelLock = 0;
  el.viewport.addEventListener('wheel', e => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 12) return;
    e.preventDefault();
    const now = performance.now();
    if (now - wheelLock < 380) return;
    wheelLock = now;
    goTo(state.index + Math.sign(d));
  }, { passive: false });
})();

$('#prevBtn').addEventListener('click', () => goTo(state.index - 1));
$('#nextBtn').addEventListener('click', () => goTo(state.index + 1));

/* ── filmstrip + year strip ──────────────────────────────── */
function buildRail() {
  const frag = document.createDocumentFragment();
  W.forEach((item, i) => {
    const b = document.createElement('button');
    b.dataset.i = i;
    b.setAttribute('aria-label', item.title);
    const img = document.createElement('img');
    img.src = path.thumb(item.id); img.alt = ''; img.loading = 'lazy';
    b.appendChild(img);
    b.addEventListener('click', () => { showStage(); goTo(i); });
    frag.appendChild(b);
  });
  el.rail.appendChild(frag);
}

const MONTH_LETTERS = 'JFMAMJJASOND';
function buildYear() {
  const counts = new Array(13).fill(0);
  W.forEach(x => counts[x.month]++);
  const max = Math.max(...counts);
  const yr = $('#year');
  for (let m = 1; m <= 12; m++) {
    const b = document.createElement('button');
    b.className = 'year-m'; b.dataset.m = m;
    b.disabled = !counts[m];
    b.title = counts[m]
      ? `${W.find(x => x.month === m).monthName} — ${counts[m]} wallpaper${counts[m] > 1 ? 's' : ''}`
      : 'Nothing here yet';
    b.innerHTML = `<span class="year-bar" style="--fill:${(counts[m] / max).toFixed(3)}"></span><em>${MONTH_LETTERS[m - 1]}</em>`;
    b.addEventListener('click', () => goTo(W.findIndex(x => x.month === m)));
    yr.appendChild(b);
  }
}

/* ── gallery: one long horizontal strip, split into the series
      they were shot in, so near-identical frames stay together ── */
function buildStrip() {
  const frag = document.createDocumentFragment();
  let cells = null, seriesIndex = -1;

  // The data is newest-first for the viewer; a timeline has to read the other
  // way, so walk it backwards. Series are contiguous, so they stay intact.
  for (const i of [...W.keys()].reverse()) {
    const item = W[i];
    if (item.series !== seriesIndex) {
      seriesIndex = item.series;
      const s = SERIES[seriesIndex];
      const group = document.createElement('div');
      group.className = 'grp';
      group.dataset.series = seriesIndex;
      const sep = document.createElement('div');
      sep.className = 'sep';
      sep.innerHTML = `<b>${s.monthName}</b><em>${s.ids.length}</em>`;
      cells = document.createElement('div');
      cells.className = 'grp-cells';
      group.append(sep, cells);
      frag.appendChild(group);
    }

    const c = document.createElement('button');
    c.className = 'cell';
    c.dataset.i = i;
    c.dataset.family = item.family;
    c.setAttribute('aria-label', `Open ${item.title}`);
    c.innerHTML =
      `<img src="${item.lqip}" data-src="${path.thumb(item.id)}" alt="${item.title}">
       <i class="cell-dot" style="background:${item.accent}"></i>
       <span class="cell-label"><b>${item.title}</b><span class="cell-sub"></span></span>`;
    c.addEventListener('click', () => openFromCell(c, i));
    cells.appendChild(c);
  }

  el.stripTrack.appendChild(frag);
  measureStrip();
  paintCellSubs();

  const lazy = new IntersectionObserver(es => {
    es.forEach(e => {
      if (!e.isIntersecting) return;
      const img = e.target.querySelector('img');
      if (img && img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
      e.target.classList.add('in');
      lazy.unobserve(e.target);
    });
  }, { root: el.strip, rootMargin: '600px' });
  el.stripTrack.querySelectorAll('.cell').forEach(c => lazy.observe(c));
}

/* Two rows per series on a wide screen. An odd count would leave a hole, so the
   last frame grows into it — which is why the strip is punctuated by big cards.
   One row on a phone, where every cell stays the same size. */
function layoutGroups() {
  const heroes = true;   // the odd frame always gets .hero; CSS decides how it grows
  el.stripTrack.querySelectorAll('.grp').forEach(group => {
    const visible = [...group.querySelectorAll('.cell:not(.hidden)')];
    group.classList.toggle('hidden', visible.length === 0);
    visible.forEach((c, n) =>
      c.classList.toggle('hero', heroes && visible.length % 2 === 1 && n === visible.length - 1));
  });
}

function paintCellSubs() {
  el.stripTrack.querySelectorAll('.cell').forEach(c => {
    const item = W[+c.dataset.i];
    const n = state.counts && state.counts[item.id];
    c.querySelector('.cell-sub').textContent =
      n ? `${n.toLocaleString()} downloads` : FAMILIES[item.family].label;
  });
}

function measureStrip() {
  const mobile = innerWidth < 861;
  const gap = mobile ? 8 : 10;
  const headH = mobile ? 30 : 36;      // the month label sits above the rows
  let cellH, cellW;

  // Two rows everywhere. A hero is four times the area of a normal cell, which
  // is right on a wide screen and absurd on a phone — so on mobile the odd
  // frame keeps its size and simply centres across both rows instead.
  state.rows = 2;
  state.heroes = !mobile;
  cellH = Math.max(80, Math.floor((el.strip.clientHeight - headH - gap) / 2));
  cellW = Math.round(cellH * 9 / 16);
  const maxW = Math.floor(el.strip.clientWidth / (mobile ? 3.2 : 4.2));
  if (cellW > maxW) { cellW = Math.max(64, maxW); cellH = Math.round(cellW * 16 / 9); }

  el.strip.dataset.heroes = state.heroes ? 'wide' : 'tall';
  el.strip.style.setProperty('--cellH', cellH + 'px');
  el.strip.style.setProperty('--cellW', cellW + 'px');
  el.strip.style.setProperty('--cellGap', gap + 'px');
  layoutGroups();
  updateScrubWindow();
}

/* ── the scrubber: a colour ribbon of the whole year ─────── */
function buildScrub() {
  const frag = document.createDocumentFragment();
  for (const i of [...W.keys()].reverse()) {      // oldest at the left, like the strip
    const b = document.createElement('i');
    b.style.background = W[i].accent;
    b.dataset.i = i;
    frag.appendChild(b);
  }
  el.scrubBars.appendChild(frag);

  const seek = clientX => {
    const r = el.scrub.getBoundingClientRect();
    const p = clamp((clientX - r.left) / r.width, 0, 1);
    el.strip.scrollLeft = p * (el.strip.scrollWidth - el.strip.clientWidth);
  };

  let dragging = false;
  el.scrub.addEventListener('pointerdown', e => {
    dragging = true; el.scrub.setPointerCapture(e.pointerId);
    el.scrub.classList.add('active'); seek(e.clientX);
  });
  el.scrub.addEventListener('pointermove', e => { if (dragging) seek(e.clientX); });
  const stop = () => { dragging = false; el.scrub.classList.remove('active'); };
  el.scrub.addEventListener('pointerup', stop);
  el.scrub.addEventListener('pointercancel', stop);

  el.scrub.addEventListener('keydown', e => {
    const page = el.strip.clientWidth * 0.8;
    if (e.key === 'ArrowRight') { el.strip.scrollLeft += page; e.preventDefault(); }
    if (e.key === 'ArrowLeft')  { el.strip.scrollLeft -= page; e.preventDefault(); }
    if (e.key === 'Home') { el.strip.scrollLeft = 0; e.preventDefault(); }
    if (e.key === 'End')  { el.strip.scrollLeft = el.strip.scrollWidth; e.preventDefault(); }
  });
}

function updateScrubWindow() {
  const max = el.strip.scrollWidth - el.strip.clientWidth;
  const frac = el.strip.clientWidth / Math.max(el.strip.scrollWidth, 1);
  const p = max > 0 ? el.strip.scrollLeft / max : 0;
  el.scrubWindow.style.width = (frac * 100).toFixed(2) + '%';
  el.scrubWindow.style.left = (p * (1 - frac) * 100).toFixed(2) + '%';

  const visible = [...el.stripTrack.querySelectorAll('.cell:not(.hidden)')];
  if (visible.length) {
    const mid = el.strip.scrollLeft + el.strip.clientWidth / 2;
    const near = visible.reduce((best, c) =>
      Math.abs(c.offsetLeft - mid) < Math.abs(best.offsetLeft - mid) ? c : best, visible[0]);
    el.scrub.setAttribute('aria-valuenow', String(W.length - near.dataset.i));
  }
}

/* horizontal drag + vertical wheel both pan the strip */
(function stripPan() {
  let id = null, x0 = 0, s0 = 0, moved = false;
  el.strip.addEventListener('pointerdown', e => {
    if (e.button !== 0 || e.pointerType === 'touch') return;   // touch scrolls natively
    id = e.pointerId; x0 = e.clientX; s0 = el.strip.scrollLeft; moved = false;
  });
  el.strip.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    const dx = e.clientX - x0;
    if (!moved && Math.abs(dx) < 6) return;
    if (!moved) { moved = true; el.strip.setPointerCapture(id); el.strip.classList.add('dragging'); }
    el.strip.scrollLeft = s0 - dx;
  });
  const stop = e => {
    if (e.pointerId !== id) return;
    id = null;
    el.strip.classList.remove('dragging');
    if (moved) { const kill = ev => ev.stopPropagation(); addEventListener('click', kill, { capture: true, once: true }); }
  };
  el.strip.addEventListener('pointerup', stop);
  el.strip.addEventListener('pointercancel', stop);

  el.strip.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    el.strip.scrollLeft += e.deltaY * 1.6;
  }, { passive: false });

  el.strip.addEventListener('scroll', () => {
    state.stripScroll = el.strip.scrollLeft;
    updateScrubWindow();
  }, { passive: true });
})();

/* ── filters + colour packs ──────────────────────────────── */
function buildFilters() {
  const counts = {};
  W.forEach(x => counts[x.family] = (counts[x.family] || 0) + 1);
  const mk = (key, label, dot, n) => {
    const b = document.createElement('button');
    b.className = 'filter'; b.dataset.key = key;
    b.setAttribute('aria-pressed', key === state.filter);
    b.innerHTML = (dot ? `<i style="background:${dot}"></i>` : '') + `${label} <small>${n}</small>`;
    b.addEventListener('click', () => setFilter(key));
    return b;
  };
  el.filters.appendChild(mk('all', 'Everything', '', W.length));
  Object.entries(FAMILIES)
    .sort((a, b) => (counts[b[0]] || 0) - (counts[a[0]] || 0))
    .forEach(([k, f]) => { if (counts[k]) el.filters.appendChild(mk(k, f.label, f.dot, counts[k])); });
}

function filtered() {
  return W.filter(x => state.filter === 'all' || x.family === state.filter);
}

function setFilter(key) {
  state.filter = key;
  [...el.filters.children].forEach(b => b.setAttribute('aria-pressed', b.dataset.key === key));

  el.stripTrack.querySelectorAll('.cell').forEach(c => {
    c.classList.toggle('hidden', !(key === 'all' || c.dataset.family === key));
  });
  layoutGroups();
  el.scrubBars.querySelectorAll('i').forEach(b => {
    const on = key === 'all' || W[+b.dataset.i].family === key;
    b.classList.toggle('dim', !on);
  });

  el.strip.scrollLeft = 0;
  requestAnimationFrame(updateScrubWindow);
  updatePackLabel();
}

function updatePackLabel() {
  const set = filtered();
  const mb = Math.round(set.reduce((n, x) => n + x.mb, 0));
  const name = state.filter === 'all' ? `all ${set.length}` : `the ${FAMILIES[state.filter].label.toLowerCase()} set`;
  el.packLabel.textContent = `Download ${name} · ${mb} MB`;
  el.packBtn.disabled = !set.length;
}

/* A store-only ZIP, written by hand — JPEGs don't compress, so there's no
   reason to pull in a library for this. */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [], central = [];
  let offset = 0;

  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const size = f.data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, f.data);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);

    offset += local.length + size;
  }

  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
}

async function downloadPack() {
  const set = filtered();
  if (!set.length) return;
  el.packBtn.classList.add('busy');
  const files = [];
  try {
    for (let i = 0; i < set.length; i++) {
      toast(`Bundling ${i + 1} of ${set.length}…`, 60000);
      const res = await fetch(path.full(set[i].id));
      if (!res.ok) throw new Error('fetch');
      files.push({ name: fileName(set[i]), data: new Uint8Array(await res.arrayBuffer()) });
      bumpCount(set[i].id, { silent: true });
    }
    const label = state.filter === 'all' ? 'all' : state.filter;
    saveBlob(zipStore(files), `2026-wallpapers-${label}.zip`);
    toast(`${files.length} wallpapers zipped up`);
  } catch (err) {
    toast('Could not build the zip — serve the folder over http rather than file://', 4000);
  } finally {
    el.packBtn.classList.remove('busy');
  }
}

el.packBtn.addEventListener('click', downloadPack);

/* ── view switching + FLIP ───────────────────────────────── */
function showGallery() {
  state.view = 'grid';
  el.gallery.hidden = false;
  el.body.dataset.view = 'grid';
  el.body.classList.remove('immersive');
  $('#viewToggle .chip-btn-label').textContent = 'Single';
  $('#viewToggle').setAttribute('aria-label', 'Back to the single view');
  history.replaceState(null, '', '#/all');
  measureStrip();
  // the newest photographs live at the right-hand end
  el.strip.scrollLeft = state.stripScroll ?? el.strip.scrollWidth;
  updateScrubWindow();
}

function showStage() {
  if (state.view === 'grid') state.stripScroll = el.strip.scrollLeft;
  state.view = 'stage';
  el.body.dataset.view = 'stage';
  el.gallery.hidden = true;
  $('#viewToggle .chip-btn-label').textContent = 'Timeline';
  $('#viewToggle').setAttribute('aria-label', 'Show the timeline');
  measure(); layout();
  history.replaceState(null, '', `#/w/${W[state.index].id}`);
}

function openFromCell(cell, i) {
  const from = cell.getBoundingClientRect();
  const src = cell.querySelector('img').src;
  state.index = i; state.pos = i;
  showStage();
  goTo(i, { instant: true });
  if (reduce) return;

  const to = (state.slides.get(i) || el.viewport).getBoundingClientRect();
  const fly = document.createElement('div');
  fly.className = 'flyer';
  fly.innerHTML = `<img src="${src}" alt="">`;
  Object.assign(fly.style, {
    left: from.left + 'px', top: from.top + 'px',
    width: from.width + 'px', height: from.height + 'px'
  });
  document.body.appendChild(fly);

  fly.animate([
    { left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px', borderRadius: '14px' },
    { left: to.left + 'px', top: to.top + 'px', width: to.width + 'px', height: to.height + 'px', borderRadius: state.geo.radius + 'px' }
  ], { duration: 620, easing: 'cubic-bezier(.22,1,.28,1)', fill: 'both' })
    .finished.then(() => {
      fly.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'both' })
         .finished.then(() => fly.remove());
    });
}

$('#viewToggle').addEventListener('click', () => state.view === 'stage' ? showGallery() : showStage());

/* ── download counts ─────────────────────────────────────── */
async function loadCounts() {
  if (!SITE.api) return;
  try {
    const res = await fetch(SITE.api.replace(/\/$/, '') + '/counts');
    if (!res.ok) return;
    state.counts = await res.json();
    render(W[state.index]);
    paintCellSubs();
  } catch { /* counts are a nicety, never a blocker */ }
}

async function bumpCount(id, { silent = false } = {}) {
  if (!SITE.api) return;
  if (!state.counts) state.counts = {};
  state.counts[id] = (state.counts[id] || 0) + 1;      // optimistic
  if (!silent && W[state.index].id === id) el.specs.textContent = specsFor(W[state.index]);
  try {
    const res = await fetch(SITE.api.replace(/\/$/, '') + '/count', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id })
    });
    if (!res.ok) return;
    const data = await res.json();
    state.counts[id] = data.count;
    if (W[state.index].id === id) el.specs.textContent = specsFor(W[state.index]);
  } catch { /* keep the optimistic number */ }
}

/* ── the mailing list: header panel and footer line share one path ──────── */
const EMAIL_RE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;
const listIsLive = () => Boolean(SITE.api || SITE.email);

async function joinList(email) {
  if (!SITE.api) {
    location.href = `mailto:${SITE.email}?subject=${encodeURIComponent('New wallpaper drops')}` +
      `&body=${encodeURIComponent('Please add ' + email + ' to the list.')}`;
    return true;
  }
  const res = await fetch(SITE.api.replace(/\/$/, '') + '/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email })
  });
  if (!res.ok) throw new Error('subscribe');
  return true;
}

(function aboutPanel() {
  const toggle = $('#infoToggle'), panel = $('#info');
  $('.info-name').textContent = SITE.author;
  const ig = $('#infoIg');
  if (SITE.link && SITE.handle) {
    ig.href = SITE.link;
    $('.info-handle').textContent = SITE.handle;
  } else {
    ig.hidden = true;
  }

  const close = () => { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });
  addEventListener('click', e => { if (!panel.hidden && !panel.contains(e.target)) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
})();

(function signupFooter() {
  const form = $('#footJoin'), input = $('#footEmail'), note = el.footNote;
  const button = form.querySelector('button');

  if (!listIsLive()) {
    // Shown, but honest about it — nothing here would reach anyone yet.
    form.dataset.state = 'off';
    input.disabled = button.disabled = true;
    note.textContent = 'Opening soon.';
    return;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = input.value.trim();
    note.className = 'foot-note';
    if (!EMAIL_RE.test(email)) {
      note.textContent = 'That address doesn\'t look right.';
      note.classList.add('bad');
      return;
    }
    form.classList.add('busy');
    try {
      await joinList(email);
      input.value = '';
      note.textContent = 'You\'re on the list.';
      note.classList.add('good');
    } catch {
      note.textContent = 'That didn\'t go through. Try again in a moment?';
      note.classList.add('bad');
    } finally {
      form.classList.remove('busy');
    }
  });
})();

/* ── wallpaper tools ─────────────────────────────────────── */
function toast(msg, ms = 2400) {
  el.toast.textContent = msg;
  el.toast.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.toast.classList.remove('on'), ms);
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function fileName(item, suffix) {
  const slug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug}-2026${suffix ? '-' + suffix : ''}.jpg`;
}

function download(item) {
  const a = document.createElement('a');
  a.href = path.full(item.id);
  a.download = fileName(item);
  document.body.appendChild(a); a.click(); a.remove();
  toast(`Saving “${item.title}”${wallpaperHint(' — ')}`, 5000);
  bumpCount(item.id);
}

function screenSize() {
  const dpr = window.devicePixelRatio || 1;
  return { w: Math.round(screen.width * dpr), h: Math.round(screen.height * dpr) };
}

/* Centre-crop the photo to the visitor's exact screen. Returns a Blob, or
   null when the canvas is unusable (file:// taints it). */
async function cropToScreen(item) {
  const { w: tw, h: th } = screenSize();
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => {
      img.onload = res; img.onerror = () => rej(new Error('load'));
      img.src = path.full(item.id);
    });
    const cv = document.createElement('canvas');
    cv.width = tw; cv.height = th;
    const cx = cv.getContext('2d');
    const s = Math.max(tw / img.width, th / img.height);
    const dw = img.width * s, dh = img.height * s;
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, (tw - dw) / 2, (th - dh) / 2, dw, dh);
    return await new Promise((res, rej) =>
      cv.toBlob(b => b ? res(b) : rej(new Error('encode')), 'image/jpeg', 0.94));
  } catch {
    return null;
  }
}

/* No browser can set a device wallpaper — that API doesn't exist on iOS or
   Android. Handing the photo to the native share sheet is the closest thing:
   from there it's Save Image, then set it from Photos. */
const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/.test(navigator.userAgent);

function wallpaperHint(prefix = '') {
  if (IS_IOS) return `${prefix}open Photos, then Share ▸ Use as Wallpaper`;
  if (IS_ANDROID) return `${prefix}open Photos, then ⋮ ▸ Use as ▸ Wallpaper`;
  return '';
}

async function shareLink(item) {
  const url = location.origin === 'null'
    ? location.href
    : location.origin + location.pathname + `#/w/${item.id}`;
  try {
    if (navigator.share) {
      await navigator.share({
        title: `${item.title} — 2026 Wallpapers`,
        text: `${item.title}${item.place ? ', ' + item.place : ''}${SITE.author ? ' — by ' + SITE.author : ''}`,
        url
      });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('Link copied to clipboard');
  } catch { /* dismissed */ }
}

async function share(item, btn) {
  // Only on a phone: cropping to a desktop screen would letterbox a portrait photo.
  if ((IS_IOS || IS_ANDROID) && navigator.canShare && navigator.share) {
    btn.classList.add('busy');
    try {
      let blob = await cropToScreen(item);
      if (!blob) {
        const res = await fetch(path.full(item.id));
        if (res.ok) blob = await res.blob();
      }
      if (blob) {
        const file = new File([blob], fileName(item), { type: 'image/jpeg' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: `${item.title} — 2026 Wallpapers` });
          bumpCount(item.id);
          const hint = wallpaperHint();
          if (hint) toast(`Saved — ${hint}`, 5200);
          return;
        }
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;   // the sheet was dismissed
    } finally {
      btn.classList.remove('busy');
    }
  }
  shareLink(item);
}

$('#tools').addEventListener('click', e => {
  const btn = e.target.closest('.tool');
  if (!btn) return;
  const item = W[state.index];
  const act = btn.dataset.act;
  if (act === 'download') download(item);
  if (act === 'share') share(item, btn);
  if (act === 'lock') {
    const on = el.body.classList.toggle('lockpreview');
    btn.setAttribute('aria-pressed', on);
    if (on) tickClock();
    toast(on ? 'Lock-screen preview on — check your clock stays readable' : 'Lock-screen preview off', 2000);
  }
});

function tickClock() {
  const d = new Date();
  el.lockTime.textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/i, '');
  el.lockDate.textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}
setInterval(() => { if (el.body.classList.contains('lockpreview')) tickClock(); }, 20000);

/* ── keyboard ────────────────────────────────────────────── */
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.matches('input, textarea')) return;
  const k = e.key.toLowerCase();
  if (state.view === 'stage') {
    if (k === 'arrowright') { e.preventDefault(); goTo(state.index + 1); }
    if (k === 'arrowleft') { e.preventDefault(); goTo(state.index - 1); }
    if (k === 'home') goTo(0);
    if (k === 'end') goTo(W.length - 1);
    if (k === 'd') download(W[state.index]);
    if (k === 'escape') el.body.classList.remove('immersive');
  }
  if (k === 'g') state.view === 'stage' ? showGallery() : showStage();
});

/* Written out rather than a numeral — it's a headline, and it has to stay
   right when photographs are added. */
const ONES = ['zero','one','two','three','four','five','six','seven','eight','nine','ten',
  'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
function spell(n) {
  if (n < 20) return ONES[n];
  if (n > 99) return String(n);
  const t = TENS[Math.floor(n / 10)], o = n % 10;
  return o ? `${t}-${ONES[o]}` : t;
}

/* ── boot ────────────────────────────────────────────────── */
function boot() {
  // On a phone that can share files, this button saves the photo rather than a link
  if ((IS_IOS || IS_ANDROID) && navigator.canShare) {
    $('[data-act="share"] span').textContent = 'Save to phone';
  }
  $('#footAuthor').textContent = SITE.author;
  $('.foot-legal-name').textContent = SITE.author;

  el.scrub.setAttribute('aria-valuemax', String(W.length));
  const headline = spell(W.length);
  $('.gallery-intro h2').textContent =
    headline.charAt(0).toUpperCase() + headline.slice(1) + ' frames from 2026';

  buildRail();
  buildYear();
  buildStrip();
  buildScrub();
  buildFilters();
  updatePackLabel();
  measure();
  tickClock();

  const hash = location.hash;
  const m = hash.match(/#\/w\/(.+)$/);
  const start = m ? W.findIndex(x => x.id === m[1]) : -1;
  goTo(start >= 0 ? start : 0, { instant: true });
  if (hash === '#/all') showGallery();

  loadCounts();
  requestAnimationFrame(() => el.body.classList.remove('is-loading'));
}

let rz;
addEventListener('resize', () => {
  clearTimeout(rz);
  rz = setTimeout(() => {
    measure(); layout();
    if (state.view === 'grid') measureStrip();
  }, 120);
});

addEventListener('hashchange', () => {
  const m = location.hash.match(/#\/w\/(.+)$/);
  if (m) {
    const i = W.findIndex(x => x.id === m[1]);
    if (i >= 0 && i !== state.index) { showStage(); goTo(i); }
  } else if (location.hash === '#/all' && state.view !== 'grid') showGallery();
});

boot();
