import { clean, fixPrompt, shellQuote } from "@stale-deploy-check/core";
import type { TabReport } from "./types.ts";

/**
 * A prompt for a coding agent to fix what the probe found in this tab, ending with the CLI command that checks
 * the headers once the fix is deployed. Undefined when there's nothing to fix. The extension and the snippet share it.
 */
export function tabPrompt(report: TabReport): string | undefined {
  const minor = report.tool.version.split(".").slice(0, 2).join(".");
  return fixPrompt({
    from: "browser",
    site: report.url,
    version: report.tool.version,
    findings: report.findings,
    rerun: `npx stale-deploy-check@${minor} ${shellQuote(clean(report.url))}`,
  });
}
