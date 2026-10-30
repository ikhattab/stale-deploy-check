# Calibration

Unit tests show the checks do what the code says. This shows whether that's right for real sites. `sites.json` lists 50 sites across frameworks and hosts, each with a note on why it's there.

```sh
npm run build
node calibration/run.mjs --cli npm:0.6.0 &   # the last release, through npx
node calibration/run.mjs                      # the working tree
wait
node calibration/report.mjs calibration/results/npm-0.6.0.json calibration/results/local.json
```

Run both at the same time so a difference comes from the tool, not from a site that changed in between. Each run makes about 22 requests per site, 4 sites at a time.

- `run.mjs` saves the fails, warns and infos per site to `results/<label>.json`, and each full report, with every request and header, to `reports/<label>/` (gitignored).
- `report.mjs results.json` lists every fail and warn grouped by check, for reviewing a run on its own.
- `report.mjs old.json new.json` lists what changed per site.

Before a release, read the diff and check each change against the headers in `reports/`. Every wrong call becomes a test in `packages/core/test/`, and the release's results replace the committed baseline.

## The sdc-lab sites

The last five sites in `sites.json` are Cloudflare Pages sites built to trigger specific findings, from the private repos `ikhattab/sdc-lab-*`. Each one deploys from its repo's `main`, so they're the only sites here that can be redeployed on purpose: to test `--baseline`, or a tab left open across a deploy.

Each has an `expect`: the fails and warns it should get, and no others. `report.mjs results.json` lists any site that doesn't match under "not what the site expects". A mismatch is either a wrong call by the tool or a change at Cloudflare; check the headers in `reports/` to tell which.

| Site | Set up with | Expects |
| --- | --- | --- |
| sdc-lab-good | `/assets/*` immutable, a `404.html`, a build id, reload on `vite:preloadError` | nothing |
| sdc-lab-defaults | no `_headers`, no `404.html`, no build id | `assets.short-cache` warn |
| sdc-lab-html-cached | `max-age=3600` on every path | `html.max-age` fail; `assets.short-cache`, `assets.missing-cached` warn |
| sdc-lab-immutable-404 | `/assets/*` immutable, no `404.html` | `assets.missing-cached` warn |
| sdc-lab-sw | as good, plus a cache-first service worker | nothing (the CLI only reports `page.service-worker`) |

What they showed about Pages, 2026-10-30:

- Every response gets `public, max-age=0, must-revalidate` unless `_headers` says otherwise, hashed files included.
- `_headers` rules don't apply to real 404s, which get `no-store`. They do apply to the SPA fallback: without a `404.html`, a missing `/assets/x.js` gets the app's HTML with `200` and whatever the `/assets/*` rule says, a year in sdc-lab-immutable-404.
- HTML never has an `ETag` or `Last-Modified`, compressed or not, while every other file has an `ETag` and answers `If-None-Match` with `304`. Workers static assets does the same (ihabkhattab.com).
- A deploy removes the previous build's files. After sdc-lab-good went from 726f7f0 to 4aa1c8e, `--baseline` passed `assets.previous-kept` for v1's `index-DeZm4FUm.js`, but that `200` was `cf-cache-status: HIT` with `age: 465` at the MRS edge: the copy the v1 run's own request had put there. With a query string to skip that copy it's a `404`, and so is v1's lazy chunk, which nothing had requested. The pass was wrong: tabs that reach any other edge, or this one once the copy is evicted, get the 404. Since then, an old file that loads from the edge's cache is asked for again past it, and this is `assets.previous-removed`.

## Review: 0.5.3 → 0.6.0, 2026-10-30

Both run at once. Every change was checked against the headers in `reports/`:

| Change | Sites | Why |
| --- | --- | --- |
| `html.no-validator` warn → info | ihabkhattab.com, solidjs.com, developers.cloudflare.com, sdc-lab-good, sdc-lab-defaults, sdc-lab-immutable-404, sdc-lab-sw | Cloudflare serves the HTML itself (Pages or Workers static assets): the files have an `ETag`, the HTML never does, and there's no setting for it |
| `html.no-validator` stays warn | elk.zone, docusaurus.io, jestjs.io (Netlify), nodejs.org (Vercel) | Another platform behind Cloudflare sends an `ETag`, so a zone setting most likely drops it. The first version of the change made these info too; this run caught it |
| `cdn.edge-rule-suspected` gone | remix.run | Fastly `HIT` in the 0.5.3 run, `MISS` in this one: the site, not the tool |
| exit 2 → 0 | github.com | Timed out in the 0.5.3 run |

