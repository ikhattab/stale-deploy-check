import { edgeCacheState } from "../cdn.ts";
import { learn } from "../links.ts";
import type { Finding, RequestRecord } from "../types.ts";
import { header, plural, servesHtml, status, type Context } from "./context.ts";

export function pageChecks(ctx: Context): Finding[] {
  const findings: Finding[] = [];
  const { buildId, serviceWorker } = ctx.page;

  if (buildId) {
    findings.push({
      check: "page.build-id",
      layer: "diagnostics",
      severity: "pass",
      source: "headers",
      title: `The page says which build it is: ${buildId.content}`,
      detail: `Found <meta name="${buildId.name}">.`,
      evidence: [{ kind: "computed", label: `meta ${buildId.name}`, value: buildId.content }],
      learnMore: learn.proveIt,
    });
  } else {
    findings.push({
      check: "page.build-id",
      layer: "diagnostics",
      severity: "info",
      source: "headers",
      title: "The page doesn't say which build it is",
      detail: 'Without a build id in the HTML, "users see the old version" has no number attached, and you can\'t tell which deploy a screenshot came from.',
      evidence: [{ kind: "computed", label: "meta build/version", value: "not found" }],
      fix: 'Add <meta name="build" content="..."> with the build id or commit, and show it somewhere a user can read it.',
      learnMore: learn.proveIt,
    });
  }

  if (serviceWorker) {
    findings.push({
      check: "page.service-worker",
      layer: "service-worker",
      severity: "info",
      source: "headers",
      title: "The page registers a service worker",
      detail:
        "A service worker can answer requests from its own cache before any of the HTTP headers above apply, and a new one waits until every tab using the old one is closed. " +
        "This check can't see what it serves. Check its update flow in the code, or in DevTools under Application → Service workers.",
      evidence: [{ kind: "computed", label: "detected by", value: serviceWorker }],
      learnMore: learn.serviceWorker,
    });
  }

  return findings;
}

export function baselineChecks(ctx: Context): Finding[] {
  if (!ctx.baseline) return [];
  const { checked, pastCache, control } = ctx.baseline;
  const base = { layer: "open-tab", source: "headers", learnMore: learn.openTab } as const;
  const failed = (r: RequestRecord): boolean => r.status >= 400 || servesHtml(r);
  const gone = checked.filter(failed);
  // Past the CDN's copy, an old file only counts as gone if a current file still loads the same way.
  const queryIgnored = control !== undefined && !failed(control);
  const cacheOnly = queryIgnored ? pastCache.filter((p) => failed(p.fresh)) : [];
  const unconfirmed = queryIgnored ? [] : pastCache;
  const kept = checked.filter((r) => !gone.includes(r));

  if (gone.length + cacheOnly.length > 0) {
    const n = gone.length + cacheOnly.length;
    const answers = [...gone, ...cacheOnly.map((p) => p.fresh)];
    // An HTML error page is just how the 404 looks; only a successful HTML answer is a fallback rule.
    const fallback = (r: RequestRecord): boolean => r.status < 400 && servesHtml(r);
    const one = cacheOnly.length === 1;
    const why = [
      cacheOnly.length > 0
        ? `${cacheOnly.length === n ? (n === 1 ? "It" : "They") : `${cacheOnly.length} of them`} only loaded from the CDN's cache. ` +
          `Asked for with a unique query string, which the CDN has no copy for, the deploy no longer has ${one ? "it" : "them"}, while a current file loads that way. ` +
          "Other edges, and this one once the copy expires or is purged, return the error. The copy may be one an earlier run of this check put there."
        : "",
      answers.some((r) => r.status === 403)
        ? "S3 answers 403 instead of 404 for a missing file when the reader isn't allowed to list the bucket, which is the usual setup behind CloudFront."
        : "",
      answers.some(fallback)
        ? "An HTML page came back where a script or stylesheet should be: a CDN error rule that serves index.html for missing files, which a browser can't run as code."
        : "",
    ].filter(Boolean);
    const goneEvidence = (r: RequestRecord) => (fallback(r) ? [status(r), header(r, "content-type")] : [status(r)]);
    return [
      {
        ...base,
        check: "assets.previous-removed",
        severity: "fail",
        title: `${plural(n, "file")} from the previous deploy no longer ${n === 1 ? "loads" : "load"}${cacheOnly.length === n ? " except from the CDN's cache" : ""}`,
        detail: [
          "Tabs opened before this deploy still run the old code, which loads these URLs on demand (a route, a lazy component). " +
            "They now fail, and an unhandled failed import() usually means a blank screen.",
          ...why,
        ].join(" "),
        evidence: [
          ...gone.flatMap(goneEvidence),
          ...cacheOnly.flatMap((p) => [status(p.cached), ...edgeCacheState(p.cached).evidence.map((e) => header(p.cached, e.name)), ...goneEvidence(p.fresh)]),
          ...(cacheOnly.length > 0 && control ? [status(control)] : []),
        ],
        fix: "Keep old assets for a few days after a deploy instead of deleting them, and reload once when a dynamic import fails.",
      },
    ];
  }

  if (unconfirmed.length > 0) {
    return [
      {
        ...base,
        check: "assets.previous-kept",
        severity: "info",
        title: `${plural(unconfirmed.length, "file")} from the previous deploy ${unconfirmed.length === 1 ? "loads" : "load"}, but only the CDN's cached copy could be checked`,
        detail:
          `${unconfirmed.length === 1 ? "It" : "They"} came from the CDN's cache, which can hold a file the deploy removed, sometimes a copy an earlier run of this check put there. ` +
          (control
            ? "Asking past it with a unique query string didn't work for a current file either, so this host doesn't ignore the query"
            : "No current file loaded to show whether this host ignores a query string, so asking past the cache with one proves nothing") +
          ` and there's no telling whether the deploy still has ${unconfirmed.length === 1 ? "it" : "them"}.`,
        evidence: [
          ...unconfirmed.flatMap((p) => [status(p.cached), ...edgeCacheState(p.cached).evidence.map((e) => header(p.cached, e.name))]),
          ...(control ? [status(control)] : []),
        ],
        fix: "Request one of these past the CDN (from the origin, or after a purge), or keep old assets for a few days after a deploy so it doesn't matter.",
      },
    ];
  }

  return [
    {
      ...base,
      check: "assets.previous-kept",
      severity: "pass",
      title: checked.length === 0 ? "No asset URLs changed since the baseline" : "Files from the previous deploy still load",
      detail:
        checked.length === 0
          ? "Every asset in the baseline report is still referenced by the HTML, so there was nothing to check."
          : `${plural(kept.length, "file")} the old HTML referenced and this one doesn't still load, so tabs opened before the deploy keep working.` +
            (pastCache.length > 0 ? ` ${pastCache.length} came from the CDN's cache, and load past it too.` : ""),
      evidence: kept.map(status),
    },
  ];
}
