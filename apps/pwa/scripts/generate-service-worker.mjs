import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "dist");
const html = await readFile(join(dist, "index.html"), "utf8");
const builtAssets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)]
  .map((match) => match[1])
  .filter((value) => value !== undefined);
const appShell = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  ...builtAssets,
];

for (const path of appShell.filter((value) => value !== "/")) {
  const entry = await stat(join(dist, path.slice(1)));
  if (!entry.isFile() || entry.size === 0) {
    throw new Error(`PWA app-shell asset is missing or empty: ${path}`);
  }
}

const fingerprint = createHash("sha256")
  .update(appShell.join("\n"))
  .digest("hex")
  .slice(0, 12);
const source = `const CACHE_NAME = "smartfarm-shell-${fingerprint}";
const APP_SHELL = ${JSON.stringify(appShell, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached !== undefined) return cached;
        if (request.mode === "navigate") return (await caches.match("/")) ?? Response.error();
        return Response.error();
      }),
  );
});
`;

await writeFile(join(dist, "sw.js"), source, "utf8");
process.stdout.write(`Generated offline app shell with ${appShell.length} precached URLs.\n`);
