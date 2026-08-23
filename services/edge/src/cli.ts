#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { isatty } from "node:tty";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_EDGE_CONFIG_PATH,
  loadEdgeAgentConfig,
  type EdgeAgentConfig,
} from "./agent-config.js";
import { FetchApiRequestExecutor } from "./api-client.js";
import {
  EDGE_CREDENTIAL_FILE_SCHEMA,
  credentialStatus,
  writeEdgeCredential,
} from "./credential-store.js";
import { EdgeEnrollmentClient } from "./enrollment-client.js";
import { startEdgeAgentRuntime, type TelemetrySourcePort } from "./agent-runtime.js";
import {
  EDGE_PASSWORD_USER_ALLOWLIST,
  createSpawnSystemAccountPort,
  type SystemAccountPort,
} from "./system-account.js";
import type { DeviceCommandExecutor } from "./gateway.js";

export type CliCommand =
  | { readonly kind: "run"; readonly configPath: string }
  | { readonly kind: "enroll"; readonly configPath: string }
  | { readonly kind: "credential-status"; readonly configPath: string }
  | { readonly kind: "passwd"; readonly username: string; readonly configPath: string };

export type CliDependencies = {
  readonly stdin?: NodeJS.ReadStream;
  readonly stdout?: NodeJS.WriteStream;
  readonly stderr?: NodeJS.WriteStream;
  readonly loadConfig?: (path: string) => Promise<EdgeAgentConfig>;
  readonly createEnrollmentClient?: (config: EdgeAgentConfig) => EdgeEnrollmentClient;
  readonly writeCredential?: typeof writeEdgeCredential;
  readonly readHiddenValue?: (prompt: string) => Promise<string>;
  readonly readConfirmedPassword?: () => Promise<string>;
  readonly createSystemAccountPort?: () => SystemAccountPort;
  readonly startRuntime?: typeof startEdgeAgentRuntime;
  readonly createDeviceExecutor?: () => DeviceCommandExecutor;
  readonly createTelemetrySource?: () => TelemetrySourcePort | undefined;
  readonly credentialStatus?: typeof credentialStatus;
  readonly waitForTermination?: (stop: () => Promise<void>) => Promise<void>;
};

const HELP_TEXT = `Usage: smartfarm-edge <command> [options]

Commands:
  run                       Start the local edge daemon loops
  enroll                    Exchange a one-time enrollment token from hidden TTY/stdin
  credential-status         Read the local credential file without printing secrets
  passwd --user <name>      Change one allowlisted Pi-local OS account password

Options:
  --config <path>           Edge config JSON path (default: ${DEFAULT_EDGE_CONFIG_PATH})
  --help                    Show this help

Password users:
  ${EDGE_PASSWORD_USER_ALLOWLIST.join(", ")}
`;

export function parseCliArgs(args: readonly string[]): CliCommand | { readonly kind: "help" } {
  if (args.includes("--help")) return { kind: "help" };
  if (args.length === 0) {
    throw new Error("A subcommand is required");
  }

  const command = args[0];
  let configPath = DEFAULT_EDGE_CONFIG_PATH;
  let username: string | null = null;

  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--config") {
      const value = args[index + 1];
      if (value === undefined) throw new Error("--config requires a path");
      configPath = value;
      index += 1;
      continue;
    }
    if (argument === "--user") {
      const value = args[index + 1];
      if (value === undefined) throw new Error("--user requires a value");
      username = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  switch (command) {
    case "run":
      return { kind: "run", configPath };
    case "enroll":
      return { kind: "enroll", configPath };
    case "credential-status":
      return { kind: "credential-status", configPath };
    case "passwd":
      if (username === null) throw new Error("passwd requires --user <allowlisted username>");
      return { kind: "passwd", username, configPath };
    default:
      throw new Error(`Unknown subcommand: ${command}`);
  }
}

