import assert from "node:assert/strict";
import test from "node:test";
import {
  AlarmRuleSchema,
  AlarmListResponseSchema,
  AlarmResponseSchema,
  ApplyIrrigationStrategyRequestSchema,
  AuditEventListResponseSchema,
  ApiErrorSchema,
  CommandAckSchema,
  CommandListQuerySchema,
  CommandListResponseSchema,
  CommandSchema,
  CommandProjectionSchema,
  CropCycleIdSchema,
  CropCycleListResponseSchema,
  CropCycleResponseSchema,
  CropIdSchema,
  CropResponseSchema,
  CropListResponseSchema,
  DeviceIdSchema,
  DeviceListResponseSchema,
  FarmControlProfileResponseSchema,
  FarmIdSchema,
  FarmListResponseSchema,
  GrowingAreaIdSchema,
  GrowingAreaListResponseSchema,
  IrrigationStrategyListResponseSchema,
  IrrigationStrategySchema,
  LatestTelemetryResponseSchema,
  PendingCommandResponseSchema,
  PutFarmControlProfileRequestSchema,
  StrategyApplicationResponseSchema,
  TelemetryHistoryResponseSchema,
  TelemetryReceiptSchema,
  TelemetrySchema,
  commandExpectedFinalPumpState,
} from "@smartfarm-os/contracts";
import type { ModuleRegistryConfigurationV1 } from "@smartfarm-os/module-sdk";
import { DEFAULT_BUILT_IN_MODULE_CONFIGURATION } from "@smartfarm-os/module-sdk/builtins";
import type { FastifyRequest } from "fastify";
import { buildApi } from "./app.js";
import type { AuthPrincipal, AuthenticateRequest, EdgeDeviceScope } from "./auth.js";
import { InMemorySmartFarmStore } from "./store.js";

const fixedNow = new Date("2026-07-17T00:00:10.000Z");
const demoFarmId = FarmIdSchema.parse("farm:demo");
const otherFarmId = FarmIdSchema.parse("farm:other");
const demoDeviceId = DeviceIdSchema.parse("device:bed-1");
const secondDemoDeviceId = DeviceIdSchema.parse("device:bed-2");
const sensorOnlyDeviceId = DeviceIdSchema.parse("device:sensor-only");
const otherFarmOnlyDeviceId = DeviceIdSchema.parse("device:other-bed-9");
const demoFarmPath = encodeURIComponent(demoFarmId);
const demoDevicePath = encodeURIComponent(demoDeviceId);
const eastAreaId = GrowingAreaIdSchema.parse("area:east-bed");
const westAreaId = GrowingAreaIdSchema.parse("area:west-bed");
const activeCycleId = CropCycleIdSchema.parse("cycle:basil-week-31");
const nextCycleId = CropCycleIdSchema.parse("cycle:basil-week-32");
const basilCropId = CropIdSchema.parse("crop:basil-bed-1");
const lettuceCropId = CropIdSchema.parse("crop:lettuce-bed-1");

function edgeDeviceScope(farmId: typeof demoFarmId, deviceId: typeof demoDeviceId): EdgeDeviceScope {
  return { farmId, deviceId };
}

function buildTestApi(moduleConfiguration?: ModuleRegistryConfigurationV1) {
  let commandSequence = 0;
  let cropSequence = 0;
  let cropCycleSequence = 0;
  let strategyApplicationSequence = 0;

  return buildApi({
    authenticate: authenticateTestPrincipal,
    createCommandId: () => {
      commandSequence += 1;
      return `command:test-${commandSequence.toString().padStart(6, "0")}`;
    },
    createCropId: () => {
      cropSequence += 1;
      return `crop:test-${cropSequence.toString().padStart(6, "0")}`;
    },
    createCropCycleId: () => {
      cropCycleSequence += 1;
      return `cycle:test-${cropCycleSequence.toString().padStart(6, "0")}`;
    },
    createStrategyApplicationId: () => {
      strategyApplicationSequence += 1;
      return `strategy-application:test-${strategyApplicationSequence.toString().padStart(6, "0")}`;
    },
    now: () => new Date(fixedNow),
    store: buildSeededStore(),
    ...(moduleConfiguration === undefined ? {} : { moduleConfiguration }),
  });
}

function buildTestApiWithStore(
  store: InMemorySmartFarmStore,
  moduleConfiguration?: ModuleRegistryConfigurationV1,
) {
  return buildTestApiWithAuthenticate(authenticateTestPrincipal, store, moduleConfiguration);
}

function buildTestApiWithAuthenticate(
  authenticate: AuthenticateRequest,
  store = buildSeededStore(),
  moduleConfiguration?: ModuleRegistryConfigurationV1,
) {
  let commandSequence = 0;
  let cropSequence = 0;
  let cropCycleSequence = 0;
  let strategyApplicationSequence = 0;

  return buildApi({
    authenticate,
    createCommandId: () => {
      commandSequence += 1;
      return `command:test-${commandSequence.toString().padStart(6, "0")}`;
    },
    createCropId: () => {
      cropSequence += 1;
      return `crop:test-${cropSequence.toString().padStart(6, "0")}`;
    },
    createCropCycleId: () => {
      cropCycleSequence += 1;
      return `cycle:test-${cropCycleSequence.toString().padStart(6, "0")}`;
    },
    createStrategyApplicationId: () => {
      strategyApplicationSequence += 1;
      return `strategy-application:test-${strategyApplicationSequence.toString().padStart(6, "0")}`;
    },
    now: () => new Date(fixedNow),
    store,
    ...(moduleConfiguration === undefined ? {} : { moduleConfiguration }),
  });
}

function authenticateTestPrincipal(request: FastifyRequest): AuthPrincipal | null {
  const value = request.headers["x-test-principal"];
  const name = Array.isArray(value) ? value[0] : value;

  switch (name) {
    case "user":
      return { id: "user:demo", role: "user", farmIds: [demoFarmId] };
    case "admin":
      return { id: "admin:demo", role: "admin", farmIds: [demoFarmId] };
    case "edge":
      return {
        id: "edge:demo",
        role: "edge",
        farmIds: [demoFarmId],
        deviceScopes: [
          edgeDeviceScope(demoFarmId, demoDeviceId),
          edgeDeviceScope(demoFarmId, secondDemoDeviceId),
        ],
      };
    case "edge-single-device":
      return {
        id: "edge:single-device",
        role: "edge",
        farmIds: [demoFarmId],
        deviceScopes: [edgeDeviceScope(demoFarmId, demoDeviceId)],
      };
    case "multi-farm-user":
      return { id: "user:multi", role: "user", farmIds: [demoFarmId, otherFarmId] };
    case "other-farm-user":
      return { id: "user:other", role: "user", farmIds: [otherFarmId] };
    case "other-farm-edge":
      return {
        id: "edge:other",
        role: "edge",
        farmIds: [otherFarmId],
        deviceScopes: [edgeDeviceScope(otherFarmId, demoDeviceId)],
      };
    default:
      return null;
  }
}

function validTelemetryInput(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: "smartfarm.telemetry.v1",
    id: "telemetry:bed-1-000001",
    farmId: demoFarmId,
    deviceId: "device:bed-1",
    metric: "temperature",
    value: 24.5,
    unit: "celsius",
    sequence: 1,
    observedAt: fixedNow.toISOString(),
    ...overrides,
  };
}

function commandRequestInput(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: demoDeviceId,
    state: "on",
    idempotencyKey: "demo-pump-000001",
    ttlSeconds: 60,
    ...overrides,
  };
}

function farmControlProfileRequestInput(overrides: Record<string, unknown> = {}) {
  return PutFarmControlProfileRequestSchema.parse({
    expectedRevision: 0,
    widgets: [{
      schemaVersion: "smartfarm.farm-control-widget.v1",
      kind: "pump_control",
      deviceId: secondDemoDeviceId,
      label: "West Bed Start",
      showStart: false,
    }],
    ...overrides,
  });
}

function alarmRuleInput(overrides: Record<string, unknown> = {}) {
  return AlarmRuleSchema.parse({
    schemaVersion: "smartfarm.alarm-rule.v1",
    id: "alarm-rule:demo-temperature-high",
    farmId: demoFarmId,
    cycleId: activeCycleId,
    areaId: eastAreaId,
    deviceId: demoDeviceId,
    name: "High Temperature",
    metric: "temperature",
    comparison: "above",
    threshold: 30,
    severity: "critical",
    enabled: true,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    ...overrides,
  });
}

function irrigationStrategyInput(overrides: Record<string, unknown> = {}) {
  return IrrigationStrategySchema.parse({
    schemaVersion: "smartfarm.irrigation-strategy.v1",
    id: "strategy:irrigation-once",
    version: 1,
    farmId: demoFarmId,
    cycleId: activeCycleId,
    name: "Irrigation Once",
    description: "Turn the pump on for the assigned areas.",
    pumpState: "on",
    status: "approved",
    createdAt: "2026-07-17T00:00:00.000Z",
    approvedAt: "2026-07-17T00:00:00.000Z",
    ...overrides,
  });
}

