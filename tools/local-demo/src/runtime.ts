import { randomUUID } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  authenticateEdgeBearerCredential,
  buildApi,
  type AuthenticateRequest,
  type AuthPrincipal,
  type AuthRole,
  type EdgeAuthPrincipal,
  type EdgeDeviceScope,
} from "@smartfarm-os/api";
import { SqliteSmartFarmStore } from "@smartfarm-os/api/sqlite-store";
import {
  AlarmRuleIdSchema,
  CropCycleIdSchema,
  CropIdSchema,
  DeviceIdSchema,
  GrowingAreaIdSchema,
  IrrigationStrategyIdSchema,
  type AlarmRule,
  type CropCycleDetail,
  type CropRecord,
  type Device,
  type DeviceId,
  type Farm,
  FarmIdSchema,
  type FarmId,
  type GrowingArea,
  type IrrigationStrategy,
  type TelemetryMetric,
} from "@smartfarm-os/contracts";
import { DeviceSimulator } from "@smartfarm-os/device-simulator";
import {
  CentralApiClient,
  EdgeGateway,
  FetchApiRequestExecutor,
  SqliteEdgeExecutionRepository,
} from "@smartfarm-os/edge";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_TELEMETRY_INTERVAL_MS = 5_000;
const DEFAULT_COMMAND_POLL_INTERVAL_MS = 1_000;
const DEFAULT_TIMED_IRRIGATION_SECONDS = 5;
const DEFAULT_LOW_WATER_RECOVERY_EMISSION_INDEX = 3;
const DEFAULT_START_TEMPERATURE_CELSIUS = 24.5;
const DEFAULT_START_HUMIDITY_PERCENT = 58;
const DEFAULT_START_ILLUMINANCE_LUX = 12_000;
const DEFAULT_START_WATER_LEVEL_PERCENT = 76;
const DEFAULT_LOW_WATER_LEVEL_PERCENT = 64;
const DEFAULT_RECOVERED_WATER_LEVEL_PERCENT = 72;
const TELEMETRY_METRICS = [
  "temperature",
  "humidity",
  "illuminance",
  "water_level",
] as const satisfies readonly TelemetryMetric[];

export const DEMO_AUTH_KEY_HEADER = "x-smartfarm-demo-key";
export const DEMO_AUTH_ROLE_HEADER = "x-smartfarm-demo-role";
export const DEMO_AUTH_PRINCIPAL_HEADER = "x-smartfarm-demo-principal";

export type LocalDemoRole = AuthRole;

export type TemperatureGenerator = (context: {
  readonly emissionIndex: number;
  readonly deviceId: DeviceId;
  readonly deviceIndex: number;
  readonly previousValue: number | null;
  readonly now: Date;
}) => number;

export type HumidityGenerator = TemperatureGenerator;
export type IlluminanceGenerator = TemperatureGenerator;
export type WaterLevelGenerator = TemperatureGenerator;

export type StartLocalDemoOptions = {
  readonly farmId: string;
  readonly deviceId: string;
  readonly secondaryDeviceId?: string;
  readonly databasePath: string;
  readonly edgeDatabasePath?: string;
  readonly demoKey: string;
  readonly port?: number;
  readonly telemetryIntervalMs?: number;
  readonly commandPollIntervalMs?: number;
  readonly lowWaterRecoveryEmissionIndex?: number;
  readonly now?: () => Date;
  readonly temperatureGenerator?: TemperatureGenerator;
  readonly humidityGenerator?: HumidityGenerator;
  readonly illuminanceGenerator?: IlluminanceGenerator;
  readonly waterLevelGenerator?: WaterLevelGenerator;
  readonly onBackgroundError?: (error: unknown) => void;
};

export type LocalDemoRuntime = {
  readonly baseUrl: string;
  readonly farmId: FarmId;
  readonly deviceId: DeviceId;
  readonly deviceIds: readonly [DeviceId, DeviceId];
  readonly databasePath: string;
  readonly edgeDatabasePath: string;
  createHeaders(role: LocalDemoRole, principalId?: string): Readonly<Record<string, string>>;
  getLastBackgroundError(): unknown | null;
  close(): Promise<void>;
};

