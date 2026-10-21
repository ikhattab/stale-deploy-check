import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { browserFreshness, parseCacheControl } from "../src/cache-control.ts";
import { detectCdn, edgeCacheState, sharedLifetime } from "../src/cdn.ts";
import { formatDuration } from "../src/duration.ts";
import { parsePage } from "../src/html.ts";
import { hasContentHash, versionParam } from "../src/naming.ts";
import type { RequestRecord } from "../src/types.ts";

const record = (headers: Record<string, string>): RequestRecord => ({ method: "GET", url: "https://example.com/", status: 200, headers, ms: 0 });
const DATE = "Fri, 17 Oct 2026 09:00:00 GMT";

describe("parseCacheControl", () => {
  test("names are lowercased, values unquoted, first occurrence wins", () => {
    const cc = parseCacheControl('Public, MAX-AGE=60, no-cache="set-cookie, x-foo", max-age=5');
    assert.equal(cc.get("public"), true);
    assert.equal(cc.get("max-age"), "60");
    assert.equal(cc.get("no-cache"), "set-cookie, x-foo");
  });

  test("empty and missing values", () => {
    assert.equal(parseCacheControl(undefined).size, 0);
    assert.equal(parseCacheControl("").size, 0);
  });
});

describe("browserFreshness", () => {
  test("no-store beats everything", () => {
    assert.deepEqual(browserFreshness(record({ "cache-control": "no-store, max-age=600" })), { kind: "no-store" });
  });

  test("no-cache and max-age=0 revalidate; qualified no-cache doesn't", () => {
    assert.equal(browserFreshness(record({ "cache-control": "no-cache" })).kind, "revalidate");
    assert.equal(browserFreshness(record({ "cache-control": "public, max-age=0, must-revalidate" })).kind, "revalidate");
    assert.deepEqual(browserFreshness(record({ "cache-control": 'no-cache="set-cookie", max-age=60' })), { kind: "explicit", via: "max-age", seconds: 60 });
  });

  test("Expires relative to Date; invalid Expires is already expired", () => {
    assert.deepEqual(browserFreshness(record({ date: DATE, expires: "Fri, 17 Oct 2026 10:00:00 GMT" })), { kind: "explicit", via: "expires", seconds: 3600 });
    assert.equal(browserFreshness(record({ date: DATE, expires: "0" })).kind, "revalidate");
  });

  test("the article's example: ten days since Last-Modified gives one day", () => {
    const f = browserFreshness(record({ date: DATE, "last-modified": "Tue, 07 Oct 2026 09:00:00 GMT" }));
    assert.deepEqual(f, { kind: "heuristic", seconds: 86400, lastModifiedAge: 864000 });
  });

  test("s-maxage alone still leaves browsers guessing", () => {
    assert.equal(browserFreshness(record({ date: DATE, "cache-control": "s-maxage=60", "last-modified": DATE })).kind, "heuristic");
  });

  test("nothing to go on", () => {
    assert.deepEqual(browserFreshness(record({ "cache-control": "public" })), { kind: "none" });
  });
});

describe("hasContentHash", () => {
  const hashed = [
    "/assets/app.3f9a1c.js",
    "/assets/index-BxK3a9Qz.js",
    "/assets/index-BxKaQzWe.css",
    "/_astro/Base.Bpa2CPKj.css",
    "/_next/static/chunks/main-app-7a3f0c1e2b.js",
    "/_next/static/a1B2c3D4e5/_buildManifest.js",
    "/vendor/jquery-3.7.1.min.js",
    "/static/js/main.8b1e07ab.chunk.js",
    "/_next/static/immutable/chunks/1omje2kalxx-o.css",
    "/_next/static/immutable/chunks/2j9_bme65_mpx.js",
  ];
  const unhashed = ["/app.js", "/app.bundle.js", "/framework-polyfills.js", "/assets/vendor.min.js", "/static/runtime.js", "/main.mjs?v=42", "/rum.js", "/vendors-node_modules_react.js"];

  for (const path of hashed) test(`hashed: ${path}`, () => assert.ok(hasContentHash(`https://example.com${path}`)));
  for (const path of unhashed) test(`not hashed: ${path}`, () => assert.ok(!hasContentHash(`https://example.com${path}`)));
});

test("versionParam", () => {
  assert.equal(versionParam("https://example.com/app.js?v=42"), "v=42");
  assert.equal(versionParam("https://example.com/app.js?build=2026.10"), "build=2026.10");
  assert.equal(versionParam("https://example.com/app.js?lang=en"), undefined);
  assert.equal(versionParam("https://example.com/app.js?v="), undefined);
});

