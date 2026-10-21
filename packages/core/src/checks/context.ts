import type { ParsedPage } from "../html.ts";
import type { Evidence, RequestRecord } from "../types.ts";

export interface Thresholds {
  /** Seconds a browser may reuse the HTML without asking before that's a fail. */
  htmlMaxAge: number;
  /** Seconds a CDN may keep the HTML before that's a warn. */
  edgeMaxAge: number;
  /** Minimum max-age for a hashed asset. */
  assetMinMaxAge: number;
}

export interface AssetResult {
  url: string;
  record: RequestRecord;
  hashed: boolean;
  versionParam?: string;
}

/** Everything the run fetched. Checks only read this; they never make requests. */
export interface Context {
  document: RequestRecord;
  /** The same GET with If-None-Match / If-Modified-Since, when the HTML had a validator. */
  revalidation?: RequestRecord;
  page: ParsedPage;
  assets: AssetResult[];
  notChecked: { crossOrigin: string[]; overCap: string[]; limit: number };
  /** With --baseline: requests for the previous report's assets that this HTML no longer references. */
  baseline?: { checked: RequestRecord[] };
  thresholds: Thresholds;
}

export function header(record: RequestRecord, name: string): Evidence {
  return { kind: "header", url: record.url, name, value: record.headers[name] ?? null };
}

export function status(record: RequestRecord): Evidence {
  return { kind: "status", url: record.url, status: record.status, ...(record.conditional ? { request: record.conditional } : {}) };
}

export function computed(label: string, value: string): Evidence {
  return { kind: "computed", label, value };
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