function buildSeededStore() {
  const store = new InMemorySmartFarmStore();

  store.upsertFarm({
    schemaVersion: "smartfarm.farm.v1",
    id: demoFarmId,
    name: "Demo Farm",
    timezone: "Asia/Seoul",
    createdAt: "2026-07-17T00:00:00.000Z",
  });
  store.upsertFarm({
    schemaVersion: "smartfarm.farm.v1",
    id: otherFarmId,
    name: "Other Farm",
    timezone: "UTC",
    createdAt: "2026-07-17T00:10:00.000Z",
  });
  store.upsertDevice({
    schemaVersion: "smartfarm.device.v1",
    id: demoDeviceId,
    farmId: demoFarmId,
    name: "Grow Bed 1",
    kind: "hybrid",
    capabilities: ["temperature", "pump"],
    status: "online",
    lastSeenAt: null,
  });
  store.upsertDevice({
    schemaVersion: "smartfarm.device.v1",
    id: secondDemoDeviceId,
    farmId: demoFarmId,
    name: "Grow Bed 2",
    kind: "hybrid",
    capabilities: ["temperature", "pump"],
    status: "online",
    lastSeenAt: null,
  });
  store.upsertDevice({
    schemaVersion: "smartfarm.device.v1",
    id: sensorOnlyDeviceId,
    farmId: demoFarmId,
    name: "Temperature Sensor",
    kind: "sensor",
    capabilities: ["temperature"],
    status: "online",
    lastSeenAt: null,
  });
  store.upsertDevice({
    schemaVersion: "smartfarm.device.v1",
    id: demoDeviceId,
    farmId: otherFarmId,
    name: "Other Farm Bed 1",
    kind: "sensor",
    capabilities: ["temperature"],
    status: "degraded",
    lastSeenAt: "2026-07-17T00:08:00.000Z",
  });
  store.upsertDevice({
    schemaVersion: "smartfarm.device.v1",
    id: otherFarmOnlyDeviceId,
    farmId: otherFarmId,
    name: "Other Farm Pump",
    kind: "controller",
    capabilities: ["pump"],
    status: "online",
    lastSeenAt: null,
  });
  store.upsertGrowingArea({
    schemaVersion: "smartfarm.growing-area.v1",
    id: eastAreaId,
    farmId: demoFarmId,
    name: "East Bed",
    kind: "bed",
    primaryDeviceId: demoDeviceId,
    status: "active",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  });
  store.upsertGrowingArea({
    schemaVersion: "smartfarm.growing-area.v1",
    id: westAreaId,
    farmId: demoFarmId,
    name: "West Bed",
    kind: "bed",
    primaryDeviceId: secondDemoDeviceId,
    status: "active",
    createdAt: "2026-07-17T00:01:00.000Z",
    updatedAt: "2026-07-17T00:01:00.000Z",
  });
  store.upsertGrowingArea({
    schemaVersion: "smartfarm.growing-area.v1",
    id: eastAreaId,
    farmId: otherFarmId,
    name: "Other Farm East Bed",
    kind: "bed",
    primaryDeviceId: demoDeviceId,
    status: "active",
    createdAt: "2026-07-17T00:02:00.000Z",
    updatedAt: "2026-07-17T00:02:00.000Z",
  });
  store.upsertCrop({
    schemaVersion: "smartfarm.crop.v1",
    id: basilCropId,
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    name: "Basil",
    healthStatus: "good",
    managerName: "Demo Operator",
    notes: "Healthy basil bed",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  });
  store.upsertCrop({
    schemaVersion: "smartfarm.crop.v1",
    id: lettuceCropId,
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    name: "Lettuce",
    healthStatus: "fair",
    managerName: "Demo Operator",
    notes: "Needs nutrient check",
    createdAt: "2026-07-17T00:05:00.000Z",
    updatedAt: "2026-07-17T00:05:00.000Z",
  });
  store.createCropCycle({
    schemaVersion: "smartfarm.crop-cycle-detail.v1",
    cycle: {
      schemaVersion: "smartfarm.crop-cycle.v1",
      id: activeCycleId,
      farmId: demoFarmId,
      name: "Basil Cycle Week 31",
      cropName: "Basil",
      variety: "Sweet Basil",
      status: "active",
      startedAt: "2026-07-17T00:00:00.000Z",
      plannedEndAt: "2026-08-14T00:00:00.000Z",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:00:00.000Z",
    },
    areaIds: [eastAreaId, westAreaId],
  });
  store.createCropCycle({
    schemaVersion: "smartfarm.crop-cycle-detail.v1",
    cycle: {
      schemaVersion: "smartfarm.crop-cycle.v1",
      id: activeCycleId,
      farmId: otherFarmId,
      name: "Other Farm Basil Cycle",
      cropName: "Basil",
      variety: null,
      status: "active",
      startedAt: "2026-07-17T00:02:00.000Z",
      plannedEndAt: "2026-08-14T00:00:00.000Z",
      createdAt: "2026-07-17T00:02:00.000Z",
      updatedAt: "2026-07-17T00:02:00.000Z",
    },
    areaIds: [eastAreaId],
  });
  store.upsertAlarmRule(alarmRuleInput());
  store.upsertAlarmRule(alarmRuleInput({
    id: "alarm-rule:other-temperature-high",
    farmId: otherFarmId,
    areaId: eastAreaId,
    deviceId: demoDeviceId,
    name: "Other Farm High Temperature",
    createdAt: "2026-07-17T00:02:00.000Z",
    updatedAt: "2026-07-17T00:02:00.000Z",
  }));

  return store;
}