export function assertDemoModeEnabled(
  env: {
    readonly SMARTFARM_DEMO_MODE?: string | undefined;
    readonly NODE_ENV?: string | undefined;
  } = process.env,
): void {
  if (env.SMARTFARM_DEMO_MODE !== "1") {
    throw new Error(
      "Local demo runtime refuses to start unless SMARTFARM_DEMO_MODE=1",
    );
  }
  if (env.NODE_ENV === "production") {
    throw new Error("Local demo runtime refuses to start when NODE_ENV=production");
  }
}

export function createDemoHeaders(options: {
  readonly demoKey: string;
  readonly role: LocalDemoRole;
  readonly principalId?: string;
}): Readonly<Record<string, string>> {
  if (options.demoKey.trim() === "") {
    throw new Error("Local demo header key cannot be empty");
  }

  const headers: Record<string, string> = {
    [DEMO_AUTH_KEY_HEADER]: options.demoKey,
    [DEMO_AUTH_ROLE_HEADER]: options.role,
  };
  if (options.principalId !== undefined) {
    const principalId = options.principalId.trim();
    if (principalId.length === 0) {
      throw new Error("Local demo principal ID cannot be empty");
    }
    headers[DEMO_AUTH_PRINCIPAL_HEADER] = principalId;
  }
  return headers;
}