Every sdc-lab site matched its `expect`. The `--baseline` change (an old file that only loads from the CDN's cache is removed) doesn't show here, since calibration doesn't pass `--baseline`; it was checked on sdc-lab-good, above.

The published 0.6.0 gave the same results, apart from gohugo.io and squoosh.app timing out as usual. `results/npm-0.6.0.json` is the baseline now.

## Review: 0.3.4 → working tree (`assets.missing-cached`), 2026-10-22

The new probe warned on 15 sites. Each was checked against the probe's headers, and each is right:

| Kept for | Sites |
| --- | --- |
| a year or more, `immutable` 404 | vite.dev, vitepress.dev, vuejs.org (Netlify `/assets/*` rule), nuxt.com, vercel.com, elk.zone, docusaurus.io (`max-age=365000000`) |
| a year, `index.html` served as CSS | angular.dev |
| 7 days, `immutable` 404 | developers.cloudflare.com (the same Cloudflare static-assets `_headers` rule ihabkhattab.com had) |
| 4 hours | jestjs.io, tailwindcss.com (404); solidjs.com (`index.html` served as JS) |
| about an hour, guessed from `Last-Modified` | excalidraw.com (`index.html` served as JS, `s-maxage=0` only) |
| 10 to 20 min | wikipedia.org (`s-maxage=600` at the CDN), docs.readthedocs.io (`max-age=1200`) |

It's a warn, not a fail: it takes a race or a rollback to hit, and failing would have turned 9 of these green CI runs red. Everything else matched 0.3.4.

The published 0.4.0 gave the same results as the working tree, apart from news.ycombinator.com timing out in one of the two runs. `results/npm-0.4.0.json` is the baseline now.

## Review: 0.3.1 → working tree, 2026-10-22

Fixed, all false calls found by the first run:

| Site | 0.3.1 said | Why it was wrong |
| --- | --- | --- |
| tailwindcss.com | fail: 7 files unhashed | Turbopack hashes contain `~` (`0aqjr575~-kiw.js`) |
| svelte.dev | fail: 1 file unhashed | `/_app/immutable/chunks/DHFLKPNG.js`: all capitals, in SvelteKit's hashed folder |
| astro.build | fail: 2 files unhashed | `/_astro/ec.uumq6.css`: a five-character hash |
| remix.run | fail: 20 files unhashed | Remix 3 names files `global.@lQ7lA2.css`, and serves `.ts` |
| news.ycombinator.com | fail: 2 files unhashed | the whole query is the hash: `news.css?xRLUGZw7cmuze0dugP4m` |
| docs.python.org, docs.readthedocs.io | warn: `?version` instead of a hash | Sphinx's `?v=b86133f3` is a content hash |
| tailwindcss.com, nodejs.org | warn: edge rule suspected | Cloudflare passed the request through (`DYNAMIC`); the hit was Vercel's cache, which clears on deploy |
| docusaurus.io, elk.zone, jestjs.io | warn: edge rule suspected | the same, with Netlify behind Cloudflare |

Checked and left as they are:

- **`html.max-age` fails (9)**: every one sends `max-age` of 600 to 3600 on HTML. GitHub Pages sites (jekyllrb.com, pages.github.com, rubyonrails.org, rust-lang.org) get 600 from GitHub and can't change it. The skill says so.
- **`html.heuristic-freshness` fails (2)**: aws.amazon.com sends no `Cache-Control` and no `Expires`, with a `Last-Modified` two days old. docs.python.org likewise.
- **`assets.unhashed-long-cache` fails (2)**: python.org's `modernizr.js` and others for 7 days, docs.python.org's `rtd_switcher.js` for 23 days by heuristic.
- **`cdn.edge-rule-suspected` on Fastly (3)**: right, but the detail now explains Surrogate-Control instead of suggesting a cache-everything rule.
- **gohugo.io and squoosh.app** time out from this network with plain `curl` too, so that's not the tool.

The published 0.3.2 gave the same results as the working tree, apart from theguardian.com's `html.revalidation`, which comes and goes between runs. `results/npm-0.4.0.json` is the baseline now.
