import assert from "node:assert/strict";
import {
  AuditEventListResponseSchema,
  CommandListResponseSchema,
  CommandProjectionSchema,
  DeviceIdSchema,
  FarmIdSchema,
  LatestTelemetryResponseSchema,
  PendingCommandResponseSchema,
  TelemetryReceiptSchema,
} from "../packages/contracts/dist/index.js";
import { InMemorySmartFarmStore, buildApi } from "../services/api/dist/index.js";
import { DeviceSimulator } from "../tools/device-simulator/dist/index.js";

const demoFarmId = FarmIdSchema.parse("farm:demo");
const demoDeviceId = DeviceIdSchema.parse("device:bed-1");
const secondDemoDeviceId = DeviceIdSchema.parse("device:bed-2");
const demoEdgeScope = { farmId: demoFarmId, deviceId: demoDeviceId };
const now = new Date("2026-07-17T00:00:10.000Z");
const store = new InMemorySmartFarmStore();
store.upsertFarm({
  schemaVersion: "smartfarm.farm.v1",
  id: demoFarmId,
  name: "Smoke Farm",
  timezone: "Asia/Seoul",
  createdAt: "2026-07-17T00:00:00.000Z",
});
store.upsertDevice({
  schemaVersion: "smartfarm.device.v1",
  id: demoDeviceId,
  farmId: demoFarmId,
  name: "Smoke Bed 1",
  kind: "hybrid",
  capabilities: ["temperature", "pump"],
  status: "online",
  lastSeenAt: null,
});
store.upsertDevice({
  schemaVersion: "smartfarm.device.v1",
  id: secondDemoDeviceId,
  farmId: demoFarmId,
  name: "Smoke Bed 2",
  kind: "hybrid",
  capabilities: ["temperature", "pump"],
  status: "online",
  lastSeenAt: null,
});
const app = buildApi({
  authenticate: (request) => {
    const role = request.headers["x-smoke-principal"];

    if (role === "edge" || role === "edge-bed-1") {
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
  createCommandId: () => "command:smoke-000001",
  now: () => new Date(now),
  store,
});
const simulator = new DeviceSimulator({
  farmId: demoFarmId,
  deviceId: demoDeviceId,
  now: () => new Date(now),
});
const secondSimulator = new DeviceSimulator({
  farmId: demoFarmId,
  deviceId: secondDemoDeviceId,
  now: () => new Date(now),
});
const farmPath = encodeURIComponent(demoFarmId);
const devicePath = encodeURIComponent(simulator.deviceId);
const secondDevicePath = encodeURIComponent(secondSimulator.deviceId);

try {
  const telemetry = simulator.emitTemperature(24.5);
  const accepted = await app.inject({
    method: "POST",
    url: `/v1/farms/${farmPath}/telemetry`,
    headers: { "x-smoke-principal": "edge" },
    payload: telemetry,
  });
  assert.equal(accepted.statusCode, 202);
  assert.equal(TelemetryReceiptSchema.parse(accepted.json()).status, "accepted");

  const wrongDeviceTelemetry = await app.inject({
    method: "POST",
    url: `/v1/farms/${farmPath}/telemetry`,
    headers: { "x-smoke-principal": "edge-bed-1" },
    payload: secondSimulator.emitTemperature(27.25),
  });
  assert.equal(wrongDeviceTelemetry.statusCode, 403);

  const latestResponse = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/devices/${devicePath}/telemetry/latest?metric=temperature`,
    headers: { "x-smoke-principal": "user" },
  });
  assert.equal(latestResponse.statusCode, 200);
  const latest = LatestTelemetryResponseSchema.parse(latestResponse.json());
  assert.equal(latest.telemetry.id, telemetry.id);

  const missingSecondaryLatest = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/devices/${secondDevicePath}/telemetry/latest?metric=temperature`,
    headers: { "x-smoke-principal": "user" },
  });
  assert.equal(missingSecondaryLatest.statusCode, 404);

  const commandResponse = await app.inject({
    method: "POST",
    url: `/v1/farms/${farmPath}/commands`,
    headers: { "x-smoke-principal": "user" },
    payload: {
      deviceId: simulator.deviceId,
      state: "on",
      idempotencyKey: "smoke-pump-000001",
      ttlSeconds: 60,
    },
  });
  assert.equal(commandResponse.statusCode, 202);
  const pending = CommandProjectionSchema.parse(commandResponse.json());
  assert.equal(pending.status, "pending");

  const fullScopePull = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/edge/commands/next?deviceId=${devicePath}`,
    headers: { "x-smoke-principal": "edge-bed-1" },
  });
  assert.equal(fullScopePull.statusCode, 200);
  assert.equal(PendingCommandResponseSchema.parse(fullScopePull.json()).command.id, pending.command.id);

  const forbiddenNext = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/edge/commands/next?deviceId=${secondDevicePath}`,
    headers: { "x-smoke-principal": "edge-bed-1" },
  });
  assert.equal(forbiddenNext.statusCode, 403);

  const forbiddenStop = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/edge/commands/next-stop?deviceId=${secondDevicePath}`,
    headers: { "x-smoke-principal": "edge-bed-1" },
  });
  assert.equal(forbiddenStop.statusCode, 403);

  const spoofedWrongDeviceAck = new DeviceSimulator({
    farmId: demoFarmId,
    deviceId: secondDemoDeviceId,
    now: () => new Date(now),
  }).handleCommand({
    ...pending.command,
    deviceId: secondDemoDeviceId,
  });
  const forbiddenAck = await app.inject({
    method: "POST",
    url: `/v1/farms/${farmPath}/command-acks`,
    headers: { "x-smoke-principal": "edge-bed-1" },
    payload: spoofedWrongDeviceAck,
  });
  assert.equal(forbiddenAck.statusCode, 403);

  const stillPending = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/commands/${encodeURIComponent(pending.command.id)}`,
    headers: { "x-smoke-principal": "user" },
  });
  assert.equal(stillPending.statusCode, 200);
  assert.equal(CommandProjectionSchema.parse(stillPending.json()).status, "pending");

  const secondDeviceCommands = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/commands?deviceId=${secondDevicePath}&limit=10`,
    headers: { "x-smoke-principal": "user" },
  });
  assert.equal(secondDeviceCommands.statusCode, 200);
  assert.equal(CommandListResponseSchema.parse(secondDeviceCommands.json()).commands.length, 0);

  const audit = await app.inject({
    method: "GET",
    url: `/v1/farms/${farmPath}/audit-events?includeUnscoped=true&limit=10`,
    headers: { "x-smoke-principal": "user" },
  });
  assert.equal(audit.statusCode, 200);
  assert.deepEqual(AuditEventListResponseSchema.parse(audit.json()).auditEvents, []);

  const ack = simulator.handleCommand(pending.command);
  const ackResponse = await app.inject({
    method: "POST",
    url: `/v1/farms/${farmPath}/command-acks`,
    headers: { "x-smoke-principal": "edge-bed-1" },
    payload: ack,
  });
  assert.equal(ackResponse.statusCode, 200);
  const completed = CommandProjectionSchema.parse(ackResponse.json());
  assert.equal(completed.status, "acknowledged");
  assert.equal(completed.ack?.result?.pumpState, "on");
  assert.equal(simulator.currentPumpState(), "on");

  process.stdout.write("Simulator and central API telemetry/command roundtrip passed.\n");
} finally {
  await app.close();
}
