import type { Finding, Layer, Report, Severity } from "@stale-deploy-check/core";

const LAYERS: { layer: Layer; heading: string }[] = [
  { layer: "service-worker", heading: "Service worker" },
  { layer: "http-cache", heading: "HTTP cache" },
  { layer: "cdn", heading: "CDN" },
  { layer: "open-tab", heading: "Open tabs" },
  { layer: "diagnostics", heading: "Diagnostics" },
];

const SEVERITY_ORDER: Severity[] = ["fail", "warn", "info", "pass"];

export interface Style {
  red(s: string): string;
  yellow(s: string): string;
  green(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
}

export function makeStyle(color: boolean): Style {
  const wrap = (open: number, close: number) => (s: string) => (color ? `\x1b[${open}m${s}\x1b[${close}m` : s);
  return { red: wrap(31, 39), yellow: wrap(33, 39), green: wrap(32, 39), dim: wrap(2, 22), bold: wrap(1, 22) };
}

export function formatReport(report: Report, options: { verbose: boolean; style: Style; width: number }): string {
  const { style, verbose } = options;
  const width = Math.max(40, Math.min(options.width, 100));
  const marks: Record<Severity, string> = {
    fail: style.red("✗"),
    warn: style.yellow("!"),
    info: style.dim("·"),
    pass: style.green("✓"),
  };

  const s = report.summary;
  const counts = [
    s.fail ? style.red(`${s.fail} fail`) : "",
    s.warn ? style.yellow(`${s.warn} warn`) : "",
    s.info ? `${s.info} info` : "",
    verbose && s.pass ? style.green(`${s.pass} pass`) : "",
  ].filter(Boolean);
  const lines = [`${style.bold(report.resolved)}  →  ${counts.length ? counts.join(" · ") : style.green("no problems found")}`];
  if (report.resolved !== normalizeForCompare(report.target)) lines.push(style.dim(`(redirected from ${report.target})`));

  for (const { layer, heading } of LAYERS) {
    const findings = report.findings
      .filter((f) => f.layer === layer && (verbose || f.severity !== "pass"))
      .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
    if (findings.length === 0) continue;
    lines.push("", style.bold(heading));
    for (const f of findings) lines.push(...formatFinding(f, marks[f.severity], { style, verbose, width }));
  }

  if (report.ignored.length) lines.push("", style.dim(`Ignored: ${report.ignored.join(", ")}`));

  lines.push(
    "",
    ...wrap(
      "Not checked from here: what's in users' browser caches, their open tabs, and their service workers. Run the agent skill on your repo to check the code that controls them.",
      width,
    ).map(style.dim),
  );
  return lines.join("\n");
}

function formatFinding(f: Finding, mark: string, options: { style: Style; verbose: boolean; width: number }): string[] {
  const { style, verbose, width } = options;
  const indent = "    ";
  const lines = [`  ${mark} ${f.title}`];
  if (f.severity === "pass" && !verbose) return lines;
  lines.push(...wrap(f.detail, width - indent.length).map((l) => indent + l));
  if (f.fix) lines.push(...wrap(`Fix: ${f.fix}`, width - indent.length).map((l) => indent + l));
  if (verbose) {
    for (const e of f.evidence) {
      const text =
        e.kind === "header"
          ? `${e.name}: ${e.value ?? "(missing)"}  ${shortUrl(e.url)}`
          : e.kind === "status"
            ? `${e.status}  ${shortUrl(e.url)}${e.request ? `  (${Object.entries(e.request).map(([k, v]) => `${k}: ${v}`).join(", ")})` : ""}`
            : e.kind === "computed"
              ? `${e.label}: ${e.value}`
              : `${e.path}${e.line ? `:${e.line}` : ""}`;
      lines.push(style.dim(`${indent}  ${text}`));
    }
  }
  lines.push(style.dim(`${indent}→ ${f.learnMore}`));
  return lines;
}

function shortUrl(url: string): string {
  const u = new URL(url);
  return u.pathname + u.search;
}

function normalizeForCompare(target: string): string {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `https://${target}`).href;
  } catch {
    return target;
  }
}

export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
