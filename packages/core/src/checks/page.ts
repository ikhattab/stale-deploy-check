import { learn } from "../links.ts";
import type { Finding, RequestRecord } from "../types.ts";
import { header, plural, status, type Context } from "./context.ts";

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
  const { checked } = ctx.baseline;
  const base = { layer: "open-tab", source: "headers", learnMore: learn.openTab } as const;
  const gone = checked.filter((r) => r.status >= 400 || servesHtml(r));
  const kept = checked.filter((r) => !gone.includes(r));

  if (gone.length > 0) {
    const why = [
      gone.some((r) => r.status === 403) ? "S3 answers 403 instead of 404 for a missing file when the reader isn't allowed to list the bucket, which is the usual setup behind CloudFront." : "",
      gone.some(servesHtml) ? "An HTML page came back where a script or stylesheet should be: a CDN error rule that serves index.html for missing files, which a browser can't run as code." : "",
    ].filter(Boolean);
    return [
      {
        ...base,
        check: "assets.previous-removed",
        severity: "fail",
        title: `${plural(gone.length, "file")} from the previous deploy no longer load`,
        detail: [
          "Tabs opened before this deploy still run the old code, which loads these URLs on demand (a route, a lazy component). " +
            "They now fail, and an unhandled failed import() usually means a blank screen.",
          ...why,
        ].join(" "),
        evidence: gone.flatMap((r) => (servesHtml(r) ? [status(r), header(r, "content-type")] : [status(r)])),
        fix: "Keep old assets for a few days after a deploy instead of deleting them, and reload once when a dynamic import fails.",
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
          : `${plural(kept.length, "file")} the old HTML referenced and this one doesn't still load, so tabs opened before the deploy keep working.`,
      evidence: kept.map(status),
    },
  ];
}

/** A script or stylesheet URL answered with an HTML page, like a single-page app's fallback for missing paths. */
function servesHtml(record: RequestRecord): boolean {
  return /\.(?:[cm]?js|css)$/.test(new URL(record.url).pathname) && /text\/html/i.test(record.headers["content-type"] ?? "");
}
