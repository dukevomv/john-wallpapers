# wallpapers-api

Download counts and the new-drops mailing list, on Workers KV.

**Deployed and live:** `https://wallpapers-api.dukevomv.workers.dev`
(wired into `site/app.js` as `SITE.api`.)

## Endpoints

```
GET  /counts       -> { "2026-06-24-082111": 128, ... }
POST /count        { id }    -> { id, count }
POST /subscribe    { email } -> { ok: true }
```

Only `https://john-wallpapers.pages.dev` may call it (`ALLOW_ORIGIN`).
Ids and email addresses are validated before anything is written.

## Storage

Workers KV, namespace `wallpapers`:

- `c:<wallpaper-id>` — the download tally for that frame
- `s:<email>` — a subscriber, value is the ISO date they joined
- `idx` — a plain list of every id that has ever been counted

`idx` is why `/counts` never calls `KV.list()`. List is eventually consistent in
a way `get` is not: a freshly written key can take up to a minute to become
listable, which showed up as counts appearing to reset on the next page load.
Reading the index and then getting each key returns the new number immediately.

## Two things to keep in mind when editing this

- **A 204 response must not have a body.** `new Response(JSON.stringify(...),
  {status: 204})` throws in the Workers runtime. The OPTIONS handler runs before
  the try/catch, so that surfaced as a 500 on every CORS preflight — which meant
  browsers silently blocked every write, while `curl` worked fine.
- **`curl` does not send preflights.** Testing a cross-origin API with curl alone
  will pass even when every browser is being refused. Test OPTIONS explicitly:

  ```sh
  curl -i -X OPTIONS https://wallpapers-api.dukevomv.workers.dev/count \
    -H "Origin: https://john-wallpapers.pages.dev" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type"
  ```

Counts started from zero on the day the Worker went up. They are real, not
seeded — the `downloads` numbers in `w/index.js` are only a stand-in used when
no API is configured.

## Redeploying after changing index.js

```sh
source ~/.zshrc     # CF_API_TOKEN, CF_ACCOUNT_ID

cat > /tmp/metadata.json <<EOF
{ "main_module": "index.js",
  "compatibility_date": "2025-01-01",
  "bindings": [
    { "type": "kv_namespace", "name": "KV", "namespace_id": "7643a77b423546989beb008fd55dc69f" },
    { "type": "plain_text", "name": "ALLOW_ORIGIN", "text": "https://john-wallpapers.pages.dev" }
  ] }
EOF

curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/wallpapers-api" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -F "metadata=@/tmp/metadata.json;type=application/json" \
  -F "index.js=@index.js;type=application/javascript+module"
```

`wrangler deploy` works too if you'd rather (`npm i -g wrangler`); `wrangler.toml`
is already pointed at the right namespace.

## Reading the data

```sh
# every subscriber
curl "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/storage/kv/namespaces/7643a77b423546989beb008fd55dc69f/keys?prefix=s:" \
  -H "Authorization: Bearer $CF_API_TOKEN"

# most downloaded
curl -s https://wallpapers-api.dukevomv.workers.dev/counts | python3 -m json.tool
```

## Notes

- The count endpoint is deliberately dumb: one POST, one increment. Someone
  determined could inflate a number. That's the right trade for a wallpaper
  site — the alternative is fingerprinting your visitors.
- Emails are stored lowercased, one key each, nothing else. If you'd rather a
  real mailing service handle consent and unsubscribes, point `SITE.api` at
  Buttondown or Mailchimp instead; the site only needs a URL accepting
  `POST {email}`.
