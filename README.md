# stale-deploy-check

Find out why users still see the old version after a deploy.

```sh
npx stale-deploy-check https://example.com/
```

It's built on the article [We Deployed an Hour Ago. Why Do Users Still See the Old Version?](https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/), and every finding links to the section that explains it, so you learn why as well as what to change.

> **Work in progress.** Expect rough edges and missed cases, and output that may change between versions. If it gets your site wrong, [open an issue](https://github.com/ikhattab/stale-deploy-check/issues) with the URL and what you expected.

## Where an old version hides

After a deploy, an old copy of your app can live in four places. Two of them can be seen from outside with plain HTTP requests, and two can only be judged by reading your code. That's why there are two parts: a **CLI** for what HTTP shows, and an **agent skill** that runs the CLI and then reads your repo for the rest.

| Where | What goes wrong | CLI | Agent skill |
| --- | --- | --- | --- |
| Browser HTTP cache | HTML reused without asking; unhashed scripts cached for days | ✓ live headers | ✓ the host config that sets them |
| CDN | The edge keeps old HTML until it expires or is purged | ✓ cache status, edge lifetime | ✓ purge step in the deploy |
| Open tabs | Old code requests chunks the deploy deleted: blank screen | ✓ with `--baseline` | ✓ deploy deletes, no reload on chunk errors |
| Service worker | A new worker waits until every tab closes | detects one | ✓ the update flow |

## CLI

```sh
npx stale-deploy-check https://example.com/
```

```txt
https://example.com/  →  1 fail · 1 warn · 3 info

HTTP cache
  ✗ Browsers may reuse the HTML for about 1.6 hours without asking
    The HTML has no Cache-Control lifetime and no Expires, so browsers guess
    one: usually 10% of the time since Last-Modified. It was last modified 16.5
    hours before this response, so a user who loads it now can keep getting this
    copy for about 1.6 hours after your next deploy.
    Fix: Send Cache-Control: no-cache on HTML, with an ETag, so browsers keep a
    copy but ask before every use.
    → https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/#question-2-no-cache-header-means-no-caching-right
  ! 1 file without a hash in the name
  …
```

Point it at production or a preview deploy on your real host, not a local dev server: dev servers don't hash file names and send their own headers, so every finding would be about the dev server.

It makes a handful of requests per run: the page, a conditional request for it, and a `HEAD` for each script and stylesheet (up to 20). It doesn't crawl, send cookies, or guess paths.

### Options

| Option | What it does |
| --- | --- |
| `--json` | Print the full report as JSON instead of text |
| `--out <file>` | Also save the JSON report, for use as the next run's `--baseline` |
| `--baseline <file>` | A previous report: check that the files it referenced still load |
| `--asset-origin <url>` | Another origin that serves your files, like an asset domain or a CDN distribution. Repeatable. Subdomains of the page's host are always checked. |
| `--strict` | Exit 1 on warnings too |
| `--ignore <check-id>` | Drop a finding by id. Repeatable. Ignored ids are listed in the report. |
| `--html-max-age <s>` | How long browsers may reuse the HTML before it fails (default 300) |
| `--edge-max-age <s>` | How long a CDN may keep the HTML before it warns (default 300) |
| `--max-assets <n>` | How many scripts and stylesheets to check (default 20) |
| `--timeout <ms>` | Per-request timeout (default 10000) |
| `--verbose` | Show passing checks and the evidence behind each finding |
| `--no-color` | Plain output |

| Exit | Meaning |
| --- | --- |
| 0 | No failures (no warnings either, with `--strict`) |
| 1 | At least one failure |
| 2 | The check couldn't run: network error, non-HTML response, blocked |

**Assets on another domain.** Only your own files are checked, since third-party scripts aren't part of your deploy. "Your own" means the page's origin and subdomains of its host, so `static.example.com` counts for `www.example.com`. If your build serves files from somewhere else (`d1234.cloudfront.net`, `example-assets.com`), the report says how many it skipped and where. Add that origin with `--asset-origin`.

### In CI

Run it after each production deploy. Saving each report and passing the previous one as `--baseline` catches the blank-screen problem: a deploy that deletes the files that tabs opened before it still need.

```yaml
# .github/workflows/deploy.yml, after the deploy step
- name: Restore the previous deploy's report
  uses: actions/cache/restore@v4
  with:
    path: stale-deploy-report.json
    key: stale-deploy-report-${{ github.run_id }}
    restore-keys: stale-deploy-report-

- name: Check for stale deploys
  run: |
    if [ -f stale-deploy-report.json ]; then
      mv stale-deploy-report.json previous-report.json
      baseline="--baseline previous-report.json"
    fi
    npx -y stale-deploy-check@0.3 "https://example.com/" $baseline --out stale-deploy-report.json

- name: Save this deploy's report
  if: always()
  uses: actions/cache/save@v4
  with:
    path: stale-deploy-report.json
    key: stale-deploy-report-${{ github.run_id }}
```

Pin the version while the project is pre-1.0, since findings can change between minor versions. If a finding doesn't apply to your site, `--ignore` it by id rather than dropping the step.

### What it can't see

Only what any HTTP client can see from one place: the HTML's headers, the names and headers of its scripts and stylesheets, and the CDN edge that answered. It can't see what's already in users' browser caches, what their open tabs are running, or what their service workers serve. Other CDN edges can hold different copies than the one that answered. The agent skill covers the code that controls the rest.

## Agent skill

The skill has your coding agent do the whole investigation. It runs the CLI against your site, reads the repo for what HTTP can't show, tests its main claim when that's cheap, and gives you one report covering all four places, with a file and line for every code finding.

Install it with [skills](https://github.com/vercel-labs/skills), which works with Claude Code, Codex, Cursor and other agents:

```sh
npx skills add ikhattab/stale-deploy-check        # into this project
npx skills add ikhattab/stale-deploy-check -g     # for all your projects
npx skills update                                 # later, to pick up new versions
```

Or copy [`skills/stale-deploy-check/`](https://github.com/ikhattab/stale-deploy-check/tree/main/skills/stale-deploy-check) into your agent's skills directory (`.claude/skills/` for Claude Code).

### Using it

You don't need to name the skill. Describe the symptom, and the agent picks it up:

- "Users still see the old version after we deploy, can you find out why?"
- "Every deploy, a few people get a blank screen with *Failed to fetch dynamically imported module*. Refreshing fixes it."
- "Since we added a service worker, new releases don't show up until people close every tab."
- "Before I publish, check that example.com won't serve stale pages after the deploy."
- "Add a check to our deploy workflow that fails if users could get stuck on an old version."

Give it the production URL if you can. Without one it looks in the repo (`homepage`, `CNAME`, host config) and asks you to confirm before sending any requests.

What it checks in the repo:

- **Host header config**: `_headers`, `vercel.json`, `netlify.toml`, `firebase.json`, nginx or Caddy, S3 upload flags. Where the config and the live headers disagree, it reports both.
- **CDN purge**: whether the deploy purges HTML when the CDN keeps it.
- **Old assets**: whether the deploy deletes the previous build's chunks (`s3 sync --delete`, `rsync --delete`, platforms that replace the whole site).
- **Chunk-load recovery**: whether a failed dynamic import reloads once, with a loop guard.
- **Service worker update flow**: `skipWaiting`, how a waiting update reaches the user, and whether navigations come from the worker's cache.
- **Build id**: whether the page says which deploy it is, so "the old version" has a number.

What it won't do: edit your code unless you ask, install packages or build in your repo (tests run in a scratch copy), or download the CLI with `npx` without asking first.

## Development

```sh
npm install
npm run build   # tsc -b, then bundle the CLI
npm test        # node --test against the TypeScript sources
```

```
packages/core   fetch-only checks that return findings; runs in Node, Workers, and browsers
packages/cli    the stale-deploy-check command
skills/         the agent skill
evals/          the skill's test prompts and two example repos
```

- [docs/checks.md](https://github.com/ikhattab/stale-deploy-check/blob/main/docs/checks.md): every check, what triggers it, and where the article explains it
- [docs/findings.md](https://github.com/ikhattab/stale-deploy-check/blob/main/docs/findings.md): the finding and report format

## License

MIT
