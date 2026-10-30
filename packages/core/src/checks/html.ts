import { browserFreshness, parseCacheControl, seconds } from "../cache-control.ts";
import { detectCdn } from "../cdn.ts";
import { formatDuration } from "../duration.ts";
import { learn } from "../links.ts";
import type { Finding } from "../types.ts";
import { computed, header, status, type Context } from "./context.ts";

const NO_CACHE_FIX = "Send Cache-Control: no-cache on HTML, with an ETag, so browsers keep a copy but ask before every use.";

export function htmlChecks(ctx: Context): Finding[] {
  const doc = ctx.document;
  const freshness = browserFreshness(doc);
  const findings: Finding[] = [];
  const base = { layer: "http-cache", source: "headers" } as const;

  switch (freshness.kind) {
    case "heuristic":
      findings.push({
        ...base,
        check: "html.heuristic-freshness",
        severity: "fail",
        title: `Browsers may reuse the HTML for about ${formatDuration(freshness.seconds)} without asking`,
        detail:
          `The HTML has no Cache-Control lifetime and no Expires, so browsers guess one: usually 10% of the time since Last-Modified. ` +
          `It was last modified ${formatDuration(freshness.lastModifiedAge)} before this response, so a user who loads it now can keep getting this copy for about ${formatDuration(freshness.seconds)} after your next deploy. ` +
          `The longer the page goes between changes, the longer the guess.`,
        evidence: [
          header(doc, "cache-control"),
          header(doc, "expires"),
          header(doc, "last-modified"),
          header(doc, "date"),
          computed("heuristic lifetime (10% of age)", formatDuration(freshness.seconds)),
        ],
        fix: NO_CACHE_FIX,
        learnMore: learn.heuristic,
      });
      break;

    case "none":
      findings.push({
        ...base,
        check: "html.heuristic-freshness",
        severity: "info",
        title: "The HTML has no caching headers at all",
        detail:
          "No Cache-Control lifetime, no Expires, no Last-Modified. Browsers usually don't guess a lifetime without Last-Modified, " +
          "but nothing tells them to ask before reusing the page, and adding Last-Modified later would start the guessing.",
        evidence: [header(doc, "cache-control"), header(doc, "expires"), header(doc, "last-modified")],
        fix: NO_CACHE_FIX,
        learnMore: learn.heuristic,
      });
      break;

    case "no-store":
      findings.push({
        ...base,
        check: "html.no-store",
        severity: "warn",
        title: "The HTML is no-store, so every visit downloads it again",
        detail:
          "no-store does keep deploys visible right away, but browsers can't keep a copy to revalidate with a cheap 304, " +
          "and some browsers keep no-store pages out of the back/forward cache, so Back reloads the page. " +
          "no-cache gets you the same freshness for the price of one small round trip.",
        evidence: [header(doc, "cache-control")],
        fix: "Use Cache-Control: no-cache on HTML unless the page holds private data that must never be stored.",
        learnMore: learn.headers,
      });
      break;

    case "explicit": {
      const fail = freshness.seconds > ctx.thresholds.htmlMaxAge;
      findings.push({
        ...base,
        check: "html.max-age",
        severity: fail ? "fail" : "warn",
        title: `Browsers reuse the HTML for ${formatDuration(freshness.seconds)} without asking`,
        detail:
          `The ${freshness.via === "max-age" ? "max-age" : "Expires header"} gives the HTML a fixed lifetime. A user who loads it just before a deploy keeps the old page, and with it the old asset URLs, for up to ${formatDuration(freshness.seconds)}.` +
          (fail ? ` That's over the ${formatDuration(ctx.thresholds.htmlMaxAge)} limit for this check.` : ""),
        evidence: [header(doc, freshness.via === "max-age" ? "cache-control" : "expires"), computed("browser lifetime", formatDuration(freshness.seconds))],
        fix: NO_CACHE_FIX,
        learnMore: learn.headers,
      });
      break;
    }

    case "revalidate":
      findings.push({
        ...base,
        check: "html.max-age",
        severity: "pass",
        title: "Browsers ask the server before reusing the HTML",
        detail: `The HTML is revalidated on every use (${freshness.via}).`,
        evidence: [header(doc, "cache-control")],
        learnMore: learn.headers,
      });
      break;
  }

  const cc = parseCacheControl(doc.headers["cache-control"]);
  const swr = seconds(cc, "stale-while-revalidate");
  if (swr && freshness.kind === "explicit") {
    findings.push({
      ...base,
      check: "html.stale-while-revalidate",
      severity: "warn",
      title: `After the HTML goes stale, browsers may still show it for up to ${formatDuration(swr)}`,
      detail:
        "With stale-while-revalidate, a browser that supports it shows the stale copy right away and fetches the new one in the background. " +
        "The first visit after a deploy gets the old version; the next one gets the new.",
      evidence: [header(doc, "cache-control")],
      fix: "Drop stale-while-revalidate from HTML, or accept that each user sees one old page load after a deploy.",
      learnMore: learn.headers,
    });
  }

  const hasValidator = doc.headers["etag"] !== undefined || doc.headers["last-modified"] !== undefined;
  // Cloudflare Pages and Workers static assets send an ETag with every file but the HTML, and have
  // no setting for it (seen on sdc-lab-*.pages.dev and ihabkhattab.com). Not something to fix there.
  const htmlOnlyOnCloudflare = detectCdn(doc)?.name === "Cloudflare" && ctx.assets.some((a) => a.record.headers["etag"] !== undefined);
  if (freshness.kind === "revalidate" && !hasValidator && htmlOnlyOnCloudflare) {
    findings.push({
      ...base,
      check: "html.no-validator",
      severity: "info",
      title: "The HTML has no ETag or Last-Modified, but its files do, as usual on Cloudflare",
      detail:
        "Without a validator the server can't answer 304 Not Modified, so every visit downloads the whole HTML. " +
        "Cloudflare Pages and Workers static assets send an ETag with every file except HTML, and there's no setting for it. " +
        "Cloudflare features that rewrite HTML (Email Obfuscation, Automatic HTTPS Rewrites, Rocket Loader) remove ETags too.",
      evidence: [header(doc, "etag"), header(doc, "last-modified"), computed("CDN", "Cloudflare")],
      fix: "On Pages or Workers static assets, nothing: the page is still revalidated, just not with a 304. Behind a Cloudflare zone, check whether those features are on.",
      learnMore: learn.headers,
    });
  } else if (freshness.kind === "revalidate" && !hasValidator) {
    findings.push({
      ...base,
      check: "html.no-validator",
      severity: "warn",
      title: "The HTML has no ETag or Last-Modified, so revalidating downloads it all",
      detail:
        "Browsers ask before reusing the page, but without a validator the server can't answer 304 Not Modified, " +
        "so every visit downloads the whole HTML.",
      evidence: [header(doc, "etag"), header(doc, "last-modified")],
      fix: "Send an ETag (most servers and hosts can do this for static files) or Last-Modified with the HTML.",
      learnMore: learn.headers,
    });
  }

  const reval = ctx.revalidation;
  if (reval) {
    if (reval.status === 304) {
      findings.push({
        ...base,
        check: "html.revalidation",
        severity: "pass",
        title: "Revalidating the HTML returns 304 Not Modified",
        detail: "A conditional request with the HTML's validator got 304 with no body.",
        evidence: [status(reval)],
        learnMore: learn.headers,
      });
    } else if (reval.status >= 200 && reval.status < 300) {
      const etagChanged = doc.headers["etag"] !== undefined && reval.headers["etag"] !== undefined && doc.headers["etag"] !== reval.headers["etag"];
      findings.push({
        ...base,
        check: "html.revalidation",
        severity: "warn",
        title: "Revalidating the HTML downloads it again instead of returning 304",
        detail: etagChanged
          ? "The ETag changed between two requests made seconds apart, so the HTML is different every time (a nonce, a timestamp, or a per-request id in it). It can never be revalidated cheaply."
          : "A conditional request with the HTML's validator got a full response. The server or CDN isn't honoring If-None-Match / If-Modified-Since.",
        evidence: [status(reval), header(doc, "etag"), header(reval, "etag")],
        fix: etagChanged
          ? "Move per-request values out of the HTML, or generate the ETag from the content without them."
          : "Check that the server answers If-None-Match with 304 when the ETag matches.",
        learnMore: learn.headers,
      });
    }
  }

  return findings;
}
