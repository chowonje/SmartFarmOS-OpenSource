import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const preview = process.argv.includes("--preview");
const apiPort = process.env.SMARTFARM_DEMO_PORT ?? "3100";
const pwaPort = process.env.SMARTFARM_PWA_PORT ?? (preview ? "4173" : "5173");
const adminPort = process.env.SMARTFARM_ADMIN_PORT
  ?? adjacentPort(pwaPort)
  ?? (preview ? "4174" : "5174");
const demoKey = randomBytes(32).toString("base64url");
const sharedEnv = {
  ...process.env,
  SMARTFARM_DEMO_MODE: "1",
  SMARTFARM_DEMO_KEY: demoKey,
  SMARTFARM_DEMO_PORT: apiPort,
  PUBLIC_ADMIN_URL: `http://127.0.0.1:${adminPort}`,
  PUBLIC_ADMIN_AUTH_MODE: "demo",
};

const api = spawn(process.execPath, [
  join(repositoryRoot, "tools/local-demo/dist/cli.js"),
], {
  cwd: repositoryRoot,
  env: sharedEnv,
  stdio: "inherit",
});

const viteArguments = [
  join(repositoryRoot, "node_modules/vite/bin/vite.js"),
  ...(preview ? ["preview"] : []),
  "--host",
  "127.0.0.1",
  "--port",
  pwaPort,
  "--strictPort",
];
const pwa = spawn(process.execPath, viteArguments, {
  cwd: join(repositoryRoot, "apps/pwa"),
  env: sharedEnv,
  stdio: "inherit",
});

const adminArguments = [
  join(repositoryRoot, "node_modules/vite/bin/vite.js"),
  ...(preview ? ["preview"] : []),
  "--host",
  "127.0.0.1",
  "--port",
  adminPort,
  "--strictPort",
];
const admin = spawn(process.execPath, adminArguments, {
  cwd: join(repositoryRoot, "apps/admin"),
  env: sharedEnv,
  stdio: "inherit",
});

const children = [api, pwa, admin];
let stopping = false;

process.stdout.write(
  `[smartfarm-local-demo] PWA will be available at http://127.0.0.1:${pwaPort}\n`,
);
process.stdout.write(
  `[smartfarm-local-demo] Admin will be available at http://127.0.0.1:${adminPort}\n`,
);

for (const child of children) {
  child.once("error", (error) => {
    process.stderr.write(`[smartfarm-local-demo] failed to start child process: ${error.message}\n`);
    stopChildren("SIGTERM", 1);
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    const exitCode = code ?? (signal === null ? 1 : 128);
    stopChildren("SIGTERM", exitCode);
  });
}

process.once("SIGINT", () => stopChildren("SIGINT", 0));
process.once("SIGTERM", () => stopChildren("SIGTERM", 0));

function stopChildren(signal, exitCode) {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }

  Promise.all(children.map(waitForExit)).then(() => {
    process.exitCode = exitCode;
  });
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

function adjacentPort(portInput) {
  const port = Number.parseInt(portInput, 10);
  if (!Number.isInteger(port) || port < 1 || port >= 65_535) return null;
  return String(port + 1);
}
