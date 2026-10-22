import {
  learn,
  mapLimit,
  ownedBy,
  plural,
  servesHtml,
  summarize,
  VERSION,
  type BuildId,
  type Evidence,
  type FetchLike,
  type Finding,
  type Layer,
  type RequestRecord,
  type Severity,
} from "@stale-deploy-check/core";
import type { NavigationSnapshot, TabReport, TabSnapshot } from "./types.ts";

export interface ProbeEnv {
  fetch: FetchLike;
  /** Reads a fetched HTML page. DOMParser in the browser; core's parsePage in tests. */
  readPage(html: string, url: string): { buildId?: BuildId; assets: string[] };
  /** Resource Timing for a URL the probe requested, to tell whether the tab's service worker answered it from its cache. */
  timing?(url: string): { workerStart: number; transferSize: number } | undefined;
  timeoutMs?: number;
}

/** How many files this tab loaded, and the live page doesn't reference, to request. */
const MAX_ASSET_REQUESTS = 50;
const CONCURRENCY = 6;
/** What counts as a script or stylesheet in a tab's Resource Timing, where only the URL says what a file is. */
export const ASSET_PATH = /\.(?:[cm]?js|css)$/;
/** A Last-Modified this close to the response's Date is the server's clock, not a deploy time. */
const DYNAMIC_LAST_MODIFIED_MS = 5_000;

type HtmlSource = "service-worker" | "http-cache" | "revalidated" | "network" | "unknown";

interface Live {
  record: RequestRecord;
  buildId?: BuildId;
  assets: string[];
  /** The tab's service worker answered the request from its cache, so this isn't what the server has. */
  fromWorker: boolean;
}

interface Asset {
  url: string;
  record?: RequestRecord;
  /** Why it couldn't be requested: blocked by CORS, a network error, a timeout. */
  error?: string;
}

/** Fetches the live page and the files this tab loaded, and compares them with the tab. */
export async function analyze(tab: TabSnapshot, env: ProbeEnv): Promise<TabReport> {
  const requests: RequestRecord[] = [];
  const request = (url: string, method: "GET" | "HEAD", readBody = false) => send(env, requests, url, method, readBody);

  let live: Live | { error: string };
  try {
    const { record, body = "" } = await request(tab.url, "GET", true);
    if (record.status >= 400 || !/text\/html|application\/xhtml\+xml/i.test(record.headers["content-type"] ?? "")) {
      live = { error: `${record.url} returned ${record.status} ${record.headers["content-type"] ?? ""}`.trim() };
    } else {
      const timing = env.timing?.(tab.url);
      live = { record, ...env.readPage(body, record.url), fromWorker: !!timing && timing.workerStart > 0 && timing.transferSize === 0 };
    }
  } catch (error) {
    live = { error: describe(error) };
  }

  const isOwn = ownedBy(tab.url, []);
  const own = tab.assets.filter(isOwn);
  const liveAssets = new Set("record" in live ? live.assets : []);
  // Files the live page still references load by definition; the ones it dropped are the question.
  const changed = own.filter((a) => !liveAssets.has(a));
  const assets = await mapLimit(changed.slice(0, MAX_ASSET_REQUESTS), CONCURRENCY, async (url): Promise<Asset> => {
    try {
      let { record } = await request(url, "HEAD");
      if (record.status === 405 || record.status === 501) ({ record } = await request(url, "GET"));
      return { url, record };
    } catch (error) {
      return { url, error: describe(error) };
    }
  });

  const source = htmlSource(tab.navigation);
  const findings = [
    buildCheck(tab, live, source),
    ...sourceCheck(tab.navigation, source),
    ...serviceWorkerChecks(tab, "record" in live ? live : undefined),
    ...assetChecks(tab, own, changed, assets),
  ];

  return {
    tool: { name: "stale-deploy-check", version: VERSION },
    kind: "tab",
    url: tab.url,
    checkedAt: new Date().toISOString(),
    tab,
    requests,
    findings,
    summary: summarize(findings),
  };
}

