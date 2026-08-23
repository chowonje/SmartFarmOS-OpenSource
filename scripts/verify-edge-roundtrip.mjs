import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CommandProjectionSchema,
  DeviceIdSchema,
  FarmIdSchema,
  LatestTelemetryResponseSchema,
} from "../packages/contracts/dist/index.js";
import { InMemorySmartFarmStore, buildApi } from "../services/api/dist/index.js";
import {
  CentralApiClient,
  EdgeGateway,
  FetchApiRequestExecutor,
  SqliteEdgeExecutionRepository,
} from "../services/edge/dist/index.js";
import { DeviceSimulator } from "../tools/device-simulator/dist/index.js";

const demoFarmId = FarmIdSchema.parse("farm:demo");
const demoDeviceId = DeviceIdSchema.parse("device:bed-1");
const secondDemoDeviceId = DeviceIdSchema.parse("device:bed-2");
const demoEdgeScope = { farmId: demoFarmId, deviceId: demoDeviceId };
const secondDemoEdgeScope = { farmId: demoFarmId, deviceId: secondDemoDeviceId };
const fixedNow = new Date("2026-07-17T00:00:10.000Z");
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
    if (role === "edge-bed-2") {
      return {
        id: "edge:smoke:device-bed-2",
        role: "edge",
        farmIds: [demoFarmId],
        deviceScopes: [secondDemoEdgeScope],
      };
    }
    if (role === "user") {
      return { id: "user:smoke", role: "user", farmIds: [demoFarmId] };
    }
    return null;
  },
  createCommandId: () => {
    commandSequence += 1;
    return `command:edge-smoke-${commandSequence.toString().padStart(6, "0")}`;
  },
  now: () => new Date(fixedNow),
  store,
});

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
const edgeDirectory = await mkdtemp(join(tmpdir(), "smartfarm-edge-roundtrip-"));
const edgeDatabasePath = join(edgeDirectory, "edge.sqlite");
let edgeRepository = new SqliteEdgeExecutionRepository({ path: edgeDatabasePath });
let commandSequence = 0;