test("returns a deterministic default farm control profile without persisting it on read", async (t) => {
  const store = buildSeededStore();
  const app = buildTestApiWithStore(store);
  t.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/control-profile`,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(response.statusCode, 200);
  const body = FarmControlProfileResponseSchema.parse(response.json());
  assert.equal(body.controlProfile.revision, 0);
  assert.equal(body.controlProfile.updatedAt, "2026-07-17T00:00:00.000Z");
  assert.deepEqual(
    body.controlProfile.widgets.map((widget) => widget.deviceId),
    [demoDeviceId, secondDemoDeviceId],
  );
  assert.equal(body.controlProfile.widgets.every((widget) => widget.showStart), true);
  assert.equal(store.getFarmControlProfile(demoFarmId), null);
});

test("updates and re-reads a persisted farm control profile", async (t) => {
  const store = buildSeededStore();
  const app = buildTestApiWithStore(store);
  t.after(() => app.close());
  const url = `/v1/farms/${demoFarmPath}/control-profile`;

  const updated = await app.inject({
    method: "PUT",
    url,
    headers: { "x-test-principal": "admin" },
    payload: farmControlProfileRequestInput(),
  });

  assert.equal(updated.statusCode, 200);
  const updatedBody = FarmControlProfileResponseSchema.parse(updated.json());
  assert.equal(updatedBody.controlProfile.revision, 1);
  assert.equal(updatedBody.controlProfile.updatedAt, fixedNow.toISOString());
  assert.deepEqual(updatedBody.controlProfile.widgets, [{
    schemaVersion: "smartfarm.farm-control-widget.v1",
    kind: "pump_control",
    deviceId: secondDemoDeviceId,
    label: "West Bed Start",
    showStart: false,
  }]);

  const fetched = await app.inject({
    method: "GET",
    url,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(fetched.statusCode, 200);
  assert.deepEqual(
    FarmControlProfileResponseSchema.parse(fetched.json()).controlProfile,
    updatedBody.controlProfile,
  );
  assert.deepEqual(store.getFarmControlProfile(demoFarmId), updatedBody.controlProfile);
});

test("rejects invalid farm control profile widgets, unknown fields, wrong roles, and revision conflicts", async (t) => {
  const store = buildSeededStore();
  const app = buildTestApiWithStore(store);
  t.after(() => app.close());
  const url = `/v1/farms/${demoFarmPath}/control-profile`;

  const created = await app.inject({
    method: "PUT",
    url,
    headers: { "x-test-principal": "user" },
    payload: farmControlProfileRequestInput(),
  });
  const conflict = await app.inject({
    method: "PUT",
    url,
    headers: { "x-test-principal": "user" },
    payload: farmControlProfileRequestInput(),
  });
  const nonPump = await app.inject({
    method: "PUT",
    url,
    headers: { "x-test-principal": "user" },
    payload: {
      expectedRevision: 1,
      widgets: [{
        schemaVersion: "smartfarm.farm-control-widget.v1",
        kind: "pump_control",
        deviceId: sensorOnlyDeviceId,
        label: "Sensor Only",
        showStart: true,
      }],
    },
  });
  const crossFarm = await app.inject({
    method: "PUT",
    url,
    headers: { "x-test-principal": "multi-farm-user" },
    payload: {
      expectedRevision: 1,
      widgets: [{
        schemaVersion: "smartfarm.farm-control-widget.v1",
        kind: "pump_control",
        deviceId: otherFarmOnlyDeviceId,
        label: "Other Farm Pump",
        showStart: true,
      }],
    },
  });
  const invalid = await app.inject({
    method: "PUT",
    url,
    headers: { "x-test-principal": "user" },
    payload: {
      expectedRevision: 1,
      widgets: [{
        schemaVersion: "smartfarm.farm-control-widget.v1",
        kind: "pump_control",
        deviceId: secondDemoDeviceId,
        label: "West Bed Start",
        showStart: true,
        showStop: false,
      }],
    },
  });
  const forbidden = await app.inject({
    method: "PUT",
    url,
    headers: { "x-test-principal": "edge" },
    payload: farmControlProfileRequestInput(),
  });

  assert.equal(created.statusCode, 200);
  assert.equal(conflict.statusCode, 409);
  assert.equal(nonPump.statusCode, 400);
  assert.equal(crossFarm.statusCode, 400);
  assert.equal(invalid.statusCode, 400);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(ApiErrorSchema.parse(nonPump.json()).code, "invalid_request");
  assert.equal(ApiErrorSchema.parse(crossFarm.json()).code, "invalid_request");
  assert.equal(ApiErrorSchema.parse(invalid.json()).code, "invalid_request");
});

test("health is public and unknown routes use the versioned error contract", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());

  const health = await app.inject({ method: "GET", url: "/health" });
  const missing = await app.inject({ method: "GET", url: "/missing" });

  assert.equal(health.statusCode, 200);
  assert.equal(health.json().schemaVersion, "smartfarm.health.v1");
  assert.equal(missing.statusCode, 404);
  assert.equal(ApiErrorSchema.parse(missing.json()).code, "not_found");
});

test("registers API routes from reviewed module configuration", async (t) => {
  const app = buildTestApi({
    ...DEFAULT_BUILT_IN_MODULE_CONFIGURATION,
    modules: DEFAULT_BUILT_IN_MODULE_CONFIGURATION.modules.map((module) =>
      module.moduleId === "smartfarm.crop-journal"
        ? { ...module, enabled: false }
        : module),
  });
  t.after(() => app.close());

  const farms = await app.inject({
    method: "GET",
    url: "/v1/farms",
    headers: { "x-test-principal": "user" },
  });
  const crops = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/crops`,
    headers: { "x-test-principal": "user" },
  });
  const environment = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/devices/${demoDevicePath}/telemetry/latest?metric=temperature`,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(farms.statusCode, 200);
  assert.equal(crops.statusCode, 404);
  assert.equal(ApiErrorSchema.parse(crops.json()).code, "not_found");
  assert.equal(environment.statusCode, 404);
  assert.equal(ApiErrorSchema.parse(environment.json()).message, "Telemetry not found");
});

test("telemetry writes fail closed before validation without an edge principal", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());
  const url = `/v1/farms/${demoFarmPath}/telemetry`;

  const anonymous = await app.inject({
    method: "POST",
    url,
    payload: { unexpected: "do-not-echo-this-value" },
  });
  const user = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "user" },
    payload: validTelemetryInput(),
  });
  const wrongFarm = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "other-farm-edge" },
    payload: validTelemetryInput(),
  });
  const invalid = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "edge" },
    payload: { unexpected: "do-not-echo-this-value" },
  });

  assert.equal(anonymous.statusCode, 401);
  assert.equal(ApiErrorSchema.parse(anonymous.json()).code, "unauthorized");
  assert.equal(anonymous.body.includes("do-not-echo-this-value"), false);
  assert.equal(user.statusCode, 403);
  assert.equal(wrongFarm.statusCode, 403);
  assert.equal(invalid.statusCode, 400);
  assert.equal(ApiErrorSchema.parse(invalid.json()).code, "invalid_request");
  assert.equal(invalid.body.includes("do-not-echo-this-value"), false);
});

test("accepts, replays, rejects conflicting telemetry, and exposes latest value", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());
  const writeUrl = `/v1/farms/${demoFarmPath}/telemetry`;

  const accepted = await app.inject({
    method: "POST",
    url: writeUrl,
    headers: { "x-test-principal": "edge" },
    payload: validTelemetryInput(),
  });
  const replayed = await app.inject({
    method: "POST",
    url: writeUrl,
    headers: { "x-test-principal": "edge" },
    payload: validTelemetryInput(),
  });
  const conflict = await app.inject({
    method: "POST",
    url: writeUrl,
    headers: { "x-test-principal": "edge" },
    payload: validTelemetryInput({ value: 25 }),
  });
  const latest = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/devices/${encodeURIComponent("device:bed-1")}/telemetry/latest?metric=temperature`,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(accepted.statusCode, 202);
  assert.equal(TelemetryReceiptSchema.parse(accepted.json()).status, "accepted");
  assert.equal(replayed.statusCode, 200);
  assert.equal(TelemetryReceiptSchema.parse(replayed.json()).status, "replayed");
  assert.equal(conflict.statusCode, 409);
  assert.equal(ApiErrorSchema.parse(conflict.json()).code, "conflict");
  assert.equal(latest.statusCode, 200);
  assert.equal(LatestTelemetryResponseSchema.parse(latest.json()).telemetry.value, 24.5);
});

test("rejects telemetry writes and reads for unknown catalog devices", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());
  const missingDevicePath = encodeURIComponent("device:missing-bed");

  const write = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/telemetry`,
    headers: { "x-test-principal": "edge" },
    payload: validTelemetryInput({ deviceId: "device:missing-bed" }),
  });
  const read = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/devices/${missingDevicePath}/telemetry/latest?metric=temperature`,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(write.statusCode, 403);
  assert.equal(ApiErrorSchema.parse(write.json()).code, "forbidden");
  assert.equal(read.statusCode, 404);
  assert.equal(ApiErrorSchema.parse(read.json()).code, "not_found");
});

