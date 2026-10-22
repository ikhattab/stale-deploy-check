import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../../../", import.meta.url);
const json = async (path: string) => JSON.parse(await readFile(new URL(path, root), "utf8"));

test("the manifest's version is the release's", async () => {
  const manifest = await json("packages/extension/static/manifest.json");
  assert.equal(manifest.version, (await json("packages/cli/package.json")).version);
  assert.equal(manifest.version, (await json("packages/extension/package.json")).version);
});

test("the extension asks for activeTab and scripting, and nothing else", async () => {
  const manifest = await json("packages/extension/static/manifest.json");
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting"]);
  for (const key of ["host_permissions", "optional_host_permissions", "content_scripts", "background"]) assert.equal(manifest[key], undefined, key);
});

test("the popup loads only files the build writes", async () => {
  const html = await readFile(new URL("packages/extension/static/popup.html", root), "utf8");
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(refs.sort(), ["popup.css", "popup.js"]);
});
