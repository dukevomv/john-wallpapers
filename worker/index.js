/**
 * Counter + mailing list for the wallpaper site.
 *
 *   GET  /counts        -> { "2026-06-24-082111": 128, ... }
 *   POST /count         { id }     -> { id, count }
 *   POST /subscribe     { email }  -> { ok: true }
 *
 * Backed by D1, so the increment is a single atomic UPSERT — no lost counts
 * when several people download at once.
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
    // ALLOW_ORIGIN should be your site's origin once you know it.
    const origin = env.ALLOW_ORIGIN || '*';
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') return json({}, 204, origin);

    try {
      if (request.method === 'GET' && pathname === '/counts') {
        const { results } = await env.DB.prepare('SELECT id, n FROM downloads').all();
        const counts = {};
        for (const row of results) counts[row.id] = row.n;
        return json(counts, 200, origin);
      }

      if (request.method === 'POST' && pathname === '/count') {
        const { id } = await body(request);
        if (typeof id !== 'string' || !ID_RE.test(id)) {
          return json({ error: 'bad id' }, 400, origin);
        }
        const row = await env.DB
          .prepare(`INSERT INTO downloads (id, n) VALUES (?1, 1)
                    ON CONFLICT(id) DO UPDATE SET n = n + 1
                    RETURNING n`)
          .bind(id)
          .first();
        return json({ id, count: row.n }, 200, origin);
      }

      if (request.method === 'POST' && pathname === '/subscribe') {
        const { email } = await body(request);
        if (typeof email !== 'string' || email.length > 160 || !EMAIL_RE.test(email)) {
          return json({ error: 'bad email' }, 400, origin);
        }
        await env.DB
          .prepare(`INSERT INTO subscribers (email, created) VALUES (?1, ?2)
                    ON CONFLICT(email) DO NOTHING`)
          .bind(email.toLowerCase(), new Date().toISOString())
          .run();
        return json({ ok: true }, 200, origin);
      }

      return json({ error: 'not found' }, 404, origin);
    } catch (err) {
      return json({ error: 'server error' }, 500, origin);
    }
  },
};