test("rejects non-advancing telemetry sequence and returns not found for missing metric", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());
  const writeUrl = `/v1/farms/${demoFarmPath}/telemetry`;
  await app.inject({
    method: "POST",
    url: writeUrl,
    headers: { "x-test-principal": "edge" },
    payload: validTelemetryInput(),
  });

  const stale = await app.inject({
    method: "POST",
    url: writeUrl,
    headers: { "x-test-principal": "edge" },
    payload: validTelemetryInput({ id: "telemetry:bed-1-000002", sequence: 1 }),
  });
  const missing = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/devices/${encodeURIComponent("device:bed-1")}/telemetry/latest?metric=humidity`,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(stale.statusCode, 409);
  assert.equal(missing.statusCode, 404);
});

test("returns bounded, ordered telemetry history inside the farm and device scope", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());
  const url = `/v1/farms/${demoFarmPath}/devices/${demoDevicePath}/telemetry/history?metric=temperature&limit=2`;

  for (const [sequence, value] of [[1, 24], [2, 25], [3, 26]] as const) {
    const response = await app.inject({
      method: "POST",
      url: `/v1/farms/${demoFarmPath}/telemetry`,
      headers: { "x-test-principal": "edge" },
      payload: validTelemetryInput({
        id: `telemetry:history-${sequence}`,
        sequence,
        value,
        observedAt: `2026-07-17T00:00:${sequence.toString().padStart(2, "0")}.000Z`,
      }),
    });
    assert.equal(response.statusCode, 202);
  }

  const history = await app.inject({
    method: "GET",
    url,
    headers: { "x-test-principal": "user" },
  });
  assert.equal(history.statusCode, 200);
  const body = TelemetryHistoryResponseSchema.parse(history.json());
  assert.deepEqual(body.telemetry.map((entry) => entry.sequence), [2, 3]);
  assert.deepEqual(body.telemetry.map((entry) => entry.value), [25, 26]);

  const anonymous = await app.inject({ method: "GET", url });
  assert.equal(anonymous.statusCode, 401);
});

test("lists only principal farms and farm-scoped devices", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());

  const scopedFarms = await app.inject({
    method: "GET",
    url: "/v1/farms",
    headers: { "x-test-principal": "user" },
  });
  const multiFarm = await app.inject({
    method: "GET",
    url: "/v1/farms",
    headers: { "x-test-principal": "multi-farm-user" },
  });
  const devices = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/devices`,
    headers: { "x-test-principal": "user" },
  });
  const otherFarmDevices = await app.inject({
    method: "GET",
    url: `/v1/farms/${encodeURIComponent(otherFarmId)}/devices`,
    headers: { "x-test-principal": "multi-farm-user" },
  });
  const forbiddenDevices = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/devices`,
    headers: { "x-test-principal": "other-farm-user" },
  });

  assert.deepEqual(
    FarmListResponseSchema.parse(scopedFarms.json()).farms.map((farm) => farm.id),
    [demoFarmId],
  );
  assert.deepEqual(
    FarmListResponseSchema.parse(multiFarm.json()).farms.map((farm) => farm.id),
    [demoFarmId, otherFarmId],
  );
  assert.equal(devices.statusCode, 200);
  assert.deepEqual(
    DeviceListResponseSchema.parse(devices.json()).devices.map((device) => device.id),
    [demoDeviceId, secondDemoDeviceId, sensorOnlyDeviceId],
  );
  const otherDevices = DeviceListResponseSchema.parse(otherFarmDevices.json()).devices;
  assert.deepEqual(otherDevices.map((device) => device.id), [demoDeviceId, otherFarmOnlyDeviceId]);
  assert.equal(otherDevices[0]?.name, "Other Farm Bed 1");
  assert.equal(forbiddenDevices.statusCode, 403);
});

test("lists farm-scoped growing areas and crop cycles", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());

  const areas = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/areas`,
    headers: { "x-test-principal": "user" },
  });
  const cropCycles = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/crop-cycles`,
    headers: { "x-test-principal": "user" },
  });
  const otherFarmCropCycles = await app.inject({
    method: "GET",
    url: `/v1/farms/${encodeURIComponent(otherFarmId)}/crop-cycles`,
    headers: { "x-test-principal": "multi-farm-user" },
  });

  assert.equal(areas.statusCode, 200);
  assert.deepEqual(
    GrowingAreaListResponseSchema.parse(areas.json()).areas.map((area) => area.id),
    [eastAreaId, westAreaId],
  );
  assert.equal(cropCycles.statusCode, 200);
  const body = CropCycleListResponseSchema.parse(cropCycles.json());
  assert.equal(body.cropCycles[0]?.cycle.id, activeCycleId);
  assert.deepEqual(body.cropCycles[0]?.areaIds, [eastAreaId, westAreaId]);
  const otherBody = CropCycleListResponseSchema.parse(otherFarmCropCycles.json());
  assert.equal(otherBody.cropCycles[0]?.cycle.id, activeCycleId);
  assert.equal(otherBody.cropCycles[0]?.cycle.name, "Other Farm Basil Cycle");
});

test("supports scoped crop list, read, create, patch, and delete", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());
  const cropsUrl = `/v1/farms/${demoFarmPath}/crops`;

  const listed = await app.inject({
    method: "GET",
    url: cropsUrl,
    headers: { "x-test-principal": "user" },
  });
  const read = await app.inject({
    method: "GET",
    url: `${cropsUrl}/${encodeURIComponent(basilCropId)}`,
    headers: { "x-test-principal": "user" },
  });
  const created = await app.inject({
    method: "POST",
    url: cropsUrl,
    headers: { "x-test-principal": "user" },
    payload: {
      deviceId: demoDeviceId,
      name: "Tomato",
      managerName: "Field Lead",
      notes: "New hydroponic test crop",
    },
  });

  assert.equal(listed.statusCode, 200);
  assert.equal(CropListResponseSchema.parse(listed.json()).crops.length, 2);
  assert.equal(read.statusCode, 200);
  assert.equal(CropResponseSchema.parse(read.json()).crop.name, "Basil");
  assert.equal(created.statusCode, 201);

  const createdCrop = CropResponseSchema.parse(created.json()).crop;
  assert.equal(createdCrop.id, "crop:test-000001");
  assert.equal(createdCrop.healthStatus, "fair");
  assert.equal(createdCrop.deviceId, demoDeviceId);

  const patched = await app.inject({
    method: "PATCH",
    url: `${cropsUrl}/${encodeURIComponent(createdCrop.id)}`,
    headers: { "x-test-principal": "admin" },
    payload: {
      healthStatus: "good",
      managerName: null,
      notes: "Recovered after nutrient adjustment",
    },
  });
  const deleted = await app.inject({
    method: "DELETE",
    url: `${cropsUrl}/${encodeURIComponent(createdCrop.id)}`,
    headers: { "x-test-principal": "admin" },
  });
  const missingAfterDelete = await app.inject({
    method: "GET",
    url: `${cropsUrl}/${encodeURIComponent(createdCrop.id)}`,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(patched.statusCode, 200);
  assert.equal(CropResponseSchema.parse(patched.json()).crop.healthStatus, "good");
  assert.equal(CropResponseSchema.parse(patched.json()).crop.managerName, null);
  assert.equal(deleted.statusCode, 204);
  assert.equal(missingAfterDelete.statusCode, 404);
});

test("rejects invalid or out-of-scope crop operations", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());
  const cropsUrl = `/v1/farms/${demoFarmPath}/crops`;

  const invalidCreate = await app.inject({
    method: "POST",
    url: cropsUrl,
    headers: { "x-test-principal": "user" },
    payload: {
      name: "",
      extra: "not-allowed",
    },
  });
  const missingDevice = await app.inject({
    method: "POST",
    url: cropsUrl,
    headers: { "x-test-principal": "user" },
    payload: {
      deviceId: "device:missing-bed",
      name: "Tomato",
    },
  });
  const invalidPatch = await app.inject({
    method: "PATCH",
    url: `${cropsUrl}/${encodeURIComponent(basilCropId)}`,
    headers: { "x-test-principal": "user" },
    payload: {},
  });
  const patchMissingDevice = await app.inject({
    method: "PATCH",
    url: `${cropsUrl}/${encodeURIComponent(basilCropId)}`,
    headers: { "x-test-principal": "user" },
    payload: {
      deviceId: "device:missing-bed",
    },
  });
  const forbidden = await app.inject({
    method: "GET",
    url: cropsUrl,
    headers: { "x-test-principal": "other-farm-user" },
  });

  assert.equal(invalidCreate.statusCode, 400);
  assert.equal(ApiErrorSchema.parse(invalidCreate.json()).code, "invalid_request");
  assert.equal(missingDevice.statusCode, 404);
  assert.equal(ApiErrorSchema.parse(missingDevice.json()).code, "not_found");
  assert.equal(invalidPatch.statusCode, 400);
  assert.equal(patchMissingDevice.statusCode, 404);
  assert.equal(forbidden.statusCode, 403);
});

test("creates and updates crop cycles with scoped area validation", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());
  const url = `/v1/farms/${demoFarmPath}/crop-cycles`;

  const created = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "admin" },
    payload: {
      name: "Lettuce Trial",
      cropName: "Lettuce",
      status: "planned",
      areaIds: [eastAreaId],
    },
  });
  assert.equal(created.statusCode, 201);
  const createdCycle = CropCycleResponseSchema.parse(created.json()).cropCycle;
  assert.equal(createdCycle.cycle.id, "cycle:test-000001");

  const updated = await app.inject({
    method: "PATCH",
    url: `${url}/${encodeURIComponent(createdCycle.cycle.id)}`,
    headers: { "x-test-principal": "admin" },
    payload: {
      status: "completed",
      plannedEndAt: "2026-08-21T00:00:00.000Z",
    },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(CropCycleResponseSchema.parse(updated.json()).cropCycle.cycle.status, "completed");

  const conflicting = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "admin" },
    payload: {
      name: "Second Basil Cycle",
      cropName: "Basil",
      status: "active",
      areaIds: [eastAreaId],
    },
  });
  assert.equal(conflicting.statusCode, 409);

  const missingArea = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "admin" },
    payload: {
      name: "Bad Cycle",
      cropName: "Basil",
      areaIds: ["area:missing-bed"],
    },
  });
  assert.equal(missingArea.statusCode, 404);
});

test("lists approved irrigation strategies by farm and cycle with strict query validation", async (t) => {
  const store = buildSeededStore();
  store.seedIrrigationStrategy(irrigationStrategyInput());
  store.seedIrrigationStrategy(irrigationStrategyInput({
    id: "strategy:irrigation-draft",
    version: 2,
    status: "draft",
    approvedAt: null,
  }));
  const app = buildTestApiWithStore(store);
  t.after(() => app.close());

  const listed = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/irrigation-strategies?cycleId=${encodeURIComponent(activeCycleId)}`,
    headers: { "x-test-principal": "user" },
  });
  const forbidden = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/irrigation-strategies?cycleId=${encodeURIComponent(activeCycleId)}`,
    headers: { "x-test-principal": "other-farm-user" },
  });
  const missingCycle = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/irrigation-strategies?cycleId=${encodeURIComponent("cycle:missing")}`,
    headers: { "x-test-principal": "user" },
  });
  const invalid = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/irrigation-strategies?unknown=true`,
    headers: { "x-test-principal": "user" },
  });

  const body = IrrigationStrategyListResponseSchema.parse(listed.json());
  assert.deepEqual(body.irrigationStrategies.map((strategy) => strategy.id), ["strategy:irrigation-once"]);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(missingCycle.statusCode, 404);
  assert.equal(invalid.statusCode, 400);
});

test("applies irrigation strategies with replay conflict and ACK-driven aggregation", async (t) => {
  const store = buildSeededStore();
  store.seedIrrigationStrategy(irrigationStrategyInput());
  const app = buildTestApiWithStore(store);
  t.after(() => app.close());

  const url = `/v1/farms/${demoFarmPath}/irrigation-strategies/${encodeURIComponent("strategy:irrigation-once")}/applications`;
  const payload = ApplyIrrigationStrategyRequestSchema.parse({
    cycleId: activeCycleId,
    strategyVersion: 1,
    areaIds: [eastAreaId, westAreaId],
    idempotencyKey: "a".repeat(128),
  });
  const created = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "user" },
    payload,
  });
  const replayed = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "user" },
    payload,
  });
  const conflict = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "user" },
    payload: { ...payload, areaIds: [eastAreaId], idempotencyKey: payload.idempotencyKey },
  });
  const missingStrategy = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/irrigation-strategies/${encodeURIComponent("strategy:missing")}/applications`,
    headers: { "x-test-principal": "user" },
    payload,
  });

  assert.equal(created.statusCode, 202);
  assert.equal(replayed.statusCode, 200);
  assert.equal(conflict.statusCode, 409);
  assert.equal(missingStrategy.statusCode, 404);

  const createdBody = StrategyApplicationResponseSchema.parse(created.json()).strategyApplication;
  const replayedBody = StrategyApplicationResponseSchema.parse(replayed.json()).strategyApplication;
  assert.equal(createdBody.targets.length, 2);
  assert.equal(createdBody.status, "pending");
  assert.deepEqual(replayedBody, createdBody);

  const fetched = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/strategy-applications/${encodeURIComponent(createdBody.id)}`,
    headers: { "x-test-principal": "admin" },
  });
  assert.equal(fetched.statusCode, 200);

  const firstTarget = createdBody.targets[0]!;
  const secondTarget = createdBody.targets[1]!;
  const firstAck = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/command-acks`,
    headers: { "x-test-principal": "edge" },
    payload: CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: firstTarget.commandId,
      farmId: demoFarmId,
      deviceId: firstTarget.deviceId,
      status: "acknowledged",
      reasonCode: null,
      result: { pumpState: "on" },
      processedAt: "2026-07-17T00:00:11.000Z",
    }),
  });
  assert.equal(firstAck.statusCode, 200);

  const pendingAfterFirstAck = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/strategy-applications/${encodeURIComponent(createdBody.id)}`,
    headers: { "x-test-principal": "user" },
  });
  const pendingBody = StrategyApplicationResponseSchema.parse(pendingAfterFirstAck.json()).strategyApplication;
  assert.equal(pendingBody.status, "pending");

  const secondAck = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/command-acks`,
    headers: { "x-test-principal": "edge" },
    payload: CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: secondTarget.commandId,
      farmId: demoFarmId,
      deviceId: secondTarget.deviceId,
      status: "failed",
      reasonCode: "execution_failed",
      result: null,
      processedAt: "2026-07-17T00:00:12.000Z",
    }),
  });
  assert.equal(secondAck.statusCode, 200);

  const completed = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/strategy-applications/${encodeURIComponent(createdBody.id)}`,
    headers: { "x-test-principal": "user" },
  });
  const completedBody = StrategyApplicationResponseSchema.parse(completed.json()).strategyApplication;
  assert.equal(completedBody.status, "partial");

  const audit = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/audit-events?cycleId=${encodeURIComponent(activeCycleId)}&limit=10`,
    headers: { "x-test-principal": "user" },
  });
  const auditBody = AuditEventListResponseSchema.parse(audit.json());
  assert.equal(auditBody.auditEvents.filter((event) => event.action === "command.completed").length, 2);
  assert.equal(auditBody.auditEvents.filter((event) => event.action === "strategy.applied").length, 1);
});