describe("CDN headers", () => {
  test("detects CDNs and the edge that answered", () => {
    assert.deepEqual(detectCdn(record({ "cf-ray": "a4e3c46b1ee170cb-ZRH" })), { name: "Cloudflare", edge: "ZRH" });
    assert.deepEqual(detectCdn(record({ "x-vercel-id": "fra1::iad1::abc" })), { name: "Vercel", edge: "fra1" });
    assert.deepEqual(detectCdn(record({ "x-nf-request-id": "01J" })), { name: "Netlify" });
    assert.deepEqual(detectCdn(record({ "x-amz-cf-id": "x", "x-amz-cf-pop": "FRA56-P1" })), { name: "CloudFront", edge: "FRA56-P1" });
    assert.deepEqual(detectCdn(record({ "x-served-by": "cache-fra-etou8220145-FRA, cache-ams21021-AMS" })), { name: "Fastly", edge: "cache-ams21021-AMS" });
    assert.equal(detectCdn(record({ server: "nginx" })), undefined);
  });

  test("edge hits from Age and cache status headers", () => {
    assert.equal(edgeCacheState(record({ age: "2412" })).hit, true);
    assert.equal(edgeCacheState(record({ age: "0" })).hit, false);
    assert.equal(edgeCacheState(record({ "cf-cache-status": "DYNAMIC" })).hit, false);
    assert.equal(edgeCacheState(record({ "cf-cache-status": "HIT" })).hit, true);
    assert.equal(edgeCacheState(record({ "x-cache": "Hit from cloudfront" })).hit, true);
    assert.equal(edgeCacheState(record({ "x-cache": "MISS, HIT" })).hit, true);
    assert.equal(edgeCacheState(record({ "x-cache": "MISS, MISS" })).hit, false);
    assert.equal(edgeCacheState(record({ "cache-status": '"Netlify Edge"; hit' })).hit, true);
    assert.equal(edgeCacheState(record({ "cache-status": '"Netlify Edge"; fwd=miss' })).hit, false);
  });

  test("shared lifetime prefers the most specific header", () => {
    assert.equal(sharedLifetime(record({ "cache-control": "s-maxage=60", "cdn-cache-control": "max-age=120" }))?.seconds, 120);
    assert.equal(sharedLifetime(record({ "cache-control": "max-age=0, s-maxage=60" }))?.seconds, 60);
    assert.equal(sharedLifetime(record({ "cache-control": "max-age=60" })), undefined);
  });
});

describe("parsePage", () => {
  test("collects scripts and stylesheets, resolves against <base>, dedupes", () => {
    const page = parsePage(
      `<base href="/app/"><link rel="stylesheet" href="a.css"><link rel="icon" href="i.png">
       <link rel="preload" as="script" href="b.js"><link rel="preload" as="font" href="f.woff2">
       <script src="b.js"></script><script src="/c.js#x"></script><script src="data:text/javascript,1"></script>`,
      "https://example.com/page",
    );
    assert.deepEqual(page.assets, ["https://example.com/app/a.css", "https://example.com/app/b.js", "https://example.com/c.js"]);
  });

  test("build id from meta", () => {
    assert.deepEqual(parsePage(`<meta name="version" content="1.2.3">`, "https://example.com/").buildId, { name: "version", content: "1.2.3" });
    assert.equal(parsePage(`<meta name="description" content="x">`, "https://example.com/").buildId, undefined);
  });

  test("service worker registration", () => {
    const url = "https://example.com/";
    assert.ok(parsePage(`<script>navigator.serviceWorker.register('/sw.js')</script>`, url).serviceWorker);
    assert.ok(parsePage(`<script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script>`, url).serviceWorker);
    assert.equal(parsePage(`<script src="/_astro/ServiceWorkerLifecycle.astro_astro_type_script_index_0_lang.wS4vCHOc.js"></script>`, url).serviceWorker, undefined);
    assert.equal(parsePage(`<script>// talks about serviceWorker</script>`, url).serviceWorker, undefined);
  });
});

test("formatDuration", () => {
  assert.equal(formatDuration(45), "45 s");
  assert.equal(formatDuration(720), "12 min");
  assert.equal(formatDuration(5.5 * 3600), "5.5 hours");
  assert.equal(formatDuration(268_000), "3.1 days");
});
