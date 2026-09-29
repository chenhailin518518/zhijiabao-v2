/*
  智价宝 - Service Worker
  策略：HTML 走「网络优先」，保证内容更新即时生效；静态资源走「缓存优先」，弱网/离线可打开。
  接口请求（/api/）一律不缓存，避免读到过期数据。
*/
const VERSION = "20260929a";
const CACHE = `zhijiabao-static-${VERSION}`;
const PRECACHE = [
  "./",
  "index.html",
  "estimate/",
  "compare/",
  "market/",
  "profile/",
  "styles.css",
  "site-data.js",
  "pricing.js",
  "api-services.js",
  "store.js",
  "script.js",
  "app-core.js",
  "app-account.js",
  "manifest.webmanifest",
  "assets/img/favicon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => null)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes("/api/")) return;

  const isHTML = request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html");
  if (isHTML) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => null);
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match("index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => null);
        }
        return response;
      });
    })
  );
});