try {
  const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  const primaryApi = new CentralApiClient(new FetchApiRequestExecutor({
    baseUrl,
    headers: () => ({ "x-smoke-principal": "edge-bed-1" }),
  }));
  const secondaryApi = new CentralApiClient(new FetchApiRequestExecutor({
    baseUrl,
    headers: () => ({ "x-smoke-principal": "edge-bed-2" }),
  }));
  const uploadFailingApi = {
    submitTelemetry: (farmId, telemetry) => primaryApi.submitTelemetry(farmId, telemetry),
    pullNextCommand: (farmId, deviceId) => primaryApi.pullNextCommand(farmId, deviceId),
    submitAck: async () => {
      throw new Error("simulated ACK upload outage");
    },
  };
  let firstDeviceCalls = 0;
  const edge = new EdgeGateway({
    farmId: demoFarmId,
    deviceId: simulator.deviceId,
    api: uploadFailingApi,
    device: {
      executeCommand: (command, persistTerminalAck) => {
        firstDeviceCalls += 1;
        return simulator.handleCommand(command, persistTerminalAck);
      },
    },
    repository: edgeRepository,
    now: () => new Date(fixedNow),
  });
  let secondDeviceCalls = 0;
  const secondEdge = new EdgeGateway({
    farmId: demoFarmId,
    deviceId: secondSimulator.deviceId,
    api: secondaryApi,
    device: {
      executeCommand: (command, persistTerminalAck) => {
        secondDeviceCalls += 1;
        return secondSimulator.handleCommand(command, persistTerminalAck);
      },
    },
    repository: edgeRepository,
    now: () => new Date(fixedNow),
  });

  const telemetry = simulator.emitTemperature(24.5);
  const receipt = await edge.forwardTelemetry(telemetry);
  assert.equal(receipt.status, "accepted");
  const secondTelemetry = secondSimulator.emitTemperature(26.75);
  const secondReceipt = await secondEdge.forwardTelemetry(secondTelemetry);
  assert.equal(secondReceipt.status, "accepted");

  await assert.rejects(
    primaryApi.submitTelemetry(demoFarmId, secondSimulator.emitTemperature(27.5)),
    isForbiddenCentralApiError,
  );
  await assert.rejects(
    primaryApi.pullNextCommand(demoFarmId, secondDemoDeviceId),
    isForbiddenCentralApiError,
  );
  await assert.rejects(
    secondaryApi.pullNextCommand(demoFarmId, demoDeviceId),
    isForbiddenCentralApiError,
  );

  const latestResponse = await userRequest(
    baseUrl,
    `/v1/farms/${farmPath}/devices/${devicePath}/telemetry/latest?metric=temperature`,
  );
  assert.equal(latestResponse.status, 200);
  const latest = LatestTelemetryResponseSchema.parse(latestResponse.body);
  assert.equal(latest.telemetry.id, telemetry.id);
  const secondLatestResponse = await userRequest(
    baseUrl,
    `/v1/farms/${farmPath}/devices/${secondDevicePath}/telemetry/latest?metric=temperature`,
  );
  assert.equal(secondLatestResponse.status, 200);
  const secondLatest = LatestTelemetryResponseSchema.parse(secondLatestResponse.body);
  assert.equal(secondLatest.telemetry.id, secondTelemetry.id);

  const createResponse = await userRequest(
    baseUrl,
    `/v1/farms/${farmPath}/commands`,
    {
      method: "POST",
      body: JSON.stringify({
        deviceId: simulator.deviceId,
        state: "on",
        idempotencyKey: "edge-smoke-pump-000001",
        ttlSeconds: 60,
      }),
    },
  );
  assert.equal(createResponse.status, 202);
  const pending = CommandProjectionSchema.parse(createResponse.body);
  assert.equal(pending.status, "pending");
  const secondCreateResponse = await userRequest(
    baseUrl,
    `/v1/farms/${farmPath}/commands`,
    {
      method: "POST",
      body: JSON.stringify({
        deviceId: secondSimulator.deviceId,
        state: "on",
        idempotencyKey: "edge-smoke-pump-000002",
        ttlSeconds: 60,
      }),
    },
  );
  assert.equal(secondCreateResponse.status, 202);
  const secondPending = CommandProjectionSchema.parse(secondCreateResponse.body);
  assert.equal(secondPending.status, "pending");

  const spoofedWrongDeviceAck = new DeviceSimulator({
    farmId: demoFarmId,
    deviceId: secondDemoDeviceId,
    now: () => new Date(fixedNow),
  }).handleCommand(secondPending.command);
  await assert.rejects(
    primaryApi.submitAck(demoFarmId, spoofedWrongDeviceAck),
    isForbiddenCentralApiError,
  );

  await assert.rejects(edge.processNextCommand(), /simulated ACK upload outage/);
  assert.equal(firstDeviceCalls, 1);
  assert.equal(edgeRepository.get(pending.command.id)?.ackDelivery, "pending");

  const secondProcessed = await secondEdge.processNextCommand();
  assert.equal(secondProcessed.kind, "processed");
  assert.equal(
    secondProcessed.kind === "processed" ? secondProcessed.projection.status : null,
    "acknowledged",
  );
  assert.equal(secondDeviceCalls, 1);
  assert.equal(secondSimulator.currentPumpState(), "on");

  edgeRepository.close();
  edgeRepository = new SqliteEdgeExecutionRepository({ path: edgeDatabasePath });
  let replayDeviceCalls = 0;
  const restartedEdge = new EdgeGateway({
    farmId: demoFarmId,
    deviceId: simulator.deviceId,
    api: primaryApi,
    device: {
      executeCommand: () => {
        replayDeviceCalls += 1;
        throw new Error("A recovered ACK must not execute the device again");
      },
    },
    repository: edgeRepository,
    now: () => new Date(fixedNow),
  });
  const processed = await restartedEdge.processNextCommand();
  assert.equal(processed.kind, "processed");
  assert.equal(
    processed.kind === "processed" ? processed.projection.status : null,
    "acknowledged",
  );
  assert.equal(replayDeviceCalls, 0);
  assert.equal(edgeRepository.get(pending.command.id)?.ackDelivery, "delivered");
  assert.equal(simulator.currentPumpState(), "on");

  const projectionResponse = await userRequest(
    baseUrl,
    `/v1/farms/${farmPath}/commands/${encodeURIComponent(pending.command.id)}`,
  );
  assert.equal(projectionResponse.status, 200);
  const completed = CommandProjectionSchema.parse(projectionResponse.body);
  assert.equal(completed.status, "acknowledged");
  assert.equal(completed.ack?.result?.pumpState, "on");
  const secondProjectionResponse = await userRequest(
    baseUrl,
    `/v1/farms/${farmPath}/commands/${encodeURIComponent(secondPending.command.id)}`,
  );
  assert.equal(secondProjectionResponse.status, 200);
  const secondCompleted = CommandProjectionSchema.parse(secondProjectionResponse.body);
  assert.equal(secondCompleted.status, "acknowledged");
  assert.equal(secondCompleted.ack?.result?.pumpState, "on");

  process.stdout.write(
    "Simulator, durable Edge ACK restart recovery, and central API real-socket roundtrip passed.\n",
  );
} finally {
  edgeRepository.close();
  await app.close();
  await rm(edgeDirectory, { recursive: true, force: true });
}

async function userRequest(baseUrl, path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  headers.set("x-smoke-principal", "user");
  if (options.body !== undefined) headers.set("content-type", "application/json");

  const response = await fetch(new URL(path, baseUrl), {
    ...options,
    headers,
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  return {
    status: response.status,
    body: response.status === 204 ? null : await response.json(),
  };
}

function isForbiddenCentralApiError(error) {
  return typeof error === "object"
    && error !== null
    && "statusCode" in error
    && error.statusCode === 403
    && "code" in error
    && error.code === "forbidden";
}
