---
name: stale-deploy-check
description: Diagnose why users still see an old version of a web app after a deploy, by checking the live site's cache headers and CDN with the stale-deploy-check CLI and then reading the repo for the parts HTTP can't show (host header config, asset deletion on deploy, failed dynamic imports in long-lived tabs, service worker update flow). Use this whenever someone says users see the old version, a deploy "didn't go out" for some users, people need a hard refresh, a CDN serves stale HTML, there's a blank screen or "Failed to fetch dynamically imported module" / ChunkLoadError after deploys, a service worker won't update, they want their caching headers reviewed before or after shipping, or they want a check in CI that catches these problems, even if they never mention caching.
---

# Stale deploy check

An old version can live in four places: the browser's HTTP cache, a CDN, a tab that was opened before the deploy, and a service worker. The CLI checks what any HTTP client can see (the first two). You check the code that controls the other two, and the config behind the first two, so the user gets one report covering all four.

The background for every check is the article [We Deployed an Hour Ago. Why Do Users Still See the Old Version?](https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/). Each finding links to the section that explains it, so the user can learn why, not just what to change.

## 1. Find the URL

Use the URL the user gives. If they don't give one, look for the production URL in the repo: `homepage` in package.json, a `CNAME` file, `routes`/`site` in host config (`wrangler.jsonc`/`wrangler.toml`, `netlify.toml`, `vercel.json`, `firebase.json`), the `site` option of the framework config, or the README. Confirm it with the user before running anything against it, since it's their production site.

Prefer production or a preview deploy on the real host. A local dev server is the wrong target: dev servers skip hashing and send their own headers, so every finding would be about the dev server, not the deploy. If there's no deployed URL, skip step 2, do the code checks, and say the headers weren't checked.

## 2. Run the CLI

Find a copy of the CLI that's already on the machine before downloading one, in this order:

1. `stale-deploy-check` on the PATH (`command -v stale-deploy-check`).
2. The project's own install: `npx --no-install stale-deploy-check`, which only uses `node_modules`.
3. A local checkout the user points you to: `node <checkout>/packages/cli/dist/bin.js`.
4. `npx -y stale-deploy-check`, which downloads and runs the package. Ask before doing this, because it runs code from the registry, and some environments block it.

```sh
<cli> <url> --json > "${TMPDIR:-/tmp}/stale-deploy-report.json"
```

Write the report outside the repo so you don't leave files behind. Exit 1 just means it found failures, which is expected. Exit 2 means the check couldn't run (network, not HTML, blocked); stderr says why. Tell the user and carry on with the code checks.

Read the JSON. Its findings follow the format in `references/findings-format.md`. Note in particular:

- `cdn.detected`: which CDN or platform, which decides which config files matter
- `cdn.edge-rule-suspected`, `cdn.html-edge-lifetime`: these make `code.cdn-purge` worth checking
- `page.service-worker`: the page registers one, so the service worker checks matter even if you can't find the file at first
- `assets.not-checked` naming another origin: see "Assets on another origin" below
- `assets.previous-removed`: only present with `--baseline`. If the user has a previous report, pass it.

### Assets on another origin

The CLI only checks the site's own files: the page's origin and subdomains of its host. If `assets.not-checked` says files were skipped on another origin, find out whether that origin is the site's own asset host before trusting the asset findings. Look for an asset prefix in the build config (Vite `base` or `experimental.renderBuiltUrl`, Next.js `assetPrefix`, webpack `output.publicPath`, CRA `PUBLIC_URL`, Astro `build.assetsPrefix`) or an upload to a separate bucket or CDN in the deploy script. If the build points there, rerun with `--asset-origin <origin>` and use that report. Never add origins that only serve third-party code (analytics, fonts, a library CDN). They aren't part of the deploy.

`--asset-origin` arrived in 0.3. If the CLI rejects it as an unknown option, it's an older copy: say the asset domain wasn't checked, and mention that a newer CLI can check it.

### A before-and-after baseline

`--baseline` is the only way to see from outside whether a deploy deleted files that open tabs still need. If the user is about to deploy, offer to save a report now and compare after:

```sh
<cli> <url> --out "${TMPDIR:-/tmp}/stale-deploy-before.json"
# after the deploy finishes
<cli> <url> --baseline "${TMPDIR:-/tmp}/stale-deploy-before.json" --json
```

`assets.previous-removed` then answers `code.asset-retention` for real. Only the asset URLs that changed are requested, so an unchanged build reports `assets.previous-kept` with nothing to check.

## 3. Learn the repo

Before checking anything, work out:

