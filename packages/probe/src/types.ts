import type { BuildId, Finding, RequestRecord, Severity } from "@stale-deploy-check/core";

/** What the browser knows about one tab, read without making any requests. */
export interface TabSnapshot {
  /** The tab's URL, without the fragment. */
  url: string;
  /** When this document started loading (performance.timeOrigin), ISO 8601. */
  loadedAt: string;
  /** From this tab's own <meta>, as it was loaded. */
  buildId?: BuildId;
  /** How the browser got this document's HTML, from Navigation Timing. Missing in browsers without it. */
  navigation?: NavigationSnapshot;
  /** Scripts and stylesheets this tab loaded or references: Resource Timing entries plus the DOM. */
  assets: string[];
  /** "unsupported" outside a secure context, where navigator.serviceWorker doesn't exist. */
  serviceWorker: ServiceWorkerSnapshot | "unsupported";
  /** Copies of this page in Cache Storage, which a service worker can answer navigations from. */
  cachedPages: CachedPage[];
}

export interface NavigationSnapshot {
  /** navigate, reload, back_forward or prerender. */
  type: string;
  /** Bytes over the network, headers included. 0 when the HTTP cache answered. */
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  /** Above 0 when a service worker handled the navigation. */
  workerStart: number;
  /** Chrome's "cache" for an HTTP cache hit; empty otherwise. */
  deliveryType?: string;
}

export interface ServiceWorkerSnapshot {
  /** Script URLs. */
  controller?: string;
  active?: string;
  waiting?: string;
  installing?: string;
  scope?: string;
}

export interface CachedPage {
  cache: string;
  /** The request URL it's stored under. */
  url: string;
  buildId?: BuildId;
}

/** What the probe found for one tab. Same findings as the CLI's Report, with source "browser". */
export interface TabReport {
  tool: { name: "stale-deploy-check"; version: string };
  kind: "tab";
  url: string;
  checkedAt: string;
  tab: TabSnapshot;
  /** The live page and the asset checks. Response headers are only readable for the page's own origin and CORS-enabled ones. */
  requests: RequestRecord[];
  findings: Finding[];
  summary: Record<Severity, number>;
}
