import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveComposeCommand } from "./run-cloud-pilot-compose.mjs";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "deploy/cloud-pilot/.env.example",
  "deploy/cloud-pilot/Caddyfile",
  "deploy/cloud-pilot/Dockerfile",
  "deploy/cloud-pilot/Dockerfile.dockerignore",
  "deploy/cloud-pilot/docker-compose.yml",
  "deploy/cloud-pilot/entrypoint.sh",
  "deploy/cloud-pilot/podman.sh",
  "scripts/podman-cloud-pilot.test.mjs",
  "docs/deployment/cloud-pilot.md",
  "docs/deployment/cloud-pilot-checklist.md",
];

export async function inspectCloudPilotPackage(root = repositoryRoot) {
  const issues = [];

  for (const relativePath of requiredFiles) {
    try {
      await access(join(root, relativePath), constants.F_OK);
    } catch {
      issues.push(`Missing required cloud-pilot file: ${relativePath}`);
    }
  }

  const compose = await readRequired(root, "deploy/cloud-pilot/docker-compose.yml", issues);
  const caddyfile = await readRequired(root, "deploy/cloud-pilot/Caddyfile", issues);
  const dockerfile = await readRequired(root, "deploy/cloud-pilot/Dockerfile", issues);
  const dockerignore = await readRequired(root, "deploy/cloud-pilot/Dockerfile.dockerignore", issues);
  const envExample = await readRequired(root, "deploy/cloud-pilot/.env.example", issues);
  const podmanScript = await readRequired(root, "deploy/cloud-pilot/podman.sh", issues);
  const guide = await readRequired(root, "docs/deployment/cloud-pilot.md", issues);
  const checklist = await readRequired(root, "docs/deployment/cloud-pilot-checklist.md", issues);

  if (compose !== null) {
    assertIncludes(compose, "SMARTFARM_DEMO_KEY: ${SMARTFARM_DEMO_KEY:?", issues, "Compose must reject an empty demo key");
    assertIncludes(compose, "SMARTFARM_OPENWEATHER_API_KEY: ${SMARTFARM_OPENWEATHER_API_KEY:-}", issues, "Compose must pass only the optional server-side weather key");
    assertIncludes(compose, "SMARTFARM_BASIC_AUTH_USER: ${SMARTFARM_BASIC_AUTH_USER:?", issues, "Compose must reject an empty Basic Auth username");
    assertIncludes(compose, "SMARTFARM_BASIC_AUTH_HASH: ${SMARTFARM_BASIC_AUTH_HASH:?", issues, "Compose must reject an empty Basic Auth hash");
    assertIncludes(compose, 'SMARTFARM_DEMO_MODE: "1"', issues, "Compose must force demo mode");
    assertIncludes(compose, "smartfarm_cloud_pilot_data:/data", issues, "Compose must persist the demo SQLite volume");
    assertIncludes(compose, '"${SMARTFARM_HTTP_PORT:-80}:80"', issues, "Compose must publish the HTTP port through Caddy");
    assertIncludes(compose, '"${SMARTFARM_HTTPS_PORT:-443}:443"', issues, "Compose must publish the HTTPS port through Caddy");
    const publishedPortLines = Array.from(
      compose.matchAll(/^\s+- "\$\{SMARTFARM_(?:HTTP|HTTPS)_PORT:-\d+\}:\d+"$/gm),
      (match) => match[0],
    );
    if (publishedPortLines.length !== 2) {
      issues.push("Compose must publish only the reverse-proxy HTTP and HTTPS ports");
    }
    if (/3100:3100|4173:4173/.test(compose)) {
      issues.push("Compose must not publish the internal API or preview ports");
    }
  }

  if (caddyfile !== null) {
    assertIncludes(caddyfile, "{$SMARTFARM_SITE_ADDRESS}", issues, "Caddy must read the public site address from env");
    assertIncludes(caddyfile, "basic_auth", issues, "Caddy must enforce outer Basic Auth");
    assertIncludes(caddyfile, "reverse_proxy 127.0.0.1:4173", issues, "Caddy must proxy the PWA preview server");
    assertIncludes(caddyfile, "reverse_proxy 127.0.0.1:3100", issues, "Caddy must proxy the local demo health endpoint");
    assertIncludes(caddyfile, "@health path /healthz", issues, "Caddy must expose a dedicated health path");
    if (!/handle\s+@health\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:3100[\s\S]*?\}/u.test(caddyfile)) {
      issues.push("Caddyfile must route /healthz through its dedicated unauthenticated handle");
    }
    if (!/handle\s*\{\s*basic_auth\s*\{[\s\S]*?reverse_proxy\s+127\.0\.0\.1:4173[\s\S]*?\}/u.test(caddyfile)) {
      issues.push("Caddyfile must keep Basic Auth and the preview proxy inside one fallback handle");
    }
    if (!/reverse_proxy\s+127\.0\.0\.1:4173\s*\{[\s\S]*?header_up\s+Host\s+\{upstream_hostport\}[\s\S]*?\}/u.test(caddyfile)) {
      issues.push("Caddyfile must rewrite the preview Host header for Vite");
    }
  }

  if (dockerfile !== null) {
    assertIncludes(dockerfile, "RUN npm ci", issues, "Dockerfile must install workspace dependencies");
    assertIncludes(dockerfile, "RUN npm run build", issues, "Dockerfile must build the workspaces before runtime");
    assertIncludes(dockerfile, "COPY apps/admin/package.json", issues, "Dockerfile must include the admin workspace manifest");
    assertIncludes(dockerfile, "COPY apps/admin apps/admin", issues, "Dockerfile must include the admin workspace source");
    assertIncludes(dockerfile, "COPY deploy/cloud-pilot/entrypoint.sh", issues, "Dockerfile must install the pilot entrypoint");
  }

  if (podmanScript !== null) {
    assertIncludes(podmanScript, "#!/bin/sh", issues, "Podman helper must use POSIX sh");
    assertIncludes(podmanScript, "Podman is required", issues, "Podman helper must fail clearly when Podman is unavailable");
    assertIncludes(podmanScript, "--archive-sha256", issues, "Podman helper must require a source archive SHA-256");
    assertIncludes(podmanScript, "sha256sum", issues, "Podman helper must calculate the source archive SHA-256");
    assertIncludes(podmanScript, "tar -tvf", issues, "Podman helper must reject non-regular archive members");
    assertIncludes(podmanScript, "MAX_ARCHIVE_BYTES=536870912", issues, "Podman helper must cap practical archive size");
    assertIncludes(podmanScript, "--env-file \"$normalized_env_file\"", issues, "Podman helper must pass a normalized private env file");
    assertIncludes(podmanScript, "chmod 600 \"$normalized_env_file\"", issues, "Podman helper must protect its temporary env file");
    assertIncludes(podmanScript, "trap cleanup EXIT HUP INT TERM", issues, "Podman helper must clean up temporary files");
    assertIncludes(podmanScript, "--publish 80:80", issues, "Podman helper must publish HTTP");
    assertIncludes(podmanScript, "--publish 443:443", issues, "Podman helper must publish HTTPS");
    assertIncludes(podmanScript, ":/data:Z", issues, "Podman helper must relabel the SQLite volume for SELinux");
    assertIncludes(podmanScript, ":/srv/caddy-data:Z", issues, "Podman helper must relabel the Caddy data volume for SELinux");
    assertIncludes(podmanScript, "podman container exists", issues, "Podman helper must refuse an existing pilot container");
    assertIncludes(podmanScript, "io.smartfarm.cloud-pilot.managed", issues, "Podman helper must require an ownership label before removal");
    if (/\beval\b/u.test(podmanScript) || /(^|[;\n])\s*source\s+/mu.test(podmanScript)) {
      issues.push("Podman helper must not evaluate or source the pilot env file");
    }
    if (/--replace/u.test(podmanScript)) {
      issues.push("Podman helper must not automatically replace an existing pilot container");
    }
    if (/SMARTFARM_CLOUD_PILOT_(?:CONTAINER|DATA_VOLUME|CADDY_DATA_VOLUME|CADDY_CONFIG_VOLUME)/u.test(podmanScript)) {
      issues.push("Podman helper must not permit environment overrides for fixed container or volume targets");
    }
  }

  if (dockerignore !== null) {
    for (const pattern of [".git", ".env", "node_modules", "dist", "artifacts"]) {
      assertIncludes(dockerignore, pattern, issues, `Dockerfile.dockerignore must exclude ${pattern}`);
    }
  }

  if (envExample !== null) {
    for (const requiredLine of [
      "SMARTFARM_SITE_ADDRESS=",
      "SMARTFARM_BASIC_AUTH_USER=",
      "SMARTFARM_BASIC_AUTH_HASH=",
      "SMARTFARM_DEMO_KEY=",
      "SMARTFARM_OPENWEATHER_API_KEY=",
    ]) {
      assertIncludes(envExample, requiredLine, issues, `.env.example must include ${requiredLine}`);
    }
    if (/^SMARTFARM_BASIC_AUTH_HASH=.+$/m.test(envExample)) {
      issues.push(".env.example must not ship a Basic Auth hash");
    }
    if (/^SMARTFARM_DEMO_KEY=.+$/m.test(envExample)) {
      issues.push(".env.example must not ship a demo key");
    }
    if (/^SMARTFARM_OPENWEATHER_API_KEY=.+$/m.test(envExample)) {
      issues.push(".env.example must not ship a weather API key");
    }
    if (/^PUBLIC_/m.test(envExample)) {
      issues.push(".env.example must not define browser-visible PUBLIC_ variables");
    }
  }

  for (const [document, label] of [
    [guide, "cloud-pilot guide"],
    [checklist, "cloud-pilot checklist"],
  ]) {
    if (document !== null) {
      if (/contest/i.test(document) === false || /pilot/i.test(document) === false) {
        issues.push(`The ${label} must clearly say this package is contest/pilot only`);
      }
    }
  }

  return issues;
}

