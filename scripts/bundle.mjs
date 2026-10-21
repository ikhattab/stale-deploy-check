// Bundles the CLI and core (with htmlparser2) into one file, so the published package has no dependencies,
// and ships the agent skill next to it for `stale-deploy-check install-skill`.
import { cpSync, rmSync } from "node:fs";
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

rmSync("packages/cli/dist/skill", { recursive: true, force: true });
cpSync("skill/stale-deploy-check", "packages/cli/dist/skill", { recursive: true });