test("keeps timed irrigation pending until a timed-capable device reports final off", async (t) => {
  const store = buildSeededStore();
  const timedStrategy = irrigationStrategyInput({
    version: 2,
    name: "Timed Irrigation",
    runDurationSeconds: 5,
  });
  assert.equal(timedStrategy.runDurationSeconds, 5);
  assert.equal(store.seedIrrigationStrategy(timedStrategy).kind, "created");
  assert.equal(
    store.getIrrigationStrategy(demoFarmId, timedStrategy.id, timedStrategy.version)
      ?.runDurationSeconds,
    5,
  );
  const app = buildTestApiWithStore(store);
  t.after(() => app.close());
  const url = `/v1/farms/${demoFarmPath}/irrigation-strategies/${encodeURIComponent("strategy:irrigation-once")}/applications`;
  const payload = ApplyIrrigationStrategyRequestSchema.parse({
    cycleId: activeCycleId,
    strategyVersion: 2,
    areaIds: [eastAreaId],
    idempotencyKey: "timed-irrigation-application-0001",
  });

  const unsupported = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "user" },
    payload,
  });
  assert.equal(unsupported.statusCode, 409);

  const device = store.getDevice(demoFarmId, demoDeviceId);
  assert.ok(device !== null);
  store.upsertDevice({
    ...device,
    capabilities: [...device.capabilities, "timed_pump"],
  });

  const created = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "user" },
    payload,
  });
  assert.equal(created.statusCode, 202);
  const application = StrategyApplicationResponseSchema.parse(created.json())
    .strategyApplication;
  assert.equal(application.runDurationSeconds, 5);

  const pulled = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/edge/commands/next?deviceId=${encodeURIComponent(demoDeviceId)}`,
    headers: { "x-test-principal": "edge" },
  });
  const command = PendingCommandResponseSchema.parse(pulled.json()).command;
  assert.equal(command.schemaVersion, "smartfarm.command.v2");
  assert.deepEqual(command.payload, { action: "run_pump_for", durationSeconds: 5 });

  const falseFinalState = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/command-acks`,
    headers: { "x-test-principal": "edge" },
    payload: CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: command.id,
      farmId: command.farmId,
      deviceId: command.deviceId,
      status: "acknowledged",
      reasonCode: null,
      result: { pumpState: "on" },
      processedAt: "2026-07-17T00:00:14.000Z",
    }),
  });
  assert.equal(falseFinalState.statusCode, 409);

  const pending = store.getStrategyApplication(demoFarmId, application.id);
  assert.equal(pending?.status, "pending");

  const completed = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/command-acks`,
    headers: { "x-test-principal": "edge" },
    payload: CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: command.id,
      farmId: command.farmId,
      deviceId: command.deviceId,
      status: "acknowledged",
      reasonCode: null,
      result: { pumpState: "off" },
      processedAt: "2026-07-17T00:00:15.000Z",
    }),
  });
  assert.equal(completed.statusCode, 200);

  const finalApplication = store.getStrategyApplication(demoFarmId, application.id);
  assert.equal(finalApplication?.status, "succeeded");
  assert.equal(finalApplication?.targets[0]?.resultingPumpState, "off");
  const audit = store.listAuditEvents(demoFarmId, { cycleId: activeCycleId, limit: 10 });
  const commandAudit = audit.find((event) => event.action === "command.completed");
  assert.equal(commandAudit?.details.runDurationSeconds, 5);
});

test("creates commands centrally and enforces idempotent intent", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());
  const url = `/v1/farms/${demoFarmPath}/commands`;

  const created = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "user" },
    payload: commandRequestInput(),
  });
  const replayed = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "user" },
    payload: commandRequestInput(),
  });
  const conflict = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "user" },
    payload: commandRequestInput({ state: "off" }),
  });
  const missingDevice = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "user" },
    payload: commandRequestInput({ deviceId: "device:missing-bed" }),
  });
  const forbidden = await app.inject({
    method: "POST",
    url,
    headers: { "x-test-principal": "edge" },
    payload: commandRequestInput(),
  });

  const first = CommandProjectionSchema.parse(created.json());
  const second = CommandProjectionSchema.parse(replayed.json());
  assert.equal(created.statusCode, 202);
  assert.equal(first.status, "pending");
  assert.equal(first.command.actor.id, "user:demo");
  assert.equal(first.command.expiresAt, "2026-07-17T00:01:10.000Z");
  assert.equal(replayed.statusCode, 200);
  assert.equal(second.command.id, first.command.id);
  assert.equal(conflict.statusCode, 409);
  assert.equal(missingDevice.statusCode, 404);
  assert.equal(forbidden.statusCode, 403);
});

test("reads command projection only inside the authenticated farm scope", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());
  const created = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/commands`,
    headers: { "x-test-principal": "user" },
    payload: commandRequestInput(),
  });
  const projection = CommandProjectionSchema.parse(created.json());
  const commandPath = encodeURIComponent(projection.command.id);

  const found = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/commands/${commandPath}`,
    headers: { "x-test-principal": "user" },
  });
  const denied = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/commands/${commandPath}`,
    headers: { "x-test-principal": "other-farm-user" },
  });

  assert.equal(found.statusCode, 200);
  assert.equal(CommandProjectionSchema.parse(found.json()).command.id, projection.command.id);
  assert.equal(denied.statusCode, 403);
});

