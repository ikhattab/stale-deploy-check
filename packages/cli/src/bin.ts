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
  width: process.stdout.columns ?? 80,
});
process.exitCode = code;
