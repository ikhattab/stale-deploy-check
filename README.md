# stale-deploy-check

Find out why users still see the old version after a deploy.

```sh
npx stale-deploy-check https://example.com/
```

It's built on the article [We Deployed an Hour Ago. Why Do Users Still See the Old Version?](https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/), and every finding links to the section that explains it, so you learn why as well as what to change.

> **Work in progress.** Expect rough edges and missed cases, and output that may change between versions. If it gets your site wrong, [open an issue](https://github.com/ikhattab/stale-deploy-check/issues) with the URL and what you expected.

## Where an old version hides

After a deploy, an old copy of your app can live in four places. Two of them can be seen from outside with plain HTTP requests, and two can only be judged by reading your code. That's why there are two parts: a **CLI** for what HTTP shows, and an **agent skill** that runs the CLI and then reads your repo for the rest. A **browser extension** shows the other two for one tab: the one you have open.

| Where | What goes wrong | CLI | Agent skill | Extension |
| --- | --- | --- | --- | --- |
| Browser HTTP cache | HTML reused without asking; unhashed scripts cached for days; a missing file's 404 kept for a year | ✓ live headers | ✓ the host config that sets them | ✓ where this tab's HTML came from |
| CDN | The edge keeps old HTML until it expires or is purged | ✓ cache status, edge lifetime | ✓ purge step in the deploy | |
| Open tabs | Old code requests chunks the deploy deleted: blank screen | ✓ with `--baseline` | ✓ deploy deletes, no reload on chunk errors | ✓ this tab's build and files |
| Service worker | A new worker waits until every tab closes | detects one | ✓ the update flow | ✓ this tab's worker and its cache |

## CLI

```sh
npx stale-deploy-check https://example.com/
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/ikhattab/stale-deploy-check/main/docs/images/cli-report-dark.png">
  <img alt="The CLI's report for a site whose HTML has no Cache-Control: 2 fails and 2 warnings under HTTP cache, each with what goes wrong, a fix, and a link to the article section, ending with the command that copies a prompt for a coding agent" src="https://raw.githubusercontent.com/ikhattab/stale-deploy-check/main/docs/images/cli-report-light.png" width="720">
</picture>

Point it at production or a preview deploy on your real host, not a local dev server: dev servers don't hash file names and send their own headers, so every finding would be about the dev server.

To have a coding agent fix what it found, ask for a prompt instead of the report and paste it into the agent, in the site's repo:

```sh
npx -y stale-deploy-check https://example.com/ --prompt | pbcopy
```

The prompt lists each failure and warning with its evidence and suggested fix, says where headers usually come from in a repo, and ends with the command that checks the fix. Run at a terminal, the report ends with this command whenever there's something to fix. The prompt quotes headers and URLs from the site, and tells the agent to treat them as data. To also review the service worker and deploy code, use the [agent skill](#agent-skill) instead.

It makes a handful of requests per run: the page, a conditional request for it, a `HEAD` for each script and stylesheet (up to 20) and for a made-up file next to them, to see how long a missing file's 404 is kept, with a `GET` when `HEAD` gets an error. It doesn't crawl or send cookies.

### Options

| Option | What it does |
| --- | --- |
| `--json` | Print the full report as JSON instead of text |
| `--prompt` | Print a prompt for your AI coding agent to fix what was found, instead of the report. Try `--prompt \| pbcopy`. |
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

Run it after each production deploy. On GitHub Actions, add a step after the deploy:

```yaml
- uses: ikhattab/stale-deploy-check@v0
  with:
    url: https://example.com/
```

The step fails when a deploy can leave users on an old version, and the report goes in the job summary. It keeps each run's report in the Actions cache and compares the next run with it, which catches the blank-screen problem: a deploy that deletes the files that tabs opened before it still need. The first run has nothing to compare with, so that part starts from the second.

| Input | What it does |
| --- | --- |
| `url` | The page users load. Required. |
| `asset-origins` | Other origins that serve your files, one per line (`--asset-origin`) |
| `ignore` | Check ids to ignore, one per line |
| `strict` | `true` to fail on warnings too |
| `baseline` | `false` to skip keeping reports between runs |
| `version` | The CLI version to run from npm (default: the action's own minor version) |

Outputs: `exit-code` (0, 1 or 2), `report` (the JSON report's path), and `compared` (whether this run was compared with the previous one).

The step runs after the deploy, so a red job means the deploy is already live: it's an alarm, not a gate. To block a deploy, run the same step against a preview or staging URL on the same host first.

**Other CI systems.** Save each report with `--out` and pass the previous one back with `--baseline`:

```sh
npx -y stale-deploy-check@0.5 https://example.com/ --baseline previous-report.json --out report.json
```

Keep `report.json` somewhere that outlives the job (a cache, an artifact, a bucket) and restore it as `previous-report.json` next time. Pin the version while the project is pre-1.0, since findings can change between minor versions. If a finding doesn't apply to your site, `--ignore` it by id rather than dropping the step.

### What it can't see

Only what any HTTP client can see from one place: the HTML's headers, the names and headers of its scripts and stylesheets, and the CDN edge that answered. It can't see what's already in users' browser caches, what their open tabs are running, or what their service workers serve. Other CDN edges can hold different copies than the one that answered. The agent skill covers the code that controls the rest, and the [browser extension](#browser-extension) shows it for a tab you have open.

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

## Browser extension

Install [stale-deploy-check from the Chrome Web Store](https://chromewebstore.google.com/detail/stale-deploy-check/bcibhjoeiphifeicebippfihloijnanm). When a tab still shows the old version after a deploy, click its toolbar button on that tab to find out why. It looks at the tab from inside the browser:

- **Its build**: the tab's build id (or, without one, the files it loaded) against what the server sends now.
- **Where its HTML came from**: the network, the browser cache, a 304, or a service worker.
- **The service worker**: whether one controls the tab, whether a new one is waiting to take over, and whether its cache holds an old copy of the page.
- **The files the tab loaded**: whether the deploy deleted them, which leaves the tab one click away from a blank screen.

<img alt="The extension's popup on a tab that loaded build 1 from its service worker after build 2 was deployed: 2 fails, each with the evidence, a fix, and a Copy prompt to fix button" src="https://raw.githubusercontent.com/ikhattab/stale-deploy-check/main/packages/extension/store/screenshot-1-service-worker.png" width="720">

Each problem names the layer that kept the old version, with the evidence, a fix, and a link to the article section. **Copy prompt to fix** copies a prompt for your coding agent, like the CLI's `--prompt`. The checks are listed in [docs/checks.md](https://github.com/ikhattab/stale-deploy-check/blob/main/docs/checks.md#browser-probe-checks).

## Privacy

None of the tools collect anything or send it anywhere, and none have telemetry. The CLI and the GitHub Action request the URL you give them and its files, as listed above. The browser extension runs only when you click it, and only on that tab: it reads the tab, requests that page and its files from the same site, and shows the result in its popup. The agent skill runs in your coding agent and reads your repo there.

## Development

```sh
npm install
npm run build   # tsc -b, then bundle the CLI, the probe snippet, and the extension
npm test        # node --test against the TypeScript sources
npm run package:extension   # build, then zip the extension for the Chrome Web Store
npm run screenshot:cli      # redraw the README's CLI screenshots in docs/images (needs Chrome)
```

```
packages/core       fetch-only checks that return findings; runs in Node, Workers, and browsers
packages/cli        the stale-deploy-check command
packages/probe      runs inside a tab: is it on the old version, and why (built as a console snippet)
packages/extension  a browser extension that runs the probe on the current tab (load packages/extension/dist/chrome unpacked to try a change); store/ has the listing
skills/             the agent skill
evals/              the skill's test prompts and two example repos
calibration/        runs the CLI against 50 real sites and compares versions
action.yml          the GitHub Action; action/check.sh does the work, and CI runs it against the test server
```

- [docs/checks.md](https://github.com/ikhattab/stale-deploy-check/blob/main/docs/checks.md): every check, what triggers it, and where the article explains it
- [docs/findings.md](https://github.com/ikhattab/stale-deploy-check/blob/main/docs/findings.md): the finding and report format

Releases: bump every `package.json` and `packages/extension/static/manifest.json` (a test checks they match), then push a `vX.Y.Z` tag that matches `packages/cli/package.json`. [`release.yml`](https://github.com/ikhattab/stale-deploy-check/blob/main/.github/workflows/release.yml) tests the tag and, once a maintainer approves the `npm` environment, publishes to npm with [trusted publishing](https://docs.npmjs.com/trusted-publishers) and provenance. After npm lists the version, move the `v0` tag to it for the action. Then run `npm run package:extension` and upload the zip to the [Chrome Web Store listing](https://chromewebstore.google.com/detail/stale-deploy-check/bcibhjoeiphifeicebippfihloijnanm) from the developer dashboard.

## License

MIT
