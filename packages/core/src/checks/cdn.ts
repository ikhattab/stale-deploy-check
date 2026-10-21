import { browserFreshness, parseCacheControl } from "../cache-control.ts";
import { detectCdn, edgeCacheState, IGNORES_CDN_CACHE_CONTROL, sharedLifetime, type CdnName } from "../cdn.ts";
import { formatDuration } from "../duration.ts";
import { learn } from "../links.ts";
import type { Evidence, Finding } from "../types.ts";
import { header, type Context } from "./context.ts";

export function cdnChecks(ctx: Context): Finding[] {
  const doc = ctx.document;
  const findings: Finding[] = [];
  const base = { layer: "cdn", source: "headers", learnMore: learn.cdn } as const;

  const cdn = detectCdn(doc);
  const at = cdn ? `${cdn.name}${cdn.edge ? ` (edge ${cdn.edge})` : ""}` : "a CDN";
  const oneEdge = cdn?.edge ? ` This is what the ${cdn.edge} edge had; other edges can hold different copies.` : " Other edges can hold different copies.";

  if (cdn) {
    findings.push({
      ...base,
      check: "cdn.detected",
      severity: "info",
      title: `Served through ${at}`,
      detail: "The CDN findings below are for this one edge location.",
      evidence: [{ kind: "computed", label: "CDN", value: cdn.name }],
    });
  }

  // The second (conditional) request often shows a HIT that the first one missed.
  const states = [doc, ctx.revalidation].filter((r) => r !== undefined).map((r) => ({ record: r, state: edgeCacheState(r) }));
  const hitOn = states.find((s) => s.state.hit);
  const lifetime = sharedLifetime(doc);
  const freshness = browserFreshness(doc);
  const privateOnly = parseCacheControl(doc.headers["cache-control"]).has("private");
  // Shared caches may use a lifetime from max-age, Expires, or the same 10% guess browsers make.
  const explained = lifetime !== undefined || ((freshness.kind === "explicit" || freshness.kind === "heuristic") && !privateOnly);

  if (hitOn) {
    const age = hitOn.state.age;
    const ageText = age ? ` This copy had been there for ${formatDuration(age)}.` : "";
    const evidence: Evidence[] = [
      ...hitOn.state.evidence.map((e) => ({ kind: "header", url: hitOn.record.url, name: e.name, value: e.value }) satisfies Evidence),
      header(doc, "cache-control"),
    ];
    const deployScoped = deployScopedCache(cdn?.name, age);
    if (explained || deployScoped) {
      findings.push({
        ...base,
        check: "cdn.html-from-edge",
        severity: "info",
        title: `${at} served the HTML from its cache`,
        detail: `${explained ? "The headers allow it, so this is expected." : deployScoped}${ageText}${oneEdge}`,
        evidence,
      });
    } else {
      findings.push({
        ...base,
        check: "cdn.edge-rule-suspected",
        severity: "warn",
        title: `${at} served the HTML from its cache, but the headers don't ask it to`,
        detail:
          `The HTML's headers only allow browsers to keep it, yet a shared cache answered.${ageText} ` +
          `Something in the CDN's own settings (a cache-everything rule, an HTML TTL) is probably overriding the headers, and users get this copy until it expires at the edge or is purged.${oneEdge}`,
        evidence,
        fix: "Find the rule in the CDN's settings that caches HTML and remove it, or purge HTML from the CDN as part of every deploy.",
      });
    }
  }

  if (lifetime) {
    const warn = lifetime.seconds > ctx.thresholds.edgeMaxAge;
    findings.push({
      ...base,
      check: "cdn.html-edge-lifetime",
      severity: warn ? "warn" : "info",
      title: `CDNs may keep the HTML for ${formatDuration(lifetime.seconds)}`,
      detail: warn
        ? `Unless your deploy purges the CDN, users can get the old HTML for up to ${formatDuration(lifetime.seconds)} after a deploy, even though their browsers ask for a fresh copy.`
        : "That's short enough that a deploy shows up quickly, even without a purge.",
      evidence: [{ kind: "header", url: doc.url, name: lifetime.header, value: lifetime.value }],
      ...(warn ? { fix: `Purge HTML from the CDN on every deploy, or shorten the CDN lifetime to ${formatDuration(ctx.thresholds.edgeMaxAge)} or less.` } : {}),
    });
  }

  if (cdn && IGNORES_CDN_CACHE_CONTROL.has(cdn.name) && doc.headers["cdn-cache-control"] !== undefined) {
    findings.push({
      ...base,
      check: "cdn.cdn-cache-control-unread",
      severity: "warn",
      title: `${cdn.name} doesn't document reading CDN-Cache-Control`,
      detail: `The HTML sets CDN-Cache-Control, but ${cdn.name} reads s-maxage instead, so the header probably has no effect there.`,
      evidence: [header(doc, "cdn-cache-control"), header(doc, "cache-control")],
      fix: "Use s-maxage in Cache-Control for the CDN lifetime, for example Cache-Control: max-age=0, s-maxage=60.",
    });
  }

  return findings;
}

/**
 * Some platforms throw their edge cache away on every deploy, so a HIT on HTML there isn't a stale copy.
 * Returns why, or undefined when a HIT can outlive a deploy.
 */
function deployScopedCache(cdn: CdnName | undefined, age: number | undefined): string | undefined {
  switch (cdn) {
    case "Vercel":
    case "Netlify":
      return `${cdn} clears its CDN cache on every deploy, so this copy can't outlive the next one as long as you deploy through ${cdn}.`;
    case "Cloudflare":
      // Cloudflare's zone cache sends Age on a hit. A Worker's cache (static assets included, as far as we've seen) doesn't,
      // and it's keyed by the Worker version unless cache.cross_version_cache is on.
      return age === undefined
        ? "Cloudflare reports a hit but no Age, which is what a Worker's own cache sends. That cache is keyed by the deployed Worker version by default, so a deploy starts with an empty cache. If cache.cross_version_cache is on, it doesn't."
        : undefined;
    default:
      return undefined;
  }
}
