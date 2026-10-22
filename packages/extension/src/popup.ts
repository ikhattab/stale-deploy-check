// The toolbar popup. Opening it is the click that grants activeTab, which is all the extension asks for: it can
// read this tab and request this tab's origin, nothing else. The tab is read in the extension's isolated world,
// and the requests go from here, so the page's service worker can't answer them.
import { ARTICLE, clean, fixPrompt, shellQuote, type Finding, type Severity } from "@stale-deploy-check/core";
import { analyze, ordered, readPage, type TabReport, type TabSnapshot } from "@stale-deploy-check/probe";

const MARKS: Record<Severity, string> = { fail: "✗", warn: "!", info: "·", pass: "✓" };

const byId = (id: string) => document.getElementById(id)!;
let report: TabReport | undefined;
let prompt: string | undefined;

async function run(): Promise<void> {
  report = undefined;
  prompt = undefined;
  byId("prompt").hidden = true;
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
  // The same prompt as the CLI's --prompt, written for findings from a tab. Only when there's something to fix.
  const minor = r.tool.version.split(".").slice(0, 2).join(".");
  prompt = fixPrompt({ from: "browser", site: r.url, version: r.tool.version, findings: r.findings, rerun: `npx stale-deploy-check@${minor} ${shellQuote(clean(r.url))}` });
  byId("prompt").hidden = !prompt;
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

async function copy(text: string | undefined, done: string): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    byId("status").textContent = done;
  } catch {
    byId("status").textContent = "Couldn't copy";
  }
}

byId("prompt").addEventListener("click", () => void copy(prompt, "Copied. Paste it into your coding agent, in the site's repo."));
byId("copy").addEventListener("click", () => void copy(report && JSON.stringify(report, null, 2), "Copied as JSON"));
byId("again").addEventListener("click", () => void run());

void run();
