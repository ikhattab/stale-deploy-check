// Uploads the packaged extension to the Chrome Web Store and submits it for review, with the store's V2 API.
//
//   node scripts/publish-extension.mjs packages/extension/dist/stale-deploy-check-extension-<version>.zip
//
// Needs CWS_ACCESS_TOKEN (scope https://www.googleapis.com/auth/chromewebstore), CWS_PUBLISHER_ID and
// CWS_EXTENSION_ID. release.yml gets the token through workload identity federation, so no key is stored
// anywhere; docs/releasing.md has the one-time setup. The store rejects an upload whose manifest version
// isn't higher than the last one, so a release can only be uploaded once.
import { appendFileSync, readFileSync } from "node:fs";

const API = process.env.CWS_API ?? "https://chromewebstore.googleapis.com";
const POLL_MS = Number(process.env.CWS_POLL_MS ?? 10_000);
const POLLS = 30;

const zip = process.argv[2];
if (!zip) fail("Usage: node scripts/publish-extension.mjs <extension.zip>");
const token = env("CWS_ACCESS_TOKEN");
const item = `publishers/${env("CWS_PUBLISHER_ID")}/items/${env("CWS_EXTENSION_ID")}`;
const { version } = JSON.parse(readFileSync("packages/extension/dist/chrome/manifest.json", "utf8"));

const upload = await call("POST", `${API}/upload/v2/${item}:upload`, readFileSync(zip));
let uploadState = upload.uploadState;
for (let i = 0; uploadState === "IN_PROGRESS" && i < POLLS; i++) {
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  uploadState = (await call("GET", `${API}/v2/${item}:fetchStatus`)).lastAsyncUploadState;
}
if (uploadState !== "SUCCEEDED") fail(`The upload ended in ${uploadState ?? "no state"}, not SUCCEEDED.`);
// The store reads the version from the zip's manifest, but only says so when the upload finished right away.
// fetchStatus can't stand in: its versions are the submitted and published revisions, not this upload.
if (upload.crxVersion && upload.crxVersion !== version) fail(`The store read version ${upload.crxVersion} from the upload, but the manifest says ${version}.`);
console.log(`Uploaded ${zip}, version ${version}.`);

const published = await call("POST", `${API}/v2/${item}:publish`, JSON.stringify({}));
const warnings = (published.warningInfo?.warnings ?? []).map((w) => `${w.reason}: ${w.description}`);
for (const warning of warnings) console.log(`Warning: ${warning}`);
if (published.state === "REJECTED" || published.state === "CANCELLED") fail(`The submission was ${published.state}.`);
console.log(`Submitted version ${version} for review: ${published.state}.`);
summary([`Chrome Web Store: version ${version} submitted, ${published.state}.`, ...warnings.map((w) => `- ${w}`)].join("\n"));

async function call(method, url, body) {
  const headers = { authorization: `Bearer ${token}`, ...(typeof body === "string" ? { "content-type": "application/json" } : {}) };
  const response = await fetch(url, { method, headers, ...(body !== undefined ? { body } : {}) });
  const text = await response.text();
  if (!response.ok) fail(`${method} ${url.replace(API, "")} returned ${response.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

function env(name) {
  const value = process.env[name];
  if (!value) fail(`${name} isn't set.`);
  return value;
}

function summary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
