import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { inspectCloudPilotPackage } from "./verify-cloud-pilot-package.mjs";

test("cloud-pilot package keeps packaging constraints intact", async () => {
  const issues = await inspectCloudPilotPackage();
  assert.deepEqual(issues, []);
});

test("cloud-pilot package rejects Basic Auth outside the protected fallback handle", async () => {
  const root = await mkdtemp(join(tmpdir(), "smartfarm-cloud-pilot-invalid-"));
  await cp("deploy", join(root, "deploy"), { recursive: true });
  await cp("docs/deployment", join(root, "docs/deployment"), { recursive: true });
  const caddyPath = join(root, "deploy/cloud-pilot/Caddyfile");
  const caddyfile = await readFile(caddyPath, "utf8");
  await writeFile(
    caddyPath,
    caddyfile.replace("  handle {\n    basic_auth", "  basic_auth"),
    "utf8",
  );

  const issues = await inspectCloudPilotPackage(root);
  assert.ok(issues.includes(
    "Caddyfile must keep Basic Auth and the preview proxy inside one fallback handle",
  ));
});

test("cloud-pilot package rewrites the public Host before proxying to Vite", async () => {
  const root = await mkdtemp(join(tmpdir(), "smartfarm-cloud-pilot-missing-preview-host-rewrite-"));
  await cp("deploy", join(root, "deploy"), { recursive: true });
  await cp("docs/deployment", join(root, "docs/deployment"), { recursive: true });
  const caddyPath = join(root, "deploy/cloud-pilot/Caddyfile");
  const caddyfile = await readFile(caddyPath, "utf8");
  await writeFile(caddyPath, caddyfile.replace(/^\s*header_up Host \{upstream_hostport\}\n/mu, ""), "utf8");

  const issues = await inspectCloudPilotPackage(root);
  assert.ok(issues.includes(
    "Caddyfile must rewrite the preview Host header for Vite",
  ));
});
