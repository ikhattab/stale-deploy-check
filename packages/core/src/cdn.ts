import { parseCacheControl, seconds } from "./cache-control.ts";
import type { RequestRecord } from "./types.ts";

export type CdnName = "Cloudflare" | "Vercel" | "Netlify" | "CloudFront" | "Fastly" | "Bunny";

export interface Cdn {
  name: CdnName;
  /** Which edge answered, when the CDN says. */
  edge?: string;
}

/** CDNs that don't document reading CDN-Cache-Control; they read s-maxage instead. */
export const IGNORES_CDN_CACHE_CONTROL: ReadonlySet<CdnName> = new Set(["CloudFront", "Fastly"]);

export function detectCdn(record: RequestRecord): Cdn | undefined {
  const h = record.headers;
  const server = (h["server"] ?? "").toLowerCase();
  const withEdge = (name: CdnName, edge: string | undefined): Cdn => (edge ? { name, edge } : { name });

  if (h["cf-ray"] || server === "cloudflare") return withEdge("Cloudflare", h["cf-ray"]?.split("-").pop());
  if (h["x-vercel-id"] || server === "vercel") return withEdge("Vercel", h["x-vercel-id"]?.split("::")[0]);
  if (h["x-nf-request-id"] || server === "netlify") return withEdge("Netlify", undefined);
  if (h["x-amz-cf-id"] || /cloudfront/i.test(h["via"] ?? "")) return withEdge("CloudFront", h["x-amz-cf-pop"]);
  if (h["x-fastly-request-id"] || /^cache-/.test(h["x-served-by"] ?? "")) return withEdge("Fastly", h["x-served-by"]?.split(",").pop()?.trim());
  if (server.startsWith("bunnycdn")) return withEdge("Bunny", h["cdn-requestcountrycode"]);
  return undefined;
}

export interface EdgeCacheState {
  /** The response came out of a shared cache rather than from the origin. */
  hit: boolean;
  /** Seconds the response had been in a shared cache, from Age. */
  age?: number;
  /** The header that told us, for evidence. */
  evidence: { name: string; value: string }[];
}

const STATUS_HEADERS = ["cf-cache-status", "x-vercel-cache", "x-cache", "cache-status", "cdn-cache"] as const;

export function edgeCacheState(record: RequestRecord): EdgeCacheState {
  const evidence: EdgeCacheState["evidence"] = [];
  let hit = false;

  const ageHeader = record.headers["age"];
  const age = ageHeader !== undefined && /^\d+$/.test(ageHeader.trim()) ? Number(ageHeader.trim()) : undefined;
  if (age !== undefined) {
    evidence.push({ name: "age", value: ageHeader! });
    if (age > 0) hit = true;
  }

  for (const name of STATUS_HEADERS) {
    const value = record.headers[name];
    if (value === undefined) continue;
    evidence.push({ name, value });
    if (statusIsHit(name, value)) hit = true;
  }
  return { hit, ...(age !== undefined ? { age } : {}), evidence };
}

function statusIsHit(name: (typeof STATUS_HEADERS)[number], value: string): boolean {
  const v = value.trim().toUpperCase();
  switch (name) {
    case "cf-cache-status":
      return ["HIT", "STALE", "UPDATING"].includes(v);
    case "x-vercel-cache":
      return ["HIT", "STALE"].includes(v);
    case "cache-status":
      // RFC 9211: `"Netlify Edge"; hit`. Any cache in the chain with a hit counts.
      return /;\s*hit\b/i.test(value);
    default:
      // x-cache is "HIT", "Hit from cloudfront", or Fastly's "MISS, HIT" for a chain of caches.
      return /\bHIT\b/.test(v);
  }
}

export interface SharedLifetime {
  header: string;
  value: string;
  seconds: number;
}

/** How long the response tells CDNs to keep it, from the most specific header present. */
export function sharedLifetime(record: RequestRecord): SharedLifetime | undefined {
  for (const header of ["cloudflare-cdn-cache-control", "vercel-cdn-cache-control", "cdn-cache-control"]) {
    const value = record.headers[header];
    if (value === undefined) continue;
    const s = seconds(parseCacheControl(value), "max-age") ?? seconds(parseCacheControl(value), "s-maxage");
    if (s !== undefined) return { header, value, seconds: s };
  }
  const cc = record.headers["cache-control"];
  const s = seconds(parseCacheControl(cc), "s-maxage");
  return s !== undefined ? { header: "cache-control", value: cc!, seconds: s } : undefined;
}
