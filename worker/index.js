/**
 * Counter + mailing list for the wallpaper site.
 *
 *   GET  /counts        -> { "2026-06-24-082111": 128, ... }
 *   POST /count         { id }     -> { id, count }
 *   POST /subscribe     { email }  -> { ok: true }
 *
 * Backed by Workers KV, one key per wallpaper. KV is eventually consistent, so
 * a freshly incremented number can take a moment to show up everywhere — fine
 * for a download tally, and it keeps the whole thing on the free tier with only
 * a KV binding to configure.
 */

const ID_RE    = /^[0-9a-z-]{4,64}$/;
const EMAIL_RE = /^[^@\s]{1,64}@[^@\s.]{1,63}(\.[^@\s.]{1,63})+$/;

const json = (body, status, origin) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
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

export default {
  async fetch(request, env) {
    const origin = env.ALLOW_ORIGIN || '*';
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') return json({}, 204, origin);

    try {
      if (request.method === 'GET' && pathname === '/counts') {
        const counts = {};
        let cursor;
        do {
          const page = await env.KV.list({ prefix: 'c:', cursor });
          const rows = await Promise.all(page.keys.map(async k => {
            const v = await env.KV.get(k.name);
            return [k.name.slice(2), Number(v) || 0];
          }));
          for (const [id, n] of rows) if (n) counts[id] = n;
          cursor = page.list_complete ? null : page.cursor;
        } while (cursor);
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
