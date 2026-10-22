// Injected into the tab by the popup, in the extension's isolated world, so the page's own scripts can't change
// what it reads. It makes no requests; the popup calls the function it leaves behind.
import { collect } from "@stale-deploy-check/probe";

(globalThis as { staleDeployCheckCollect?: typeof collect }).staleDeployCheckCollect = collect;
