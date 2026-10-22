# Calibration

Unit tests show the checks do what the code says. This shows whether that's right for real sites. `sites.json` lists 50 sites across frameworks and hosts, each with a note on why it's there.

```sh
npm run build
node calibration/run.mjs --cli npm:0.3.1 &   # the last release, through npx
node calibration/run.mjs                      # the working tree
wait
node calibration/report.mjs calibration/results/npm-0.3.1.json calibration/results/local.json
```

Run both at the same time so a difference comes from the tool, not from a site that changed in between. Each run makes about 22 requests per site, 4 sites at a time.

- `run.mjs` saves the fails, warns and infos per site to `results/<label>.json`, and each full report, with every request and header, to `reports/<label>/` (gitignored).
- `report.mjs results.json` lists every fail and warn grouped by check, for reviewing a run on its own.
- `report.mjs old.json new.json` lists what changed per site.

Before a release, read the diff and check each change against the headers in `reports/`. Every wrong call becomes a test in `packages/core/test/`, and the release's results replace the committed baseline.

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