export async function startLocalDemo(
  options: StartLocalDemoOptions,
): Promise<LocalDemoRuntime> {
  const farmId = FarmIdSchema.parse(options.farmId);
  const deviceId = DeviceIdSchema.parse(options.deviceId);
  const secondaryDeviceId = DeviceIdSchema.parse(
    options.secondaryDeviceId
      ?? (deviceId === "device:bed-2" ? "device:bed-1" : "device:bed-2"),
  );
  if (secondaryDeviceId === deviceId) {
    throw new Error("Local demo primary and secondary device IDs must be different");
  }
  const deviceIds = [deviceId, secondaryDeviceId] as const;
  const databasePath = resolveDatabasePath(options.databasePath);
  const edgeDatabasePath = resolveDatabasePath(
    options.edgeDatabasePath
      ?? (databasePath === ":memory:" ? ":memory:" : `${databasePath}.edge.sqlite`),
  );
  if (databasePath !== ":memory:" && edgeDatabasePath === databasePath) {
    throw new Error("Local demo API and Edge SQLite paths must be different");
  }
  const demoKey = parseDemoKey(options.demoKey);
  const port = parsePort(options.port ?? 3100);
  const telemetryIntervalMs = parsePositiveInteger(
    options.telemetryIntervalMs ?? DEFAULT_TELEMETRY_INTERVAL_MS,
    "telemetryIntervalMs",
  );
  const commandPollIntervalMs = parsePositiveInteger(
    options.commandPollIntervalMs ?? DEFAULT_COMMAND_POLL_INTERVAL_MS,
    "commandPollIntervalMs",
  );
  const now = options.now ?? (() => new Date());
  const temperatureGenerator = options.temperatureGenerator ?? defaultTemperatureGenerator;
  const humidityGenerator = options.humidityGenerator ?? defaultHumidityGenerator;
  const illuminanceGenerator = options.illuminanceGenerator ?? defaultIlluminanceGenerator;
  const lowWaterRecoveryEmissionIndex = parsePositiveInteger(
    options.lowWaterRecoveryEmissionIndex ?? DEFAULT_LOW_WATER_RECOVERY_EMISSION_INDEX,
    "lowWaterRecoveryEmissionIndex",
  );
  const waterLevelGenerator = options.waterLevelGenerator
    ?? ((context) => defaultWaterLevelGenerator(context, lowWaterRecoveryEmissionIndex));

  if (databasePath !== ":memory:") {
    await mkdir(dirname(databasePath), { recursive: true });
  }
  if (edgeDatabasePath !== ":memory:") {
    await mkdir(dirname(edgeDatabasePath), { recursive: true });
  }
  if (databasePath !== ":memory:" && edgeDatabasePath !== ":memory:") {
    const [apiDatabaseExists, edgeDatabaseExists] = await Promise.all([
      pathExists(databasePath),
      pathExists(edgeDatabasePath),
    ]);
    if (apiDatabaseExists !== edgeDatabaseExists) {
      throw new Error(
        "Local demo central API and Edge primary databases must both exist or both be absent",
      );
    }
  }

  const store = new SqliteSmartFarmStore({ path: databasePath });
  const edgeRepository = (() => {
    try {
      return new SqliteEdgeExecutionRepository({ path: edgeDatabasePath });
    } catch (error) {
      store.close();
      throw error;
    }
  })();
  const deviceContexts = (() => {
    try {
      seedLocalDemoCatalog(store, farmId, deviceIds);
      return deviceIds.map((currentDeviceId, deviceIndex) => {
        const latestTelemetryByMetric = {
          temperature: store.latestTelemetry(farmId, currentDeviceId, "temperature"),
          humidity: store.latestTelemetry(farmId, currentDeviceId, "humidity"),
          illuminance: store.latestTelemetry(farmId, currentDeviceId, "illuminance"),
          water_level: store.latestTelemetry(farmId, currentDeviceId, "water_level"),
        } as const;

        return {
          deviceId: currentDeviceId,
          deviceIndex,
          simulator: new DeviceSimulator({
            farmId,
            deviceId: currentDeviceId,
            initialSequence: maxPersistedTelemetrySequence(latestTelemetryByMetric),
            now,
          }),
          previousTelemetryValues: {
            temperature: latestTelemetryByMetric.temperature?.value ?? null,
            humidity: latestTelemetryByMetric.humidity?.value ?? null,
            illuminance: latestTelemetryByMetric.illuminance?.value ?? null,
            water_level: latestTelemetryByMetric.water_level?.value ?? null,
          } satisfies Record<TelemetryMetric, number | null>,
        };
      });
    } catch (error) {
      edgeRepository.close();
      store.close();
      throw error;
    }
  })();
  const edgeCredentialsByDevice = new Map(deviceIds.map((currentDeviceId) => {
    const principal = createDemoEdgePrincipal(farmId, currentDeviceId);
    return [currentDeviceId, {
      key: createDemoEdgeKey(),
      principal,
    }] as const;
  }));
  const edgePrincipalsByKey = new Map(
    Array.from(edgeCredentialsByDevice.values(), ({ key, principal }) => [key, principal] as const),
  );
  const app = (() => {
    try {
      return buildApi({
        authenticate: createDemoAuthenticator(
          farmId,
          demoKey,
          edgePrincipalsByKey,
          store,
        ),
        now,
        store,
      });
    } catch (error) {
      edgeRepository.close();
      store.close();
      throw error;
    }
  })();

  let baseUrl = "";
  let closed = false;
  let closePromise: Promise<void> | null = null;
  let lastBackgroundError: unknown | null = null;
  let telemetryTimer: NodeJS.Timeout | null = null;
  let commandTimer: NodeJS.Timeout | null = null;
  let telemetryInFlight: Promise<void> | null = null;
  let commandInFlightByDevice: Array<Promise<void> | null> = [];
  let stopCommandInFlightByDevice: Array<Promise<void> | null> = [];
  let recoveryRequiredByDevice: Array<string | null> = [];
  let emissionIndex = 0;

  const reportBackgroundError = (error: unknown): void => {
    lastBackgroundError = error;
    options.onBackgroundError?.(error);
  };

  try {
    baseUrl = await app.listen({
      host: LOOPBACK_HOST,
      port,
    });

    const gateways = deviceContexts.map((context) => {
      const edgeCredentials = edgeCredentialsByDevice.get(context.deviceId);
      if (edgeCredentials === undefined) {
        throw new Error("Local demo edge credential configuration is incomplete");
      }
      const api = new CentralApiClient(
        new FetchApiRequestExecutor({
          baseUrl,
          headers: () => ({
            [DEMO_AUTH_KEY_HEADER]: edgeCredentials.key,
          }),
        }),
      );

      return new EdgeGateway({
        farmId,
        deviceId: context.deviceId,
        api,
        device: {
          executeCommand: (command, persistTerminalAck) =>
            context.simulator.handleCommand(command, persistTerminalAck),
        },
        repository: edgeRepository,
        now,
      });
    });
    commandInFlightByDevice = gateways.map(() => null);
    stopCommandInFlightByDevice = gateways.map(() => null);
    recoveryRequiredByDevice = gateways.map(() => null);

    const forwardNextTelemetry = async (): Promise<void> => {
      const observedAt = now();
      for (const [deviceIndex, context] of deviceContexts.entries()) {
        const generatorContext = (previousValue: number | null) => ({
          emissionIndex,
          deviceId: context.deviceId,
          deviceIndex,
          previousValue,
          now: observedAt,
        });
        const generatedValues: Record<TelemetryMetric, number> = {
          temperature: normalizeTemperatureValue(temperatureGenerator(
            generatorContext(context.previousTelemetryValues.temperature),
          )),
          humidity: normalizePercentValue("humidity", humidityGenerator(
            generatorContext(context.previousTelemetryValues.humidity),
          )),
          illuminance: normalizeLuxValue(illuminanceGenerator(
            generatorContext(context.previousTelemetryValues.illuminance),
          )),
          water_level: normalizePercentValue("water level", waterLevelGenerator(
            generatorContext(context.previousTelemetryValues.water_level),
          )),
        };

        for (const metric of TELEMETRY_METRICS) {
          const telemetry = context.simulator.emitTelemetry(metric, generatedValues[metric]);
          const gateway = gateways[deviceIndex];
          if (gateway === undefined) {
            throw new Error("Local demo gateway configuration is incomplete");
          }
          await gateway.forwardTelemetry(telemetry);
          context.previousTelemetryValues[metric] = generatedValues[metric];
        }
      }

      emissionIndex += 1;
    };

    const startCommandPoll = (): void => {
      for (const [index, gateway] of gateways.entries()) {
        const processResult = (
          result: Awaited<ReturnType<EdgeGateway["processNextCommand"]>>,
        ): void => {
          if (
            result.kind === "recovery_required"
            && recoveryRequiredByDevice[index] !== result.commandId
          ) {
            recoveryRequiredByDevice[index] = result.commandId;
            reportBackgroundError(new Error(
              `Edge command ${result.commandId} requires device-state reconciliation and was not re-executed`,
            ));
          }
        };

        if (commandInFlightByDevice[index] === null) {
          commandInFlightByDevice[index] = runBackgroundTask(
            async () => processResult(await gateway.processNextCommand()),
            () => {
              commandInFlightByDevice[index] = null;
            },
            reportBackgroundError,
          );
        }

        if (stopCommandInFlightByDevice[index] === null) {
          stopCommandInFlightByDevice[index] = runBackgroundTask(
            async () => processResult(await gateway.processNextStopCommand()),
            () => {
              stopCommandInFlightByDevice[index] = null;
            },
            reportBackgroundError,
          );
        }
      }
    };

    await forwardNextTelemetry();
    startCommandPoll();
    await Promise.all([
      ...commandInFlightByDevice.map((task) => task ?? Promise.resolve()),
      ...stopCommandInFlightByDevice.map((task) => task ?? Promise.resolve()),
    ]);

    telemetryTimer = setInterval(() => {
      telemetryInFlight ??= runBackgroundTask(forwardNextTelemetry, () => {
        telemetryInFlight = null;
      }, reportBackgroundError);
    }, telemetryIntervalMs);
    commandTimer = setInterval(() => {
      startCommandPoll();
    }, commandPollIntervalMs);
  } catch (error) {
    try {
      await app.close();
    } catch {
      // Preserve the original startup error.
    }
    edgeRepository.close();
    store.close();
    throw error;
  }

  return {
    baseUrl,
    farmId,
    deviceId,
    deviceIds,
    databasePath,
    edgeDatabasePath,
    createHeaders: (role, principalId) => createDemoHeaders({
      demoKey,
      role,
      ...(principalId === undefined ? {} : { principalId }),
    }),
    getLastBackgroundError: () => lastBackgroundError,
    close: async () => {
      if (closePromise !== null) return closePromise;

      closePromise = (async () => {
        if (closed) return;
        closed = true;

        if (telemetryTimer !== null) {
          clearInterval(telemetryTimer);
          telemetryTimer = null;
        }
        if (commandTimer !== null) {
          clearInterval(commandTimer);
          commandTimer = null;
        }

        await Promise.allSettled([
          telemetryInFlight ?? Promise.resolve(),
          ...commandInFlightByDevice.map((task) => task ?? Promise.resolve()),
          ...stopCommandInFlightByDevice.map((task) => task ?? Promise.resolve()),
        ]);

        try {
          await app.close();
        } finally {
          edgeRepository.close();
          store.close();
        }
      })();

      return closePromise;
    },
  };
}

