import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  CommandListResponseSchema,
  CommandProjectionSchema,
  DeviceIdSchema,
  FarmIdSchema,
  LatestTelemetryResponseSchema,
  PendingCommandResponseSchema,
  TelemetryReceiptSchema,
} from "../packages/contracts/dist/index.js";
import { buildApi } from "../services/api/dist/index.js";
import {
  SQLITE_SCHEMA_VERSION,
  SqliteSmartFarmStore,
} from "../services/api/dist/sqlite-store.js";
import { DeviceSimulator } from "../tools/device-simulator/dist/index.js";

const demoFarmId = FarmIdSchema.parse("farm:demo");
const demoDeviceId = DeviceIdSchema.parse("device:bed-1");
const secondDemoDeviceId = DeviceIdSchema.parse("device:bed-2");
const demoEdgeScope = { farmId: demoFarmId, deviceId: demoDeviceId };
const fixedNow = new Date("2026-07-17T00:00:10.000Z");
const directory = await mkdtemp(join(tmpdir(), "smartfarm-persistence-smoke-"));
const databasePath = join(directory, "smartfarm.sqlite");
const simulator = new DeviceSimulator({
  farmId: demoFarmId,
  deviceId: demoDeviceId,
  now: () => new Date(fixedNow),
});
const secondSimulator = new DeviceSimulator({
  farmId: demoFarmId,
  deviceId: secondDemoDeviceId,
  now: () => new Date(fixedNow),
});
const farmPath = encodeURIComponent(demoFarmId);
const devicePath = encodeURIComponent(simulator.deviceId);
const secondDevicePath = encodeURIComponent(secondSimulator.deviceId);
const telemetrySamples = [
  simulator.emitTelemetry("temperature", 24.5),
  simulator.emitTelemetry("humidity", 58.25),
  simulator.emitTelemetry("illuminance", 12_500),
  simulator.emitTelemetry("water_level", 76.5),
];
let commandSequence = 0;
let app = null;
let store = null;