- **Framework and bundler** (Vite, Next.js, Astro, webpack, CRA, Angular…), from package.json and config files. It decides how chunks are named and loaded, and what error a missing chunk throws.
- **Host and deploy path**: the platform, and how files get there (a platform's git integration, `wrangler deploy`, `aws s3 sync`, `rsync`, a Docker image behind nginx). Look in CI workflows (`.github/workflows/`, `.gitlab-ci.yml`), `package.json` scripts, and `deploy*` scripts.
- **Service worker**: a hand-written `sw.js`/`service-worker.js`, Workbox config, `vite-plugin-pwa`, `@ducanh2912/next-pwa`/`next-pwa`, `@angular/service-worker`, or a `navigator.serviceWorker.register(` call.

## 4. Run the code checks

`references/code-checks.md` lists each check: where to look, what counts as a problem, and what fix to suggest for common setups. Read it now. Run each check that applies to this repo, and skip the ones that don't (no service worker means no service worker checks).

Two rules make the report trustworthy:

- **Every code finding cites a file and line.** If you think something is missing (no reload-on-chunk-error handler), say where you looked: "searched src/ for `vite:preloadError`, `ChunkLoadError`, and wrappers around `import()`". A finding the user can't verify is a guess.
- **Cross-check config against the live headers.** When the repo says `no-cache` for HTML but the CLI saw `max-age=3600`, that disagreement is the most useful thing you can report. It means something between the config and the user overrides it: a CDN rule, a config file that isn't in the build output, or a path pattern that doesn't match. Report it as `code.host-html-headers` with both pieces of evidence.

## 5. Test the claim when it's cheap

Reading code tells you what should happen. When the main finding can be checked in a few minutes, check it, because "I reproduced it" is worth more to the user than "this should cause it". Some examples:

- **Suspected deleted chunks:** build the app twice in a scratch copy (never in the user's repo), then compare chunk names. Or request an old hashed URL from the live site and see whether it still loads. A 403 from S3, or `index.html` served in its place by a CloudFront error rule, means it's gone just as surely as a 404.
- **Suspected service worker behavior:** build in a scratch copy and read the generated worker to see what it actually does on install and on message.
- **A pre-release check:** request the exact URLs that are about to change, such as the new page or the index that will link to it, and check how they're cached right now.

Keep it proportionate. Skip it when the repo needs credentials or a long install, and say what you'd test instead. Don't install packages in, build in, or write to the user's repo.

## 6. Report

Answer the user's question first, in a sentence or two, in their terms: "Yes, safe to publish", or "The deploy deletes the files open tabs still need". Then give the counts, then the findings.

The shape depends on what the user asked:

- **"Is it safe?" with no fails** (a pre-release check, a review): they want a verdict, not a report. Give the verdict and the 3–5 facts behind it as short bullets, then a "Worth fixing later" list with one or two lines per warn (what, the fix, the file). Then one line naming the info findings and one line on what you couldn't check. Aim for something they can read in a minute, about 400 words. If they want the details, they'll ask.
- **A symptom to explain, or any fails**: use the full layout below, because they need the reasoning to trust the fix.

Either way, summarize what a test showed in a line or two ("built twice: all 5 chunks renamed"). Don't paste the whole transcript.

Group findings by layer in the order a request reaches them: service worker, HTTP cache, CDN, open tabs, diagnostics. Within a layer, fails first. CLI findings and code findings go together; don't make the user read two reports.

For each fail or warn, give:

- what happens to users, in one plain sentence (✗ for fail, ! for warn)
- why, with this site's numbers (how long, which files)
- the fix, naming the file in this repo to change
- the evidence: file:line, or the header and URL that shows it
- the article section link

Info findings get one line each, with the link. Leave out passes unless the user asks, but do say when a whole layer is clean ("Service worker: none registered").

End with what you couldn't check and why, for example "users' browsers: what's already cached there can't be seen from here; it ages out according to the old headers."

Don't edit code unless the user asks. When they do, make the smallest change that fixes the finding, and rerun the CLI against a preview deploy if one exists, so the fix is checked against real headers.

If the user wants the report as a file (for CI or an issue), write the combined findings as JSON in the CLI's report format, with your findings using `"source": "code"` and `file` evidence.

## Setting it up in CI

If the user wants these problems caught on every deploy, add a step after the production deploy.

On GitHub Actions, use the action. It keeps each report in the Actions cache and compares the next run with it, so it catches deleted assets without any extra steps:

```yaml
- uses: ikhattab/stale-deploy-check@v0
  with:
    url: https://example.com/
    # asset-origins: https://assets.example.com    (one per line)
    # ignore: html.no-validator                     (one per line)
```

On other CI, run the CLI with `--out`, keep the report somewhere that outlives the job (a cache, an artifact, a bucket), and pass it back with `--baseline` next time. Without that, the step can't see deleted assets. Pin the version (`stale-deploy-check@<major>.<minor>`), since findings can change between minor versions before 1.0.

Either way:

- Run it after the deploy finishes, against the URL users load, not a build directory. If the deploy invalidates a CDN, put the step after the invalidation.
- Add an asset origin for an asset domain you found (see "Assets on another origin"), and ignore findings the user has decided to accept, rather than leaving the step out.
- A fail fails the job. Ask whether they want strict mode to fail on warnings too. Most don't at first.
- The step runs after the deploy is live, so it's an alarm, not a gate. If they want a gate, point the same step at a preview or staging URL before the production deploy.

If they asked you to add it, add it. If they only asked whether it's possible, show the change and let them decide. Either way, say which current findings will make the new step fail right away, so a red first run isn't a surprise.
