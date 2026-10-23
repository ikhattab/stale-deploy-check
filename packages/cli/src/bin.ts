#!/usr/bin/env node
import { main } from "./main.ts";

// Piping into something that exits early (`| head`) closes stdout. That's the reader's choice, not a crash.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code !== "EPIPE") throw error;
  process.exit(process.exitCode ?? 0);
});

const code = await main(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
  // A pseudo-terminal can report 0 columns.
  width: process.stdout.columns || 80,
  progress: Boolean(process.stderr.isTTY) && !process.env.CI,
  interactive: Boolean(process.stdout.isTTY) && !process.env.CI,
  hyperlinks: Boolean(process.stdout.isTTY) && supportsHyperlinks(process.env),
  clipboard: clipboardCommand(),
});
process.exitCode = code;

// A terminal without OSC 8 shows the label and drops the URL, so only the ones known to render it get links.
function supportsHyperlinks(env: NodeJS.ProcessEnv): boolean {
  if (env.FORCE_HYPERLINK !== undefined) return env.FORCE_HYPERLINK !== "0";
  if (env.CI || env.TERM === "dumb") return false;
  if (["ghostty", "WezTerm", "vscode"].includes(env.TERM_PROGRAM ?? "")) return true;
  if (env.TERM_PROGRAM === "iTerm.app") return Number(env.TERM_PROGRAM_VERSION?.split(".")[0]) >= 3;
  if (env.WT_SESSION || env.KITTY_WINDOW_ID) return true;
  if (["xterm-ghostty", "xterm-kitty", "alacritty"].includes(env.TERM ?? "")) return true;
  return Number(env.VTE_VERSION) >= 5000;
}

function clipboardCommand(): string | undefined {
  if (process.platform === "darwin") return "pbcopy";
  if (process.platform === "win32") return "clip";
  if (process.env.WAYLAND_DISPLAY) return "wl-copy";
  if (process.env.DISPLAY) return "xclip -selection clipboard";
  return undefined;
}