try {
  store = new SqliteSmartFarmStore({ path: databasePath });
  seedCatalog(store);
  app = buildPersistentApi(store);

  for (const telemetry of telemetrySamples) {
    const accepted = await app.inject({
      method: "POST",
      url: `/v1/farms/${farmPath}/telemetry`,
      headers: { "x-smoke-principal": "edge" },
      payload: telemetry,
    });
    assert.equal(accepted.statusCode, 202);
    assert.equal(TelemetryReceiptSchema.parse(accepted.json()).status, "accepted");
  }

  const forbiddenTelemetry = await app.inject({
    method: "POST",
    url: `/v1/farms/${farmPath}/telemetry`,
    headers: { "x-smoke-principal": "edge-bed-1" },
    payload: secondSimulator.emitTemperature(25.75),
  });
  assert.equal(forbiddenTelemetry.statusCode, 403);

  const created = await app.inject({
    method: "POST",
    url: `/v1/farms/${farmPath}/commands`,
    headers: { "x-smoke-principal": "user" },
    payload: {
      deviceId: simulator.deviceId,
      state: "on",
      idempotencyKey: "persistence-smoke-pump-000001",
      ttlSeconds: 60,
    },
  });
  assert.equal(created.statusCode, 202);
  const pending = CommandProjectionSchema.parse(created.json());

  const forbiddenPull = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/edge/commands/next?deviceId=${secondDevicePath}`,
    headers: { "x-smoke-principal": "edge-bed-1" },
  });
  assert.equal(forbiddenPull.statusCode, 403);

  const pulled = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/edge/commands/next?deviceId=${devicePath}`,
    headers: { "x-smoke-principal": "edge-bed-1" },
  });
  assert.equal(pulled.statusCode, 200);
  const command = PendingCommandResponseSchema.parse(pulled.json()).command;
  assert.equal(command.id, pending.command.id);

  const forbiddenAck = await app.inject({
    method: "POST",
    url: `/v1/farms/${farmPath}/command-acks`,
    headers: { "x-smoke-principal": "edge-bed-1" },
    payload: new DeviceSimulator({
      farmId: demoFarmId,
      deviceId: secondDemoDeviceId,
      now: () => new Date(fixedNow),
    }).handleCommand({
      ...command,
      deviceId: secondDemoDeviceId,
    }),
  });
  assert.equal(forbiddenAck.statusCode, 403);

  const acknowledged = await app.inject({
    method: "POST",
    url: `/v1/farms/${farmPath}/command-acks`,
    headers: { "x-smoke-principal": "edge-bed-1" },
    payload: simulator.handleCommand(command),
  });
  assert.equal(acknowledged.statusCode, 200);
  assert.equal(CommandProjectionSchema.parse(acknowledged.json()).status, "acknowledged");

  await app.close();
  app = null;
  store.close();
  store = null;

  store = new SqliteSmartFarmStore({ path: databasePath });
  app = buildPersistentApi(store);

  for (const telemetry of telemetrySamples) {
    const replayed = await app.inject({
      method: "POST",
      url: `/v1/farms/${farmPath}/telemetry`,
      headers: { "x-smoke-principal": "edge" },
      payload: telemetry,
    });
    assert.equal(replayed.statusCode, 200);
    assert.equal(TelemetryReceiptSchema.parse(replayed.json()).status, "replayed");

    const latestResponse = await app.inject({
      method: "GET",
      url: `/v1/farms/${farmPath}/devices/${devicePath}/telemetry/latest?metric=${telemetry.metric}`,
      headers: { "x-smoke-principal": "user" },
    });
    assert.equal(latestResponse.statusCode, 200);
    assert.equal(
      LatestTelemetryResponseSchema.parse(latestResponse.json()).telemetry.id,
      telemetry.id,
    );
  }

  const missingSecondaryLatest = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/devices/${secondDevicePath}/telemetry/latest?metric=temperature`,
    headers: { "x-smoke-principal": "user" },
  });
  assert.equal(missingSecondaryLatest.statusCode, 404);

  const persistedForbiddenPull = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/edge/commands/next?deviceId=${secondDevicePath}`,
    headers: { "x-smoke-principal": "edge-bed-1" },
  });
  assert.equal(persistedForbiddenPull.statusCode, 403);

  const createdAfterRestart = await app.inject({
    method: "POST",
    url: `/v1/farms/${farmPath}/commands`,
    headers: { "x-smoke-principal": "user" },
    payload: {
      deviceId: simulator.deviceId,
      state: "off",
      idempotencyKey: "persistence-smoke-pump-000002",
      ttlSeconds: 60,
    },
  });
  assert.equal(createdAfterRestart.statusCode, 202);
  const secondPending = CommandProjectionSchema.parse(createdAfterRestart.json());

  const secondPull = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/edge/commands/next?deviceId=${devicePath}`,
    headers: { "x-smoke-principal": "edge-bed-1" },
  });
  assert.equal(secondPull.statusCode, 200);
  const secondCommand = PendingCommandResponseSchema.parse(secondPull.json()).command;
  assert.equal(secondCommand.id, secondPending.command.id);

  const persistedForbiddenAck = await app.inject({
    method: "POST",
    url: `/v1/farms/${farmPath}/command-acks`,
    headers: { "x-smoke-principal": "edge-bed-1" },
    payload: new DeviceSimulator({
      farmId: demoFarmId,
      deviceId: secondDemoDeviceId,
      now: () => new Date(fixedNow),
    }).handleCommand({
      ...secondCommand,
      deviceId: secondDemoDeviceId,
    }),
  });
  assert.equal(persistedForbiddenAck.statusCode, 403);

  const acknowledgedAfterRestart = await app.inject({
    method: "POST",
    url: `/v1/farms/${farmPath}/command-acks`,
    headers: { "x-smoke-principal": "edge-bed-1" },
    payload: simulator.handleCommand(secondCommand),
  });
  assert.equal(acknowledgedAfterRestart.statusCode, 200);
  assert.equal(CommandProjectionSchema.parse(acknowledgedAfterRestart.json()).status, "acknowledged");

  const commandResponse = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/commands/${encodeURIComponent(pending.command.id)}`,
    headers: { "x-smoke-principal": "user" },
  });
  assert.equal(commandResponse.statusCode, 200);
  const persisted = CommandProjectionSchema.parse(commandResponse.json());
  assert.equal(persisted.status, "acknowledged");
  assert.equal(persisted.ack?.result?.pumpState, "on");
  const secondCommandResponse = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/commands/${encodeURIComponent(secondPending.command.id)}`,
    headers: { "x-smoke-principal": "user" },
  });
  assert.equal(secondCommandResponse.statusCode, 200);
  const secondPersisted = CommandProjectionSchema.parse(secondCommandResponse.json());
  assert.equal(secondPersisted.status, "acknowledged");
  assert.equal(secondPersisted.ack?.result?.pumpState, "off");

  const secondDeviceCommands = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/commands?deviceId=${secondDevicePath}&limit=10`,
    headers: { "x-smoke-principal": "user" },
  });
  assert.equal(secondDeviceCommands.statusCode, 200);
  assert.equal(CommandListResponseSchema.parse(secondDeviceCommands.json()).commands.length, 0);

  await app.close();
  app = null;
  store.close();
  store = null;

  const inspection = new DatabaseSync(databasePath, { readOnly: true });
  const integrity = inspection.prepare("PRAGMA integrity_check").get();
  const version = inspection.prepare("PRAGMA user_version").get();
  inspection.close();
  assert.equal(integrity.integrity_check, "ok");
  assert.equal(version.user_version, SQLITE_SCHEMA_VERSION);

  process.stdout.write(
    "Central API environment telemetry and command lifecycle survived a SQLite restart.\n",
  );
} finally {
  if (app !== null) await app.close();
  if (store !== null) store.close();
  await rm(directory, { recursive: true, force: true });
}