function createDemoAuthenticator(
  farmId: FarmId,
  demoKey: string,
  edgePrincipalsByKey: ReadonlyMap<string, EdgeAuthPrincipal>,
  store: SqliteSmartFarmStore,
): AuthenticateRequest {
  return (request) => {
    const key = readSingleHeader(request.headers[DEMO_AUTH_KEY_HEADER]);
    if (key === null) {
      return authenticateEdgeBearerCredential(request, store);
    }

    const edgePrincipal = edgePrincipalsByKey.get(key);
    if (edgePrincipal !== undefined) {
      return edgePrincipal;
    }

    if (key !== demoKey) return null;
    const bearerPrincipal = authenticateEdgeBearerCredential(request, store);
    if (bearerPrincipal !== null) {
      return bearerPrincipal;
    }

    const roleInput = readSingleHeader(request.headers[DEMO_AUTH_ROLE_HEADER]);
    if (roleInput === null || !isAuthRole(roleInput) || roleInput === "edge") return null;

    const principalId = readSingleHeader(request.headers[DEMO_AUTH_PRINCIPAL_HEADER])
      ?? `demo:${roleInput}`;
    if (principalId.trim().length === 0) return null;

    const principal: AuthPrincipal = {
      id: principalId,
      role: roleInput,
      farmIds: [farmId],
    };
    return principal;
  };
}

