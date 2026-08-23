import { setTimeout as delay } from "node:timers/promises";
import {
  CentralApiClient,
  FetchApiRequestExecutor,
  type ApiRequestExecutor,
} from "./api-client.js";
import { type EdgeAgentConfig, ensureEdgeRuntimeDirectories } from "./agent-config.js";
import { readEdgeCredential } from "./credential-store.js";
import {
  EdgeGateway,
  type CentralApiPort,
  type DeviceCommandExecutor,
} from "./gateway.js";
import {
  SqliteEdgeExecutionRepository,
  type EdgeExecutionRepository,
} from "./execution-repository.js";

export interface TelemetrySourcePort {
  readTelemetry(): Promise<readonly unknown[]>;
}

export type EdgeAgentRuntimeOptions = {
  readonly config: EdgeAgentConfig;
  readonly deviceExecutor: DeviceCommandExecutor;
  readonly telemetrySource?: TelemetrySourcePort;
  readonly api?: CentralApiPort;
  readonly apiExecutor?: ApiRequestExecutor;
  readonly repository?: EdgeExecutionRepository;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly onBackgroundError?: (error: unknown) => void;
};

export type EdgeAgentRuntime = {
  readonly stop: () => Promise<void>;
  readonly getLastBackgroundError: () => unknown | null;
};

export async function startEdgeAgentRuntime(
  options: EdgeAgentRuntimeOptions,
): Promise<EdgeAgentRuntime> {
  await ensureEdgeRuntimeDirectories(options.config, {
    credential: options.api === undefined,
    journal: options.repository === undefined,
  });
  const now = options.now ?? (() => new Date());
  const sleep = options.sleep ?? ((milliseconds) => delay(milliseconds).then(() => undefined));
  const api = options.api ?? await createConfiguredCentralApiClient(options.config, options.apiExecutor);
  const repository = options.repository ?? new SqliteEdgeExecutionRepository({
    path: options.config.journalPath,
  });
  const gateway = new EdgeGateway({
    farmId: options.config.farmId,
    deviceId: options.config.deviceId,
    api,
    device: options.deviceExecutor,
    repository,
    now,
  });

  let closed = false;
  let closePromise: Promise<void> | null = null;
  let lastBackgroundError: unknown | null = null;
  let normalLoop: Promise<void> | null = null;
  let stopLoop: Promise<void> | null = null;
  let telemetryLoop: Promise<void> | null = null;

  const reportError = (error: unknown): void => {
    lastBackgroundError = error;
    options.onBackgroundError?.(error);
  };

  const runRecurring = (intervalMs: number, work: () => Promise<void>): Promise<void> => (async () => {
    while (!closed) {
      try {
        await work();
      } catch (error) {
        reportError(error);
      }
      if (!closed) {
        await sleep(intervalMs);
      }
    }
  })();

  stopLoop = runRecurring(options.config.stopPollIntervalMs, async () => {
    await gateway.processNextStopCommand();
  });
  normalLoop = runRecurring(options.config.commandPollIntervalMs, async () => {
    const result = await gateway.processNextCommand();
    if (result.kind === "recovery_required") {
      throw new Error(
        `Edge execution recovery is required for ${options.config.farmId}/${options.config.deviceId} command ${result.commandId}`,
      );
    }
  });
  if (options.telemetrySource !== undefined) {
    telemetryLoop = runRecurring(options.config.telemetryIntervalMs, async () => {
      const telemetryBatch = await options.telemetrySource?.readTelemetry() ?? [];
      for (const telemetry of telemetryBatch) {
        await gateway.forwardTelemetry(telemetry);
      }
    });
  }

  return {
    stop: async () => {
      if (closePromise !== null) return closePromise;
      closePromise = (async () => {
        closed = true;
        await Promise.all([normalLoop, stopLoop, telemetryLoop]);
        repository.close();
      })();
      return closePromise;
    },
    getLastBackgroundError: () => lastBackgroundError,
  };
}

async function createConfiguredCentralApiClient(
  config: EdgeAgentConfig,
  apiExecutor: ApiRequestExecutor | undefined,
): Promise<CentralApiPort> {
  const credential = await readEdgeCredential(config.credentialPath);
  return new CentralApiClient(
    apiExecutor ?? new FetchApiRequestExecutor({
      baseUrl: config.apiUrl,
      headers: () => ({
        authorization: `Bearer ${credential.edgeKey}`,
      }),
      timeoutMs: config.requestTimeoutMs,
      maxResponseBytes: config.maxResponseBytes,
    }),
  );
}