function buildPersistentApi(databaseStore) {
  return buildApi({
    authenticate: (request) => {
      const role = request.headers["x-smoke-principal"];

      if (role === "edge") {
        return {
          id: "edge:smoke:device-bed-1",
          role: "edge",
          farmIds: [demoFarmId],
          deviceScopes: [demoEdgeScope],
        };
      }
      if (role === "edge-bed-1") {
        return {
          id: "edge:smoke:device-bed-1",
          role: "edge",
          farmIds: [demoFarmId],
          deviceScopes: [demoEdgeScope],
        };
      }
      if (role === "user") {
        return { id: "user:smoke", role: "user", farmIds: [demoFarmId] };
      }
      return null;
    },
    createCommandId: () => {
      commandSequence += 1;
      return `command:persistence-smoke-${commandSequence.toString().padStart(6, "0")}`;
    },
    now: () => new Date(fixedNow),
    store: databaseStore,
  });
}

function seedCatalog(databaseStore) {
  databaseStore.upsertFarm({
    schemaVersion: "smartfarm.farm.v1",
    id: demoFarmId,
    name: "Persistence Smoke Farm",
    timezone: "Asia/Seoul",
    createdAt: fixedNow.toISOString(),
  });
  databaseStore.upsertDevice({
    schemaVersion: "smartfarm.device.v1",
    id: simulator.deviceId,
    farmId: demoFarmId,
    name: "Persistence Smoke Device",
    kind: "hybrid",
    capabilities: ["temperature", "humidity", "illuminance", "water_level", "pump"],
    status: "online",
    lastSeenAt: fixedNow.toISOString(),
  });
  databaseStore.upsertDevice({
    schemaVersion: "smartfarm.device.v1",
    id: secondSimulator.deviceId,
    farmId: demoFarmId,
    name: "Persistence Smoke Device 2",
    kind: "hybrid",
    capabilities: ["temperature", "humidity", "illuminance", "water_level", "pump"],
    status: "online",
    lastSeenAt: fixedNow.toISOString(),
  });
}
