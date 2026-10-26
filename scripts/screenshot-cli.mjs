// Renders the README's CLI screenshots: docs/images/cli-report-light.png and cli-report-dark.png.
// Runs the CLI from source against the test server's /bad/ page, shows its URL as https://example.com/,
// draws the colored output in a terminal window, and screenshots it at 2x with headless Chrome.
// Needs Chrome (set CHROME to its path if it isn't found), and ImageMagick to shrink the PNGs if it's there.
// Run with npm run screenshot:cli.
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { startServer } from "../packages/core/test/server.ts";
import { main } from "../packages/cli/src/main.ts";

const SHOWN_AS = "https://example.com/";

const THEMES = {
  light: { bg: "#ffffff", border: "#d0d7de", fg: "#1f2328", dim: "#6e7781", red: "#cf222e", yellow: "#9a6700", green: "#1a7f37", cyan: "#0969da", shadow: ".08" },
  dark: { bg: "#0d1117", win: "#161b22", border: "#30363d", fg: "#e6edf3", dim: "#7d8590", red: "#ff7b72", yellow: "#e3b341", green: "#3fb950", cyan: "#79c0ff", shadow: ".5" },
};

// What a person sees at an 80-column terminal that renders OSC 8 links, on macOS.
const server = await startServer();
let ansi = "";
try {
  const url = server.url("/bad/");
  await main([url], { stdout: (s) => (ansi += s), stderr: () => {}, color: true, width: 80, interactive: true, hyperlinks: true, clipboard: "pbcopy" });
  ansi = ansi.replaceAll(url, SHOWN_AS).replaceAll(server.url(""), SHOWN_AS.slice(0, -1)).trimEnd();
} finally {
  await server.close();
}

const work = mkdtempSync(join(tmpdir(), "screenshot-cli-"));
const chrome = spawn(findChrome(), ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${work}/profile`, "about:blank"], { stdio: "ignore" });
try {
  const send = await connect(9333);
  for (const [name, theme] of Object.entries(THEMES)) {
    const html = join(work, `${name}.html`);
    writeFileSync(html, page(ansi, theme));
    await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 3000, deviceScaleFactor: 2, mobile: false });
    await send("Page.navigate", { url: `file://${html}` });
    await new Promise((r) => setTimeout(r, 800));
    const { result } = await send("Runtime.evaluate", { expression: "JSON.stringify(document.querySelector('.wrap').getBoundingClientRect())", returnByValue: true });
    const box = JSON.parse(result.value);
    const { data } = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: Math.ceil(box.width), height: Math.ceil(box.height), scale: 1 } });
    const out = resolve(`docs/images/cli-report-${name}.png`);
    writeFileSync(out, Buffer.from(data, "base64"));
    shrink(out);
    console.log(`docs/images/cli-report-${name}.png`);
  }
} finally {
  // Chrome writes to its profile until it exits.
  await new Promise((r) => (chrome.once("exit", r), chrome.kill()));
  rmSync(work, { recursive: true, force: true });
}

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const candidates = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "google-chrome", "chromium", "chromium-browser"];
  for (const c of candidates) {
    try {
      execFileSync(c, ["--version"], { stdio: "ignore" });
      return c;
    } catch {}
  }
  throw new Error("Chrome not found. Set CHROME to its path.");
}

async function connect(port) {
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {}
  }
  if (!targets) throw new Error("Chrome didn't open its DevTools port");
  const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    pending.get(m.id)?.(m.result);
  });
  return (method, params = {}) => new Promise((r) => (pending.set(++id, r), ws.send(JSON.stringify({ id, method, params }))));
}

// 256 colors is plenty for text, and about a third of the size. Without ImageMagick, the PNG stays as Chrome wrote it.
function shrink(file) {
  try {
    execFileSync("magick", [file, "-strip", "-dither", "None", "-colors", "256", "-define", "png:compression-level=9", `PNG8:${file}`], { stdio: "ignore" });
  } catch {}
}

/** The report in a terminal window: SGR colors and OSC 8 links turned into styled spans. */
function page(ansi, t) {
  const escape = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const colors = { 31: "red", 32: "green", 33: "yellow", 36: "cyan" };
  const state = { bold: false, dim: false, color: null, link: false };
  const css = () =>
    [
      state.color ? `color:${t[state.color]}` : state.dim ? `color:${t.dim}` : "",
      state.bold ? "font-weight:600" : "",
      state.link ? "text-decoration:underline;text-underline-offset:2px" : "",
    ].filter(Boolean).join(";");
  let body = "";
  let last = 0;
  const emit = (text) => {
    if (text) body += `<span style="${css()}">${escape(text)}</span>`;
  };
  for (const m of ansi.matchAll(/\x1b\[(\d+)m|\x1b\]8;;(.*?)\x1b\\/g)) {
    emit(ansi.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1] === undefined) state.link = Boolean(m[2]);
    else if (m[1] === "1") state.bold = true;
    else if (m[1] === "2") state.dim = true;
    else if (m[1] === "22") state.bold = state.dim = false;
    else if (m[1] === "39") state.color = null;
    else if (colors[m[1]]) state.color = colors[m[1]];
  }
  emit(ansi.slice(last));
  const prompt = `<span style="color:${t.dim}">$</span> npx stale-deploy-check ${SHOWN_AS}\n\n`;
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:${t.bg}}
.wrap{padding:28px;display:inline-block}
.win{background:${t.win ?? t.bg};border:1px solid ${t.border};border-radius:10px;overflow:hidden;box-shadow:0 8px 24px rgba(0,0,0,${t.shadow})}
.bar{height:34px;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid ${t.border}}
.bar i{width:12px;height:12px;border-radius:50%;display:block}
pre{margin:0;padding:18px 22px 22px;font:13px/1.55 "SF Mono",Menlo,monospace;color:${t.fg};white-space:pre}
</style><div class="wrap"><div class="win"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div><pre>${prompt}${body}</pre></div></div>`;
}
