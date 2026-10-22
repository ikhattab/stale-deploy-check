// The console snippet: paste the bundle into DevTools on the page to check. It keeps the report on window for copy().
import { probe } from "./browser.ts";
import { printReport } from "./format.ts";

void (async () => {
  try {
    const report = await probe();
    (globalThis as { staleDeployCheck?: unknown }).staleDeployCheck = report;
    printReport(report);
  } catch (error) {
    console.error("stale-deploy-check couldn't run:", error);
  }
})();
