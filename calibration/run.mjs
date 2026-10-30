// Runs one version of the CLI against every site in sites.json and saves the findings.
//
//   node calibration/run.mjs                      # the working tree's build (npm run build first)
//   node calibration/run.mjs --cli npm:0.3.1      # a published version, through npx
//   node calibration/run.mjs --only vite.dev      # some sites only (matched against the URL)
//
// Results go to calibration/results/<label>.json, and each site's full report to
// calibration/reports/<label>/ for looking up evidence (gitignored).
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    cli: { type: "string", default: "packages/cli/dist/stale-deploy-check.js" },
    label: { type: "string" },
    only: { type: "string", multiple: true, default: [] },
    concurrency: { type: "string", default: "4" },
  },
});

const published = values.cli.startsWith("npm:") ? values.cli.slice(4) : undefined;
const command = published ? ["npx", "-y", `stale-deploy-check@${published}`] : [process.execPath, values.cli];
const label = values.label ?? (published ? `npm-${published}` : "local");
// Inside this repo, npx would run the workspace's own stale-deploy-check instead of downloading the published one.
const cwd = published ? tmpdir() : process.cwd();
const dir = new URL("./", import.meta.url);

const all = JSON.parse(await readFile(new URL("sites.json", dir), "utf8"));
const sites = values.only.length > 0 ? all.filter((s) => values.only.some((o) => s.url.includes(o))) : all;

await mkdir(new URL(`reports/${label}/`, dir), { recursive: true });
await mkdir(new URL("results/", dir), { recursive: true });

const version = (await run([...command, "--version"], 120_000)).stdout.trim();
console.error(`stale-deploy-check ${version} against ${sites.length} sites, ${values.concurrency} at a time`);

const results = new Array(sites.length);
let next = 0;
await Promise.all(
  Array.from({ length: Number(values.concurrency) }, async () => {
    while (next < sites.length) {
      const i = next++;
      results[i] = await checkSite(sites[i]);
      const r = results[i];
      console.error(`${String(i + 1).padStart(2)}/${sites.length}  exit ${r.exit}  ${r.url}${r.error ? `  (${r.error})` : ""}`);
    }
  }),
);

const out = new URL(`results/${label}.json`, dir);
await writeFile(out, `${JSON.stringify({ version, checkedAt: new Date().toISOString(), sites: results }, null, 2)}\n`);
console.error(`wrote ${out.pathname}`);

async function checkSite(site) {
  const { code, stdout, stderr } = await run([...command, site.url, "--json", ...(site.args ?? [])], 90_000);
  const base = { url: site.url, why: site.why, ...(site.expect ? { expect: site.expect } : {}), exit: code };
  if (code !== 0 && code !== 1) return { ...base, error: stderr.trim().split("\n").pop() || `exit ${code}` };

  const report = JSON.parse(stdout);
  await writeFile(new URL(`reports/${label}/${new URL(site.url).host}.json`, dir), stdout);
  const cdn = report.findings.find((f) => f.check === "cdn.detected")?.evidence[0]?.value;
  return {
    ...base,
    resolved: report.resolved,
    ...(cdn ? { cdn } : {}),
    assets: report.assets.length,
    summary: report.summary,
    findings: report.findings.filter((f) => f.severity !== "pass").map((f) => ({ check: f.check, severity: f.severity, title: f.title })),
  };
}

function run(argv, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code, signal) => resolve({ code: code ?? (signal ? `killed (${signal})` : -1), stdout, stderr }));
  });
}