function createDemoEdgePrincipal(farmId: FarmId, deviceId: DeviceId): EdgeAuthPrincipal {
  return {
    id: `edge:local-demo:${deviceId}`,
    role: "edge",
    farmIds: [farmId],
    deviceScopes: [
      {
        farmId,
        deviceId,
      } satisfies EdgeDeviceScope,
    ],
  };
}

function createDemoEdgeKey(): string {
  return randomUUID();
}

function runBackgroundTask(
  operation: () => Promise<void>,
  onFinally: () => void,
  onError: (error: unknown) => void,
): Promise<void> {
  return operation()
    .catch((error: unknown) => {
      onError(error);
    })
    .finally(() => {
      onFinally();
    });
}

function readSingleHeader(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function isAuthRole(value: string): value is AuthRole {
  return value === "user" || value === "admin" || value === "edge";
}

function parseDatabasePath(value: string): string {
  if (value.trim() === "") {
    throw new Error("Local demo database path cannot be empty");
  }
  return value;
}

function resolveDatabasePath(value: string): string {
  const parsed = parseDatabasePath(value);
  return parsed === ":memory:" ? parsed : resolve(parsed);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

function parseDemoKey(value: string): string {
  if (value.trim() === "") {
    throw new Error("Local demo key cannot be empty");
  }
  return value;
}

function parsePort(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65_535) {
    throw new Error("Local demo port must be an integer between 0 and 65535");
  }
  return value;
}

function parsePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function normalizeTemperatureValue(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Local demo temperature generator must return a finite number");
  }
  return Number(value.toFixed(2));
}

