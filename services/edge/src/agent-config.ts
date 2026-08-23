import { lstat, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DeviceIdSchema, FarmIdSchema, type DeviceId, type FarmId } from "@smartfarm-os/contracts";

export const DEFAULT_EDGE_CONFIG_PATH = "/etc/smartfarm-edge/config.json";
export const DEFAULT_EDGE_CREDENTIAL_PATH = "/var/lib/smartfarm-edge/credential.json";
export const DEFAULT_EDGE_JOURNAL_PATH = "/var/lib/smartfarm-edge/execution.sqlite";
export const DEFAULT_EDGE_ENROLLMENT_PATH = "/v1/gateway-enrollments/exchange";
export const DEFAULT_EDGE_COMMAND_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_EDGE_STOP_POLL_INTERVAL_MS = 250;
export const DEFAULT_EDGE_TELEMETRY_INTERVAL_MS = 5_000;
export const DEFAULT_EDGE_REQUEST_TIMEOUT_MS = 5_000;
export const DEFAULT_EDGE_MAX_RESPONSE_BYTES = 1_024 * 1_024;

export type EdgeAgentConfig = {
  readonly apiUrl: string;
  readonly farmId: FarmId;
  readonly deviceId: DeviceId;
  readonly credentialPath: string;
  readonly journalPath: string;
  readonly enrollmentPath: string;
  readonly commandPollIntervalMs: number;
  readonly stopPollIntervalMs: number;
  readonly telemetryIntervalMs: number;
  readonly requestTimeoutMs: number;
  readonly maxResponseBytes: number;
};

export async function loadEdgeAgentConfig(pathInput = DEFAULT_EDGE_CONFIG_PATH): Promise<EdgeAgentConfig> {
  const path = resolve(pathInput);
  const text = await readFile(path, "utf8");
  return parseEdgeAgentConfig(JSON.parse(text), { configPath: path });
}

export function parseEdgeAgentConfig(
  input: unknown,
  options: { readonly configPath?: string } = {},
): EdgeAgentConfig {
  if (!isRecord(input)) {
    throw new Error("Edge config must be a JSON object");
  }
  if ("credentialHeaderName" in input || "credentialHeaderPrefix" in input) {
    throw new Error("Edge authentication uses the fixed Authorization Bearer contract");
  }

  const apiUrl = parseApiUrl(input.apiUrl);
  return {
    apiUrl,
    farmId: FarmIdSchema.parse(input.farmId),
    deviceId: DeviceIdSchema.parse(input.deviceId),
    credentialPath: resolveOptionalPath(
      input.credentialPath,
      DEFAULT_EDGE_CREDENTIAL_PATH,
      options.configPath,
    ),
    journalPath: resolveOptionalPath(
      input.journalPath,
      DEFAULT_EDGE_JOURNAL_PATH,
      options.configPath,
    ),
    enrollmentPath: parseEnrollmentPath(input.enrollmentPath),
    commandPollIntervalMs: parsePositiveInteger(
      input.commandPollIntervalMs,
      "commandPollIntervalMs",
      DEFAULT_EDGE_COMMAND_POLL_INTERVAL_MS,
    ),
    stopPollIntervalMs: parsePositiveInteger(
      input.stopPollIntervalMs,
      "stopPollIntervalMs",
      DEFAULT_EDGE_STOP_POLL_INTERVAL_MS,
    ),
    telemetryIntervalMs: parsePositiveInteger(
      input.telemetryIntervalMs,
      "telemetryIntervalMs",
      DEFAULT_EDGE_TELEMETRY_INTERVAL_MS,
    ),
    requestTimeoutMs: parsePositiveInteger(
      input.requestTimeoutMs,
      "requestTimeoutMs",
      DEFAULT_EDGE_REQUEST_TIMEOUT_MS,
    ),
    maxResponseBytes: parsePositiveInteger(
      input.maxResponseBytes,
      "maxResponseBytes",
      DEFAULT_EDGE_MAX_RESPONSE_BYTES,
    ),
  };
}

export async function ensureEdgeRuntimeDirectories(
  config: EdgeAgentConfig,
  scope: { readonly credential?: boolean; readonly journal?: boolean } = {
    credential: true,
    journal: true,
  },
): Promise<void> {
  const directories = new Set<string>();
  if (scope.credential === true) directories.add(dirname(config.credentialPath));
  if (scope.journal === true) directories.add(dirname(config.journalPath));
  await Promise.all([...directories].map(ensurePrivateEdgeDirectory));
}

export async function ensurePrivateEdgeDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const status = await lstat(path);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error("Edge runtime directory must be a real directory, not a symbolic link");
  }
  if (process.platform !== "win32" && (status.mode & 0o077) !== 0) {
    throw new Error("Edge runtime directory must not grant group or other access");
  }
  const currentUserId = process.getuid?.();
  if (process.platform !== "win32" && currentUserId !== undefined && status.uid !== currentUserId) {
    throw new Error("Edge runtime directory must be owned by the current service account");
  }
}

function parseApiUrl(input: unknown): string {
  if (typeof input !== "string" || input.trim() === "") {
    throw new Error("apiUrl must be a non-empty string");
  }

  const normalized = input.trim();
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("apiUrl must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("apiUrl must use http or https");
  }
  if (url.protocol === "http:" && !isLoopbackHostname(url.hostname)) {
    throw new Error("apiUrl must use https unless the API is on loopback");
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error("apiUrl must not contain credentials");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new Error("apiUrl must not contain a query or fragment");
  }
  if (url.pathname !== "/") {
    throw new Error("apiUrl must not contain a path");
  }
  return normalized;
}

function parseEnrollmentPath(input: unknown): string {
  const value = input === undefined ? DEFAULT_EDGE_ENROLLMENT_PATH : input;
  if (
    typeof value !== "string"
    || !value.startsWith("/")
    || value.startsWith("//")
    || value.includes("?")
    || value.includes("#")
  ) {
    throw new Error("enrollmentPath must be an origin-relative path");
  }
  return value;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function parsePositiveInteger(input: unknown, field: string, fallback: number): number {
  const value = input === undefined ? fallback : input;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function resolveOptionalPath(
  input: unknown,
  fallback: string,
  configPath: string | undefined,
): string {
  const value = input === undefined ? fallback : input;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Configured path must be a non-empty string");
  }
  if (value.startsWith("/")) return value;
  if (configPath === undefined) return resolve(value);
  return resolve(dirname(configPath), value);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}
