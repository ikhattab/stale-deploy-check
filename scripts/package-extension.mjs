// Zips the built extension for the Chrome Web Store: packages/extension/dist/stale-deploy-check-extension-<version>.zip.
// Run npm run build first; npm run package:extension does both.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";

const dir = "packages/extension/dist/chrome";
const { version } = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8"));
const zip = `stale-deploy-check-extension-${version}.zip`;
rmSync(`packages/extension/dist/${zip}`, { force: true });
// From inside the folder, so manifest.json is at the zip's root, as the store requires.
execFileSync("zip", ["-qrX", `../${zip}`, "."], { cwd: dir, stdio: "inherit" });
if (!existsSync(`packages/extension/dist/${zip}`)) throw new Error(`${zip} wasn't written`);
console.log(`packages/extension/dist/${zip}`);
