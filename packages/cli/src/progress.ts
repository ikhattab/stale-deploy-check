import type { RequestRecord } from "@stale-deploy-check/core";
import { clean } from "./format.ts";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Progress {
  request(record: RequestRecord): void;
  /** Clears the line, so the report starts on a clean one. */
  stop(): void;
}

/** One line on a terminal that redraws itself: a spinner, the request count, and the latest request. */
export function startProgress(write: (s: string) => void, options: { target: string; width: number; color: boolean }): Progress {
  const dim = (s: string) => (options.color ? `\x1b[2m${s}\x1b[22m` : s);
  let frame = 0;
  let count = 0;
  let latest = "";
  const draw = () => {
    const head = `${FRAMES[frame++ % FRAMES.length]} Checking ${options.target}`;
    const tail = count ? ` · ${count} request${count === 1 ? "" : "s"}${latest ? ` · ${latest}` : ""}` : "";
    // Never wider than the terminal, or the next redraw lands on a new line instead of over this one.
    const room = Math.max(0, options.width - 1 - head.length);
    write(`\r\x1b[2K${head}${dim(truncate(tail, room))}`);
  };
  draw();
  const timer = setInterval(draw, 80);
  timer.unref();
  return {
    request(record) {
      count++;
      const url = new URL(record.url);
      latest = clean(`${record.method} ${url.pathname}${url.search} ${record.status}`);
    },
    stop() {
      clearInterval(timer);
      write("\r\x1b[2K");
    },
  };
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text;
  return width <= 1 ? "" : `${text.slice(0, width - 1)}…`;
}
