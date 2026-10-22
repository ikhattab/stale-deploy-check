// C0 and C1 controls (newlines included) and bidi overrides. Headers, URLs and <meta> content come from the
// checked site, and an escape sequence in them would otherwise reach the user's terminal, or start a new line
// in a prompt for a coding agent.
const UNSAFE = /[\x00-\x08\x0a-\x1f\x7f-\x9f‪-‮⁦-⁩]/g;

export function clean(text: string): string {
  return text.replace(UNSAFE, "?");
}

/** Quotes a word for a POSIX shell when it needs it. */
export function shellQuote(word: string): string {
  return /^[\w@%+=:,./~-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}
