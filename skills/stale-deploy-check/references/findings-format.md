# Findings format

Every check, whether it runs in the CLI or in the agent skill, reports the same shape. The CLI prints it for people, `--json` prints the raw report, and the skill reads that JSON and adds its own code findings.

## Types

```ts
/**
 * The four places an old version can live, in the order a request reaches them,
 * plus "diagnostics" for findings that make the other layers easier to debug.
 */
type Layer = "service-worker" | "http-cache" | "cdn" | "open-tab" | "diagnostics";

/**
 * fail: users can get an old version after a deploy.
 * warn: works, but costs something (extra downloads, lost bfcache) or depends on luck.
 * info: something we saw that changes how to read the other findings.
 * pass: the check ran and found nothing wrong.
 */
type Severity = "fail" | "warn" | "info" | "pass";

/** Where the finding came from. The CLI only produces "headers". */
type Source = "headers" | "code";

interface Finding {
  /** Stable, dotted id. Safe to match on in CI and to put in an ignore list. */
  check: string;
  layer: Layer;
  severity: Severity;
  source: Source;
  /** One line, plain words: "Browsers may reuse index.html for about 3 days". */
  title: string;
  /** Why it matters for this site, with the numbers we computed. */
  detail: string;
  /** What we saw. At least one entry for anything that isn't "pass". */
  evidence: Evidence[];
  /** What to change. Omitted for "pass" and most "info". */
  fix?: string;
  /** The article section that explains it. */
  learnMore: string;
}

type Evidence =
  | { kind: "header"; url: string; name: string; value: string | null }
  | { kind: "status"; url: string; status: number; request?: Record<string, string> }
  | { kind: "computed"; label: string; value: string }
  | { kind: "file"; path: string; line?: number; excerpt?: string };

interface Report {
  tool: { name: "stale-deploy-check"; version: string };
  target: string;
  /** Final URL after redirects. */
  resolved: string;
  checkedAt: string; // ISO 8601
  /** Every same-origin asset URL the HTML references, checked or not. A later run's --baseline reads this. */
  assets: string[];
  /** Every request the run made, so a finding's evidence can be traced. */
  requests: RequestRecord[];
  findings: Finding[];
  /** Check ids that were dropped by --ignore. */
  ignored: string[];
  summary: Record<Severity, number>;
}

interface RequestRecord {
  method: "GET" | "HEAD";
  url: string;
  status: number;
  /** Lowercased names, values as received. Set-Cookie values are redacted. */
  headers: Record<string, string>;
  /** Conditional headers we sent, if any (If-None-Match, If-Modified-Since). */
  conditional?: Record<string, string>;
  ms: number;
}
```

### `value: null` in header evidence

A missing header is often the finding itself (Question 2), so header evidence keeps the name and sets `value` to `null` instead of leaving the entry out.

### `learnMore`

Always a full URL to a section anchor on the article, so the link still works if the report is pasted into an issue:

| Layer | Default section |
| --- | --- |
| `http-cache` | `#question-2-no-cache-header-means-no-caching-right`, `#question-3-then-turn-caching-off`, `#question-4-why-put-a-hash-in-the-name` |
| `cdn` | `#question-5-some-users-still-get-it-for-an-hour` |
| `open-tab` | `#question-6-a-blank-screen-with-no-cache-involved` |
| `service-worker` | `#question-7-now-add-a-service-worker` |
| `diagnostics` | `#question-8-prove-it` |

Base: `https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/`

## Example

```json
{
  "check": "html.heuristic-freshness",
  "layer": "http-cache",
  "severity": "fail",
  "source": "headers",
  "title": "Browsers may reuse index.html for about 3 days without asking",
  "detail": "The HTML has no Cache-Control or Expires, so browsers guess a lifetime: usually 10% of the time since Last-Modified. The file was last modified 31 days before this response, so a user who loads it now can keep getting this copy for about 3.1 days after your next deploy.",
  "evidence": [
    { "kind": "header", "url": "https://example.com/", "name": "cache-control", "value": null },
    { "kind": "header", "url": "https://example.com/", "name": "expires", "value": null },
    { "kind": "header", "url": "https://example.com/", "name": "last-modified", "value": "Sun, 21 Sep 2026 09:00:00 GMT" },
    { "kind": "computed", "label": "heuristic lifetime (10% of age)", "value": "3.1 days" }
  ],
  "fix": "Send Cache-Control: no-cache on HTML, with an ETag, so browsers keep a copy but ask before every use.",
  "learnMore": "https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/#question-2-no-cache-header-means-no-caching-right"
}
```

## CLI output and exit codes

Human output groups findings by layer in request order (service worker, HTTP cache, CDN, open tab, then diagnostics), skips `pass` unless `--verbose`, and ends with what the CLI could not see:

```txt
https://example.com/  →  2 fail · 3 warn · 1 info

HTTP cache
  ✗ Browsers may reuse index.html for about 3 days without asking
    Last-Modified is 31 days old and there is no Cache-Control.
    Fix: Cache-Control: no-cache, plus an ETag.
    → …/#question-2-no-cache-header-means-no-caching-right
  …

Not checked from here: what's in users' browser caches, open tabs, and service workers.
Run the agent skill on your repo to check the code that controls them.
```

| Exit | Meaning |
| --- | --- |
| 0 | No `fail` findings (or no `warn` either, with `--strict`) |
| 1 | At least one `fail` (or `warn`, with `--strict`) |
| 2 | The check itself couldn't run: DNS, TLS, timeout, non-HTML response, blocked by the site |

`--ignore <check-id>` (repeatable) drops a finding before the exit code is decided. Ignored ids are listed in the report so they don't disappear silently.