async function readRequired(root, relativePath, issues) {
  try {
    return await readFile(join(root, relativePath), "utf8");
  } catch {
    issues.push(`Unable to read cloud-pilot file: ${relativePath}`);
    return null;
  }
}

function assertIncludes(content, snippet, issues, message) {
  if (!content.includes(snippet)) {
    issues.push(message);
  }
}

async function main() {
  const issues = await inspectCloudPilotPackage();
  if (issues.length > 0) {
    for (const issue of issues) {
      console.error(`[cloud-pilot] ${issue}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("Cloud pilot packaging files, guards, and docs are present.");
  for (const note of await collectOptionalValidationNotes()) {
    console.log(`[cloud-pilot] ${note}`);
  }
}

async function collectOptionalValidationNotes() {
  const notes = [];
  const env = {
    ...process.env,
    SMARTFARM_SITE_ADDRESS: "pilot.example.com",
    SMARTFARM_BASIC_AUTH_USER: "pilot",
    SMARTFARM_BASIC_AUTH_HASH: "$2a$14$exampleexampleexampleexampleexampleexampleexampleexample",
    SMARTFARM_DEMO_KEY: "example-demo-key",
  };

  try {
    const composeCommand = await resolveComposeCommand();
    const composeConfig = await runCommand(
      composeCommand[0],
      [...composeCommand.slice(1), "-f", "deploy/cloud-pilot/docker-compose.yml", "config"],
      env,
    );
    if (composeConfig.ok) {
      notes.push("Optional compose config validation passed.");
    } else {
      notes.push(`Optional compose config validation skipped or failed: ${composeConfig.stderr || composeConfig.stdout || "compose unavailable"}`);
    }
  } catch (error) {
    notes.push(`Optional compose config validation skipped: ${formatError(error)}`);
  }

  notes.push(await validateCaddy(env));
  return notes;
}

async function validateCaddy(env) {
  const local = await runCommand(
    "caddy",
    ["adapt", "--config", "deploy/cloud-pilot/Caddyfile", "--adapter", "caddyfile", "--validate"],
    env,
  );
  if (local.ok) {
    return "Optional caddy adapt/validate passed with local caddy.";
  }

  const dockerInfo = await runCommand("docker", ["info", "--format", "{{.ServerVersion}}"]);
  if (!dockerInfo.ok) {
    return "Optional caddy adapt/validate skipped: local caddy is unavailable and the Docker daemon is not running.";
  }

  const dockerized = await runCommand(
    "docker",
    [
      "run",
      "--rm",
      "-e",
      "SMARTFARM_SITE_ADDRESS",
      "-e",
      "SMARTFARM_BASIC_AUTH_USER",
      "-e",
      "SMARTFARM_BASIC_AUTH_HASH",
      "-v",
      `${join(repositoryRoot, "deploy/cloud-pilot/Caddyfile")}:/etc/caddy/Caddyfile:ro`,
      "caddy:2.10",
      "caddy",
      "adapt",
      "--config",
      "/etc/caddy/Caddyfile",
      "--adapter",
      "caddyfile",
      "--validate",
    ],
    env,
  );
  if (dockerized.ok) {
    return "Optional caddy adapt/validate passed in a dockerized caddy runtime.";
  }

  return `Optional caddy adapt/validate skipped or failed: ${dockerized.stderr || dockerized.stdout || "unknown error"}`;
}

async function runCommand(command, args, env = process.env) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", (error) => resolve({
      ok: false,
      stdout,
      stderr: stderr || formatError(error),
    }));
    child.once("exit", (code) => resolve({
      ok: code === 0,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }));
  });
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
