import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultEnvPath = join(repositoryRoot, "deploy/cloud-pilot/.env");
const defaultComposeFile = "deploy/cloud-pilot/docker-compose.yml";

export async function parseSimpleEnvFile(filePath = defaultEnvPath) {
  await access(filePath, constants.F_OK);
  const content = await readFile(filePath, "utf8");
  const entries = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`Invalid cloud-pilot env line: ${rawLine}`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = parseEnvValue(line.slice(separatorIndex + 1).trim());
    entries[key] = value;
  }

  return entries;
}

export async function resolveComposeCommand(check = canRunCommand) {
  if (await check(["docker", "compose", "version"])) {
    return ["docker", "compose"];
  }
  if (await check(["docker-compose", "--version"])) {
    return ["docker-compose"];
  }
  throw new Error("Neither `docker compose` nor `docker-compose` is available on this machine.");
}

export function createComposeArguments(baseCommand, composeArguments) {
  return [...baseCommand, "-f", defaultComposeFile, ...composeArguments];
}

export function parseEnvValue(rawValue) {
  if (rawValue.startsWith("'")) {
    if (rawValue.endsWith("'") === false || rawValue.length === 1) {
      throw new Error(`Invalid single-quoted env value: ${rawValue}`);
    }
    return rawValue.slice(1, -1);
  }

  if (rawValue.startsWith("\"")) {
    if (rawValue.endsWith("\"") === false || rawValue.length === 1) {
      throw new Error(`Invalid double-quoted env value: ${rawValue}`);
    }
    return JSON.parse(rawValue);
  }

  return rawValue.replace(/\s+#.*$/u, "");
}

async function canRunCommand(command) {
  return await new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: repositoryRoot,
      stdio: "ignore",
    });
    child.once("error", () => resolve(false));
    child.once("exit", (code) => resolve(code === 0));
  });
}

async function main() {
  const composeCommand = await resolveComposeCommand();
  const env = await parseSimpleEnvFile();
  const args = createComposeArguments(composeCommand, process.argv.slice(2));

  const child = spawn(args[0], args.slice(1), {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ...env,
    },
    stdio: "inherit",
  });

  child.once("error", (error) => {
    console.error(`[cloud-pilot] failed to start compose command: ${error.message}`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    process.exitCode = code ?? (signal === null ? 1 : 128);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cloud-pilot] ${message}`);
    process.exitCode = 1;
  });
}
