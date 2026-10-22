import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

test("the skill's copy of the findings format matches docs/findings.md", async () => {
  assert.equal(await read("skills/stale-deploy-check/references/findings-format.md"), await read("docs/findings.md"));
});

test("every CLI check id is documented in docs/checks.md", async () => {
  const checks = await read("docs/checks.md");
  const dir = new URL("packages/core/src/checks/", root);
  for (const file of await readdir(dir)) {
    const source = await readFile(new URL(file, dir), "utf8");
    for (const [, id] of source.matchAll(/check: "([a-z.-]+)"/g)) assert.ok(checks.includes(`\`${id}\``), `${id} (${file}) is missing from docs/checks.md`);
  }
});

test("every skill check id is in docs/checks.md", async () => {
  const checks = await read("docs/checks.md");
  const skill = await read("skills/stale-deploy-check/references/code-checks.md");
  const ids = [...skill.matchAll(/^## (code\.[a-z-]+)$/gm)].map((m) => m[1]!);
  assert.ok(ids.length > 0);
  for (const id of ids) assert.ok(checks.includes(`\`${id}\``), `${id} is missing from docs/checks.md`);
});
