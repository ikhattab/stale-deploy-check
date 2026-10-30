# Code checks

Each check has an id (use it as the finding's `check`), the layer, the article section for `learnMore`, where to look, what counts as a problem, and fixes for common setups. Article base URL: `https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/`.

## Contents

- [code.host-html-headers](#codehost-html-headers): HTML and asset headers in host config
- [code.cdn-purge](#codecdn-purge): purging the CDN on deploy
- [code.asset-retention](#codeasset-retention): old assets deleted on deploy
- [code.chunk-load-recovery](#codechunk-load-recovery): failed dynamic imports in old tabs
- [code.update-notice](#codeupdate-notice): telling open tabs a new version is out
- [code.sw-skip-waiting](#codesw-skip-waiting): a new worker taking over without asking
- [code.sw-update-flow](#codesw-update-flow): no path from "update waiting" to the user
- [code.sw-html-cache-first](#codesw-html-cache-first): the worker serving HTML from its cache
- [code.build-id](#codebuild-id): a build id in the page

---

## code.host-html-headers

Layer `http-cache` · `#question-3-then-turn-caching-off`

The goal: HTML gets `Cache-Control: no-cache` (or `max-age=0, must-revalidate`) with an ETag; hashed assets get `public, max-age=31536000, immutable`.

Where headers are set:

| Setup | File |
| --- | --- |
| Netlify | `_headers` in the publish directory, or `[[headers]]` in `netlify.toml` |
| Cloudflare Pages, Workers static assets | `_headers` in the output directory (usually copied from `public/_headers`) |
| Vercel | `headers` in `vercel.json`, or `headers()` in `next.config.*` |
| Firebase Hosting | `hosting.headers` in `firebase.json` |
| nginx | `add_header Cache-Control`, `expires` in `location` blocks |
| Caddy | `header` directives |
| S3 (+ CloudFront) | `--cache-control` / `--metadata` on `aws s3 cp`/`sync` in the deploy script; CloudFront response headers policies |
| GitHub Pages | Can't set headers. It sends its own short `max-age` on everything. Say so instead of suggesting a config change. |
| A Worker or server in front | The code that builds the response. A Worker that rewrites or re-creates responses can drop `ETag` or `Cache-Control`. |

Problems:

- **fail**: config gives HTML a lifetime over 5 minutes, or sets a long `max-age` on paths that include unhashed files.
- **fail**: config and live headers disagree (from the CLI report). Report both and the likely reason: the `_headers` file isn't copied into the build output, the path pattern doesn't match (`/assets/*` vs. the bundler's `/_astro/*` or `/_next/static/*`), or a CDN rule overrides it.
- **warn**: no rule for hashed assets, so they get the host default (often `max-age=0`). Name the bundler's asset directory in the fix.
- **pass**: config matches the goal and the live headers.

Example fix for a `_headers` file (Netlify, Cloudflare):

```
/*
  Cache-Control: no-cache

/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

**Missing ETag on HTML only.** On Cloudflare Pages and Workers static assets this is the platform: they send an ETag with every file except HTML, and there's no setting for it, so the CLI reports it as info. Say so and move on. With Vercel or Netlify behind Cloudflare, the platform sends one, so it's a warn and the zone settings below are the likely cause. Elsewhere, if the CLI reports `html.no-validator` but assets have ETags, look for something that rewrites HTML on the way out. On Cloudflare, [Email Obfuscation, Rocket Loader, Automatic HTTPS Rewrites, and Replace insecure JavaScript libraries remove or weaken ETags](https://developers.cloudflare.com/cache/reference/etag-headers/), and Email Obfuscation only touches HTML. These are dashboard settings, not repo files, so say which ones to check rather than claiming one is on. A Worker or server that builds a new `Headers` object instead of copying the original can also drop it. Read that code before blaming the zone.

**Missing files cached like real ones.** If the CLI reports `assets.missing-cached` as a warning, the long rule for hashed assets also matches misses: header rules match by path, not by whether the file exists. A `_headers` file can't set a different header on a 404, so the fix goes where the 404 is sent: a Worker, edge function, or server that sets `Cache-Control: no-store` on missing files under the assets path. On Netlify, Vercel, and Cloudflare static assets, that means a function or Worker in front of the files. Name the file that sets the long rule, and where the override would go.

Use the bundler's real asset directory: Vite `/assets/*`, Astro `/_astro/*`, Next.js `/_next/static/*`, CRA `/static/*`. Check the build output if unsure. Some hosts apply every matching rule, so a `/*` rule can stack with the assets rule. Check the host's docs on how matching rules combine.

## code.cdn-purge

Layer `cdn` · `#question-5-some-users-still-get-it-for-an-hour`

Run this only when the CLI says a CDN keeps the HTML (`cdn.html-edge-lifetime` warn, or `cdn.edge-rule-suspected`). Skip it for platforms that clear their cache on deploy (Vercel, Netlify; Cloudflare Workers and Pages when the CLI reports `cdn.html-from-edge` as info).

Look in CI workflows and deploy scripts for a purge after the upload: `aws cloudfront create-invalidation`, a call to Cloudflare's `purge_cache` API, `fastly purge`, a CDN-specific action in the workflow.

- **warn**: HTML is cached at the edge and no purge step exists. The detail says how long users can lag a deploy (the edge lifetime from the CLI).
- **info**: a purge exists but runs before the upload finishes, or purges only some paths that don't include HTML routes.
- **pass**: HTML paths are purged after upload.

## code.asset-retention

Layer `open-tab` · `#question-6-a-blank-screen-with-no-cache-involved`

Tabs opened before a deploy still run old code, which loads old hashed chunks on demand. If the deploy deleted them, those requests fail: a 404, a 403 from S3 behind CloudFront, or `index.html` from an error rule that maps missing files to the app shell.

- **fail**: the deploy deletes files the new build doesn't have: `aws s3 sync --delete`, `rsync --delete`, `gsutil rsync -d`, `az storage blob sync --delete-destination true`, a step that empties the bucket or web root first.
- **warn**: the platform replaces the whole site on each deploy (Netlify, Cloudflare Pages or Workers static assets, Firebase, a fresh container image), so old hashed files are gone unless something keeps them. On Vercel, Skew Protection addresses this; check whether it's on before warning. Elsewhere the usual fix is copying the previous deploy's hashed assets into the new build output, or uploading to a bucket without deleting.
- **pass**: uploads without deleting, with old files removed later (a lifecycle rule, a cleanup job that keeps recent versions).

If the user has two CLI reports from consecutive deploys, `--baseline` answers this for real. Suggest it in the fix: `npx stale-deploy-check <url> --out report.json` in CI, then `--baseline` with the previous report.

## code.chunk-load-recovery

Layer `open-tab` · `#question-6-a-blank-screen-with-no-cache-involved`

Only applies when the app loads code on demand: `import()` of routes or components, `React.lazy`, `defineAsyncComponent`, router-level lazy loading. A purely static site with no dynamic imports skips this.

What a failed chunk looks like:

- **Vite**: fires a `vite:preloadError` event on `window` when a dynamic import fails. The fix is a listener that reloads once.
- **webpack** (incl. CRA): the rejected promise's error has `name === "ChunkLoadError"`.
- **Native `import()`**: rejects with a `TypeError`. The message differs by browser, so don't match on it.

Search for: `vite:preloadError`, `ChunkLoadError`, error boundaries or wrappers around lazy imports that call `location.reload()`. A framework's router may already recover on its own. Check the installed version's docs before reporting it missing.

- **warn**: dynamic imports exist and nothing recovers from a failed one. The detail explains the blank screen.
- **warn**: a handler reloads with no loop guard. If the chunk is truly gone after a reload too, the page reloads forever. The fix adds a `sessionStorage` flag.
- **pass**: a guarded reload or equivalent recovery exists.

Example fix for Vite, matching the article's guard:

```js
window.addEventListener("vite:preloadError", (event) => {
  if (sessionStorage.getItem("reloaded-for-deploy")) return;
  sessionStorage.setItem("reloaded-for-deploy", "1");
  event.preventDefault();
  location.reload();
});
// After a successful load, clear the flag so the next deploy can reload again.
```

## code.update-notice

Layer `open-tab` · `#question-6-a-blank-screen-with-no-cache-involved`

A long-lived tab (a dashboard, an editor) can run old code for days. Look for polling a `version.json`/`build.json`, comparing a version header on API responses, or a framework's update notifier.

- **info**: none found, and the app looks long-lived (a dashboard, an app behind a login, a single-page app). Skip it for content sites where people rarely keep a tab open.
- **pass**: something tells open tabs a new version exists.

## code.sw-skip-waiting

Layer `service-worker` · `#question-7-now-add-a-service-worker`

A new worker that calls `skipWaiting()` on install takes over pages still running old code, and those pages then ask it for files it may not have.

Where it hides:

- Hand-written: `self.skipWaiting()` in the `install` handler, not behind a message from the page.
- Workbox `generateSW` / `injectManifest`: `skipWaiting: true`, or `self.skipWaiting()` in the source worker.
- `vite-plugin-pwa`: `registerType: 'autoUpdate'` does it for you. The default `'prompt'` doesn't.
- `next-pwa`-style plugins: a `skipWaiting` option. Check the installed plugin's default, because some default to true.

- **warn**: the worker takes over without asking, and the app has dynamic imports or precaches the shell (the combination that breaks old pages).
- **info**: it takes over without asking, but the site is static content where old and new pages don't share chunks.
- **pass**: skipping waiting only happens after a message from the page.

## code.sw-update-flow

Layer `service-worker` · `#question-7-now-add-a-service-worker`

Letting the new worker wait is only half the pattern. The page has to notice the waiting worker and let the user switch.

Look in the registration code for: an `updatefound` listener with a `statechange` check, a check of `registration.waiting` at startup, a message that tells the worker to skip waiting, and a `controllerchange` listener that reloads. Plugin equivalents: `vite-plugin-pwa`'s `onNeedRefresh` / `useRegisterSW`, Workbox Window's `waiting` event.

- **warn**: a worker is registered and nothing tells the user about a waiting update. They stay on the old version until every tab closes.
- **warn**: it handles `updatefound` but never checks `registration.waiting` at startup, so an update that arrived during an earlier visit is missed.
- **pass**: the page detects a waiting worker (new or existing), asks the user, then reloads on `controllerchange`.

## code.sw-html-cache-first

Layer `service-worker` · `#question-7-now-add-a-service-worker`

When the worker answers navigations from its cache (a precached `index.html`, a `navigateFallback`, a cache-first route for documents), the HTTP headers on HTML don't apply. The HTML only changes when a new worker installs and takes over.

- **warn**: navigations are served from the cache and `code.sw-update-flow` isn't a pass. Users are pinned to the cached shell.
- **info**: navigations are served from the cache, with a working update flow. Mention it so the user knows the headers aren't what controls HTML freshness.
- **pass**: navigations go to the network first (or aren't handled by the worker).

## code.build-id

Layer `diagnostics` · `#question-8-prove-it`

Run this only when the CLI reported `page.build-id` as info (none found).

Find where the HTML shell is rendered (`index.html`, a root layout, a base template) and how the build could inject an id: the commit SHA from CI (`GITHUB_SHA`, `CF_PAGES_COMMIT_SHA`, `VERCEL_GIT_COMMIT_SHA`, `COMMIT_REF` on Netlify), passed through the bundler's env mechanism (`import.meta.env`, `process.env` with `define`, the framework's public env prefix).

- **info**: always info. The fix names the template file and the env variable available on this host.
