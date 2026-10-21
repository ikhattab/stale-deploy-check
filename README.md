# stale-deploy-check

Find out why users still see the old version after a deploy.

Based on [We Deployed an Hour Ago. Why Do Users Still See the Old Version?](https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/), which walks through the four places an old copy can live: the HTTP cache, the CDN, the open tab, and the service worker.


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

It checks what any HTTP client can see: the HTML's cache headers, whether asset names are hashed, and the CDN in front of the site. It can't see users' browser caches, their open tabs, or their service workers. The [agent skill](#agent-skill) checks the code that controls those.

## Agent skill

The CLI checks what HTTP can show. The agent skill runs it, then reads your repo for the rest: host header config, whether deploys delete old assets, recovery from failed dynamic imports, and the service worker update flow. It tests its main claim when that's cheap (a scratch build, a local reproduction), and doesn't edit your code unless you ask.

Install it with [skills](https://github.com/vercel-labs/skills), which works with Claude Code, Codex, Cursor and other agents:

```sh
npx skills add ikhattab/stale-deploy-check        # into this project
npx skills add ikhattab/stale-deploy-check -g     # for all your projects
```

Then ask your agent something like "users still see the old version after we deploy, can you find out why?". `npx skills update` picks up new versions.

## Development

```sh
npm install
npm run build   # tsc -b
npm test        # node --test against the TypeScript sources
```

```
packages/core   fetch-only checks that return findings; runs in Node, Workers, and browsers
packages/cli    the stale-deploy-check command
skills/         the agent skill
evals/          the skill's test prompts and two example repos
```

- [docs/findings.md](https://github.com/ikhattab/stale-deploy-check/blob/main/docs/findings.md): the finding and report format
- [docs/checks.md](https://github.com/ikhattab/stale-deploy-check/blob/main/docs/checks.md): every check, what triggers it, and where the article explains it

## License

MIT
