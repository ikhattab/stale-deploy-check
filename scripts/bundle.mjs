// Bundles the CLI and core (with htmlparser2) into one file, so the published package has no dependencies,
// the browser probe into a console snippet, and the browser extension.
import { cpSync } from "node:fs";
import { build } from "esbuild";

await build({
  entryPoints: ["packages/cli/src/bin.ts"],
  outfile: "packages/cli/dist/stale-deploy-check.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // Resolve @stale-deploy-check/core to its TypeScript source instead of a separate build.
  conditions: ["source"],
  legalComments: "inline",
  logLevel: "warning",
});

// One script to paste into the DevTools console. Core's HTML parser isn't used in the browser, so it's left out.
await build({
  entryPoints: ["packages/probe/src/snippet.ts"],
  outfile: "packages/probe/dist/stale-deploy-check.snippet.js",
  bundle: true,
  minify: true,
  platform: "browser",
  format: "iife",
  target: "chrome110",
  conditions: ["source"],
  legalComments: "none",
  logLevel: "warning",
});

// The extension, ready to load unpacked or zip for the store: the popup, the script it injects into the tab,
// and the static files. Not minified, so a store reviewer can read it.
await build({
  entryPoints: { popup: "packages/extension/src/popup.ts", collect: "packages/extension/src/collect.ts" },
  outdir: "packages/extension/dist/chrome",
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome116",
  conditions: ["source"],
  legalComments: "none",
  logLevel: "warning",
});
cpSync("packages/extension/static", "packages/extension/dist/chrome", { recursive: true });
