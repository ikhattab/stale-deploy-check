# Checks

Two sources: the **CLI** reads HTTP responses (`source: "headers"`), and the **skill** reads the repo (`source: "code"`). The CLI can't see users' browsers, so the open-tab and service-worker layers are mostly the skill's job.

Section links point at the article: [Q2](https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/#question-2-no-cache-header-means-no-caching-right) · [Q3](https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/#question-3-then-turn-caching-off) · [Q4](https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/#question-4-why-put-a-hash-in-the-name) · [Q5](https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/#question-5-some-users-still-get-it-for-an-hour) · [Q6](https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/#question-6-a-blank-screen-with-no-cache-involved) · [Q7](https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/#question-7-now-add-a-service-worker) · [Q8](https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/#question-8-prove-it)

## CLI: what it requests

1. `GET <url>` with `Accept: text/html`, no cookies, following redirects (each hop recorded). Anything other than a 2xx HTML response ends the run with exit 2.
2. Parse the HTML for same-origin `<script src>`, `<link rel="stylesheet">` and `<link rel="modulepreload">`. Cap at 20 assets; say so if there were more.
3. `HEAD` each asset, falling back to `GET` if the server rejects `HEAD`.
4. If the HTML had an `ETag` or `Last-Modified`, send the same `GET` again with `If-None-Match` / `If-Modified-Since`.
5. With `--baseline <report.json>`, `HEAD` every asset URL from the previous report.

Nothing else: no crawling, no guessing paths like `/sw.js`.

## CLI checks

### HTTP cache: the HTML

| Check id | Severity | Condition | Learn |
| --- | --- | --- | --- |
| `html.heuristic-freshness` | fail | No `Cache-Control` freshness directive (`max-age`, `s-maxage`, `no-cache`, `no-store`) and no `Expires`, and a `Last-Modified` is present. Report 10% of `Date − Last-Modified` as the likely lifetime. | Q2 |
| `html.heuristic-freshness` | info | Same, but no `Last-Modified`. Browsers are allowed to guess but usually don't without it. | Q2 |
| `html.max-age` | warn / fail | `max-age` (or `Expires`) > 0 without `no-cache`. warn up to the threshold, fail above it. Default threshold 300 s (`--html-max-age`). | Q3 |
| `html.max-age` | pass | `no-cache`, `max-age=0`, or an `Expires` in the past: browsers ask before every use. | Q3 |
| `html.stale-while-revalidate` | warn | HTML with a `max-age` and `stale-while-revalidate`. The first visit after a deploy can get the old page while the new one loads in the background. | Q3 |
| `html.no-store` | warn | `no-store` on HTML. It works, but every visit downloads the page again and some browsers keep it out of the back/forward cache. | Q3 |
| `html.no-validator` | warn | `no-cache` (or `max-age=0`) but no `ETag` and no `Last-Modified`, so every revalidation downloads the whole page. | Q3 |
| `html.revalidation` | warn | The conditional request got a full `200` instead of `304`. | Q3 |
| `html.revalidation` | pass | It got `304`. | Q3 |

### HTTP cache: the assets

| Check id | Severity | Condition | Learn |
| --- | --- | --- | --- |
| `assets.unreachable` | warn | An asset the HTML references returns 4xx/5xx. The HTML and assets may be out of sync. | Q6 |
| `assets.unhashed-long-cache` | fail | Asset name has no content hash, and `max-age` ≥ 1 day. After a deploy, this URL keeps serving old bytes. | Q4 |
| `assets.query-version` | warn | Asset uses `?v=` / `?version=` / `?build=` instead of a hash in the name. Every deploy re-downloads everything. | Q4 |
| `assets.unhashed` | warn | No hash in the name, no long cache. Safe but slow: browsers revalidate every file. | Q4 |
| `assets.short-cache` | warn | Hashed asset with no `max-age`, or `max-age` < 30 days. Browsers ask about files that can't change. | Q3 |
| `assets.short-cache` | pass | Every hashed asset is cached for at least 30 days. | Q3 |
| `assets.no-immutable` | info | Hashed asset with a long `max-age` but no `immutable`. | Q3 |
| `assets.not-checked` | info | Assets on other origins, assets over the `--max-assets` limit, or no assets in the HTML at all. | Q4 |

"Has a content hash" is a name heuristic only; we don't hash the bytes. A token counts as a hash when it's at least 6 characters of `[A-Za-z0-9_-]` and has a digit or mixes upper and lower case (so `bundle` and `framework` don't count). Build-target names like `es2015` or `v2` don't count, and neither does a dashed token with a plain word in it (`es2015-polyfills`, `vendors-2`). A URL is hashed when any of these hold:

- any dot-separated part of the file name after the first is a hash: `app.3f9a1c.js`, `main.8b1e07ab.chunk.js`, `index.md.DNpnSOya.lean.js` (VitePress)
- what follows a dash is a hash: `index-BxKaQzWe.css`, `index-Bq-xKzWe.js`
- the whole file name is a hash of 8+ characters: `1omje2kalxx-o.css` (Vercel's Next.js build)
- the name has a semver: `jquery-3.7.1.min.js`
- a directory is a hash of 8+ characters: `/_next/static/a1B2c3D4e5/_buildManifest.js`

### CDN

| Check id | Severity | Condition | Learn |
| --- | --- | --- | --- |
| `cdn.detected` | info | Which CDN, from `cf-ray`, `x-vercel-id`, `x-nf-request-id`, `x-amz-cf-id`, `x-served-by` + `x-cache` (Fastly), `server`. Used to tailor the other CDN fixes. | Q5 |
| `cdn.html-from-edge` | info | HTML has `Age` > 0, or a cache status of `HIT` (`cf-cache-status`, `x-cache`, `x-vercel-cache`, `cache-status`) on either request, and that's explained: the headers give shared caches a lifetime (`s-maxage`, `CDN-Cache-Control`, `max-age`, or a heuristic), or the platform clears its cache on deploy (see below). Reports how long it had been there. | Q5 |
| `cdn.edge-rule-suspected` | warn | An edge hit that nothing explains: the headers only allow browser caching (`no-cache`, `private`, `max-age=0`). Something in the CDN config is overriding them. | Q5 |
| `cdn.html-edge-lifetime` | info / warn | `CDN-Cache-Control` (or `Cloudflare-`/`Vercel-CDN-Cache-Control`) or `s-maxage` on HTML. info with the lifetime; warn if over 300 s (`--edge-max-age`), since that's how long users can lag a deploy unless it purges. | Q5 |
| `cdn.cdn-cache-control-unread` | warn | `CDN-Cache-Control` is set but the detected CDN doesn't document reading it (CloudFront, Fastly). Suggest `s-maxage`. | Q5 |

Platforms that clear their edge cache on deploy don't get `cdn.edge-rule-suspected`:

- **Vercel and Netlify** clear their CDN cache on every deploy.
- **Cloudflare with a hit but no `Age`**: that's what a Worker's own cache sends (seen on Workers static assets). Cloudflare's docs say [a Worker's cache is keyed by its version](https://developers.cloudflare.com/workers/cache/debugging/) unless `cache.cross_version_cache` is on. Cloudflare's zone cache sends `Age`, so a hit with `Age` still warns.

Every CDN finding says which edge answered (from `cf-ray`, `x-served-by`, etc. when present) and that other edges can hold different copies.

### Open tab

| Check id | Severity | Condition | Learn |
| --- | --- | --- | --- |
| `assets.previous-removed` | fail | With `--baseline`: an asset URL from the previous report now returns 404. Tabs opened before the deploy will fail to load it. | Q6 |
| `assets.previous-kept` | pass | With `--baseline`: every previous asset still loads. | Q6 |

### Proving it

| Check id | Severity | Condition | Learn |
| --- | --- | --- | --- |
| `page.build-id` | info / pass | No `<meta name="build">`, `<meta name="version">`, or similar (info). Without one, "old version" has no number. pass with the value when found. | Q8 |
| `page.service-worker` | info | An inline script calls `serviceWorker.register`, or the page loads a registration helper like `registerSW.js`. The CLI can't see what the worker serves; point to the skill. Layer: `service-worker`. | Q7 |

## Skill checks

The skill runs the CLI first (against the URL the user gives, or a preview URL), then reads the repo. It reports code findings with `kind: "file"` evidence.

| Check id | Severity | What it looks for | Learn |
| --- | --- | --- | --- |
| `code.host-html-headers` | fail / pass | Host config (`_headers`, `vercel.json`, `netlify.toml`, `wrangler.jsonc`, `firebase.json`, nginx/Caddy configs) sets `no-cache` on HTML and long `immutable` on hashed assets. Cross-check with the CLI findings: config and live headers disagreeing is its own finding. | Q3 |
| `code.cdn-purge` | warn | The CLI found HTML cached at the edge, and the deploy pipeline (CI workflow, deploy script) has no purge step. | Q5 |
| `code.asset-retention` | fail | The deploy deletes old assets right away: `aws s3 sync --delete`, `rsync --delete`, `gsutil rsync -d`, emptying the output bucket. | Q6 |
| `code.chunk-load-recovery` | warn | Route-level `import()` with no recovery: no `vite:preloadError` listener in a Vite app, no wrapper that reloads once on failure. | Q6 |
| `code.update-notice` | info | No way for a long-lived tab to learn about a deploy (no `version.json` polling, no version header check). | Q6 |
| `code.sw-skip-waiting` | warn | `skipWaiting()` called in `install` with no user prompt. New worker takes over a page running old code. | Q7 |
| `code.sw-update-flow` | warn | A service worker is registered but the page never handles `updatefound` or checks `registration.waiting`. | Q7 |
| `code.sw-html-cache-first` | warn | The worker serves navigations or `index.html` cache-first. Your HTTP headers don't apply to those responses. | Q7 |
| `code.build-id` | info | Same as `page.build-id`, with a suggested place to add it in this repo's templates. | Q8 |

The skill doesn't edit code unless asked. Each finding's `fix` is written for this repo, naming the file to change.

## Decided

- Thresholds: 300 s for HTML `max-age` (`--html-max-age`) and for the CDN lifetime (`--edge-max-age`), 30 days for hashed assets.
- `html.heuristic-freshness` is a `fail`, and it checks only the URL given.
- `--baseline` is in v1. `--out report.json` saves the report a later run compares against.

## Open questions

- The browser console snippet (resources from cache, waiting worker): its own package, or left in the article?
