import { Parser } from "htmlparser2";

export interface ParsedPage {
  /** Absolute URLs of scripts and stylesheets, in document order, deduplicated. */
  assets: string[];
  /** A build or version id from a <meta> tag, if the page has one. */
  buildId?: { name: string; content: string };
  /** How we know the page registers a service worker, if we can tell from the HTML. */
  serviceWorker?: string;
}

const BUILD_META = /^(build|version|release|commit|app[-_]?version|build[-_]?(id|version))$/i;
/** Registration helpers that bundlers and PWA plugins emit, like vite-plugin-pwa's registerSW.js. Matches the start of the file name only. */
const SW_SCRIPT_NAME = /(?:^|\/)(?:register-?sw|sw-?register|register-?service-?worker)\b[^/]*\.m?js(?:\?|$)/i;

export function parsePage(html: string, pageUrl: string): ParsedPage {
  let base: string | undefined;
  const raw: string[] = [];
  const page: ParsedPage = { assets: [] };
  let inlineScript: string | undefined;

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        // Only the first <base href> counts.
        if (name === "base" && attrs.href !== undefined && base === undefined) {
          base = resolve(attrs.href, pageUrl) ?? pageUrl;
        } else if (name === "script") {
          if (attrs.src) {
            raw.push(attrs.src);
            if (!page.serviceWorker && SW_SCRIPT_NAME.test(attrs.src)) page.serviceWorker = `<script src="${attrs.src}">`;
          } else {
            inlineScript = "";
          }
        } else if (name === "link" && attrs.href) {
          const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/);
          const as = (attrs.as ?? "").toLowerCase();
          if (rel.includes("stylesheet") || rel.includes("modulepreload") || (rel.includes("preload") && (as === "script" || as === "style"))) {
            raw.push(attrs.href);
          }
        } else if (name === "meta" && attrs.name && attrs.content && !page.buildId && BUILD_META.test(attrs.name)) {
          // It ends up in a title; a build id longer than this isn't one.
          page.buildId = { name: attrs.name, content: attrs.content.slice(0, 100) };
        }
      },
      ontext(text) {
        if (inlineScript !== undefined) inlineScript += text;
      },
      onclosetag(name) {
        if (name === "script" && inlineScript !== undefined) {
          if (!page.serviceWorker && /serviceWorker\s*\.\s*register\s*\(/.test(inlineScript)) {
            page.serviceWorker = "an inline script calls navigator.serviceWorker.register()";
          }
          inlineScript = undefined;
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();

  const seen = new Set<string>();
  for (const href of raw) {
    const url = resolve(href, base ?? pageUrl);
    if (url && !seen.has(url)) {
      seen.add(url);
      page.assets.push(url);
    }
  }
  return page;
}

function resolve(href: string, base: string): string | undefined {
  try {
    const url = new URL(href, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}
