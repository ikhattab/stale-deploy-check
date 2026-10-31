import type { RequestRecord } from "./types.ts";

export type Directives = Map<string, string | true>;

/** Parses a Cache-Control value. Names are lowercased, quoted values unquoted. */
export function parseCacheControl(value: string | null | undefined): Directives {
  const directives: Directives = new Map();
  if (!value) return directives;
  for (const part of splitDirectives(value)) {
    const eq = part.indexOf("=");
    const name = (eq < 0 ? part : part.slice(0, eq)).trim().toLowerCase();
    if (!name || /[\s"]/.test(name)) continue;
    const raw = eq < 0 ? undefined : part.slice(eq + 1).trim();
    const parsed = raw === undefined ? true : raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw;
    if (!directives.has(name)) directives.set(name, parsed);
  }
  return directives;
}

/**
 * Splits on commas outside quoted values. A loop rather than a regex, so a server's header can't make
 * parsing take long: the regex this replaced backtracked on long runs of one character (CodeQL).
 */
function splitDirectives(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quoted && c === "\\") i++;
    else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  // A quote that never closes doesn't swallow the directives after it.
  if (quoted) return value.split(",");
  parts.push(value.slice(start));
  return parts;
}

/** A delta-seconds directive like max-age, or undefined if absent or malformed. */
export function seconds(directives: Directives, name: string): number | undefined {
  const value = directives.get(name);
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  return Number(value);
}

/**
 * How a browser's own cache treats a response. Shared-cache directives (s-maxage) don't count:
 * a browser ignores them, and can still fall back to a heuristic when they're the only ones present.
 */
export type BrowserFreshness =
  | { kind: "no-store" }
  /** Store, but revalidate before every use: no-cache, max-age=0, or an Expires in the past. */
  | { kind: "revalidate"; via: string }
  | { kind: "explicit"; via: "max-age" | "expires"; seconds: number }
  /** No explicit lifetime, so the browser may guess 10% of the time since Last-Modified. */
  | { kind: "heuristic"; seconds: number; lastModifiedAge: number }
  /** No explicit lifetime and no Last-Modified to guess from. */
  | { kind: "none" };

export function browserFreshness(record: RequestRecord): BrowserFreshness {
  const cc = parseCacheControl(record.headers["cache-control"]);
  if (cc.has("no-store")) return { kind: "no-store" };
  // A qualified no-cache="Set-Cookie" only restricts those fields, so it doesn't force revalidation.
  if (cc.get("no-cache") === true) return { kind: "revalidate", via: "no-cache" };

  const maxAge = seconds(cc, "max-age");
  if (maxAge !== undefined) {
    return maxAge === 0 ? { kind: "revalidate", via: "max-age=0" } : { kind: "explicit", via: "max-age", seconds: maxAge };
  }

  const date = responseDate(record);
  const expires = record.headers["expires"];
  if (expires !== undefined) {
    // An invalid Expires (often "0" or "-1") means already expired.
    const at = Date.parse(expires);
    const lifetime = Number.isNaN(at) ? 0 : Math.round((at - date) / 1000);
    return lifetime <= 0 ? { kind: "revalidate", via: `expires: ${expires}` } : { kind: "explicit", via: "expires", seconds: lifetime };
  }

  const lastModified = Date.parse(record.headers["last-modified"] ?? "");
  if (Number.isNaN(lastModified)) return { kind: "none" };
  const lastModifiedAge = Math.max(0, Math.round((date - lastModified) / 1000));
  return { kind: "heuristic", seconds: Math.round(lastModifiedAge / 10), lastModifiedAge };
}

/** The response's Date header, or when we got it if the server didn't send one. */
export function responseDate(record: RequestRecord): number {
  const date = Date.parse(record.headers["date"] ?? "");
  return Number.isNaN(date) ? Date.now() : date;
}
