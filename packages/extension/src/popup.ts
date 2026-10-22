// The toolbar popup. Opening it is the click that grants activeTab, which is all the extension asks for: it can
// read this tab and request this tab's origin, nothing else. The tab is read in the extension's isolated world,
// and the requests go from here, so the page's service worker can't answer them.
import { ARTICLE, type Finding, type Severity } from "@stale-deploy-check/core";
import { analyze, ordered, readPage, type TabReport, type TabSnapshot } from "@stale-deploy-check/probe";

const MARKS: Record<Severity, string> = { fail: "✗", warn: "!", info: "·", pass: "✓" };

const byId = (id: string) => document.getElementById(id)!;
let report: TabReport | undefined;

async function run(): Promise<void> {
  report = undefined;
  byId("copy").toggleAttribute("disabled", true);
  byId("findings").replaceChildren();
  byId("status").textContent = "";
  byId("summary").textContent = "Checking this tab…";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined || !tab.url || !/^https?:/.test(tab.url)) {
    byId("summary").textContent = "Only web pages can be checked. Open one, then click the button again.";
    return;
  }
  const url = new URL(tab.url);
  byId("page").textContent = url.host + url.pathname;

  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["collect.js"] });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (globalThis as { staleDeployCheckCollect?: () => Promise<unknown> }).staleDeployCheckCollect!(),
    });
    const snapshot = injection?.result as TabSnapshot | undefined;
    if (!snapshot) throw new Error("the page didn't answer");
    // Cookies go along, so a page behind a login comes back the way this tab sees it.
    report = await analyze(snapshot, { fetch: (input, init) => fetch(input, { ...init, credentials: "include" }), readPage });
  } catch (error) {
    byId("summary").textContent = `Couldn't check this tab: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  render(report);
}

function render(r: TabReport): void {
  const s = r.summary;
  const counts = [s.fail ? `${s.fail} fail` : "", s.warn ? `${s.warn} warn` : ""].filter(Boolean);
  byId("summary").textContent = counts.length ? counts.join(" · ") : "No problems found";
  byId("findings").replaceChildren(...ordered(r.findings).map(item));
  byId("copy").toggleAttribute("disabled", false);
}

/** One finding. Everything from the page goes in as text, never as HTML. */
function item(f: Finding): HTMLLIElement {
  const details = el("details");
  details.open = f.severity === "fail" || f.severity === "warn" || f.check === "tab.build";
  const summary = el("summary");
  summary.append(el("span", MARKS[f.severity], "mark"), el("span", f.title));
  details.append(summary, el("p", f.detail));
  if (f.fix) {
    const fix = el("p", "", "fix");
    fix.append(el("strong", "Fix: "), f.fix);
    details.append(fix);
  }
  if (f.evidence.length) {
    const evidence = el("ul", "", "evidence");
    for (const e of f.evidence) evidence.append(el("li", describe(e)));
    details.append(evidence);
  }
  // Only links to the article: learnMore comes from the probe, but a link is the one thing worth being strict about.
  if (f.learnMore.startsWith(ARTICLE)) {
    const link = el("a", "Why this happens");
    link.href = f.learnMore;
    link.target = "_blank";
    link.rel = "noreferrer";
    details.append(link);
  }
  const li = el("li", "", f.severity);
  li.append(details);
  return li;
}

function describe(e: Finding["evidence"][number]): string {
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

byId("copy").addEventListener("click", async () => {
  if (!report) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    byId("status").textContent = "Copied as JSON";
  } catch {
    byId("status").textContent = "Couldn't copy";
  }
});
byId("again").addEventListener("click", () => void run());

void run();
