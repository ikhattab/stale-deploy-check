import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { check, CheckError, VERSION, type CheckOptions, type Report } from "@stale-deploy-check/core";
import { formatReport, makeStyle } from "./format.ts";

const HELP = `Usage: stale-deploy-check <url> [options]

Checks why users might still see the old version of a page after a deploy:
the HTML's cache headers, hashed asset names, and the CDN in front of it.

Options:
  --json                 Print the report as JSON instead of text
  --out <file>           Also write the JSON report to a file (use it as the next --baseline)
  --baseline <file>      A previous report: check that its old assets still load
  --strict               Exit 1 on warnings too, not just failures
  --ignore <check-id>    Drop a finding by id (repeatable)
  --asset-origin <url>   Another origin that serves this site's files, like an
                         asset domain or CDN (repeatable). Subdomains of the
                         page's host are always checked.
  --html-max-age <s>     Seconds the HTML may be reused without asking before it fails (default 300)
  --edge-max-age <s>     Seconds a CDN may keep the HTML before it warns (default 300)
  --max-assets <n>       How many scripts and stylesheets to check (default 20)
  --timeout <ms>         Per-request timeout (default 10000)
  --verbose              Show passing checks and the evidence for each finding
  --no-color             Plain output
  -h, --help             Show this help
  -v, --version          Show the version

Exit codes: 0 no failures, 1 failures found, 2 the check couldn't run.
`;

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  color: boolean;
  width: number;
  fetch?: CheckOptions["fetch"];
}

/** Runs the CLI and returns the exit code. */
export async function main(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: "boolean", default: false },
        out: { type: "string" },
        baseline: { type: "string" },
        strict: { type: "boolean", default: false },
        ignore: { type: "string", multiple: true, default: [] },
        "asset-origin": { type: "string", multiple: true, default: [] },
        "html-max-age": { type: "string" },
        "edge-max-age": { type: "string" },
        "max-assets": { type: "string" },
        timeout: { type: "string" },
        verbose: { type: "boolean", default: false },
        "no-color": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parsed;

  if (values.help) {
    io.stdout(HELP);
    return 0;
  }
  if (values.version) {
    io.stdout(`${VERSION}\n`);
    return 0;
  }
  if (positionals.length !== 1) {
    io.stderr(`${positionals.length === 0 ? "Missing the URL to check." : "Pass one URL at a time."}\n\n${HELP}`);
    return 2;
  }
  const target = positionals[0]!;

  let options: CheckOptions;
  try {
    options = {
      ignore: values.ignore,
      assetOrigins: values["asset-origin"],
      thresholds: {
        ...optionalInt(values["html-max-age"], "--html-max-age", (n) => ({ htmlMaxAge: n })),
        ...optionalInt(values["edge-max-age"], "--edge-max-age", (n) => ({ edgeMaxAge: n })),
      },
      ...optionalInt(values["max-assets"], "--max-assets", (n) => ({ maxAssets: n })),
      ...optionalInt(values.timeout, "--timeout", (n) => ({ timeoutMs: n })),
      ...(values.baseline ? { baseline: await readBaseline(values.baseline) } : {}),
      ...(io.fetch ? { fetch: io.fetch } : {}),
    };
  } catch (error) {
    io.stderr(`${(error as Error).message}\n`);
    return 2;
  }

  let report: Report;
  try {
    report = await check(target, options);
  } catch (error) {
    if (error instanceof CheckError) {
      io.stderr(`Couldn't check ${target}: ${error.message}\n`);
      return 2;
    }
    throw error;
  }

  if (values.out) await writeFile(values.out, `${JSON.stringify(report, null, 2)}\n`);
  if (values.json) {
    io.stdout(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const style = makeStyle(io.color && !values["no-color"]);
    io.stdout(`${formatReport(report, { verbose: values.verbose, style, width: io.width })}\n`);
  }

  const failing = report.summary.fail + (values.strict ? report.summary.warn : 0);
  return failing > 0 ? 1 : 0;
}

function optionalInt<T>(raw: string | undefined, flag: string, wrapValue: (n: number) => T): T | Record<string, never> {
  if (raw === undefined) return {};
  if (!/^\d+$/.test(raw)) throw new Error(`${flag} needs a whole number, got "${raw}"`);
  return wrapValue(Number(raw));
}

async function readBaseline(path: string): Promise<Pick<Report, "assets">> {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Couldn't read the baseline report ${path}: ${(error as Error).message}`);
  }
  const assets = (data as Partial<Report> | null)?.assets;
  if (!Array.isArray(assets) || !assets.every((a) => typeof a === "string")) {
    throw new Error(`${path} isn't a stale-deploy-check report (no "assets" list). Create one with --out.`);
  }
  return { assets };
}
