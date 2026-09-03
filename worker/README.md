# wallpapers-api

Download counts and the new-drops mailing list. Two tables in Cloudflare D1,
one Worker in front of them. Free tier covers this many times over.

## Deploy

```sh
npm install -g wrangler
wrangler login

cd worker
wrangler d1 create wallpapers          # copy the database_id it prints
#   -> paste it into wrangler.toml

wrangler d1 execute wallpapers --remote --file=schema.sql
wrangler deploy                        # prints https://wallpapers-api.<you>.workers.dev
```

Then put that URL into `site/app.js`:

```js
const SITE = {
  ...
  api: 'https://wallpapers-api.<you>.workers.dev'
};
```

Counts appear on the site immediately. With `api` left empty the site simply
hides the numbers and the signup falls back to a mail link — nothing breaks.

Once the site is live, uncomment `ALLOW_ORIGIN` in `wrangler.toml`, set it to
your site's origin, and `wrangler deploy` again so only your page can post to it.

## Reading the mailing list

```sh
wrangler d1 execute wallpapers --remote \
  --command "SELECT email, created FROM subscribers ORDER BY created DESC"

# most downloaded
wrangler d1 execute wallpapers --remote \
  --command "SELECT id, n FROM downloads ORDER BY n DESC LIMIT 20"
```

Export the list to CSV when you want to actually send something:

```sh
wrangler d1 execute wallpapers --remote --json \
  --command "SELECT email FROM subscribers" > subscribers.json
```

## Notes

- The count endpoint is deliberately dumb: one POST, one increment. Someone
  determined could inflate a number. That's the right trade for a wallpaper
  site — the alternative is fingerprinting your visitors.
- Emails are stored lowercased, one row each, nothing else. If you'd rather a
  real mailing service handle consent and unsubscribes, point `api` at
  Buttondown or Mailchimp's endpoint instead; the site only needs a URL that
  accepts `POST {email}`.
