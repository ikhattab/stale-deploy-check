# stale-deploy-check

Find out why users still see the old version after a deploy.

Based on [We Deployed an Hour Ago. Why Do Users Still See the Old Version?](https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/), which walks through the four places an old copy can live: the HTTP cache, the CDN, the open tab, and the service worker.

> Status: the CLI and the agent skill work; neither is published yet.

## Usage

```sh
npx stale-deploy-check https://example.com/
```

```txt
https://example.com/  →  1 fail · 1 warn · 3 info

HTTP cache
  ✗ Browsers may reuse the HTML for about 2.3 hours without asking
    The HTML has no Cache-Control lifetime and no Expires, so browsers guess
    one: usually 10% of the time since Last-Modified. …
    Fix: Send Cache-Control: no-cache on HTML, with an ETag, so browsers keep a
    copy but ask before every use.
    → https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/#question-2-no-cache-header-means-no-caching-right
```

Every finding links to the part of the article that explains it.

### In CI

Run it after each deploy. It exits 1 when something can leave users on an old version:

```sh
# Save this deploy's report, and check that the previous deploy's assets still load.
npx stale-deploy-check "$PREVIEW_URL" --baseline previous-report.json --out report.json
```

| Exit | Meaning |
| --- | --- |
| 0 | No failures (no warnings either, with `--strict`) |
| 1 | At least one failure |
| 2 | The check couldn't run: network error, non-HTML response, blocked |

Options: `--json`, `--out <file>`, `--baseline <file>`, `--strict`, `--ignore <check-id>`, `--html-max-age <s>`, `--edge-max-age <s>`, `--max-assets <n>`, `--timeout <ms>`, `--verbose`, `--no-color`. See `--help`.

### What it can't see

It checks what any HTTP client can see: the HTML's cache headers, whether asset names are hashed, and the CDN in front of the site. It can't see users' browser caches, their open tabs, or their service workers. The agent skill in [`skill/stale-deploy-check`](skill/stale-deploy-check/SKILL.md) runs the CLI, then checks the code that controls those: host header config, whether deploys delete old assets, recovery from failed dynamic imports, and the service worker update flow.

## Development

```sh
npm install
npm run build   # tsc -b
npm test        # node --test against the TypeScript sources
```

```
packages/core   fetch-only checks that return findings; runs in Node, Workers, and browsers
packages/cli    the stale-deploy-check command
skill/          the agent skill; skill/evals has its test prompts and two example repos
```

- [docs/findings.md](docs/findings.md): the finding and report format
- [docs/checks.md](docs/checks.md): every check, what triggers it, and where the article explains it
