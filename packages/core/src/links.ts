export const ARTICLE = "https://ihabkhattab.com/blog/deployed-but-users-see-the-old-version/";

export const learn = {
  heuristic: `${ARTICLE}#question-2-no-cache-header-means-no-caching-right`,
  headers: `${ARTICLE}#question-3-then-turn-caching-off`,
  hashing: `${ARTICLE}#question-4-why-put-a-hash-in-the-name`,
  cdn: `${ARTICLE}#question-5-some-users-still-get-it-for-an-hour`,
  openTab: `${ARTICLE}#question-6-a-blank-screen-with-no-cache-involved`,
  serviceWorker: `${ARTICLE}#question-7-now-add-a-service-worker`,
  proveIt: `${ARTICLE}#question-8-prove-it`,
} as const;