function normalizePercentValue(label: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Local demo ${label} generator must return a finite number`);
  }
  return Number(value.toFixed(2));
}

function normalizeLuxValue(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Local demo illuminance generator must return a finite number");
  }
  return Math.round(value);
}

function defaultTemperatureGenerator(context: {
  readonly emissionIndex: number;
  readonly deviceIndex: number;
  readonly previousValue: number | null;
}): number {
  const deviceOffset = context.deviceIndex * 2.5;
  if (context.previousValue === null) {
    return DEFAULT_START_TEMPERATURE_CELSIUS + deviceOffset;
  }
  return DEFAULT_START_TEMPERATURE_CELSIUS + deviceOffset + cyclicOffset(context.emissionIndex, [
    0,
    0.25,
    0.1,
    0.35,
    0.15,
    -0.05,
  ]);
}

function defaultHumidityGenerator(context: {
  readonly emissionIndex: number;
  readonly deviceIndex: number;
  readonly previousValue: number | null;
}): number {
  const deviceOffset = context.deviceIndex * -4;
  if (context.previousValue === null) {
    return DEFAULT_START_HUMIDITY_PERCENT + deviceOffset;
  }
  return DEFAULT_START_HUMIDITY_PERCENT + deviceOffset + cyclicOffset(context.emissionIndex, [
    0,
    1.5,
    0.75,
    2.25,
    0.5,
    -0.5,
  ]);
}

function defaultIlluminanceGenerator(context: {
  readonly emissionIndex: number;
  readonly deviceIndex: number;
  readonly previousValue: number | null;
}): number {
  const deviceOffset = context.deviceIndex * 1_500;
  if (context.previousValue === null) {
    return DEFAULT_START_ILLUMINANCE_LUX + deviceOffset;
  }
  return DEFAULT_START_ILLUMINANCE_LUX + deviceOffset + cyclicOffset(context.emissionIndex, [
    0,
    750,
    300,
    1_050,
    450,
    150,
  ]);
}

function defaultWaterLevelGenerator(context: {
  readonly emissionIndex: number;
  readonly deviceIndex: number;
  readonly previousValue: number | null;
}, lowWaterRecoveryEmissionIndex: number): number {
  if (context.deviceIndex === 1) {
    if (context.emissionIndex < lowWaterRecoveryEmissionIndex) {
      return DEFAULT_LOW_WATER_LEVEL_PERCENT + cyclicOffset(context.emissionIndex, [0, -0.6, -1.1]);
    }
    return DEFAULT_RECOVERED_WATER_LEVEL_PERCENT + cyclicOffset(context.emissionIndex, [0, 0.4, -0.3]);
  }

  const deviceOffset = context.deviceIndex * -12;
  if (context.previousValue === null) {
    return DEFAULT_START_WATER_LEVEL_PERCENT + deviceOffset;
  }
  return DEFAULT_START_WATER_LEVEL_PERCENT + deviceOffset + cyclicOffset(context.emissionIndex, [
    0,
    -0.6,
    -1.1,
    -0.8,
    -0.4,
    -0.9,
  ]);
}

function maxPersistedTelemetrySequence(
  latestTelemetryByMetric: Readonly<Record<TelemetryMetric, { readonly sequence: number } | null>>,
): number {
  return Math.max(
    0,
    ...TELEMETRY_METRICS.map((metric) => latestTelemetryByMetric[metric]?.sequence ?? 0),
  );
}

function cyclicOffset(emissionIndex: number, offsets: readonly number[]): number {
  return offsets[emissionIndex % offsets.length] ?? 0;
}

function seedLocalDemoCatalog(
  store: SqliteSmartFarmStore,
  farmId: FarmId,
  deviceIds: readonly [DeviceId, DeviceId],
): void {
  const createdAt = "2026-07-17T00:00:00.000Z";
  const primaryDeviceId = deviceIds[0];
  const deviceSlug = primaryDeviceId.slice("device:".length);
  const areas: readonly GrowingArea[] = deviceIds.map((currentDeviceId, index) => ({
    schemaVersion: "smartfarm.growing-area.v1",
    id: GrowingAreaIdSchema.parse(`area:bed-${index + 1}`),
    farmId,
    name: `재배 베드 ${index + 1}`,
    kind: "bed",
    primaryDeviceId: currentDeviceId,
    status: "active",
    createdAt,
    updatedAt: createdAt,
  }));
  const cropCycleId = CropCycleIdSchema.parse("cycle:basil-2026");
  const cropCycle: CropCycleDetail = {
    schemaVersion: "smartfarm.crop-cycle-detail.v1",
    cycle: {
      schemaVersion: "smartfarm.crop-cycle.v1",
      id: cropCycleId,
      farmId,
      name: "2026 바질 재배",
      cropName: "바질",
      variety: "스위트 바질",
      status: "active",
      startedAt: createdAt,
      plannedEndAt: "2026-10-31T00:00:00.000Z",
      createdAt,
      updatedAt: createdAt,
    },
    areaIds: areas.map((area) => area.id),
  };

  for (const area of areas) {
    const existing = store.getGrowingArea(farmId, area.id);
    if (existing !== null && existing.primaryDeviceId !== area.primaryDeviceId) {
      throw new Error(
        `Local demo area ${area.id} is assigned to a different device; use the original device IDs or a fresh SQLite path`,
      );
    }
  }
  const existingCropCycle = store.getCropCycle(farmId, cropCycleId);
  if (
    existingCropCycle !== null
    && (
      existingCropCycle.cycle.status !== "active"
      || existingCropCycle.areaIds.length !== cropCycle.areaIds.length
      || cropCycle.areaIds.some((areaId) => !existingCropCycle.areaIds.includes(areaId))
    )
  ) {
    throw new Error(
      "Local demo crop cycle no longer matches the two-area seed; use a fresh SQLite path",
    );
  }

  if (store.getFarm(farmId) === null) {
    const farm: Farm = {
      schemaVersion: "smartfarm.farm.v1",
      id: farmId,
      name: "Local Demo Farm",
      timezone: "Asia/Seoul",
      createdAt,
    };
    store.upsertFarm(farm);
  }

  for (const [index, currentDeviceId] of deviceIds.entries()) {
    const existingDevice = store.getDevice(farmId, currentDeviceId);
    if (existingDevice === null) {
      const device: Device = {
        schemaVersion: "smartfarm.device.v1",
        id: currentDeviceId,
        farmId,
        name: `Demo Grow Bed ${index + 1}`,
        kind: "hybrid",
        capabilities: [
          "temperature",
          "humidity",
          "illuminance",
          "water_level",
          "pump",
          "timed_pump",
        ],
        status: "online",
        lastSeenAt: null,
      };
      store.upsertDevice(device);
    } else if (
      existingDevice.capabilities.includes("pump")
      && !existingDevice.capabilities.includes("timed_pump")
    ) {
      store.upsertDevice({
        ...existingDevice,
        capabilities: [...existingDevice.capabilities, "timed_pump"],
      });
    }
  }

  for (const area of areas) {
    if (store.getGrowingArea(farmId, area.id) === null) {
      store.upsertGrowingArea(area);
    }
  }

  if (existingCropCycle === null) {
    const result = store.createCropCycle(cropCycle);
    if (result.kind === "conflict") {
      throw new Error(`Failed to seed local demo crop cycle: ${result.reason}`);
    }
  }

  const irrigationStrategies: readonly IrrigationStrategy[] = [
    {
      schemaVersion: "smartfarm.irrigation-strategy.v1",
      id: IrrigationStrategyIdSchema.parse("strategy:basil-recovery"),
      version: 1,
      farmId,
      cycleId: cropCycleId,
      name: "저수위 회복 관수 시작",
      description:
        "호환성용 수동 프리셋입니다. 펌프 켜기 명령만 전송하며 자동 정지나 폐루프 안전 제어를 제공하지 않습니다.",
      pumpState: "on",
      status: "approved",
      createdAt,
      approvedAt: createdAt,
    },
    {
      schemaVersion: "smartfarm.irrigation-strategy.v1",
      id: IrrigationStrategyIdSchema.parse("strategy:basil-recovery"),
      version: 2,
      farmId,
      cycleId: cropCycleId,
      name: "저수위 회복 시간제 관수",
      description:
        `시뮬레이터 장치가 ${DEFAULT_TIMED_IRRIGATION_SECONDS}초 동안 실행한 뒤 로컬 타이머로 정지하고 최종 off를 확인합니다. 물리 인터록이나 폐루프 제어는 아닙니다.`,
      pumpState: "on",
      runDurationSeconds: DEFAULT_TIMED_IRRIGATION_SECONDS,
      status: "approved",
      createdAt: "2026-07-17T00:00:00.001Z",
      approvedAt: "2026-07-17T00:00:00.001Z",
    },
  ];
  for (const irrigationStrategy of irrigationStrategies) {
    const strategySeed = store.seedIrrigationStrategy(irrigationStrategy);
    if (strategySeed.kind === "conflict") {
      throw new Error(`Failed to seed local demo irrigation strategy: ${strategySeed.reason}`);
    }
  }

  const alarmRule: AlarmRule = {
    schemaVersion: "smartfarm.alarm-rule.v1",
    id: AlarmRuleIdSchema.parse("alarm-rule:bed-2-low-water"),
    farmId,
    cycleId: cropCycleId,
    areaId: GrowingAreaIdSchema.parse("area:bed-2"),
    deviceId: deviceIds[1],
    name: "2번 베드 저수위",
    metric: "water_level",
    comparison: "below",
    threshold: 68,
    severity: "critical",
    enabled: true,
    createdAt,
    updatedAt: createdAt,
  };
  const existingAlarmRule = store.listAlarmRules(farmId)
    .find((rule) => rule.id === alarmRule.id);
  if (existingAlarmRule === undefined) {
    store.upsertAlarmRule(alarmRule);
  } else if (
    existingAlarmRule.cycleId !== alarmRule.cycleId
    || existingAlarmRule.areaId !== alarmRule.areaId
    || existingAlarmRule.deviceId !== alarmRule.deviceId
    || existingAlarmRule.metric !== alarmRule.metric
    || existingAlarmRule.comparison !== alarmRule.comparison
    || existingAlarmRule.threshold !== alarmRule.threshold
    || existingAlarmRule.severity !== alarmRule.severity
    || existingAlarmRule.enabled !== alarmRule.enabled
  ) {
    throw new Error(
      "Local demo alarm rule no longer matches the bed-2 low-water scenario; use a fresh SQLite path",
    );
  }

  for (const crop of buildSeedCrops(farmId, primaryDeviceId, deviceSlug, createdAt)) {
    if (store.getCrop(farmId, crop.id) === null) {
      store.upsertCrop(crop);
    }
  }
}

function buildSeedCrops(
  farmId: FarmId,
  deviceId: DeviceId,
  deviceSlug: string,
  createdAt: string,
): readonly CropRecord[] {
  return [
    {
      schemaVersion: "smartfarm.crop.v1",
      id: CropIdSchema.parse(`crop:basil-${deviceSlug}`),
      farmId,
      deviceId,
      name: "Basil",
      healthStatus: "good",
      managerName: "Local Demo Operator",
      notes: "Demo greenhouse basil bed",
      createdAt,
      updatedAt: createdAt,
    },
    {
      schemaVersion: "smartfarm.crop.v1",
      id: CropIdSchema.parse(`crop:lettuce-${deviceSlug}`),
      farmId,
      deviceId,
      name: "Lettuce",
      healthStatus: "fair",
      managerName: "Local Demo Operator",
      notes: "Demo hydroponic lettuce bed",
      createdAt: "2026-07-17T00:05:00.000Z",
      updatedAt: "2026-07-17T00:05:00.000Z",
    },
  ];
}