/** Where this tab's HTML came from, as far as Navigation Timing says. */
export function htmlSource(nav: NavigationSnapshot | undefined): HtmlSource {
  if (!nav) return "unknown";
  if (nav.workerStart > 0) return "service-worker";
  if (nav.transferSize === 0 && (nav.decodedBodySize > 0 || nav.deliveryType === "cache")) return "http-cache";
  // Chrome says "cache" after a 304 too, when only headers went over the network.
  if (nav.transferSize > 0 && nav.deliveryType === "cache") return "revalidated";
  // Elsewhere, a 304 transfers headers only while the body size is the cached copy's. A page smaller than its headers looks like a 200.
  if (nav.transferSize > 0 && nav.transferSize < nav.encodedBodySize) return "revalidated";
  return "network";
}

function buildCheck(tab: TabSnapshot, live: Live | { error: string }, source: HtmlSource): Finding {
  const base = { check: "tab.build", source: "browser", learnMore: learn.proveIt } as const;
  if (!("record" in live)) {
    return {
      ...base,
      layer: "diagnostics",
      severity: "info",
      title: "Couldn't load the live page to compare this tab with",
      detail: `The probe requested this page again, bypassing the browser cache, and it failed: ${live.error}.`,
      evidence: [computed("error", live.error)],
    };
  }
  if (live.fromWorker) {
    return {
      ...base,
      layer: "service-worker",
      severity: "info",
      title: "The service worker answered the probe's request for the live page",
      detail:
        "The request never reached the network, so the probe can't tell what the server sends now. " +
        "Run npx stale-deploy-check on this URL to see the server's copy, or open the page in a private window, where no service worker is installed.",
      evidence: [computed("live page", "served by the service worker's cache")],
      learnMore: learn.serviceWorker,
    };
  }

  const compared = compare(tab, live);
  if (!compared) {
    return {
      ...base,
      layer: "diagnostics",
      severity: "info",
      title: "Couldn't tell which build this tab is on",
      detail: "Neither this tab nor the live page has a build id, and the live page references no scripts or stylesheets on this site to compare by name.",
      evidence: [computed("meta build/version", "not found")],
      fix: 'Add <meta name="build" content="..."> with the build id or commit, and show it somewhere a user can read it.',
    };
  }

  const { tabLabel, liveLabel, evidence } = compared;
  if (compared.same) {
    return {
      ...base,
      layer: "diagnostics",
      severity: "pass",
      title: tab.buildId ? `This tab is on the live build: ${tab.buildId.content}` : "This tab loaded the same files the live page references",
      detail: "The probe requested this page again, bypassing the browser cache, and it matches what this tab loaded.",
      evidence,
    };
  }

  const deployedAt = deployTime(live.record);
  const loadedAt = new Date(tab.loadedAt);
  const after = deployedAt ? loadedAt > deployedAt : undefined;
  const timeline = deployedAt
    ? ` This tab loaded at ${loadedAt.toISOString()}, and the live page's Last-Modified, usually the deploy time, is ${deployedAt.toISOString()}.`
    : "";
  if (deployedAt) evidence.push({ kind: "header", url: live.record.url, name: "last-modified", value: live.record.headers["last-modified"] ?? null });
  evidence.push(computed("this tab's HTML came from", sourceLabel(source)));
  const backForward =
    tab.navigation?.type === "back_forward" ? " This tab was opened with back or forward, where browsers may show a cached page even when its headers say to ask first." : "";

  if (after === false || ((source === "network" || source === "revalidated") && after === undefined)) {
    return {
      ...base,
      layer: "open-tab",
      severity: "info",
      title: after === false ? `This tab was opened before ${liveLabel} was deployed, and is still on ${tabLabel}` : `This tab is on ${tabLabel}; the server now sends ${liveLabel}`,
      detail:
        (after === false ? "" : "Its HTML came from the server, so it was most likely opened before the deploy. ") +
        "That's expected: an open tab keeps running the code it loaded until it reloads. What matters is whether it still works, which the files check below answers, and whether the app tells people to reload." +
        timeline,
      evidence,
      learnMore: learn.openTab,
    };
  }

  const cause: Record<HtmlSource, { layer: Layer; from: string; detail: string; fix: string; learnMore: string }> = {
    "service-worker": {
      layer: "service-worker",
      from: " from the service worker",
      detail:
        "A service worker handled this tab's navigation, so the HTML came from the worker and your Cache-Control headers didn't apply. " +
        "A worker that answers navigations from its cache keeps serving the version it cached until a new worker installs and takes over.",
      fix: "Serve navigations network-first in the service worker, and show an update prompt when a new worker is waiting.",
      learnMore: learn.serviceWorker,
    },
    "http-cache": {
      layer: "http-cache",
      from: " from the browser cache",
      detail: "The HTML came from the browser's HTTP cache without a request to the server (0 bytes transferred). The HTML's cache headers let the browser reuse it without asking." + backForward,
      fix: "Send Cache-Control: no-cache on HTML, with an ETag, so browsers keep a copy but ask before every use.",
      learnMore: learn.headers,
    },
    revalidated: {
      layer: "cdn",
      from: "",
      detail:
        "The browser asked, and the server or a CDN in front of it answered 304 Not Modified for the old copy after the deploy: an edge cache that hadn't been purged yet, or a deploy that wasn't live everywhere. " +
        "Other edges can hold different copies than the one that answered the probe.",
      fix: "Purge the HTML from the CDN as part of the deploy, or give it a short edge lifetime.",
      learnMore: learn.cdn,
    },
    network: {
      layer: "cdn",
      from: "",
      detail:
        "The HTML came over the network, so the server or a CDN in front of it sent the old version after the deploy: an edge cache that hadn't been purged yet, or a deploy that wasn't live everywhere. " +
        "Other edges can hold different copies than the one that answered the probe.",
      fix: "Purge the HTML from the CDN as part of the deploy, or give it a short edge lifetime.",
      learnMore: learn.cdn,
    },
    unknown: {
      layer: "diagnostics",
      from: "",
      detail: "This browser doesn't say where the HTML came from (no Navigation Timing).",
      fix: "Open the Network panel in DevTools, reload, and look at the Size column of the document request.",
      learnMore: learn.proveIt,
    },
  };
  const c = cause[source];
  const severity: Severity = after ? "fail" : "warn";
  return {
    ...base,
    layer: c.layer,
    severity,
    title: after ? `This tab loaded ${tabLabel}${c.from} after ${liveLabel} was deployed` : `This tab is on ${tabLabel}${c.from}; the server now sends ${liveLabel}`,
    detail: (after ? "" : "If this tab loaded after the deploy, it got an old copy. ") + c.detail + timeline,
    evidence,
    fix: c.fix,
    learnMore: c.learnMore,
  };
}

