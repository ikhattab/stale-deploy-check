import { buildIdFromMeta, type BuildId } from "@stale-deploy-check/core";
import { analyze, ASSET_PATH, type ProbeEnv } from "./analyze.ts";
import type { CachedPage, NavigationSnapshot, ServiceWorkerSnapshot, TabReport, TabSnapshot } from "./types.ts";

// Requests the page's own code made, including this probe's on an earlier run. They're data, not the build.
const NOT_ASSETS = new Set(["fetch", "xmlhttprequest", "beacon"]);
/** Resource Timing's default buffer size. Pages can raise it, so reaching it is a hint, not proof. */
const RESOURCE_TIMING_BUFFER = 250;

/** Checks the tab this runs in. */
export async function probe(options: { timeoutMs?: number } = {}): Promise<TabReport> {
  // Read the tab before the probe's own requests add to its Resource Timing.
  const tab = await collect();
  const env: ProbeEnv = {
    fetch: (input, init) => fetch(input, init),
    readPage,
    timing,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  };
  return analyze(tab, env);
}

/** Reads this tab's state without making any requests. */
export async function collect(): Promise<TabSnapshot> {
  const url = withoutHash(location.href);
  const buildId = buildIdOf(document);
  const navigation = navigationSnapshot();
  const resourceTimingFull = performance.getEntriesByType("resource").length >= RESOURCE_TIMING_BUFFER;
  return {
    url,
    loadedAt: new Date(performance.timeOrigin).toISOString(),
    ...(buildId ? { buildId } : {}),
    ...(navigation ? { navigation } : {}),
    assets: loadedAssets(),
    ...(resourceTimingFull ? { resourceTimingFull } : {}),
    serviceWorker: await serviceWorkerSnapshot(),
    cachedPages: await cachedPages(url),
  };
}

function navigationSnapshot(): NavigationSnapshot | undefined {
  const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  if (!nav) return undefined;
  const deliveryType = (nav as PerformanceNavigationTiming & { deliveryType?: string }).deliveryType;
  return {
    type: nav.type,
    transferSize: nav.transferSize,
    encodedBodySize: nav.encodedBodySize,
    decodedBodySize: nav.decodedBodySize,
    workerStart: nav.workerStart,
    ...(deliveryType ? { deliveryType } : {}),
  };
}

function loadedAssets(): string[] {
  const urls = new Set<string>();
  for (const entry of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    if (NOT_ASSETS.has(entry.initiatorType)) continue;
    const url = asset(entry.name);
    if (url) urls.add(url);
  }
  // Resource Timing drops entries once its buffer is full (250 by default), so the DOM fills the gaps.
  for (const el of document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src], link[rel~='stylesheet'][href], link[rel~='modulepreload'][href]")) {
    const url = asset("src" in el ? el.src : el.href);
    if (url) urls.add(url);
  }
  return [...urls];
}

function asset(href: string): string | undefined {
  try {
    const url = new URL(href, location.href);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !ASSET_PATH.test(url.pathname)) return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

async function serviceWorkerSnapshot(): Promise<ServiceWorkerSnapshot | "unsupported"> {
  if (!("serviceWorker" in navigator)) return "unsupported";
  const container = navigator.serviceWorker;
  const registration = await container.getRegistration().catch(() => undefined);
  const snapshot: ServiceWorkerSnapshot = {};
  if (container.controller) snapshot.controller = container.controller.scriptURL;
  if (registration?.active) snapshot.active = registration.active.scriptURL;
  if (registration?.waiting) snapshot.waiting = registration.waiting.scriptURL;
  if (registration?.installing) snapshot.installing = registration.installing.scriptURL;
  if (registration) snapshot.scope = registration.scope;
  return snapshot;
}

/** The page itself, and the app shell a single-page app's worker serves for every navigation. */
async function cachedPages(url: string): Promise<CachedPage[]> {
  if (typeof caches === "undefined") return [];
  const keys = [url, new URL("/", url).href, new URL("/index.html", url).href].filter((k, i, all) => all.indexOf(k) === i);
  const found: CachedPage[] = [];
  try {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const key of keys) {
        const response = await cache.match(key, { ignoreSearch: true });
        if (!response || !/text\/html/i.test(response.headers.get("content-type") ?? "text/html")) continue;
        const buildId = buildIdOf(new DOMParser().parseFromString(await response.text(), "text/html"));
        found.push({ cache: name, url: key, ...(buildId ? { buildId } : {}) });
        break;
      }
    }
  } catch {
    // Cache Storage throws in some private modes and sandboxed frames.
  }
  return found;
}

/** Reads a fetched HTML page with DOMParser: its build id and its scripts and stylesheets. */
export function readPage(html: string, url: string): { buildId?: BuildId; assets: string[] } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const buildId = buildIdOf(doc);
  const base = doc.querySelector("base[href]")?.getAttribute("href");
  const baseUrl = base ? new URL(base, url).href : url;
  const assets = new Set<string>();
  for (const el of doc.querySelectorAll("script[src], link[href]")) {
    const rel = (el.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    const as = (el.getAttribute("as") ?? "").toLowerCase();
    const isAsset = el.tagName === "SCRIPT" || rel.includes("stylesheet") || rel.includes("modulepreload") || (rel.includes("preload") && (as === "script" || as === "style"));
    const href = el.getAttribute("src") ?? el.getAttribute("href");
    if (!isAsset || !href) continue;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
      resolved.hash = "";
      assets.add(resolved.href);
    } catch {
      // Not a URL.
    }
  }
  return { ...(buildId ? { buildId } : {}), assets: [...assets] };
}

function buildIdOf(doc: Document): BuildId | undefined {
  for (const meta of doc.querySelectorAll("meta[name][content]")) {
    const buildId = buildIdFromMeta(meta.getAttribute("name"), meta.getAttribute("content"));
    if (buildId) return buildId;
  }
  return undefined;
}

function timing(url: string): { workerStart: number; transferSize: number; deliveryType?: string } | undefined {
  const entries = performance.getEntriesByName(url, "resource") as (PerformanceResourceTiming & { deliveryType?: string })[];
  const last = entries[entries.length - 1];
  if (!last) return undefined;
  return { workerStart: last.workerStart, transferSize: last.transferSize, ...(last.deliveryType !== undefined ? { deliveryType: last.deliveryType } : {}) };
}

function withoutHash(href: string): string {
  const url = new URL(href);
  url.hash = "";
  return url.href;
}
