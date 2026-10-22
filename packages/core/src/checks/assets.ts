import { browserFreshness, parseCacheControl, type BrowserFreshness } from "../cache-control.ts";
import { sharedLifetime } from "../cdn.ts";
import { DAY, formatDuration } from "../duration.ts";
import { learn } from "../links.ts";
import { hasContentHash } from "../naming.ts";
import type { Evidence, Finding } from "../types.ts";
import { computed, header, plural, servesHtml, status, type AssetResult, type Context } from "./context.ts";

export function assetChecks(ctx: Context): Finding[] {
  const findings: Finding[] = [];
  const base = { layer: "http-cache", source: "headers" } as const;

  const unreachable = ctx.assets.filter((a) => a.record.status >= 400);
  const loaded = ctx.assets.filter((a) => a.record.status < 400);

  if (unreachable.length > 0) {
    findings.push({
      ...base,
      check: "assets.unreachable",
      severity: "warn",
      title: `${plural(unreachable.length, "file")} the HTML points to ${unreachable.length === 1 ? "doesn't" : "don't"} load`,
      detail: "The HTML references these URLs, but they return an error. If a deploy is rolling out, the HTML and the assets may be out of sync.",
      evidence: unreachable.map((a) => status(a.record)),
      learnMore: learn.openTab,
    });
  }

  const queryVersioned: AssetResult[] = [];
  const unhashedLong: { asset: AssetResult; lifetime: number }[] = [];
  const unhashed: AssetResult[] = [];
  const shortCache: AssetResult[] = [];
  const noImmutable: AssetResult[] = [];
  let longCached = 0;

  for (const asset of loaded) {
    const freshness = browserFreshness(asset.record);
    const lifetime = lifetimeOf(freshness);
    if (!asset.hashed) {
      if (asset.versionParam) queryVersioned.push(asset);
      else if (lifetime >= DAY) unhashedLong.push({ asset, lifetime });
      else unhashed.push(asset);
    } else if (freshness.kind !== "explicit" || freshness.seconds < ctx.thresholds.assetMinMaxAge) {
      shortCache.push(asset);
    } else {
      longCached++;
      if (!parseCacheControl(asset.record.headers["cache-control"]).has("immutable")) noImmutable.push(asset);
    }
  }

  if (unhashedLong.length > 0) {
    findings.push({
      ...base,
      check: "assets.unhashed-long-cache",
      severity: "fail",
      title: `${plural(unhashedLong.length, "file")} without a hash in the name ${unhashedLong.length === 1 ? "is" : "are"} cached for a day or more`,
      detail:
        "These URLs stay the same when their content changes, and browsers may reuse them without asking. " +
        "After a deploy, users can get new HTML with old scripts or styles, or the other way around.",
      evidence: unhashedLong.flatMap(({ asset, lifetime }) => [
        cacheEvidence(asset),
        { kind: "computed", label: `${pathOf(asset.url)} browser lifetime`, value: formatDuration(lifetime) } satisfies Evidence,
      ]),
      fix: "Put a content hash in these file names (your bundler can do it), or serve them with Cache-Control: no-cache.",
      learnMore: learn.hashing,
    });
  }

  if (queryVersioned.length > 0) {
    findings.push({
      ...base,
      check: "assets.query-version",
      severity: "warn",
      title: `${plural(queryVersioned.length, "file")} ${queryVersioned.length === 1 ? "uses" : "use"} a ?version parameter instead of a hash in the name`,
      detail:
        "A build number changes every URL on every deploy, so returning users download everything again even when only one file changed. " +
        "A content hash only changes for the files that did.",
      evidence: queryVersioned.map((a) => ({ kind: "computed", label: pathOf(a.url), value: a.versionParam! }) satisfies Evidence),
      fix: "Let the bundler put a content hash in each file name, and drop the query parameter.",
      learnMore: learn.hashing,
    });
  }

  if (unhashed.length > 0) {
    findings.push({
      ...base,
      check: "assets.unhashed",
      severity: "warn",
      title: `${plural(unhashed.length, "file")} without a hash in the name`,
      detail:
        "These are safe after a deploy because they're cached briefly or revalidated, but browsers have to ask about each one on every visit. " +
        "With a content hash they could be cached for a year.",
      evidence: unhashed.map(cacheEvidence),
      fix: "Put a content hash in these file names and serve them with Cache-Control: public, max-age=31536000, immutable.",
      learnMore: learn.hashing,
    });
  }

  if (shortCache.length > 0) {
    findings.push({
      ...base,
      check: "assets.short-cache",
      severity: "warn",
      title: `${plural(shortCache.length, "hashed file")} ${shortCache.length === 1 ? "is" : "are"} cached for less than ${formatDuration(ctx.thresholds.assetMinMaxAge)}`,
      detail: "A hashed URL never gets different content, so there's nothing to ask the server about. A short lifetime just makes returning visits slower.",
      evidence: shortCache.map(cacheEvidence),
      fix: "Serve hashed assets with Cache-Control: public, max-age=31536000, immutable.",
      learnMore: learn.headers,
    });
  } else if (longCached > 0) {
    findings.push({
      ...base,
      check: "assets.short-cache",
      severity: "pass",
      title: "Hashed files are cached long-term",
      detail: `${plural(longCached, "hashed file")} with a lifetime of at least ${formatDuration(ctx.thresholds.assetMinMaxAge)}.`,
      evidence: [],
      learnMore: learn.headers,
    });
  }

  if (noImmutable.length > 0) {
    findings.push({
      ...base,
      check: "assets.no-immutable",
      severity: "info",
      title: `${plural(noImmutable.length, "hashed file")} could add immutable`,
      detail: "They're cached long-term already. immutable also tells browsers not to revalidate them when the user reloads the page.",
      evidence: noImmutable.map(cacheEvidence),
      fix: "Add immutable: Cache-Control: public, max-age=31536000, immutable.",
      learnMore: learn.headers,
    });
  }

  const missing = ctx.missing;
  // A 200 that isn't an HTML fallback means the server answers any path, so there's no miss to judge.
  if (missing && (missing.status >= 400 || servesHtml(missing))) {
    const cc = parseCacheControl(missing.headers["cache-control"]);
    const freshness = browserFreshness(missing);
    const browser = lifetimeOf(freshness);
    const shared = sharedLifetime(missing)?.seconds ?? 0;
    const lifetime = Math.max(browser, shared);
    const what = missing.status >= 400 ? `${missing.status} for a missing hashed file` : `HTML page served for a missing ${extensionOf(missing.url)} file`;
    if (browser > ctx.thresholds.htmlMaxAge || shared > ctx.thresholds.edgeMaxAge) {
      const guessed = freshness.kind === "heuristic" && browser >= shared;
      findings.push({
        ...base,
        check: "assets.missing-cached",
        severity: "warn",
        title: `The ${what} is cached for ${guessed ? "about " : ""}${formatDuration(lifetime)}`,
        detail:
          "A browser can ask for a hashed file while it's missing: new HTML reached it before the files did, or a rollback brought back file names an open tab asked for while they were gone. " +
          `It keeps the error the way it would keep the real file, so that user can't load the page's code for ${formatDuration(lifetime)}, even once the file is there.` +
          (cc.has("immutable") ? " immutable also stops a reload from asking again." : "") +
          (guessed ? " There's no explicit lifetime, so that's the browser's guess from Last-Modified." : "") +
          (shared > browser ? " The CDN keeps it that long, so every user who asks gets it." : ""),
        evidence: [status(missing), header(missing, "cache-control"), computed("cached for", formatDuration(lifetime))],
        fix:
          "Send Cache-Control: no-store on responses for missing files. A long-lifetime rule for hashed files usually matches by path, so it covers misses too; " +
          "set the header where the error is sent (the server, or an edge function in front of the static files).",
        learnMore: learn.headers,
      });
    } else {
      findings.push({
        ...base,
        check: "assets.missing-cached",
        severity: "pass",
        title: "Missing hashed files aren't cached long",
        detail: `The ${what} is ${lifetime > 0 ? `cached for ${formatDuration(lifetime)}` : "not reused without asking"}, so a browser that asks too early gets the file on its next try.`,
        evidence: [status(missing), header(missing, "cache-control")],
        learnMore: learn.headers,
      });
    }
  }

  const { otherOrigins, overCap, limit } = ctx.notChecked;
  if (ctx.assets.length === 0 && otherOrigins.length === 0) {
    findings.push({
      ...base,
      check: "assets.not-checked",
      severity: "info",
      title: "The HTML references no scripts or stylesheets",
      detail: "Nothing to check for hashed names. If the app loads its code some other way (a script that injects others), those files weren't checked.",
      evidence: [],
      learnMore: learn.hashing,
    });
  } else if (otherOrigins.length > 0 || overCap.length > 0) {
    const byOrigin = countByOrigin(otherOrigins);
    const noneChecked = ctx.assets.length === 0;
    // Name an origin to add only when it looks like build output, so analytics and widget hosts aren't suggested.
    const suggest = byOrigin.find(([origin]) => noneChecked || otherOrigins.some((url) => url.startsWith(`${origin}/`) && hasContentHash(url)))?.[0];
    const parts = [
      otherOrigins.length > 0 ? `${plural(otherOrigins.length, "file")} on other origins` : "",
      overCap.length > 0 ? `${overCap.length} over the ${limit}-file limit` : "",
    ].filter(Boolean);
    const detail = [
      otherOrigins.length > 0
        ? "Only files on the page's own origin and its subdomains are checked, since third-party files aren't part of your deploy. " +
          (noneChecked
            ? "Every script and stylesheet is on another origin, so none of the hashing or lifetime checks ran. If they're your own build files on an asset domain, nothing above covers them."
            : "If some of your own files live on a separate asset domain, they weren't checked.")
        : "",
      overCap.length > 0 ? `The limit is ${plural(limit, "file")} per run.` : "",
    ].filter(Boolean);
    const fixes = [
      suggest ? `If ${suggest} serves your own files, add it as an asset origin (--asset-origin ${suggest}).` : "",
      overCap.length > 0 ? `Raise the limit to check them all (--max-assets ${ctx.assets.length + overCap.length}).` : "",
    ].filter(Boolean);
    findings.push({
      ...base,
      check: "assets.not-checked",
      severity: "info",
      title: noneChecked ? `No scripts or stylesheets were checked: all ${otherOrigins.length} are on other origins` : `Skipped ${parts.join(" and ")}`,
      detail: detail.join(" "),
      evidence: [
        ...byOrigin.map(([origin, n]) => ({ kind: "computed", label: "other origin, not checked", value: `${origin} (${plural(n, "file")})` }) satisfies Evidence),
        ...overCap.map((url) => ({ kind: "computed", label: "over the limit, not checked", value: url }) satisfies Evidence),
      ],
      ...(fixes.length > 0 ? { fix: fixes.join(" ") } : {}),
      learnMore: learn.hashing,
    });
  }

  return findings;
}

/** Seconds a browser may reuse the response without asking. */
function lifetimeOf(freshness: BrowserFreshness): number {
  return freshness.kind === "explicit" || freshness.kind === "heuristic" ? freshness.seconds : 0;
}

/** Origins and how many files each serves, most first. */
function countByOrigin(urls: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const url of urls) {
    const { origin } = new URL(url);
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}

function cacheEvidence(asset: AssetResult): Evidence {
  return header(asset.record, "cache-control");
}

function extensionOf(url: string): string {
  return /\.([A-Za-z0-9]+)$/.exec(new URL(url).pathname)?.[1] ?? "";
}

function pathOf(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}