test("lists commands in bounded scoped newest-result order and validates strict query input", async (t) => {
  const store = buildSeededStore();
  const timestamps = [
    "2026-07-17T00:00:00.000Z",
    "2026-07-17T00:00:05.000Z",
    "2026-07-17T00:00:10.000Z",
  ];
  let commandSequence = 0;
  let clockIndex = 0;

  const app = buildApi({
    authenticate: authenticateTestPrincipal,
    createCommandId: () => {
      commandSequence += 1;
      return `command:test-${commandSequence.toString().padStart(6, "0")}`;
    },
    createCropId: () => "crop:test-unused",
    createCropCycleId: () => "cycle:test-unused",
    now: () => new Date(timestamps[Math.min(clockIndex++, timestamps.length - 1)]!),
    store,
  });
  t.after(() => app.close());

  const listUrl = `/v1/farms/${demoFarmPath}/commands`;
  const firstCreated = await app.inject({
    method: "POST",
    url: listUrl,
    headers: { "x-test-principal": "user" },
    payload: commandRequestInput(),
  });
  const secondCreated = await app.inject({
    method: "POST",
    url: listUrl,
    headers: { "x-test-principal": "user" },
    payload: commandRequestInput({
      deviceId: secondDemoDeviceId,
      state: "off",
      idempotencyKey: "demo-pump-000002",
    }),
  });
  const firstProjection = CommandProjectionSchema.parse(firstCreated.json());
  const secondProjection = CommandProjectionSchema.parse(secondCreated.json());

  const acked = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/command-acks`,
    headers: { "x-test-principal": "edge" },
    payload: CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: firstProjection.command.id,
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      status: "acknowledged",
      reasonCode: null,
      result: { pumpState: "on" },
      processedAt: "2026-07-17T00:00:10.000Z",
    }),
  });
  assert.equal(acked.statusCode, 200);

  const listed = await app.inject({
    method: "GET",
    url: `${listUrl}?limit=2`,
    headers: { "x-test-principal": "user" },
  });
  const filtered = await app.inject({
    method: "GET",
    url: `${listUrl}?deviceId=${encodeURIComponent(secondDemoDeviceId)}&limit=10`,
    headers: { "x-test-principal": "admin" },
  });
  const missingDevice = await app.inject({
    method: "GET",
    url: `${listUrl}?deviceId=${encodeURIComponent("device:missing-bed")}`,
    headers: { "x-test-principal": "user" },
  });
  const forbidden = await app.inject({
    method: "GET",
    url: listUrl,
    headers: { "x-test-principal": "edge" },
  });
  const wrongFarm = await app.inject({
    method: "GET",
    url: listUrl,
    headers: { "x-test-principal": "other-farm-user" },
  });
  const invalid = await app.inject({
    method: "GET",
    url: `${listUrl}?unknown=true`,
    headers: { "x-test-principal": "user" },
  });

  const listedBody = CommandListResponseSchema.parse(listed.json());
  assert.deepEqual(
    listedBody.commands.map((projection) => projection.command.id),
    [firstProjection.command.id, secondProjection.command.id],
  );
  assert.equal(listedBody.commands[0]?.status, "acknowledged");
  assert.equal(listedBody.commands.length, 2);

  const filteredBody = CommandListResponseSchema.parse(filtered.json());
  assert.deepEqual(
    filteredBody.commands.map((projection) => projection.command.id),
    [secondProjection.command.id],
  );

  assert.equal(missingDevice.statusCode, 404);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(wrongFarm.statusCode, 403);
  assert.equal(invalid.statusCode, 400);
  assert.equal(CommandListQuerySchema.safeParse({ unknown: true }).success, false);
});

test("lets only the edge pull the next deterministic pending device command", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());
  const nextUrl = `/v1/farms/${demoFarmPath}/edge/commands/next?deviceId=${encodeURIComponent("device:bed-1")}`;

  const empty = await app.inject({
    method: "GET",
    url: nextUrl,
    headers: { "x-test-principal": "edge" },
  });
  const forbidden = await app.inject({
    method: "GET",
    url: nextUrl,
    headers: { "x-test-principal": "user" },
  });
  const firstCreated = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/commands`,
    headers: { "x-test-principal": "user" },
    payload: commandRequestInput(),
  });
  const secondCreated = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/commands`,
    headers: { "x-test-principal": "user" },
    payload: commandRequestInput({
      state: "off",
      idempotencyKey: "demo-pump-000002",
    }),
  });
  const firstProjection = CommandProjectionSchema.parse(firstCreated.json());
  const secondProjection = CommandProjectionSchema.parse(secondCreated.json());

  const firstPulled = await app.inject({
    method: "GET",
    url: nextUrl,
    headers: { "x-test-principal": "edge" },
  });
  const firstCommand = PendingCommandResponseSchema.parse(firstPulled.json()).command;
  const firstAck = CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: firstCommand.id,
    farmId: firstCommand.farmId,
    deviceId: firstCommand.deviceId,
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: commandExpectedFinalPumpState(firstCommand) },
    processedAt: "2026-07-17T00:00:11.000Z",
  });
  await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/command-acks`,
    headers: { "x-test-principal": "edge" },
    payload: firstAck,
  });
  const secondPulled = await app.inject({
    method: "GET",
    url: nextUrl,
    headers: { "x-test-principal": "edge" },
  });

  assert.equal(empty.statusCode, 204);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(firstPulled.statusCode, 200);
  assert.equal(firstCommand.id, firstProjection.command.id);
  assert.equal(PendingCommandResponseSchema.parse(secondPulled.json()).command.id, secondProjection.command.id);
});

test("lets only the edge pull the next pending stop command for a device", async (t) => {
  const store = buildSeededStore();
  assert.equal(store.createCommand(CommandSchema.parse({
    schemaVersion: "smartfarm.command.v2",
    id: "command:timed-pump-000010",
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    payload: { action: "run_pump_for", durationSeconds: 5 },
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "demo-timed-pump-000010",
    issuedAt: "2026-07-17T00:00:00.000Z",
    expiresAt: "2026-07-17T00:01:00.000Z",
  }), "2026-07-17T00:00:00.000Z").kind, "created");
  assert.equal(store.createCommand(CommandSchema.parse({
    schemaVersion: "smartfarm.command.v1",
    id: "command:pump-000010",
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    payload: { action: "set_pump_state", state: "on" },
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "demo-pump-on-000010",
    issuedAt: "2026-07-17T00:00:01.000Z",
    expiresAt: "2026-07-17T00:01:01.000Z",
  }), "2026-07-17T00:00:01.000Z").kind, "created");
  const app = buildTestApiWithStore(store);
  t.after(() => app.close());
  const nextStopUrl = `/v1/farms/${demoFarmPath}/edge/commands/next-stop?deviceId=${encodeURIComponent(demoDeviceId)}`;

  const empty = await app.inject({
    method: "GET",
    url: nextStopUrl,
    headers: { "x-test-principal": "edge" },
  });
  const forbidden = await app.inject({
    method: "GET",
    url: nextStopUrl,
    headers: { "x-test-principal": "user" },
  });
  const wrongFarm = await app.inject({
    method: "GET",
    url: nextStopUrl,
    headers: { "x-test-principal": "other-farm-edge" },
  });

  assert.equal(empty.statusCode, 204);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(wrongFarm.statusCode, 403);

  const stopProjection = store.createCommand(CommandSchema.parse({
    schemaVersion: "smartfarm.command.v1",
    id: "command:pump-000011",
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    payload: { action: "set_pump_state", state: "off" },
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "demo-pump-off-000011",
    issuedAt: "2026-07-17T00:00:02.000Z",
    expiresAt: "2026-07-17T00:01:02.000Z",
  }), "2026-07-17T00:00:02.000Z");
  assert.equal(stopProjection.kind, "created");

  const pulled = await app.inject({
    method: "GET",
    url: nextStopUrl,
    headers: { "x-test-principal": "edge" },
  });

  assert.equal(pulled.statusCode, 200);
  assert.equal(PendingCommandResponseSchema.parse(pulled.json()).command.id, "command:pump-000011");
});

test("applies one scoped terminal acknowledgement and rejects conflicting terminal state", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());
  const created = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/commands`,
    headers: { "x-test-principal": "user" },
    payload: commandRequestInput(),
  });
  const pending = CommandProjectionSchema.parse(created.json());
  const ack = CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: pending.command.id,
    farmId: pending.command.farmId,
    deviceId: pending.command.deviceId,
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: "on" },
    processedAt: "2026-07-17T00:00:11.000Z",
  });
  const ackUrl = `/v1/farms/${demoFarmPath}/command-acks`;

  const applied = await app.inject({
    method: "POST",
    url: ackUrl,
    headers: { "x-test-principal": "edge" },
    payload: ack,
  });
  const replayed = await app.inject({
    method: "POST",
    url: ackUrl,
    headers: { "x-test-principal": "edge" },
    payload: ack,
  });
  const conflictingAck = CommandAckSchema.parse({
    ...ack,
    status: "failed",
    reasonCode: "execution_failed",
    result: null,
  });
  const conflict = await app.inject({
    method: "POST",
    url: ackUrl,
    headers: { "x-test-principal": "edge" },
    payload: conflictingAck,
  });

  assert.equal(applied.statusCode, 200);
  assert.equal(CommandProjectionSchema.parse(applied.json()).status, "acknowledged");
  assert.equal(replayed.statusCode, 200);
  assert.equal(conflict.statusCode, 409);

  const audit = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/audit-events?includeUnscoped=true&limit=10`,
    headers: { "x-test-principal": "user" },
  });
  const auditBody = AuditEventListResponseSchema.parse(audit.json());
  assert.equal(auditBody.auditEvents.length, 1);
  assert.equal(auditBody.auditEvents[0]?.schemaVersion, "smartfarm.audit-event.v2");
  assert.equal(auditBody.auditEvents[0]?.targetId, pending.command.id);
});

