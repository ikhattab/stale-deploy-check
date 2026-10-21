import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

export const SKILL_NAME = "stale-deploy-check";

export interface InstallOptions {
  /** The skill folder shipped with the CLI. */
  source: string;
  /** Install into ./.claude/skills of the current directory instead of the user's skills. */
  project: boolean;
  /** An explicit skills folder, overriding the two above. */
  dir?: string;
  /** Replace an installed copy that differs from this version. */
  force: boolean;
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type InstallResult =
  | { status: "installed" | "updated" | "unchanged"; target: string; files: string[] }
  | { status: "differs"; target: string; files: string[] };

/** Where Claude Code looks for skills: <config>/skills/<name>, or .claude/skills/<name> in a project. */
export function skillTarget(options: Pick<InstallOptions, "project" | "dir" | "cwd" | "env">): string {
  if (options.dir) return join(options.dir, SKILL_NAME);
  if (options.project) return join(options.cwd, ".claude", "skills", SKILL_NAME);
  const config = options.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(config, "skills", SKILL_NAME);
}

export async function installSkill(options: InstallOptions): Promise<InstallResult> {
  const target = skillTarget(options);
  const wanted = await readTree(options.source);
  const files = [...wanted.keys()].sort();
  const existing = await readTree(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });

  if (existing && sameTree(existing, wanted)) return { status: "unchanged", target, files };
  // A copy that differs may hold the user's own edits, so it's only replaced when asked.
  if (existing && !options.force) return { status: "differs", target, files };

  if (existing) await rm(target, { recursive: true });
  for (const file of files) {
    await mkdir(dirname(join(target, file)), { recursive: true });
    await copyFile(join(options.source, file), join(target, file));
  }
  return { status: existing ? "updated" : "installed", target, files };
}

async function readTree(root: string): Promise<Map<string, Buffer>> {
  const tree = new Map<string, Buffer>();
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) tree.set(relative(root, path), await readFile(path));
    }
  };
  await walk(root);
  return tree;
}

function sameTree(a: Map<string, Buffer>, b: Map<string, Buffer>): boolean {
  if (a.size !== b.size) return false;
  for (const [file, content] of a) {
    const other = b.get(file);
    if (!other || !other.equals(content)) return false;
  }
  return true;
}
