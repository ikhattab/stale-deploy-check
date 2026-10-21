/**
 * Name heuristics only: we never hash the bytes, so a "hash" is anything that looks like one.
 * A content hash mixes digits or letter cases ("3f9a1c", "BxK3a9Qz"); words don't ("bundle", "framework").
 */
const HASH_TOKEN = /^[A-Za-z0-9_-]{6,}$/;
// Allows a .chunk/.min/.bundle suffix after the hash, as in Create React App's main.8b1e07ab.chunk.js.
const NAME_HASH = /[.-]([A-Za-z0-9_-]{6,})(?:\.(?:chunk|min|bundle|module))*\.(?:m?js|css)$/;
const SEMVER = /\d+\.\d+\.\d+/;
const VERSION_PARAMS = new Set(["v", "ver", "version", "build", "rev", "hash", "t", "ts"]);

function looksLikeHash(token: string): boolean {
  return HASH_TOKEN.test(token) && (/\d/.test(token) || (/[a-z]/.test(token) && /[A-Z]/.test(token)));
}

/**
 * True when the URL changes whenever the content does: a hash in the file name or in a directory
 * (Next.js puts the build id in the path), or a semver like jquery-3.7.1.min.js.
 */
export function hasContentHash(assetUrl: string): boolean {
  const { pathname } = new URL(assetUrl);
  const segments = pathname.split("/").filter(Boolean);
  const file = segments.pop() ?? "";
  const named = NAME_HASH.exec(file)?.[1];
  if (named !== undefined && looksLikeHash(named)) return true;
  // Some bundlers name a chunk with nothing but the hash: 1omje2kalxx-o.css.
  const stem = file.replace(/(?:\.(?:chunk|min|bundle|module))*\.(?:m?js|css)$/, "");
  if (stem !== file && stem.length >= 8 && looksLikeHash(stem)) return true;
  if (SEMVER.test(file)) return true;
  return segments.some((segment) => segment.length >= 8 && looksLikeHash(segment));
}

/** The query parameter carrying a build number, like ?v=42, if there is one. */
export function versionParam(assetUrl: string): string | undefined {
  for (const [name, value] of new URL(assetUrl).searchParams) {
    if (VERSION_PARAMS.has(name.toLowerCase()) && value !== "") return `${name}=${value}`;
  }
  return undefined;
}
