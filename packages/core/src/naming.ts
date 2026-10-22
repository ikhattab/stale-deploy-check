/**
 * Name heuristics only: we never hash the bytes, so a "hash" is anything that looks like one.
 * A content hash mixes digits or letter cases ("3f9a1c", "BxK3a9Qz"); words don't ("bundle", "framework").
 */
const HASH_TOKEN = /^[A-Za-z0-9_-]{6,}$/;
const EXTENSION = /\.(?:[cm]?js|css)$/;
const SEMVER = /\d+\.\d+\.\d+/;
// A word with a number that names a build target, not a build: es2015, v2.
const TARGET_NAME = /^(?:es|v)\d+$/i;
// A plain word between dashes means the token is a name like es2015-polyfills, not a hash.
const WORD = /^[a-z]{4,}$/;
const VERSION_PARAMS = new Set(["v", "ver", "version", "build", "rev", "hash", "t", "ts"]);

function looksLikeHash(token: string): boolean {
  if (!HASH_TOKEN.test(token) || TARGET_NAME.test(token)) return false;
  if (token.includes("-") && token.split("-").some((part) => WORD.test(part))) return false;
  return /\d/.test(token) || (/[a-z]/.test(token) && /[A-Z]/.test(token));
}

/**
 * The parts of a file name that could be a hash: every dot-separated part after the first
 * (app.3f9a1c.js, main.8b1e07ab.chunk.js, index.md.DNpnSOya.lean.js), whatever follows a dash
 * (index-BxKaQzWe.css, where the hash itself may contain a dash), and a name that is nothing
 * but the hash (1omje2kalxx-o.css).
 */
function hashCandidates(stem: string): string[] {
  const parts = stem.split(".");
  const candidates = parts.slice(1);
  for (const part of parts) {
    for (let i = part.indexOf("-"); i !== -1; i = part.indexOf("-", i + 1)) candidates.push(part.slice(i + 1));
  }
  if (parts.length === 1 && stem.length >= 8) candidates.push(stem);
  return candidates;
}

/**
 * True when the URL changes whenever the content does: a hash in the file name or in a directory
 * (Next.js puts the build id in the path), or a semver like jquery-3.7.1.min.js.
 */
export function hasContentHash(assetUrl: string): boolean {
  const { pathname } = new URL(assetUrl);
  const segments = pathname.split("/").filter(Boolean);
  const file = segments.pop() ?? "";
  if (SEMVER.test(file)) return true;
  const stem = file.replace(EXTENSION, "");
  if (stem !== file && hashCandidates(stem).some(looksLikeHash)) return true;
  return segments.some((segment) => segment.length >= 8 && looksLikeHash(segment));
}

/** The query parameter carrying a build number, like ?v=42, if there is one. */
export function versionParam(assetUrl: string): string | undefined {
  for (const [name, value] of new URL(assetUrl).searchParams) {
    if (VERSION_PARAMS.has(name.toLowerCase()) && value !== "") return `${name}=${value}`;
  }
  return undefined;
}