/** The tab against the live page: by build id when both have one, else by whether this tab loaded the live page's files. */
function compare(tab: TabSnapshot, live: Live): { same: boolean; tabLabel: string; liveLabel: string; evidence: Evidence[] } | undefined {
  if (tab.buildId && live.buildId) {
    return {
      same: tab.buildId.content === live.buildId.content,
      tabLabel: `build ${tab.buildId.content}`,
      liveLabel: `build ${live.buildId.content}`,
      evidence: [computed(`this tab's meta ${tab.buildId.name}`, tab.buildId.content), computed(`live page's meta ${live.buildId.name}`, live.buildId.content)],
    };
  }
  const isOwn = ownedBy(live.record.url, []);
  const liveOwn = live.assets.filter((a) => isOwn(a) && ASSET_PATH.test(new URL(a).pathname));
  if (liveOwn.length === 0) return undefined;
  const loaded = new Set(tab.assets);
  const missing = liveOwn.filter((a) => !loaded.has(a));
  return {
    same: missing.length === 0,
    tabLabel: "the old version",
    liveLabel: "a new one",
    evidence: [
      computed("compared by", "file names: no build id in both"),
      ...missing.slice(0, 5).map((a) => computed("live page references, this tab didn't load", a)),
    ],
  };
}

function deployTime(record: RequestRecord): Date | undefined {
  const lastModified = Date.parse(record.headers["last-modified"] ?? "");
  if (Number.isNaN(lastModified)) return undefined;
  const date = Date.parse(record.headers["date"] ?? "");
  if (!Number.isNaN(date) && Math.abs(date - lastModified) < DYNAMIC_LAST_MODIFIED_MS) return undefined;
  return new Date(lastModified);
}

