import type { Finding, Severity } from "@stale-deploy-check/core";
import type { TabReport } from "./types.ts";

type Out = Pick<Console, "log" | "group" | "groupCollapsed" | "groupEnd">;

const SEVERITY_ORDER: Severity[] = ["fail", "warn", "info", "pass"];
const MARKS: Record<Severity, string> = { fail: "✗", warn: "!", info: "·", pass: "✓" };
const STYLES: Record<Severity, string> = { fail: "color:#d93025;font-weight:bold", warn: "color:#b06000;font-weight:bold", info: "", pass: "color:#188038" };

/**
 * Prints a report to the DevTools console: problems expanded, the rest collapsed.
 * Text from the page only ever goes in through %s, never in the format string, where a "%c" in a build id would restyle the output.
 */
export function printReport(report: TabReport, out: Out = console): void {
  const s = report.summary;
  const counts = [s.fail ? `${s.fail} fail` : "", s.warn ? `${s.warn} warn` : "", s.info ? `${s.info} info` : ""].filter(Boolean).join(" · ");
  out.log("%cstale-deploy-check%c %s  →  %s", "font-weight:bold", "", report.url, counts || "no problems found");

  for (const f of ordered(report.findings)) {
    const open = f.severity === "fail" || f.severity === "warn" || f.check === "tab.build";
    (open ? out.group : out.groupCollapsed)("%c%s %s", STYLES[f.severity], MARKS[f.severity], f.title);
    out.log("%s", f.detail);
    if (f.fix) out.log("%cFix:%c %s", "font-weight:bold", "", f.fix);
    for (const e of f.evidence) out.log("%c%s", "color:gray", evidence(e));
    out.log("%s", f.learnMore);
    out.groupEnd();
  }
  out.log("%cRun copy(staleDeployCheck) to copy the full report as JSON.", "color:gray");
}

/** The tab.build verdict first, then by severity. */
function ordered(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => Number(b.check === "tab.build") - Number(a.check === "tab.build") || SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

function evidence(e: Finding["evidence"][number]): string {
  switch (e.kind) {
    case "header":
      return `${e.name}: ${e.value ?? "(missing)"}  ${e.url}`;
    case "status":
      return `${e.status}  ${e.url}`;
    case "computed":
      return `${e.label}: ${e.value}`;
    case "file":
      return `${e.path}${e.line ? `:${e.line}` : ""}`;
  }
}