test("hides direct command audits by default and returns them only when includeUnscoped is enabled", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());

  const firstCreated = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/commands`,
    headers: { "x-test-principal": "user" },
    payload: commandRequestInput({
      idempotencyKey: "direct-audit-000001",
      state: "on",
    }),
  });
  const secondCreated = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/commands`,
    headers: { "x-test-principal": "user" },
    payload: commandRequestInput({
      idempotencyKey: "direct-audit-000002",
      state: "off",
    }),
  });

  const firstProjection = CommandProjectionSchema.parse(firstCreated.json());
  const secondProjection = CommandProjectionSchema.parse(secondCreated.json());

  assert.equal(firstCreated.statusCode, 202);
  assert.equal(secondCreated.statusCode, 202);

  const firstAck = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/command-acks`,
    headers: { "x-test-principal": "edge" },
    payload: CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: firstProjection.command.id,
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      status: "acknowledged",
      reasonCode: null,
      result: { pumpState: "on" },
      processedAt: "2026-07-17T00:00:11.000Z",
    }),
  });
  const secondAck = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/command-acks`,
    headers: { "x-test-principal": "edge" },
    payload: CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: secondProjection.command.id,
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      status: "failed",
      reasonCode: "execution_failed",
      result: null,
      processedAt: "2026-07-17T00:00:12.000Z",
    }),
  });

  assert.equal(firstAck.statusCode, 200);
  assert.equal(secondAck.statusCode, 200);

  const defaultAudit = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/audit-events?limit=10`,
    headers: { "x-test-principal": "user" },
  });
  const includeUnscopedAudit = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/audit-events?cycleId=${encodeURIComponent(activeCycleId)}&includeUnscoped=true&limit=10`,
    headers: { "x-test-principal": "user" },
  });

  const defaultBody = AuditEventListResponseSchema.parse(defaultAudit.json());
  const includeUnscopedBody = AuditEventListResponseSchema.parse(includeUnscopedAudit.json());
  assert.deepEqual(defaultBody.auditEvents, []);
  assert.equal(includeUnscopedBody.auditEvents.length, 2);
  assert.deepEqual(
    includeUnscopedBody.auditEvents.map((event) => event.schemaVersion),
    ["smartfarm.audit-event.v2", "smartfarm.audit-event.v2"],
  );

  const successAudit = includeUnscopedBody.auditEvents.find((event) => event.targetId === firstProjection.command.id);
  const failureAudit = includeUnscopedBody.auditEvents.find((event) => event.targetId === secondProjection.command.id);
  assert.equal(successAudit?.details.source, "direct");
  assert.equal(successAudit?.details.requestedAction, "set_pump_state");
  assert.equal(successAudit?.details.requestedPumpState, "on");
  assert.equal(successAudit?.details.status, "acknowledged");
  assert.equal(successAudit?.details.reasonCode, null);
  assert.equal(successAudit?.details.resultingPumpState, "on");
  assert.equal(failureAudit?.details.source, "direct");
  assert.equal(failureAudit?.details.requestedPumpState, "off");
  assert.equal(failureAudit?.details.status, "failed");
  assert.equal(failureAudit?.details.reasonCode, "execution_failed");
  assert.equal(failureAudit?.details.resultingPumpState, null);
});

test("rejects acknowledgement scope mismatch and unknown commands", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());
  const ackUrl = `/v1/farms/${demoFarmPath}/command-acks`;
  const unknownAck = CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: "command:missing",
    farmId: demoFarmId,
    deviceId: "device:bed-1",
    status: "failed",
    reasonCode: "execution_failed",
    result: null,
    processedAt: "2026-07-17T00:00:11.000Z",
  });
  const unknown = await app.inject({
    method: "POST",
    url: ackUrl,
    headers: { "x-test-principal": "edge" },
    payload: unknownAck,
  });
  const wrongFarm = await app.inject({
    method: "POST",
    url: ackUrl,
    headers: { "x-test-principal": "edge" },
    payload: { ...unknownAck, farmId: otherFarmId },
  });

  assert.equal(unknown.statusCode, 404);
  assert.equal(wrongFarm.statusCode, 403);
});

test("rejects same-farm edge access for devices outside the principal scope without mutating state", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());

  const unauthorizedTelemetry = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/telemetry`,
    headers: { "x-test-principal": "edge-single-device" },
    payload: validTelemetryInput({
      id: "telemetry:bed-2-000001",
      deviceId: secondDemoDeviceId,
    }),
  });

  const created = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/commands`,
    headers: { "x-test-principal": "user" },
    payload: commandRequestInput({
      deviceId: secondDemoDeviceId,
      idempotencyKey: "demo-pump-bed-2-000001",
    }),
  });
  const command = CommandProjectionSchema.parse(created.json()).command;
  const nextUrl =
    `/v1/farms/${demoFarmPath}/edge/commands/next?deviceId=${encodeURIComponent(secondDemoDeviceId)}`;
  const stopUrl =
    `/v1/farms/${demoFarmPath}/edge/commands/next-stop?deviceId=${encodeURIComponent(secondDemoDeviceId)}`;
  const forbiddenNext = await app.inject({
    method: "GET",
    url: nextUrl,
    headers: { "x-test-principal": "edge-single-device" },
  });
  const forbiddenStop = await app.inject({
    method: "GET",
    url: stopUrl,
    headers: { "x-test-principal": "edge-single-device" },
  });
  const forbiddenAck = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/command-acks`,
    headers: { "x-test-principal": "edge-single-device" },
    payload: CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: command.id,
      farmId: command.farmId,
      deviceId: command.deviceId,
      status: "acknowledged",
      reasonCode: null,
      result: { pumpState: "on" },
      processedAt: "2026-07-17T00:00:11.000Z",
    }),
  });

  const fullScopePull = await app.inject({
    method: "GET",
    url: nextUrl,
    headers: { "x-test-principal": "edge" },
  });
  const projection = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/commands/${encodeURIComponent(command.id)}`,
    headers: { "x-test-principal": "user" },
  });
  const audit = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/audit-events?includeUnscoped=true&limit=10`,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(unauthorizedTelemetry.statusCode, 403);
  assert.equal(forbiddenNext.statusCode, 403);
  assert.equal(forbiddenStop.statusCode, 403);
  assert.equal(forbiddenAck.statusCode, 403);
  assert.equal(fullScopePull.statusCode, 200);
  assert.equal(PendingCommandResponseSchema.parse(fullScopePull.json()).command.id, command.id);
  assert.equal(CommandProjectionSchema.parse(projection.json()).status, "pending");
  assert.deepEqual(AuditEventListResponseSchema.parse(audit.json()).auditEvents, []);
});

test("fails closed when authentication returns invalid edge device scopes or user device scopes", async (t) => {
  const invalidPrincipals: ReadonlyArray<{
    readonly name: string;
    readonly principal: unknown;
  }> = [
    {
      name: "missing-edge-device-scopes",
      principal: {
        id: "edge:missing-scopes",
        role: "edge",
        farmIds: [demoFarmId],
      },
    },
    {
      name: "empty-edge-device-scopes",
      principal: {
        id: "edge:empty-scopes",
        role: "edge",
        farmIds: [demoFarmId],
        deviceScopes: [],
      },
    },
    {
      name: "invalid-edge-scope-device",
      principal: {
        id: "edge:invalid-device",
        role: "edge",
        farmIds: [demoFarmId],
        deviceScopes: [{ farmId: demoFarmId, deviceId: "device:INVALID" as typeof demoDeviceId }],
      },
    },
    {
      name: "duplicate-edge-scope",
      principal: {
        id: "edge:duplicate-scope",
        role: "edge",
        farmIds: [demoFarmId],
        deviceScopes: [
          edgeDeviceScope(demoFarmId, demoDeviceId),
          edgeDeviceScope(demoFarmId, demoDeviceId),
        ],
      },
    },
    {
      name: "cross-farm-edge-scope",
      principal: {
        id: "edge:cross-farm-scope",
        role: "edge",
        farmIds: [demoFarmId],
        deviceScopes: [edgeDeviceScope(otherFarmId, demoDeviceId)],
      },
    },
    {
      name: "null-edge-scope-entry",
      principal: {
        id: "edge:null-scope",
        role: "edge",
        farmIds: [demoFarmId],
        deviceScopes: [null],
      },
    },
    {
      name: "non-array-farm-ids",
      principal: {
        id: "edge:non-array-farms",
        role: "edge",
        farmIds: demoFarmId,
        deviceScopes: [edgeDeviceScope(demoFarmId, demoDeviceId)],
      },
    },
    {
      name: "user-device-scopes",
      principal: {
        id: "user:unexpected-scopes",
        role: "user",
        farmIds: [demoFarmId],
        deviceScopes: [edgeDeviceScope(demoFarmId, demoDeviceId)],
      },
    },
  ];

  for (const { name, principal } of invalidPrincipals) {
    const app = buildTestApiWithAuthenticate(() => principal as AuthPrincipal);
    t.after(() => app.close());

    const response = await app.inject({
      method: "POST",
      url: `/v1/farms/${demoFarmPath}/telemetry`,
      payload: validTelemetryInput(),
    });

    assert.equal(response.statusCode, 500, name);
    assert.equal(ApiErrorSchema.parse(response.json()).code, "internal_error");
  }
});

test("tracks alarm trigger update acknowledgement replay and clear through the API", async (t) => {
  const app = buildTestApi();
  t.after(() => app.close());

  const telemetryUrl = `/v1/farms/${demoFarmPath}/telemetry`;
  const alarmsUrl = `/v1/farms/${demoFarmPath}/alarms?state=active&limit=10`;
  const auditUrl = `/v1/farms/${demoFarmPath}/audit-events?limit=10`;

  const first = await app.inject({
    method: "POST",
    url: telemetryUrl,
    headers: { "x-test-principal": "edge" },
    payload: validTelemetryInput({ value: 31 }),
  });
  const replayed = await app.inject({
    method: "POST",
    url: telemetryUrl,
    headers: { "x-test-principal": "edge" },
    payload: validTelemetryInput({ value: 31 }),
  });
  const updated = await app.inject({
    method: "POST",
    url: telemetryUrl,
    headers: { "x-test-principal": "edge" },
    payload: validTelemetryInput({
      id: "telemetry:bed-1-000002",
      sequence: 2,
      value: 32,
      observedAt: "2026-07-17T00:00:20.000Z",
    }),
  });
  const active = await app.inject({
    method: "GET",
    url: alarmsUrl,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(first.statusCode, 202);
  assert.equal(replayed.statusCode, 200);
  assert.equal(updated.statusCode, 202);

  const activeBody = AlarmListResponseSchema.parse(active.json());
  assert.equal(activeBody.alarms.length, 1);
  assert.equal(activeBody.alarms[0]?.lastValue, 32);
  assert.equal(activeBody.alarms[0]?.acknowledgement, null);

  const alarmId = activeBody.alarms[0]!.id;
  const acknowledgementUrl =
    `/v1/farms/${demoFarmPath}/alarms/${encodeURIComponent(alarmId)}/acknowledgements`;
  const acknowledged = await app.inject({
    method: "POST",
    url: acknowledgementUrl,
    headers: { "x-test-principal": "user" },
    payload: { idempotencyKey: "alarm-ack-000001" },
  });
  const replayedAck = await app.inject({
    method: "POST",
    url: acknowledgementUrl,
    headers: { "x-test-principal": "user" },
    payload: { idempotencyKey: "alarm-ack-000001" },
  });
  const cleared = await app.inject({
    method: "POST",
    url: telemetryUrl,
    headers: { "x-test-principal": "edge" },
    payload: validTelemetryInput({
      id: "telemetry:bed-1-000003",
      sequence: 3,
      value: 28,
      observedAt: "2026-07-17T00:00:30.000Z",
    }),
  });
  const clearedAlarms = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/alarms?state=cleared&limit=10`,
    headers: { "x-test-principal": "user" },
  });
  const audit = await app.inject({
    method: "GET",
    url: auditUrl,
    headers: { "x-test-principal": "user" },
  });
  const otherFarmAudit = await app.inject({
    method: "GET",
    url: `/v1/farms/${encodeURIComponent(otherFarmId)}/audit-events?limit=10`,
    headers: { "x-test-principal": "multi-farm-user" },
  });

  assert.equal(acknowledged.statusCode, 200);
  assert.equal(replayedAck.statusCode, 200);
  assert.equal(cleared.statusCode, 202);

  const acknowledgedBody = AlarmResponseSchema.parse(acknowledged.json());
  const replayedAckBody = AlarmResponseSchema.parse(replayedAck.json());
  assert.equal(acknowledgedBody.alarm.acknowledgement?.actorId, "user:demo");
  assert.deepEqual(replayedAckBody.alarm, acknowledgedBody.alarm);

  const clearedBody = AlarmListResponseSchema.parse(clearedAlarms.json());
  assert.equal(clearedBody.alarms.length, 1);
  assert.equal(clearedBody.alarms[0]?.id, alarmId);
  assert.equal(clearedBody.alarms[0]?.state, "cleared");
  assert.equal(clearedBody.alarms[0]?.acknowledgement?.actorId, "user:demo");

  const auditBody = AuditEventListResponseSchema.parse(audit.json());
  assert.equal(auditBody.auditEvents.length, 1);
  assert.equal(auditBody.auditEvents[0]?.action, "alarm.acknowledged");
  assert.equal(auditBody.auditEvents[0]?.targetId, alarmId);

  const otherFarmAuditBody = AuditEventListResponseSchema.parse(otherFarmAudit.json());
  assert.equal(otherFarmAuditBody.auditEvents.length, 0);
});

