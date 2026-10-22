import { assetChecks } from "./checks/assets.ts";
import { cdnChecks } from "./checks/cdn.ts";
import type { AssetResult, Context, Thresholds } from "./checks/context.ts";
import { htmlChecks } from "./checks/html.ts";
import { baselineChecks, pageChecks } from "./checks/page.ts";
import { parseCacheControl } from "./cache-control.ts";
import { DAY } from "./duration.ts";
import { parsePage } from "./html.ts";
import { CheckError, Recorder, type FetchLike } from "./http.ts";
import { ARTICLE } from "./links.ts";
import { hasContentHash, missingTwin, versionParam } from "./naming.ts";
import type { Finding, Report, RequestRecord, Severity } from "./types.ts";

export const VERSION = "0.3.4";

export const DEFAULT_THRESHOLDS: Thresholds = {
  htmlMaxAge: 300,
  edgeMaxAge: 300,
  assetMinMaxAge: 30 * DAY,
};

export interface CheckOptions {
  fetch?: FetchLike;
  timeoutMs?: number;
  userAgent?: string;
  /** How many same-origin assets to request. */
  maxAssets?: number;
  thresholds?: Partial<Thresholds>;
  /** A previous run's report. Its assets that this HTML no longer references are requested to see if they still load. */
  baseline?: Pick<Report, "assets">;
  /** Check ids to drop from the findings. */
  ignore?: string[];
  /**
   * Other origins that serve this site's own files, like an asset domain or a CloudFront distribution.
   * The page's own origin and its host's subdomains always count.
   */
  assetOrigins?: string[];
}

const MAX_BASELINE_REQUESTS = 50;
const CONCURRENCY = 6;

export async function check(target: string, options: CheckOptions = {}): Promise<Report> {
  const url = normalizeUrl(target);
  const assetOrigins = (options.assetOrigins ?? []).map((o) => new URL(normalizeUrl(o)).origin);
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const maxAssets = options.maxAssets ?? 20;
  const recorder = new Recorder({
    fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    timeoutMs: options.timeoutMs ?? 10_000,
    userAgent: options.userAgent ?? `stale-deploy-check/${VERSION} (+${ARTICLE})`,
  });

  const page = await recorder.request(url, { method: "GET", headers: { accept: "text/html,application/xhtml+xml" }, readBody: true });
  const doc = page.final;
  assertHtml(doc);

  const parsed = parsePage(page.body ?? "", doc.url);
  const revalidation = await revalidate(recorder, doc);

  const isOwn = ownedBy(doc.url, assetOrigins);
  const own = parsed.assets.filter(isOwn);
  const otherOrigins = parsed.assets.filter((a) => !isOwn(a));
  const assets = await mapLimit(own.slice(0, maxAssets), CONCURRENCY, async (assetUrl): Promise<AssetResult> => {
    const record = await headOrGet(recorder, assetUrl);
    const version = versionParam(assetUrl);
    return { url: assetUrl, record, hashed: hasContentHash(assetUrl), ...(version ? { versionParam: version } : {}) };
  });

  // A browser can ask for a new hashed file before it's live. See what it gets back for one that doesn't exist.
  const sample = assets.find((a) => a.hashed && a.record.status < 400);
  const missing = sample ? await headOrGet(recorder, missingTwin(sample.url)) : undefined;

  let baseline: Context["baseline"];
  if (options.baseline) {
    const current = new Set(own);
    const previous = options.baseline.assets.filter((a) => !current.has(a)).slice(0, MAX_BASELINE_REQUESTS);
    baseline = { checked: await mapLimit(previous, CONCURRENCY, (a) => headOrGet(recorder, a)) };
  }

  const ctx: Context = {
    document: doc,
    ...(revalidation ? { revalidation } : {}),
    page: parsed,
    assets,
    notChecked: { otherOrigins, overCap: own.slice(maxAssets), limit: maxAssets },
    ...(baseline ? { baseline } : {}),
    ...(missing ? { missing } : {}),
    thresholds,
  };
  const all = [...pageChecks(ctx), ...htmlChecks(ctx), ...assetChecks(ctx), ...cdnChecks(ctx), ...baselineChecks(ctx)];

  const ignore = new Set(options.ignore ?? []);
  const findings = all.filter((f) => !ignore.has(f.check));
  const ignored = [...new Set(all.filter((f) => ignore.has(f.check)).map((f) => f.check))];

  return {
    tool: { name: "stale-deploy-check", version: VERSION },
    target,
    resolved: doc.url,
    checkedAt: new Date().toISOString(),
    assets: own,
    requests: recorder.requests,
    findings,
    ignored,
    summary: summarize(findings),
  };
}

export function summarize(findings: Finding[]): Record<Severity, number> {
  const summary: Record<Severity, number> = { fail: 0, warn: 0, info: 0, pass: 0 };
  for (const f of findings) summary[f.severity]++;
  return summary;
}

function normalizeUrl(target: string): string {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `https://${target}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new CheckError("invalid-url", `"${target}" isn't a URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new CheckError("invalid-url", `only http and https URLs can be checked, not ${url.protocol}`);
  return url.href;
}

/** Whether an asset is part of this site's deploy: the page's origin, a subdomain of its host, or an origin the caller named. */
function ownedBy(pageUrl: string, assetOrigins: string[]): (assetUrl: string) => boolean {
  const page = new URL(pageUrl);
  const site = page.hostname.replace(/^www\./, "");
  const extra = new Set(assetOrigins);
  return (assetUrl) => {
    const { origin, hostname } = new URL(assetUrl);
    return origin === page.origin || extra.has(origin) || hostname === site || hostname.endsWith(`.${site}`);
  };
}

function assertHtml(doc: RequestRecord): void {
  if (doc.status === 401 || doc.status === 403 || doc.status === 429 || doc.headers["cf-mitigated"] === "challenge") {
    throw new CheckError("blocked", `${doc.url} refused the request (${doc.status}). The site may block automated requests, or need a login.`);
  }
  if (doc.status < 200 || doc.status >= 300) throw new CheckError("status", `${doc.url} returned ${doc.status}`);
  const type = doc.headers["content-type"] ?? "";
  if (!/text\/html|application\/xhtml\+xml/i.test(type)) {
    throw new CheckError("not-html", `${doc.url} isn't an HTML page (content-type: ${type || "none"})`);
  }
}

async function revalidate(recorder: Recorder, doc: RequestRecord): Promise<RequestRecord | undefined> {
  if (parseCacheControl(doc.headers["cache-control"]).has("no-store")) return undefined;
  const conditional: Record<string, string> = {};
  if (doc.headers["etag"]) conditional["if-none-match"] = doc.headers["etag"];
  if (doc.headers["last-modified"]) conditional["if-modified-since"] = doc.headers["last-modified"];
  if (Object.keys(conditional).length === 0) return undefined;
  const result = await recorder.request(doc.url, { method: "GET", headers: { accept: "text/html,application/xhtml+xml" }, conditional });
  return result.final;
}

async function headOrGet(recorder: Recorder, url: string): Promise<RequestRecord> {
  const head = await recorder.request(url, { method: "HEAD" });
  if (head.final.status !== 405 && head.final.status !== 501) return head.final;
  return (await recorder.request(url, { method: "GET" })).final;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}