function sourceLabel(source: HtmlSource): string {
  return {
    "service-worker": "the service worker",
    "http-cache": "the browser cache, without asking the server",
    revalidated: "the browser cache, after the server said it was current (304)",
    network: "the network",
    unknown: "unknown",
  }[source];
}

function sourceCheck(nav: NavigationSnapshot | undefined, source: HtmlSource): Finding[] {
  if (!nav || source === "unknown") return [];
  return [
    {
      check: "tab.html-source",
      layer: "diagnostics",
      severity: "info",
      source: "browser",
      title: `This tab's HTML came from ${sourceLabel(source)}`,
      detail:
        "From Navigation Timing, the same thing the Network panel's Size column shows for the document request." +
        (nav.type === "back_forward" ? " The tab was opened with back or forward, so the browser may also have restored it from the back/forward cache." : ""),
      evidence: [
        computed("navigation type", nav.type),
        computed("transferSize", String(nav.transferSize)),
        computed("encodedBodySize", String(nav.encodedBodySize)),
        computed("workerStart", String(nav.workerStart)),
        ...(nav.deliveryType ? [computed("deliveryType", nav.deliveryType)] : []),
      ],
      learnMore: learn.proveIt,
    },
  ];
}

function serviceWorkerChecks(tab: TabSnapshot, live: Live | undefined): Finding[] {
  const sw = tab.serviceWorker;
  if (sw === "unsupported") return [];
  const base = { layer: "service-worker", source: "browser", learnMore: learn.serviceWorker } as const;
  const findings: Finding[] = [];

  if (sw.waiting) {
    findings.push({
      ...base,
      check: "tab.sw-waiting",
      severity: "warn",
      title: "A new service worker is installed and waiting",
      detail:
        "It takes over only after every tab the current worker controls is closed; reloading one tab isn't enough while another is open. " +
        "Until then this tab, and new ones, get responses from the old worker.",
      evidence: [computed("active", sw.active ?? "none"), computed("waiting", sw.waiting)],
      fix: "When registration.waiting is set, show an update prompt. On click, message the waiting worker to call skipWaiting(), and reload once on controllerchange.",
    });
  }

  if (sw.controller) {
    findings.push({
      ...base,
      check: "tab.sw-controlled",
      severity: "info",
      title: "A service worker controls this tab",
      detail: "Requests from this page, including the probe's own, go through it first, and it can answer them from its cache before any HTTP header applies.",
      evidence: [computed("controller", sw.controller), ...(sw.scope ? [computed("scope", sw.scope)] : [])],
    });
  } else if (!sw.active && !sw.waiting && !sw.installing) {
    findings.push({
      ...base,
      check: "tab.sw-controlled",
      severity: "pass",
      title: "No service worker controls this tab",
      detail: "Nothing sits between this page and the HTTP cache.",
      evidence: [],
    });
  }

  for (const cached of tab.cachedPages) {
    const differs = cached.buildId && live?.buildId && cached.buildId.content !== live.buildId.content;
    findings.push({
      ...base,
      check: "tab.sw-cached-page",
      severity: differs ? "warn" : "info",
      title: differs
        ? `Cache Storage holds build ${cached.buildId!.content} of this page; the server sends build ${live!.buildId!.content}`
        : `Cache Storage holds a copy of this page${cached.buildId ? ` (build ${cached.buildId.content})` : ""}`,
      detail:
        "A service worker can answer navigations from this copy. If it does that before asking the network, people get this version until a new worker replaces the cache. " +
        "If it only falls back to it offline, this is fine.",
      evidence: [computed("cache", cached.cache), computed("stored as", cached.url), ...(cached.buildId ? [computed(`meta ${cached.buildId.name}`, cached.buildId.content)] : [])],
      ...(differs ? { fix: "Serve navigations network-first, and update the cached page when a new worker installs." } : {}),
    });
  }
  return findings;
}

