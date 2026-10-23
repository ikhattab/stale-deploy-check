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

/** The article's heading for each link, for places that can show a label and keep the URL behind it. */
export const learnTitles: Record<string, string> = {
  [learn.heuristic]: "Question 2: No Cache Header Means No Caching, Right?",
  [learn.headers]: "Question 3: Then Turn Caching Off",
  [learn.hashing]: "Question 4: Why Put a Hash in the Name?",
  [learn.cdn]: "Question 5: Some Users Still Get It for an Hour",
  [learn.openTab]: "Question 6: A Blank Screen With No Cache Involved",
  [learn.serviceWorker]: "Question 7: Now Add a Service Worker",
  [learn.proveIt]: "Question 8: Prove It",
};
