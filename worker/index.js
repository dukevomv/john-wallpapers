/**
 * Counter + mailing list for the wallpaper site.
 *
 *   GET  /counts        -> { "2026-06-24-082111": 128, ... }
 *   POST /count         { id }     -> { id, count }
 *   POST /subscribe     { email }  -> { ok: true }
 *
 * Backed by Workers KV: one key per wallpaper (`c:<id>`), one per subscriber
 * (`s:<email>`), plus `idx`, a plain list of every id that has ever been
 * counted.
 *
 * `idx` exists so /counts never calls KV.list(). List is eventually consistent
 * in a way get is not — a freshly written key can take up to a minute to be
 * listable, which showed up as counts "resetting" on the next page load.
 */

const ID_RE    = /^[0-9a-z-]{4,64}$/;
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s.]{1,63}(\.[^@\s.]{1,63})+$/;

const corsHeaders = origin => ({
  'access-control-allow-origin': origin,
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'access-control-max-age': '86400',
});

const json = (body, status, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders(origin),
    },
  });

async function body(request) {
  try {
    const data = await request.json();
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

async function readIndex(env) {
  try {
    const raw = await env.KV.get('idx');
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || '*';
    const { pathname } = new URL(request.url);

    // A 204 must not carry a body — building one with a body throws, and this
    // runs before the try/catch, so it surfaced as a 500 on every preflight.
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      if (request.method === 'GET' && pathname === '/counts') {
        let ids = await readIndex(env);

        // One-time heal: if the index is missing but counters already exist,
        // rebuild it from a list. Only ever runs once.
        if (!ids.length) {
          let cursor;
          do {
            const page = await env.KV.list({ prefix: 'c:', cursor });
            ids.push(...page.keys.map(k => k.name.slice(2)));
            cursor = page.list_complete ? null : page.cursor;
          } while (cursor);
          if (ids.length) await env.KV.put('idx', JSON.stringify(ids));
        }

        const rows = await Promise.all(
          ids.map(async id => [id, Number(await env.KV.get('c:' + id)) || 0])
        );
        const counts = {};
        for (const [id, n] of rows) if (n) counts[id] = n;
        return json(counts, 200, origin);
      }

      if (request.method === 'POST' && pathname === '/count') {
        const { id } = await body(request);
        if (typeof id !== 'string' || !ID_RE.test(id)) {
          return json({ error: 'bad id' }, 400, origin);
        }
        const key = 'c:' + id;
        const next = (Number(await env.KV.get(key)) || 0) + 1;
        await env.KV.put(key, String(next));

        if (next === 1) {                       // first download of this frame
          const ids = await readIndex(env);
          if (!ids.includes(id)) {
            ids.push(id);
            await env.KV.put('idx', JSON.stringify(ids));
          }
        }
        return json({ id, count: next }, 200, origin);
      }

      if (request.method === 'POST' && pathname === '/subscribe') {
        const { email } = await body(request);
        if (typeof email !== 'string' || email.length > 160 || !EMAIL_RE.test(email)) {
          return json({ error: 'bad email' }, 400, origin);
        }
        await env.KV.put('s:' + email.toLowerCase(), new Date().toISOString());
        return json({ ok: true }, 200, origin);
      }

      return json({ error: 'not found' }, 404, origin);
    } catch {
      return json({ error: 'server error' }, 500, origin);
    }
  },
};
