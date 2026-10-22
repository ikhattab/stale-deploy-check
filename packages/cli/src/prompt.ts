import { fixPrompt, type Report } from "@stale-deploy-check/core";

export { shellQuote } from "@stale-deploy-check/core";

/**
 * A prompt to paste into a coding agent, asking it to fix the fails and warns in this repo.
 * Returns undefined when there's nothing to fix. `rerun` is the command that checks the fix.
 */
export function buildPrompt(report: Report, options: { rerun: string }): string | undefined {
  return fixPrompt({ from: "headers", site: report.resolved, version: report.tool.version, findings: report.findings, rerun: options.rerun });
}
