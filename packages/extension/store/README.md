# Chrome Web Store listing

Published at https://chromewebstore.google.com/detail/stale-deploy-check/bcibhjoeiphifeicebippfihloijnanm.

Everything the developer dashboard asks for, ready to paste. Upload `packages/extension/dist/stale-deploy-check-extension-<version>.zip` from `npm run package:extension`.

## Store listing

**Name:** stale-deploy-check

**Summary** (the manifest's `description`, 132 characters at most):

> Is this tab on the old version after a deploy, and why? Checks its build, its HTML, its service worker and its files.

**Category:** Developer Tools · **Language:** English

**Description:**

> You deployed, but a tab still shows the old version. Click the button on that tab to find out why.
>
> stale-deploy-check looks at the tab from inside the browser:
>
> • Its build: it compares the tab's build id (or, without one, the files it loaded) with what the server sends now.
> • Where its HTML came from: the network, the browser cache, a 304, or a service worker.
> • The service worker: whether one controls the tab, whether a new one is waiting to take over, and whether its cache holds an old copy of the page.
> • The files the tab loaded: whether the deploy deleted them, which leaves an open tab one click away from a blank screen.
>
> When it finds a problem, it says which layer kept the old version, shows the evidence, and suggests the fix, with a link to the article section that explains it. "Copy prompt to fix" copies a prompt for your coding agent with everything it needs to fix it in your repo.
>
> It only runs when you click it, and only on that tab. It reads the tab, requests that page and its files from the site, and shows the result. Nothing is sent anywhere else, and nothing is stored.
>
> Built on the article "We Deployed an Hour Ago. Why Do Users Still See the Old Version?": https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/
> The same checks run from the command line and in CI: https://github.com/ikhattab/stale-deploy-check

**Images:**

| Field | File |
| --- | --- |
| Store icon (128×128) | `../static/icons/icon-128.png` |
| Screenshots (1280×800) | `screenshot-1-service-worker.png`, `screenshot-2-browser-cache.png`, `screenshot-3-healthy.png` |
| Small promo tile (440×280) | `promo-tile-440x280.png` |

**Homepage URL:** https://github.com/ikhattab/stale-deploy-check · **Support URL:** https://github.com/ikhattab/stale-deploy-check/issues

## Privacy

**Single purpose:**

> Shows whether the current tab is running an old version of its site after a deploy, and why.

**Permission justifications:**

- `activeTab`: Only when the user clicks the toolbar button, to read that tab's URL and to request that page and its files from the same site, to compare them with what the tab loaded.
- `scripting`: To run a read-only script in that tab, which reads its build id, Navigation Timing, service worker registration, and Cache Storage. It changes nothing on the page.

**Host permissions:** none. **Remote code:** No. All code is in the package.

**Data usage:** it doesn't collect any of the listed kinds of user data. It reads the page in the tab it was clicked on and sends requests only to that page's own site, from the user's browser. Nothing is sent to the developer or anyone else, and nothing is stored. Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** not required when no user data is collected. If the dashboard asks anyway, link the Privacy section of the README.

## How the images were made

- `icon.svg` is the source for every icon. The 128 px store icon keeps Chrome's 16 px of clear space; the 16, 32 and 48 px toolbar icons are rendered from the same SVG with `viewBox="8 8 112 112"`, so they fill their square. A test checks each PNG's size against the manifest.
- The screenshots show the real popup: the extension, run in Chromium against a local site that simulates deploys (`app.localhost`), and against ihabkhattab.com for the healthy one. Each popup is rendered at 448 px wide, as tall as its content up to Chrome's 600 px, at 2x, and placed on a 1280×800 card with the site's fonts.
