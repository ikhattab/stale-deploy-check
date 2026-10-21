import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { once } from "node:events";
import { promisify } from "node:util";
import { startServer, type TestServer } from "../../core/test/server.ts";
import { main } from "../src/main.ts";

let server: TestServer;
let dir: string;
before(async () => {
  server = await startServer();
  dir = await mkdtemp(join(tmpdir(), "stale-deploy-check-"));
});
after(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

async function run(...argv: string[]) {
  let stdout = "";
  let stderr = "";
  const code = await main(argv, { stdout: (s) => (stdout += s), stderr: (s) => (stderr += s), color: false, width: 80 });
  return { code, stdout, stderr };
}

describe("exit codes", () => {
  test("0 when nothing fails", async () => assert.equal((await run(server.url("/good/"))).code, 0));
  test("1 when something fails", async () => assert.equal((await run(server.url("/bad/"))).code, 1));
  test("--strict counts warnings", async () => {
    assert.equal((await run(server.url("/no-store/"))).code, 0);
    assert.equal((await run(server.url("/no-store/"), "--strict")).code, 1);
  });
  test("--ignore can bring a failing site to 0", async () => {
    const r = await run(server.url("/bad/"), "--ignore", "html.heuristic-freshness", "--ignore", "assets.unhashed-long-cache");
    assert.equal(r.code, 0);
    assert.match(r.stdout, /Ignored: html\.heuristic-freshness, assets\.unhashed-long-cache/);
  });
  test("2 when the check can't run", async () => {
    const r = await run(server.url("/json"));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /isn't an HTML page/);
  });
  test("2 on bad arguments", async () => {
    assert.equal((await run()).code, 2);
    assert.equal((await run("a", "b")).code, 2);
    assert.equal((await run(server.url("/good/"), "--max-assets", "lots")).code, 2);
    assert.equal((await run(server.url("/good/"), "--nope")).code, 2);
  });
});

describe("output", () => {
  test("text groups by layer, hides passes, links each finding", async () => {
    const { stdout } = await run(server.url("/bad/"));
    // The second warn: the fixture ignores If-Modified-Since, so revalidation gets a full 200.
    assert.match(stdout, /→ {2}2 fail · 2 warn · 2 info/);
    assert.match(stdout, /\nHTTP cache\n {2}✗ Browsers may reuse the HTML for about 3\.1 days without asking/);
    assert.match(stdout, /#question-2-no-cache-header-means-no-caching-right/);
    assert.doesNotMatch(stdout, /✓/);
    assert.match(stdout, /Not checked from here/);
  });

  test("--verbose shows passes and evidence", async () => {
    const { stdout } = await run(server.url("/good/"), "--verbose");
    assert.match(stdout, /✓ Revalidating the HTML returns 304 Not Modified/);
    assert.match(stdout, /304 {2}\/good\/ {2}\(if-none-match: "v1"\)/);
  });

  test("control characters from the site never reach the terminal", async () => {
    const { stdout } = await run(server.url("/escape/"), "--verbose");
    assert.match(stdout, /The page says which build it is: \?\]0;pwned\?\?\[2J v1\?/);
    assert.doesNotMatch(stdout, /[\x1b\x07‮]/);
  });

  test("--json prints the report", async () => {
    const report = JSON.parse((await run(server.url("/good/"), "--json")).stdout);
    assert.equal(report.tool.name, "stale-deploy-check");
    assert.equal(report.resolved, server.url("/good/"));
  });

  test("--out writes a report that works as the next --baseline", async () => {
    const out = join(dir, "report.json");
    assert.equal((await run(server.url("/bad/"), "--out", out)).code, 1);
    const saved = JSON.parse(await readFile(out, "utf8"));
    assert.equal(saved.assets.length, 2);

    // The "next deploy" is the good page, which no longer references /bad/app.js, which still loads.
    const next = await run(server.url("/good/"), "--baseline", out, "--json");
    const kept = JSON.parse(next.stdout).findings.find((f: { check: string }) => f.check === "assets.previous-kept");
    assert.equal(kept.severity, "pass");
  });

  test("a baseline that isn't a report is rejected", async () => {
    const r = await run(server.url("/good/"), "--baseline", join(dir, "missing.json"));
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Couldn't read the baseline report/);
  });
});

test("the bundled bin exits quietly when stdout closes early", async () => {
  const bin = new URL("../dist/stale-deploy-check.js", import.meta.url).pathname;
  const child = spawn(process.execPath, [bin, server.url("/good/"), "--json"], { stdio: ["ignore", "pipe", "pipe"] });
  // Like `| head -0`: the reader goes away before the report is written.
  child.stdout.destroy();
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  const [code] = await once(child, "exit");
  assert.equal(stderr, "");
  assert.equal(code, 0);
});

test("the CLI reports the version in its package.json", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal((await run("--version")).stdout, `${pkg.version}\n`);
});

test("the bundled bin runs on its own", async () => {
  const bin = new URL("../dist/stale-deploy-check.js", import.meta.url).pathname;
  const { stdout } = await promisify(execFile)(process.execPath, [bin, "--version"]);
  assert.match(stdout, /^\d+\.\d+\.\d+\n$/);
});