function assetChecks(tab: TabSnapshot, own: string[], changed: string[], assets: Asset[]): Finding[] {
  const base = { layer: "open-tab", source: "browser", learnMore: learn.openTab } as const;
  const findings: Finding[] = [];
  const answered = assets.flatMap((a) => (a.record ? [a.record] : []));
  const gone = answered.filter((r) => r.status >= 400 || servesHtml(r));
  const controlled = tab.serviceWorker !== "unsupported" && !!tab.serviceWorker.controller;

  if (gone.length > 0) {
    findings.push({
      ...base,
      check: "tab.assets-removed",
      severity: "fail",
      title: `${plural(gone.length, "file")} this tab loaded no longer ${gone.length === 1 ? "loads" : "load"}`,
      detail:
        "This tab still runs the code that loaded them, and that code loads the rest of its build the same way: a route or lazy component it hasn't opened yet. " +
        "Those files were most likely removed along with these, so the next one it asks for fails, and an unhandled failed import() usually means a blank screen." +
        (gone.some(servesHtml) ? " An HTML page came back where a script or stylesheet should be: a fallback rule that serves index.html for missing files." : ""),
      evidence: gone.map((r): Evidence => ({ kind: "status", url: r.url, status: r.status })),
      fix: "Keep old assets for a few days after a deploy instead of deleting them, and reload once when a dynamic import fails.",
    });
  } else if (answered.length > 0 || (own.length > 0 && changed.length === 0)) {
    findings.push({
      ...base,
      check: "tab.assets-kept",
      severity: "pass",
      title:
        answered.length > 0
          ? `${answered.length === 1 ? "The file" : `The ${answered.length} files`} this tab loaded that the live page doesn't reference still ${answered.length === 1 ? "loads" : "load"}`
          : "The live page references every file this tab loaded",
      detail:
        answered.length > 0
          ? "So the rest of this tab's build is most likely still there too, and it keeps working until it reloads." +
            (controlled ? " The service worker may have answered these from its cache, though, so the server may not have them." : "")
          : "No file names changed since this tab loaded, so there was nothing to check.",
      evidence: answered.map((r): Evidence => ({ kind: "status", url: r.url, status: r.status })),
    });
  }

  const failed = assets.filter((a) => a.error);
  const otherOrigins = tab.assets.length - own.length;
  const overCap = changed.length - assets.length;
  if (failed.length + otherOrigins + overCap > 0) {
    const parts = [
      failed.length ? `${plural(failed.length, "request")} failed, usually because the server doesn't allow reading the response from this page (CORS)` : "",
      otherOrigins ? `${plural(otherOrigins, "file")} on other origins weren't requested` : "",
      overCap ? `${plural(overCap, "file")} past the first ${MAX_ASSET_REQUESTS} weren't requested` : "",
    ].filter(Boolean);
    findings.push({
      ...base,
      check: "tab.assets-not-checked",
      severity: "info",
      title: `${plural(failed.length + otherOrigins + overCap, "file")} this tab loaded weren't checked`,
      detail: `${parts.join("; ")}.`,
      evidence: failed.slice(0, 5).map((a) => computed(a.url, a.error!)),
    });
  }
  return findings;
}

async function send(env: ProbeEnv, requests: RequestRecord[], url: string, method: "GET" | "HEAD", readBody: boolean): Promise<{ record: RequestRecord; body?: string }> {
  const started = Date.now();
  // no-store skips the HTTP cache both ways: what the server has now, without replacing what the tab has cached.
  const response = await env.fetch(url, {
    method,
    cache: "no-store",
    ...(readBody ? { headers: { accept: "text/html,application/xhtml+xml" } } : {}),
    signal: AbortSignal.timeout(env.timeoutMs ?? 10_000),
  });
  const body = readBody ? await response.text() : undefined;
  if (body === undefined) await response.body?.cancel();
  const headers: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headers[name] = name === "set-cookie" ? "[redacted]" : value;
  });
  const record: RequestRecord = { method, url: response.url || url, status: response.status, headers, ms: Date.now() - started };
  requests.push(record);
  return { record, ...(body !== undefined ? { body } : {}) };
}

function computed(label: string, value: string): Evidence {
  return { kind: "computed", label, value };
}

function describe(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") return "timed out";
  return error instanceof Error ? error.message : String(error);
}
