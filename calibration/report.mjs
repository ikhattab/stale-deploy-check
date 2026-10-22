// Turns run.mjs results into something to review.
//
//   node calibration/report.mjs results/local.json                       # every fail and warn, grouped by check
//   node calibration/report.mjs results/npm-0.3.1.json results/local.json  # what changed between two runs
import { readFile } from "node:fs/promises";

const [first, second] = process.argv.slice(2);
if (!first) {
  console.error("Usage: node calibration/report.mjs <results.json> [<newer-results.json>]");
  process.exit(2);
}
const load = async (path) => JSON.parse(await readFile(path, "utf8"));
console.log(second ? diff(await load(first), await load(second)) : review(await load(first)));

function review(results) {
  const byCheck = new Map();
  for (const site of results.sites) {
    for (const f of site.findings ?? []) {
      if (f.severity !== "fail" && f.severity !== "warn") continue;
      const key = `${f.severity} ${f.check}`;
      if (!byCheck.has(key)) byCheck.set(key, []);
      byCheck.get(key).push(`${site.url}  ${f.title}`);
    }
  }
  const errors = results.sites.filter((s) => s.error);
  const lines = [`# stale-deploy-check ${results.version}: ${results.sites.length} sites, ${results.checkedAt}`, ""];
  const order = (key) => (key.startsWith("fail") ? 0 : 1);
  for (const [key, entries] of [...byCheck].sort((a, b) => order(a[0]) - order(b[0]) || b[1].length - a[1].length)) {
    lines.push(`## ${key} (${entries.length})`, "", ...entries.map((e) => `- ${e}`), "");
  }
  if (errors.length > 0) lines.push(`## couldn't run (${errors.length})`, "", ...errors.map((s) => `- ${s.url}  ${s.error}`), "");
  return lines.join("\n");
}

function diff(before, after) {
  const key = (f) => `${f.severity} ${f.check}`;
  const old = new Map(before.sites.map((s) => [s.url, s]));
  const lines = [`# ${before.version} → ${after.version}`, ""];
  for (const site of after.sites) {
    const prev = old.get(site.url);
    if (!prev) {
      lines.push(`- ${site.url}: new site`);
      continue;
    }
    const was = new Set((prev.findings ?? []).map(key));
    const now = new Set((site.findings ?? []).map(key));
    const added = [...now].filter((k) => !was.has(k));
    const removed = [...was].filter((k) => !now.has(k));
    const exit = prev.exit !== site.exit ? [`exit ${prev.exit} → ${site.exit}`] : [];
    const changes = [...exit, ...added.map((k) => `+ ${k}`), ...removed.map((k) => `- ${k}`)];
    if (changes.length > 0) lines.push(`- ${site.url}: ${changes.join(", ")}`);
  }
  if (lines.length === 2) lines.push("No changes.");
  return lines.join("\n");
}
