import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "apps", "pwa", "dist");
const [html, manifestText, serviceWorker] = await Promise.all([
  readFile(join(dist, "index.html"), "utf8"),
  readFile(join(dist, "manifest.webmanifest"), "utf8"),
  readFile(join(dist, "sw.js"), "utf8"),
]);
const manifest = JSON.parse(manifestText);

assert.equal(manifest.name, "SmartFarm OS");
assert.equal(manifest.display, "standalone");
assert.equal(manifest.start_url, "/");
assert.equal(manifest.scope, "/");
assert.ok(html.includes('lang="ko"'));
assert.ok(html.includes('rel="manifest"'));
assert.ok(serviceWorker.includes('url.pathname.startsWith("/api/")'));

const expectedIcons = [
  ["/icon-192.png", "192x192", "any"],
  ["/icon-512.png", "512x512", "any"],
  ["/icon-maskable-512.png", "512x512", "maskable"],
];
for (const [src, sizes, purpose] of expectedIcons) {
  assert.ok(manifest.icons.some((icon) => (
    icon.src === src && icon.sizes === sizes && icon.purpose === purpose
  )));
  const iconStat = await stat(join(dist, src.slice(1)));
  assert.ok(iconStat.size > 0);
}

const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)]
  .map((match) => match[1]);
assert.ok(assetPaths.length >= 2);

const builtAssets = [];
for (const assetPath of assetPaths) {
  assert.ok(assetPath !== undefined);
  const contents = await readFile(join(dist, assetPath.slice(1)), "utf8");
  assert.ok(contents.length > 0);
  builtAssets.push(contents);
  assert.ok(serviceWorker.includes(JSON.stringify(assetPath)));
}

const browserBundle = builtAssets.join("\n");
assert.equal(browserBundle.includes("x-smartfarm-demo-key"), false);

process.stdout.write(
  "PWA build, manifest, icons, offline shell, assets, and browser credential boundary passed.\n",
);
