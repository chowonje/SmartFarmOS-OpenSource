import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);

if (args.includes("--help")) {
  process.stdout.write(
    "Usage: npm run demo:usability -- S01 [--resume]\n"
      + "Starts the production-preview local demo with an anonymous session database.\n",
  );
  process.exit(0);
}

const resume = args.includes("--resume");
const positional = args.filter((argument) => !argument.startsWith("--"));
const unknownFlags = args.filter((argument) => argument.startsWith("--") && argument !== "--resume");
const sessionCode = positional[0] ?? "";

if (
  positional.length !== 1
  || unknownFlags.length > 0
  || !/^S(?:0[1-9]|[1-9][0-9])$/.test(sessionCode)
) {
  fail("Expected one anonymous session code such as S01 and optional --resume");
}

const artifactsDirectory = join(repositoryRoot, "artifacts", "usability");
const databasePath = join(artifactsDirectory, `${sessionCode}.sqlite`);
const edgeDatabasePath = `${databasePath}.edge.sqlite`;
const pwaPort = process.env.SMARTFARM_PWA_PORT ?? "4173";
await mkdir(artifactsDirectory, { recursive: true });

const existingArtifacts = await Promise.all(
  [
    databasePath,
    `${databasePath}-shm`,
    `${databasePath}-wal`,
    edgeDatabasePath,
    `${edgeDatabasePath}-shm`,
    `${edgeDatabasePath}-wal`,
  ].map(fileExists),
);
const sessionExists = existingArtifacts.some(Boolean);
const apiDatabaseExists = existingArtifacts[0] === true;
const edgeDatabaseExists = existingArtifacts[3] === true;

if (sessionExists && !resume) {
  fail(
    `Session ${sessionCode} already exists. Choose a new code, or pass --resume only to continue the same interrupted session.`,
  );
}
if (resume && (!apiDatabaseExists || !edgeDatabaseExists)) {
  fail(sessionExists
    ? `Session ${sessionCode} is incomplete: the central API and Edge primary databases must both exist before resume`
    : `Session ${sessionCode} does not exist and cannot be resumed`);
}

process.stdout.write(
    `[smartfarm-usability] ${resume ? "resuming" : "starting"} ${sessionCode}\n`
    + `[smartfarm-usability] database: ${databasePath}\n`
    + `[smartfarm-usability] edge journal: ${edgeDatabasePath}\n`
    + `[smartfarm-usability] open http://127.0.0.1:${pwaPort} after startup\n`,
);

const child = spawn(process.execPath, [
  join(repositoryRoot, "scripts", "run-local-demo.mjs"),
  "--preview",
], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    SMARTFARM_DEMO_DB_PATH: databasePath,
    SMARTFARM_DEMO_LOW_WATER_EMISSIONS:
      process.env.SMARTFARM_DEMO_LOW_WATER_EMISSIONS ?? "120",
  },
  stdio: "inherit",
});

let stopping = false;
const signalForwardTimers = new Set();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopping = true;
    const timer = setTimeout(() => {
      signalForwardTimers.delete(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    }, 1_000);
    signalForwardTimers.add(timer);
  });
}

child.once("error", (error) => {
  process.stderr.write(`[smartfarm-usability] failed to start: ${error.message}\n`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  for (const timer of signalForwardTimers) clearTimeout(timer);
  signalForwardTimers.clear();
  process.exitCode = stopping ? 0 : code ?? (signal === null ? 1 : 128);
});

async function fileExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function fail(message) {
  process.stderr.write(`[smartfarm-usability] ${message}\n`);
  process.exit(1);
}
