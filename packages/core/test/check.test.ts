import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { check, CheckError, type Finding, type Report } from "../src/index.ts";
import { startServer, type TestServer } from "./server.ts";

let server: TestServer;
before(async () => {
  server = await startServer();
});
after(() => server.close());

const find = (report: Report, id: string): Finding | undefined => report.findings.find((f) => f.check === id);
const severities = (report: Report): Record<string, string> => Object.fromEntries(report.findings.map((f) => [f.check, f.severity]));

describe("check()", () => {
  test("the bad scenario: guessed freshness, unhashed long-cached script, ?v= stylesheet", async () => {
    const report = await check(server.url("/bad/"));
    const s = severities(report);
    assert.equal(s["html.heuristic-freshness"], "fail");
    assert.match(find(report, "html.heuristic-freshness")!.title, /about 3\.1 days/);
    assert.equal(s["assets.unhashed-long-cache"], "fail");
    assert.equal(s["assets.query-version"], "warn");
    assert.equal(s["assets.not-checked"], "info");
    assert.equal(s["page.build-id"], "info");
    assert.equal(report.summary.fail, 2);
    // The third-party script isn't part of the deploy.
    assert.deepEqual(report.assets, [server.url("/bad/app.js"), server.url("/bad/style.css?v=42")]);
  });

  test("the good scenario has nothing to fix and revalidates with a 304", async () => {
    const report = await check(server.url("/good/"));
    assert.deepEqual(
      report.findings.filter((f) => f.severity === "fail" || f.severity === "warn"),
      [],
    );
    const s = severities(report);
    assert.equal(s["html.max-age"], "pass");
    assert.equal(s["html.revalidation"], "pass");
    assert.equal(s["assets.short-cache"], "pass");
    assert.equal(s["page.build-id"], "pass");
    const conditional = report.requests.find((r) => r.conditional);
    assert.deepEqual(conditional?.conditional, { "if-none-match": '"v1"' });
    assert.equal(conditional?.status, 304);
  });

  test("redirects are followed and recorded", async () => {
    const report = await check(server.url("/redirect"));
    assert.equal(report.resolved, server.url("/good/"));
    assert.equal(report.requests[0]?.status, 301);
  });

  test("a zone cache holding no-cache HTML is a suspected edge rule", async () => {
    const report = await check(server.url("/edge/"));
    const finding = find(report, "cdn.edge-rule-suspected");
    assert.equal(finding?.severity, "warn");
    assert.match(finding!.title, /Cloudflare \(edge FRA\)/);
    assert.match(finding!.detail, /40 min/);
    assert.equal(find(report, "cdn.detected")?.severity, "info");
  });

  test("guessed freshness explains an edge hit too", async () => {
    const report = await check(server.url("/edge-heuristic/"));
    assert.equal(find(report, "cdn.edge-rule-suspected"), undefined);
    assert.equal(find(report, "cdn.html-from-edge")?.severity, "info");
    assert.equal(find(report, "html.heuristic-freshness")?.severity, "fail");
  });

  test("a Cloudflare HIT without Age is a Worker's version-keyed cache, not a warning", async () => {
    const report = await check(server.url("/worker/"));
    assert.equal(find(report, "cdn.edge-rule-suspected"), undefined);
    assert.equal(find(report, "cdn.html-from-edge")?.severity, "info");
  });

  test("CloudFront with a long CDN lifetime set through CDN-Cache-Control", async () => {
    const s = severities(await check(server.url("/cloudfront/")));
    assert.equal(s["cdn.html-edge-lifetime"], "warn");
    assert.equal(s["cdn.cdn-cache-control-unread"], "warn");
  });

  test("a per-request ETag can never revalidate", async () => {
    const finding = find(await check(server.url("/dynamic/")), "html.revalidation");
    assert.equal(finding?.severity, "warn");
    assert.match(finding!.detail, /ETag changed/);
  });

  test("HTML max-age over the threshold fails; under it warns, and so does stale-while-revalidate", async () => {
    assert.equal(severities(await check(server.url("/max-age-long/")))["html.max-age"], "fail");
    const short = severities(await check(server.url("/max-age-short/")));
    assert.equal(short["html.max-age"], "warn");
    assert.equal(short["html.stale-while-revalidate"], "warn");
    assert.equal(severities(await check(server.url("/max-age-long/"), { thresholds: { htmlMaxAge: 900 } }))["html.max-age"], "warn");
  });

  test("no-store warns and skips revalidation", async () => {
    const report = await check(server.url("/no-store/"));
    assert.equal(severities(report)["html.no-store"], "warn");
    assert.equal(report.requests.filter((r) => r.conditional).length, 0);
  });

  test("an inline service worker registration is reported", async () => {
    assert.equal(find(await check(server.url("/sw/")), "page.service-worker")?.layer, "service-worker");
  });

  test("falls back to GET when HEAD is rejected", async () => {
    const report = await check(server.url("/head405/"));
    const asset = report.requests.filter((r) => r.url.endsWith("app.9c8b7a.js"));
    assert.deepEqual(asset.map((r) => [r.method, r.status]), [["HEAD", 405], ["GET", 200]]);
    assert.equal(severities(report)["assets.short-cache"], "pass");
  });

  test("baseline: old assets that are gone fail, ones that still load pass", async () => {
    const gone = await check(server.url("/good/"), { baseline: { assets: [server.url("/good/assets/old.111aaa.js"), server.url("/good/assets/app.3f9a1c.js")] } });
    const removed = find(gone, "assets.previous-removed");
    assert.equal(removed?.severity, "fail");
    assert.deepEqual(removed?.evidence, [{ kind: "status", url: server.url("/good/assets/old.111aaa.js"), status: 404 }]);

    const kept = await check(server.url("/good/"), { baseline: { assets: [server.url("/good/assets/kept.222bbb.js")] } });
    assert.equal(find(kept, "assets.previous-kept")?.severity, "pass");
  });

  test("ignored checks are dropped and listed", async () => {
    const report = await check(server.url("/bad/"), { ignore: ["html.heuristic-freshness", "not.a.check"] });
    assert.equal(find(report, "html.heuristic-freshness"), undefined);
    assert.deepEqual(report.ignored, ["html.heuristic-freshness"]);
    assert.equal(report.summary.fail, 1);
  });

  test("every finding links to an article section", async () => {
    const report = await check(server.url("/bad/"));
    for (const f of report.findings) assert.match(f.learnMore, /^https:\/\/ihabkhattab\.com\/blog\/deployed-but-users-see-the-old-version\/#question-\d/);
  });

  test("errors the check can't get past", async () => {
    const code = async (target: string) => {
      try {
        await check(target);
        return "ok";
      } catch (error) {
        assert.ok(error instanceof CheckError);
        return error.code;
      }
    };
    assert.equal(await code(server.url("/json")), "not-html");
    assert.equal(await code(server.url("/blocked")), "blocked");
    assert.equal(await code(server.url("/missing")), "status");
    assert.equal(await code("ftp://example.com"), "invalid-url");
    assert.equal(await code("http://127.0.0.1:1/"), "network");
  });
});
