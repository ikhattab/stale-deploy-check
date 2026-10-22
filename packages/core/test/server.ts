import { createServer, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR = "public, max-age=31536000, immutable";

type Route = (req: IncomingMessage) => { status?: number; headers?: OutgoingHttpHeaders; body?: string };

const html = (body: string): string => `<!doctype html><html><head>${body}</head><body></body></html>`;
const asset = (cacheControl?: string): Route => () => ({ headers: { "content-type": "text/javascript", ...(cacheControl ? { "cache-control": cacheControl } : {}) }, body: "//" });

let dynamicCounter = 0;

/** One scenario per path prefix, each built to trigger specific findings. */
const routes: Record<string, Route> = {
  // No Cache-Control, a 31-day-old Last-Modified, an unhashed long-cached script, a ?v= stylesheet, a third-party script.
  "/bad/": () => ({
    headers: { "content-type": "text/html; charset=utf-8", "last-modified": new Date(Date.now() - 31 * DAY_MS).toUTCString() },
    body: html(`
      <script src="/bad/app.js"></script>
      <link rel="stylesheet" href="/bad/style.css?v=42">
      <script src="https://third-party.example/widget.js"></script>`),
  }),
  "/bad/app.js": asset("public, max-age=604800"),
  "/bad/style.css": asset("public, max-age=3600"),

  // What the article recommends.
  "/good/": (req) =>
    req.headers["if-none-match"] === '"v1"'
      ? { status: 304, headers: { etag: '"v1"', "cache-control": "no-cache" } }
      : {
          headers: { "content-type": "text/html", "cache-control": "no-cache", etag: '"v1"' },
          body: html(`
            <meta name="build" content="2026-10-22.1">
            <script type="module" src="/good/assets/app.3f9a1c.js"></script>
            <link rel="modulepreload" href="/good/assets/settings.a71f30.js">
            <link rel="stylesheet" href="assets/index-BxKaQzWe.css">`),
        },
  "/good/assets/app.3f9a1c.js": asset(YEAR),
  "/good/assets/settings.a71f30.js": asset(YEAR),
  "/good/assets/index-BxKaQzWe.css": asset(YEAR),
  "/good/assets/kept.222bbb.js": asset(YEAR),
  // How a deleted file comes back from S3 behind CloudFront: 403 when the reader can't list the bucket,
  // or the SPA's index.html with a 200 when an error response is mapped to it.
  "/good/assets/forbidden.333ccc.js": () => ({ status: 403, headers: { "content-type": "application/xml" }, body: "<Error><Code>AccessDenied</Code></Error>" }),
  "/good/assets/fallback.444ddd.js": () => ({ headers: { "content-type": "text/html" }, body: html("") }),

  // A Cloudflare zone cache holding HTML that says no-cache.
  "/edge/": () => ({
    headers: { "content-type": "text/html", "cache-control": "no-cache", "cf-ray": "8d1f-FRA", "cf-cache-status": "HIT", age: "2412" },
    body: html(""),
  }),
  // Like example.com: no Cache-Control, so the CDN guesses a lifetime from Last-Modified just as browsers do.
  "/edge-heuristic/": () => ({
    headers: { "content-type": "text/html", "last-modified": new Date(Date.now() - DAY_MS).toUTCString(), "cf-ray": "8d1f-MRS", "cf-cache-status": "HIT", age: "600" },
    body: html(""),
  }),
  // A Worker's version-keyed cache: HIT without Age.
  "/worker/": () => ({
    headers: { "content-type": "text/html", "cache-control": "public, max-age=0, must-revalidate", "cf-ray": "8d1f-ZRH", "cf-cache-status": "HIT", server: "cloudflare" },
    body: html(""),
  }),
  // Cloudflare passing requests through (DYNAMIC) to a platform cache that clears on deploy, like tailwindcss.com and docusaurus.io.
  "/cf-over-vercel/": () => ({
    headers: { "content-type": "text/html", "cache-control": "public, max-age=0, must-revalidate", "cf-ray": "a4e8-MRS", "cf-cache-status": "DYNAMIC", server: "cloudflare", age: "9", "x-vercel-id": "cdg1::sfo1::nz8kz", "x-vercel-cache": "HIT" },
    body: html(""),
  }),
  "/cf-over-netlify/": () => ({
    headers: { "content-type": "text/html", "cache-control": "public,max-age=0,must-revalidate", "cf-ray": "a4e8-CDG", "cf-cache-status": "DYNAMIC", server: "cloudflare", age: "970", "x-nf-request-id": "01M5", "cache-status": '"Netlify Edge"; hit; ttl=31535030' },
    body: html(""),
  }),
  // Fastly caching HTML on Surrogate-Control, which it strips, like python.org.
  "/fastly/": () => ({
    headers: { "content-type": "text/html", "cache-control": "max-age=0, must-revalidate", "x-served-by": "cache-mrs1530041-MRS", "x-cache": "HIT, HIT", age: "300" },
    body: html(""),
  }),
  // Long CDN lifetime on CloudFront, using a header CloudFront doesn't document.
  "/cloudfront/": () => ({
    headers: { "content-type": "text/html", "cache-control": "max-age=0, s-maxage=3600", "cdn-cache-control": "max-age=3600", "x-amz-cf-id": "abc", "x-amz-cf-pop": "FRA56-P1" },
    body: html(""),
  }),
  // A fresh ETag on every request, so revalidation can never 304.
  "/dynamic/": () => ({ headers: { "content-type": "text/html", "cache-control": "no-cache", etag: `"n${dynamicCounter++}"` }, body: html("") }),
  "/max-age-long/": () => ({ headers: { "content-type": "text/html", "cache-control": "max-age=600" }, body: html("") }),
  "/max-age-short/": () => ({ headers: { "content-type": "text/html", "cache-control": "max-age=120, stale-while-revalidate=60" }, body: html("") }),
  "/no-store/": () => ({ headers: { "content-type": "text/html", "cache-control": "no-store" }, body: html("") }),
  "/sw/": () => ({
    headers: { "content-type": "text/html", "cache-control": "no-cache" },
    body: html(`<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js")</script>`),
  }),
  // Scripts on a subdomain and on an unrelated asset domain. Tests serve every host from this server.
  "/split/": () => ({
    headers: { "content-type": "text/html", "cache-control": "no-cache" },
    body: html(`
      <script src="https://static.site.test/split/app.js"></script>
      <script src="https://assets.cdn.test/split/vendor.js"></script>`),
  }),
  "/split/app.js": asset("public, max-age=604800"),
  "/split/vendor.js": asset("public, max-age=604800"),
  "/elsewhere/": () => ({
    headers: { "content-type": "text/html", "cache-control": "no-cache" },
    body: html(`<script src="https://assets.cdn.test/split/vendor.js"></script><script src="https://assets.cdn.test/split/app.js"></script>`),
  }),

  // An asset server that rejects HEAD.
  "/head405/": () => ({ headers: { "content-type": "text/html", "cache-control": "no-cache" }, body: html(`<script src="/head405/app.9c8b7a.js"></script>`) }),
  "/head405/app.9c8b7a.js": (req) => (req.method === "HEAD" ? { status: 405 } : asset(YEAR)(req)),

  // Escape sequences in a <meta> tag, which ends up in a finding title.
  "/escape/": () => ({
    headers: { "content-type": "text/html", "cache-control": "no-cache" },
    body: html(`<meta name="build" content="&#27;]0;pwned&#7;&#27;[2J v1&#x202E;">`),
  }),
  "/redirect": () => ({ status: 301, headers: { location: "/good/" } }),
  "/json": () => ({ headers: { "content-type": "application/json" }, body: "{}" }),
  "/blocked": () => ({ status: 403, headers: { "content-type": "text/html" }, body: "no" }),
};

export interface TestServer {
  url: (path: string) => string;
  close: () => Promise<void>;
}

export async function startServer(): Promise<TestServer> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const route = routes[path];
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
      return;
    }
    const { status = 200, headers = {}, body } = route(req);
    res.writeHead(status, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: (path) => `http://127.0.0.1:${port}${path}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
