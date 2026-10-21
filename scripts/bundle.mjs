// Bundles the CLI and core (with htmlparser2) into one file, so the published package has no dependencies.
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
