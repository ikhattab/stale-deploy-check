/**
 * The four places an old version can live, in the order a request reaches them,
 * plus "diagnostics" for findings that make the other layers easier to debug.
 */
export type Layer = "service-worker" | "http-cache" | "cdn" | "open-tab" | "diagnostics";

/**
 * fail: users can get an old version after a deploy.
 * warn: works, but costs something (extra downloads, lost bfcache) or depends on luck.
 * info: something we saw that changes how to read the other findings.
 * pass: the check ran and found nothing wrong.
 */
export type Severity = "fail" | "warn" | "info" | "pass";

/** Where the finding came from. The CLI only produces "headers"; "browser" is the in-page probe, which reads a tab's own state. */
export type Source = "headers" | "code" | "browser";

export interface Finding {
  /** Stable, dotted id. Safe to match on in CI and to put in an ignore list. */
  check: string;
  layer: Layer;
  severity: Severity;
  source: Source;
  /** One line, plain words. */
  title: string;
  /** Why it matters for this site, with the numbers we computed. */
  detail: string;
  /** What we saw. At least one entry for anything that isn't "pass". */
  evidence: Evidence[];
  /** What to change. Omitted for "pass" and most "info". */
  fix?: string;
  /** The article section that explains it. */
  learnMore: string;
}

export type Evidence =
  | { kind: "header"; url: string; name: string; value: string | null }
  | { kind: "status"; url: string; status: number; request?: Record<string, string> }
  | { kind: "computed"; label: string; value: string }
  | { kind: "file"; path: string; line?: number; excerpt?: string };

export interface RequestRecord {
  method: "GET" | "HEAD";
  url: string;
  status: number;
  /** Lowercased names, values as received. Set-Cookie values are redacted. */
  headers: Record<string, string>;
  /** Conditional headers we sent, if any (If-None-Match, If-Modified-Since). */
  conditional?: Record<string, string>;
  ms: number;
}

export interface Report {
  tool: { name: "stale-deploy-check"; version: string };
  target: string;
  /** Final URL after redirects. */
  resolved: string;
  checkedAt: string;
  /** Every asset URL the HTML references on the site's own origins, checked or not. A later run's --baseline reads this. */
  assets: string[];
  /** Every request the run made, so a finding's evidence can be traced. */
  requests: RequestRecord[];
  findings: Finding[];
  /** Check ids that were dropped by --ignore. */
  ignored: string[];
  summary: Record<Severity, number>;
}
