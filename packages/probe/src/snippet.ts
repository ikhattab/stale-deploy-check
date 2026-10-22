// The console snippet: paste the bundle into DevTools on the page to check. It keeps the report on window for
// copy(), and a prompt for a coding agent when there's something to fix.
import { probe } from "./browser.ts";
import { printReport } from "./format.ts";
import { tabPrompt } from "./prompt.ts";

void (async () => {
  try {
    const report = await probe();
    const prompt = tabPrompt(report);
    const global = globalThis as { staleDeployCheck?: unknown; staleDeployCheckPrompt?: string };
    global.staleDeployCheck = report;
    if (prompt) global.staleDeployCheckPrompt = prompt;
    else delete global.staleDeployCheckPrompt;
    printReport(report, console, prompt ? { promptVariable: "staleDeployCheckPrompt" } : {});
  } catch (error) {
    console.error("stale-deploy-check couldn't run:", error);
  }
})();
