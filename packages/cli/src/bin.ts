#!/usr/bin/env node
import { main } from "./main.ts";

const code = await main(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR,
  width: process.stdout.columns ?? 80,
});
process.exitCode = code;