export async function runCli(
  args: readonly string[],
  dependencies: CliDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;

  let command: CliCommand | { readonly kind: "help" };
  try {
    command = parseCliArgs(args);
  } catch (error) {
    stderr.write(`${formatError(error)}\n`);
    stderr.write(HELP_TEXT);
    return 1;
  }

  if (command.kind === "help") {
    stdout.write(HELP_TEXT);
    return 0;
  }

  const loadConfig = dependencies.loadConfig ?? loadEdgeAgentConfig;
  try {
    switch (command.kind) {
      case "run": {
        const config = await loadConfig(command.configPath);
        const deviceExecutor = (dependencies.createDeviceExecutor ?? createUnsupportedDeviceExecutor)();
        const telemetrySource = dependencies.createTelemetrySource?.();
        const runtimeOptions = telemetrySource === undefined
          ? { config, deviceExecutor }
          : { config, deviceExecutor, telemetrySource };
        const runtime = await (dependencies.startRuntime ?? startEdgeAgentRuntime)(runtimeOptions);
        stdout.write(
          `smartfarm-edge daemon started for ${config.farmId}/${config.deviceId} via ${config.apiUrl}\n`,
        );
        await (dependencies.waitForTermination ?? waitForTermination)(runtime.stop);
        return 0;
      }
      case "enroll": {
        const config = await loadConfig(command.configPath);
        const readHiddenValue = dependencies.readHiddenValue ?? (() => readSecretValue("Enrollment token: "));
        const enrollmentToken = await readHiddenValue("Enrollment token: ");
        const client = dependencies.createEnrollmentClient?.(config)
          ?? new EdgeEnrollmentClient(
            new FetchApiRequestExecutor({
              baseUrl: config.apiUrl,
              timeoutMs: config.requestTimeoutMs,
              maxResponseBytes: config.maxResponseBytes,
            }),
            { path: config.enrollmentPath },
          );
        const result = await client.exchangeToken(config, enrollmentToken);
        await (dependencies.writeCredential ?? writeEdgeCredential)(config.credentialPath, {
          schemaVersion: EDGE_CREDENTIAL_FILE_SCHEMA,
          credential: result.credential,
          edgeKey: result.edgeKey,
        });
        stdout.write(
          `Enrollment stored for ${result.credential.farmId}/${result.credential.deviceId}.\n`,
        );
        return 0;
      }
      case "credential-status": {
        const config = await loadConfig(command.configPath);
        const status = await (dependencies.credentialStatus ?? credentialStatus)(config.credentialPath);
        stdout.write(JSON.stringify({
          farmId: config.farmId,
          deviceId: config.deviceId,
          apiUrl: config.apiUrl,
          credentialPath: config.credentialPath,
          journalPath: config.journalPath,
          credentialPresent: status.exists,
          credentialIssuedAt: status.issuedAt,
          credentialFileMode: status.mode,
        }, null, 2) + "\n");
        return 0;
      }
      case "passwd": {
        const readConfirmedPassword = dependencies.readConfirmedPassword ?? defaultReadConfirmedPassword;
        const password = await readConfirmedPassword();
        await (dependencies.createSystemAccountPort ?? (() => createSpawnSystemAccountPort()))()
          .changePassword(command.username, password);
        stdout.write(`Password updated for ${command.username}.\n`);
        return 0;
      }
      default:
        return assertNever(command);
    }
  } catch (error) {
    stderr.write(`${formatError(error)}\n`);
    return 1;
  }
}

async function defaultReadConfirmedPassword(): Promise<string> {
  const password = await readSecretValueFromTtyOnly("New password: ");
  const confirmation = await readSecretValueFromTtyOnly("Confirm password: ");
  if (password !== confirmation) {
    throw new Error("Passwords did not match");
  }
  return password;
}

export async function readSecretValue(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  if (isatty(process.stdin.fd)) {
    return readSecretFromTty(process.stdin, process.stderr);
  }
  const piped = readFileSync(0, "utf8");
  process.stderr.write("\n");
  const value = piped.trimEnd();
  if (value.trim() === "") {
    throw new Error("Secret input was empty");
  }
  return value;
}

export async function readSecretValueFromTtyOnly(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  if (!isatty(process.stdin.fd)) {
    process.stderr.write("\n");
    throw new Error("Interactive password input requires a TTY");
  }
  return readSecretFromTty(process.stdin, process.stderr);
}

async function readSecretFromTty(
  stdin: NodeJS.ReadStream,
  stderr: NodeJS.WriteStream,
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const cleanup = (): void => {
      stdin.setRawMode?.(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      for (const character of text) {
        if (character === "\r" || character === "\n") {
          stderr.write("\n");
          cleanup();
          const secret = buffer.join("");
          if (secret.trim() === "") {
            reject(new Error("Secret input was empty"));
            return;
          }
          resolve(secret);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Input cancelled"));
          return;
        }
        if (character === "\u007f") {
          buffer.pop();
          continue;
        }
        buffer.push(character);
      }
    };

    const buffer: string[] = [];
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function createUnsupportedDeviceExecutor(): DeviceCommandExecutor {
  return {
    executeCommand: () => {
      throw new Error(
        "No real Raspberry Pi device executor is configured in this slice. Inject one in code or tests.",
      );
    },
  };
}

function waitForTermination(stop: () => Promise<void>): Promise<void> {
  return new Promise((resolve) => {
    let stopping = false;
    const finish = (): void => {
      if (stopping) return;
      stopping = true;
      void stop().finally(resolve);
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled command: ${JSON.stringify(value)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = await runCli(process.argv.slice(2));
  if (exitCode !== 0) process.exitCode = exitCode;
}
