import type { RequestRecord } from "./types.ts";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type CheckErrorCode = "invalid-url" | "network" | "timeout" | "redirects" | "status" | "blocked" | "not-html";

/** The check itself couldn't run. The CLI exits 2 on this. */
export class CheckError extends Error {
  code: CheckErrorCode;
  constructor(code: CheckErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CheckError";
    this.code = code;
  }
}

const MAX_REDIRECTS = 10;

export interface RequestOptions {
  method: "GET" | "HEAD";
  headers?: Record<string, string>;
  conditional?: Record<string, string>;
  /** Read and return the body as text. Otherwise it's cancelled unread. */
  readBody?: boolean;
}

export interface Fetched {
  /** One record per hop; the last is the final response. */
  hops: RequestRecord[];
  final: RequestRecord;
  body?: string;
}

/** Makes requests and keeps a record of every one, so findings can point back at them. */
export class Recorder {
  readonly requests: RequestRecord[] = [];
  #fetch: FetchLike;
  #timeoutMs: number;
  #userAgent: string;
  #onRequest: ((record: RequestRecord) => void) | undefined;

  constructor(options: { fetch: FetchLike; timeoutMs: number; userAgent: string; onRequest?: (record: RequestRecord) => void }) {
    this.#fetch = options.fetch;
    this.#timeoutMs = options.timeoutMs;
    this.#userAgent = options.userAgent;
    this.#onRequest = options.onRequest;
  }

  async request(url: string, options: RequestOptions): Promise<Fetched> {
    const hops: RequestRecord[] = [];
    let current = url;
    for (;;) {
      const started = Date.now();
      let response: Response;
      try {
        response = await this.#fetch(current, {
          method: options.method,
          redirect: "manual",
          headers: { "user-agent": this.#userAgent, ...options.headers, ...options.conditional },
          signal: AbortSignal.timeout(this.#timeoutMs),
        });
      } catch (error) {
        const timedOut = error instanceof DOMException && error.name === "TimeoutError";
        throw new CheckError(
          timedOut ? "timeout" : "network",
          timedOut ? `${current} didn't respond within ${this.#timeoutMs} ms` : `couldn't reach ${current}: ${describe(error)}`,
          { cause: error },
        );
      }

      const location = response.headers.get("location");
      const redirected = response.status >= 300 && response.status < 400 && location !== null;
      const body = options.readBody && !redirected ? await response.text() : undefined;
      if (body === undefined) await response.body?.cancel();

      const record: RequestRecord = {
        method: options.method,
        url: current,
        status: response.status,
        headers: recordHeaders(response.headers),
        ...(options.conditional ? { conditional: options.conditional } : {}),
        ms: Date.now() - started,
      };
      hops.push(record);
      this.requests.push(record);
      this.#onRequest?.(record);

      if (!redirected) return { hops, final: record, ...(body !== undefined ? { body } : {}) };
      if (hops.length > MAX_REDIRECTS) throw new CheckError("redirects", `more than ${MAX_REDIRECTS} redirects starting at ${url}`);
      current = new URL(location, current).href;
    }
  }
}

function recordHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    // Reports get pasted into issues; session cookies shouldn't come along.
    out[name] = name === "set-cookie" ? "[redacted]" : value;
  });
  return out;
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? error.cause.message : undefined;
    return cause ? `${error.message} (${cause})` : error.message;
  }
  return String(error);
}
