/**
 * Name heuristics only: we never hash the bytes, so a "hash" is anything that looks like one.
 * A content hash mixes digits or letter cases ("3f9a1c", "BxK3a9Qz"); words don't ("bundle", "framework").
 */
const HASH_TOKEN = /^[A-Za-z0-9_~-]{6,}$/;
const EXTENSION = /\.[A-Za-z0-9]{1,5}$/;
const SEMVER = /\d+\.\d+\.\d+/;
// A word with a number that names a build target, not a build: es2015, v2.
const TARGET_NAME = /^(?:es|v)\d+$/i;
// Words bundlers put between dashes in file names, which make a token a name like es2015-polyfills
// rather than a hash. Hashes have random letter runs too (017r-ibrf-le-), so only these count.
const BUILD_WORD = /^(?:polyfills?|vendors?|chunks?|runtime|main|app|index|framework|commons?|legacy|modern|bundle|styles?|webpack)$/i;
// People name directories, so any plain word in one means a name: wporg-parent-2021.
const PLAIN_WORD = /^[a-z]{4,}$/;
// Folders that frameworks fill only with content-hashed files, whatever the names look like.
const HASHED_DIRS = ["/_next/static/", "/_app/immutable/", "/_astro/"];
const VERSION_PARAMS = new Set(["v", "ver", "version", "build", "rev", "hash", "t", "ts"]);

function looksLikeHash(token: string, word = BUILD_WORD): boolean {
  if (!HASH_TOKEN.test(token) || TARGET_NAME.test(token)) return false;
  if (token.includes("-") && token.split("-").some((part) => word.test(part))) return false;
  return /\d/.test(token) || (/[a-z]/.test(token) && /[A-Z]/.test(token));
}

/**
 * The parts of a file name that could be a hash: every dot-separated part after the first
 * (app.3f9a1c.js, main.8b1e07ab.chunk.js, index.md.DNpnSOya.lean.js, Remix's global.@lQ7lA2.css),
 * whatever follows a dash (index-BxKaQzWe.css, where the hash itself may contain a dash), and a
 * name that is nothing but the hash (1omje2kalxx-o.css).
 */
function hashCandidates(stem: string): string[] {
  const parts = stem.split(".").map((part) => part.replace(/^@/, ""));
  const candidates = parts.slice(1);
  for (const part of parts) {
    for (let i = part.indexOf("-"); i !== -1; i = part.indexOf("-", i + 1)) candidates.push(part.slice(i + 1));
  }
  if (parts.length === 1 && stem.length >= 8) candidates.push(stem);
  return candidates;
}

/**
 * A content hash in the query: a version parameter holding one (Sphinx's ?v=b86133f3), or a query
 * that is nothing but the hash. A number or a version (?v=42, ?ver=24.2.0, ?ver=1781196442) is a
 * build number instead, and other parameters (?theme=darkMode) aren't about the content.
 */
function queryHash(searchParams: URLSearchParams): boolean {
  for (const [name, value] of searchParams) {
    const token = value === "" ? name : VERSION_PARAMS.has(name.toLowerCase()) ? value : "";
    if (/[A-Za-z]/.test(token) && looksLikeHash(token)) return true;
  }
  return false;
}

/**
 * True when the URL changes whenever the content does: a hash in the file name, a directory, or
 * the query (Next.js puts the build id in the path), a semver like jquery-3.7.1.min.js, or a
 * framework folder that only holds hashed files.
 */
export function hasContentHash(assetUrl: string): boolean {
  const { pathname, searchParams } = new URL(assetUrl);
  if (HASHED_DIRS.some((dir) => pathname.includes(dir))) return true;
  const segments = pathname.split("/").filter(Boolean);
  const file = segments.pop() ?? "";
  if (SEMVER.test(file)) return true;
  const stem = file.replace(EXTENSION, "");
  if (stem !== file && hashCandidates(stem).some((candidate) => looksLikeHash(candidate))) return true;
  if (queryHash(searchParams)) return true;
  return segments.some((segment) => segment.length >= 8 && looksLikeHash(segment, PLAIN_WORD));
}

/** The query parameter carrying a build number, like ?v=42, if there is one. */
export function versionParam(assetUrl: string): string | undefined {
  for (const [name, value] of new URL(assetUrl).searchParams) {
    if (VERSION_PARAMS.has(name.toLowerCase()) && value !== "") return `${name}=${value}`;
  }
  return undefined;
}

/**
 * A URL for a file that doesn't exist, shaped like a real hashed one: same folder, extension and
 * pattern of letters, digits and separators, so the site's rules for hashed files match it too.
 * Letters are rotated by 13 and digits by 5 (app.3f9a1c.js becomes ncc.8s4n6p.js).
 */
export function missingTwin(assetUrl: string): string {
  const url = new URL(assetUrl);
  url.search = "";
  const slash = url.pathname.lastIndexOf("/") + 1;
  const file = url.pathname.slice(slash);
  const extension = EXTENSION.exec(file)?.[0] ?? "";
  const stem = file.slice(0, file.length - extension.length).replace(/[A-Za-z0-9]/g, (c) => {
    if (/\d/.test(c)) return String((Number(c) + 5) % 10);
    const a = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - a + 13) % 26) + a);
  });
  url.pathname = url.pathname.slice(0, slash) + stem + extension;
  return url.href;
}