test("rejects alarm and audit cycle filters that do not belong to the route farm", async (t) => {
  const store = buildSeededStore();
  assert.equal(store.createCropCycle({
    schemaVersion: "smartfarm.crop-cycle-detail.v1",
    cycle: {
      schemaVersion: "smartfarm.crop-cycle.v1",
      id: nextCycleId,
      farmId: otherFarmId,
      name: "Other Farm Planned Cycle",
      cropName: "Basil",
      variety: null,
      status: "planned",
      startedAt: null,
      plannedEndAt: "2026-08-21T00:00:00.000Z",
      createdAt: "2026-07-17T00:10:00.000Z",
      updatedAt: "2026-07-17T00:10:00.000Z",
    },
    areaIds: [eastAreaId],
  }).kind, "created");
  const app = buildTestApiWithStore(store);
  t.after(() => app.close());

  const cycleQuery = encodeURIComponent(nextCycleId);
  const alarms = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/alarms?cycleId=${cycleQuery}`,
    headers: { "x-test-principal": "user" },
  });
  const audit = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/audit-events?cycleId=${cycleQuery}`,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(alarms.statusCode, 404);
  assert.equal(audit.statusCode, 404);
  assert.equal(ApiErrorSchema.parse(alarms.json()).code, "not_found");
  assert.equal(ApiErrorSchema.parse(audit.json()).code, "not_found");
});

test("clears stale completed-cycle alarms and activates only the new-cycle rule through the API", async (t) => {
  const store = buildSeededStore();
  assert.deepEqual(store.putTelemetry(TelemetrySchema.parse(validTelemetryInput({ value: 31 }))), {
    kind: "accepted",
  });

  assert.equal(store.updateCropCycle({
    schemaVersion: "smartfarm.crop-cycle-detail.v1",
    cycle: {
      schemaVersion: "smartfarm.crop-cycle.v1",
      id: activeCycleId,
      farmId: demoFarmId,
      name: "Basil Cycle Week 31",
      cropName: "Basil",
      variety: "Sweet Basil",
      status: "completed",
      startedAt: "2026-07-17T00:00:00.000Z",
      plannedEndAt: "2026-08-14T00:00:00.000Z",
      createdAt: "2026-07-17T00:00:00.000Z",
      updatedAt: "2026-07-17T00:10:00.000Z",
    },
    areaIds: [eastAreaId, westAreaId],
  }).kind, "updated");
  assert.equal(store.createCropCycle({
    schemaVersion: "smartfarm.crop-cycle-detail.v1",
    cycle: {
      schemaVersion: "smartfarm.crop-cycle.v1",
      id: nextCycleId,
      farmId: demoFarmId,
      name: "Basil Cycle Week 32",
      cropName: "Basil",
      variety: "Sweet Basil",
      status: "active",
      startedAt: "2026-07-17T00:10:00.000Z",
      plannedEndAt: "2026-08-21T00:00:00.000Z",
      createdAt: "2026-07-17T00:10:00.000Z",
      updatedAt: "2026-07-17T00:10:00.000Z",
    },
    areaIds: [eastAreaId],
  }).kind, "created");
  store.upsertAlarmRule(alarmRuleInput({
    id: "alarm-rule:demo-temperature-high-next",
    cycleId: nextCycleId,
    name: "High Temperature Next Cycle",
    createdAt: "2026-07-17T00:10:00.000Z",
    updatedAt: "2026-07-17T00:10:00.000Z",
  }));

  const app = buildTestApiWithStore(store);
  t.after(() => app.close());

  const telemetry = await app.inject({
    method: "POST",
    url: `/v1/farms/${demoFarmPath}/telemetry`,
    headers: { "x-test-principal": "edge" },
    payload: validTelemetryInput({
      id: "telemetry:bed-1-000002",
      sequence: 2,
      value: 32,
      observedAt: "2026-07-17T00:00:20.000Z",
    }),
  });
  const active = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/alarms?state=active&limit=10`,
    headers: { "x-test-principal": "user" },
  });
  const cleared = await app.inject({
    method: "GET",
    url: `/v1/farms/${demoFarmPath}/alarms?state=cleared&limit=10`,
    headers: { "x-test-principal": "user" },
  });

  assert.equal(telemetry.statusCode, 202);

  const activeBody = AlarmListResponseSchema.parse(active.json());
  assert.equal(activeBody.alarms.length, 1);
  assert.equal(activeBody.alarms[0]?.cycleId, nextCycleId);
  assert.equal(activeBody.alarms[0]?.ruleId, "alarm-rule:demo-temperature-high-next");

  const clearedBody = AlarmListResponseSchema.parse(cleared.json());
  assert.equal(clearedBody.alarms.length, 1);
  assert.equal(clearedBody.alarms[0]?.cycleId, activeCycleId);
  assert.equal(clearedBody.alarms[0]?.state, "cleared");
});

test("contract schemas used by HTTP tests remain strict writers and readers", () => {
  const telemetry = TelemetrySchema.safeParse({
    ...validTelemetryInput(),
    extra: "not-allowed",
  });

  assert.equal(telemetry.success, false);
});
