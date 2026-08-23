import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AlarmListResponseSchema,
  AlarmResponseSchema,
  AuditEventListResponseSchema,
  CommandListResponseSchema,
  CommandProjectionSchema,
  CropCycleListResponseSchema,
  CropListResponseSchema,
  CropResponseSchema,
  DeviceListResponseSchema,
  FarmListResponseSchema,
  GatewayAccessListResponseSchema,
  GatewayEnrollmentExchangeResponseSchema,
  GrowingAreaListResponseSchema,
  IssueGatewayEnrollmentResponseSchema,
  IrrigationStrategyListResponseSchema,
  LatestTelemetryResponseSchema,
  RevokeEdgeCredentialResponseSchema,
  StrategyApplicationResponseSchema,
  type DeviceId,
  type TelemetryMetric,
} from "@smartfarm-os/contracts";
import {
  assertDemoModeEnabled,
  startLocalDemo,
  type LocalDemoRuntime,
} from "./runtime.js";

test("refuses to enable the CLI entrypoint without SMARTFARM_DEMO_MODE=1", () => {
  assert.throws(
    () => assertDemoModeEnabled({ SMARTFARM_DEMO_MODE: "0" }),
    /SMARTFARM_DEMO_MODE=1/,
  );
  assert.doesNotThrow(() => assertDemoModeEnabled({ SMARTFARM_DEMO_MODE: "1" }));
  assert.throws(
    () => assertDemoModeEnabled({ SMARTFARM_DEMO_MODE: "1", NODE_ENV: "production" }),
    /NODE_ENV=production/,
  );
});

test("keeps central API and Edge journal SQLite schemas in separate files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-local-demo-db-separation-"));
  const databasePath = join(directory, "shared.sqlite");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  await assert.rejects(
    startLocalDemo({
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      databasePath,
      edgeDatabasePath: join(directory, ".", "shared.sqlite"),
      demoKey: "separate-db-secret",
      port: 0,
    }),
    /API and Edge SQLite paths must be different/,
  );
});

test("refuses a split central API and Edge database pair", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-local-demo-db-pair-"));
  const databasePath = join(directory, "local-demo.sqlite");
  const edgeDatabasePath = `${databasePath}.edge.sqlite`;
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  await writeFile(databasePath, "");
  await assert.rejects(
    startLocalDemo({
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      databasePath,
      edgeDatabasePath,
      demoKey: "paired-db-secret",
      port: 0,
    }),
    /must both exist or both be absent/,
  );

  await rm(databasePath, { force: true });
  await writeFile(edgeDatabasePath, "");
  await assert.rejects(
    startLocalDemo({
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      databasePath,
      edgeDatabasePath,
      demoKey: "paired-db-secret",
      port: 0,
    }),
    /must both exist or both be absent/,
  );
});

test("serves real HTTP telemetry and command acknowledgements on loopback", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-local-demo-http-"));
  const databasePath = join(directory, "local-demo.sqlite");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const backgroundErrors: unknown[] = [];
  const runtime = await startLocalDemo({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    databasePath,
    demoKey: "demo-secret",
    port: 0,
    telemetryIntervalMs: 50,
    commandPollIntervalMs: 25,
    onBackgroundError: (error) => {
      backgroundErrors.push(error);
    },
  });
  t.after(async () => {
    await runtime.close();
  });

  const baseUrl = new URL(runtime.baseUrl);
  assert.equal(baseUrl.hostname, "127.0.0.1");
  assert.equal(runtime.edgeDatabasePath, `${databasePath}.edge.sqlite`);

  const farms = FarmListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/farms",
    200,
  ));
  const devices = DeviceListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/farms/farm%3Ademo/devices",
    200,
  ));
  const crops = CropListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/farms/farm%3Ademo/crops",
    200,
  ));
  const areas = GrowingAreaListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/farms/farm%3Ademo/areas",
    200,
  ));
  const cropCycles = CropCycleListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/farms/farm%3Ademo/crop-cycles",
    200,
  ));

  assert.equal(farms.farms.length, 1);
  assert.deepEqual(runtime.deviceIds, ["device:bed-1", "device:bed-2"]);
  assert.equal(devices.devices.length, 2);
  assert.equal(crops.crops.length, 2);
  assert.equal(areas.areas.length, 2);
  assert.equal(cropCycles.cropCycles.length, 1);
  assert.deepEqual(cropCycles.cropCycles[0]?.areaIds, ["area:bed-1", "area:bed-2"]);
  assert.deepEqual(
    devices.devices[0]?.capabilities,
    ["temperature", "humidity", "illuminance", "water_level", "pump", "timed_pump"],
  );

  const temperature = await waitForLatestTelemetry(runtime, "temperature");
  const humidity = await waitForLatestTelemetry(runtime, "humidity");
  const illuminance = await waitForLatestTelemetry(runtime, "illuminance");
  const waterLevel = await waitForLatestTelemetry(runtime, "water_level");
  assert.equal(temperature.telemetry.sequence, 1);
  assert.equal(temperature.telemetry.metric, "temperature");
  assert.equal(temperature.telemetry.unit, "celsius");
  assert.equal(humidity.telemetry.sequence, 2);
  assert.equal(humidity.telemetry.metric, "humidity");
  assert.equal(humidity.telemetry.unit, "percent");
  assert.equal(illuminance.telemetry.sequence, 3);
  assert.equal(illuminance.telemetry.metric, "illuminance");
  assert.equal(illuminance.telemetry.unit, "lux");
  assert.equal(waterLevel.telemetry.sequence, 4);
  assert.equal(waterLevel.telemetry.metric, "water_level");
  assert.equal(waterLevel.telemetry.unit, "percent");
  const secondBedTemperature = await waitForLatestTelemetry(
    runtime,
    "temperature",
    runtime.deviceIds[1],
  );
  assert.equal(secondBedTemperature.telemetry.sequence, 1);
  assert.notEqual(secondBedTemperature.telemetry.value, temperature.telemetry.value);

  const created = await requestJson(
    runtime,
    "POST",
    "/v1/farms/farm%3Ademo/commands",
    202,
    {
      deviceId: "device:bed-1",
      state: "on",
      idempotencyKey: "demo-command-0001",
      ttlSeconds: 60,
    },
  );
  const pending = CommandProjectionSchema.parse(created);
  assert.equal(pending.status, "pending");

  const projection = await waitForCommand(runtime, pending.command.id);
  assert.equal(projection.status, "acknowledged");
  assert.equal(projection.ack?.status, "acknowledged");
  assert.equal(projection.ack?.result?.pumpState, "on");

  const commandHistory = CommandListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/farms/farm%3Ademo/commands?deviceId=device%3Abed-1&limit=10",
    200,
  ));
  assert.equal(commandHistory.commands.length, 1);
  assert.equal(commandHistory.commands[0]?.command.id, pending.command.id);
  assert.equal(commandHistory.commands[0]?.status, "acknowledged");
  assert.equal(commandHistory.commands[0]?.ack?.result?.pumpState, "on");

  const otherBedHistory = CommandListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/farms/farm%3Ademo/commands?deviceId=device%3Abed-2&limit=10",
    200,
  ));
  assert.equal(otherBedHistory.commands.length, 0);
  assert.deepEqual(backgroundErrors, []);
});

test("rejects public edge headers while internal device-bound edge keys keep both gateways working", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-local-demo-edge-auth-"));
  const databasePath = join(directory, "local-demo.sqlite");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const runtime = await startLocalDemo({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    databasePath,
    demoKey: "edge-auth-secret",
    port: 0,
    telemetryIntervalMs: 10_000,
    commandPollIntervalMs: 10_000,
  });
  t.after(async () => {
    await runtime.close();
  });

  const publicEdgeTelemetry = await requestRaw(
    runtime,
    "POST",
    "/v1/farms/farm%3Ademo/telemetry",
    {
      schemaVersion: "smartfarm.telemetry.v1",
      id: "telemetry:test-unknown-edge",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      metric: "temperature",
      value: 24.5,
      unit: "celsius",
      observedAt: "2026-07-17T00:00:10.000Z",
      sequence: 1,
    },
    runtime.createHeaders("edge", "edge:anything"),
  );
  assert.equal(publicEdgeTelemetry.status, 401);

  const primaryTemperature = await waitForLatestTelemetry(runtime, "temperature");
  const secondaryTemperature = await waitForLatestTelemetry(
    runtime,
    "temperature",
    runtime.deviceIds[1],
  );
  assert.equal(primaryTemperature.telemetry.deviceId, runtime.deviceId);
  assert.equal(secondaryTemperature.telemetry.deviceId, runtime.deviceIds[1]);
});

test("issues exchanges and revokes enrolled edge bearer keys without disturbing internal demo gateways", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-local-demo-gateway-enroll-"));
  const databasePath = join(directory, "local-demo.sqlite");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const runtime = await startLocalDemo({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    databasePath,
    demoKey: "gateway-enroll-secret",
    port: 0,
    telemetryIntervalMs: 100,
    commandPollIntervalMs: 50,
    now: () => new Date("2026-07-17T00:00:00.000Z"),
  });
  t.after(async () => {
    await runtime.close();
  });

  const issuedRaw = await requestRaw(
    runtime,
    "POST",
    "/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/gateway-enrollments",
    {},
    runtime.createHeaders("admin", "admin:test"),
  );
  assert.equal(issuedRaw.status, 201);
  assert.equal(issuedRaw.headers.get("cache-control"), "no-store");
  const issued = IssueGatewayEnrollmentResponseSchema.parse(await issuedRaw.json());

  const exchanged = GatewayEnrollmentExchangeResponseSchema.parse(await requestJson(
    runtime,
    "POST",
    "/v1/gateway-enrollments/exchange",
    201,
    {},
    { authorization: `Bearer ${issued.enrollmentToken}` },
  ));
  const list = GatewayAccessListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/gateway-access?limit=10",
    200,
    undefined,
    runtime.createHeaders("admin", "admin:test"),
  ));
  assert.equal(list.enrollments[0]?.status, "exchanged");
  assert.equal(list.credentials[0]?.id, exchanged.credential.id);

  const scopedTelemetry = await requestRaw(
    runtime,
    "POST",
    "/v1/farms/farm%3Ademo/telemetry",
    {
      schemaVersion: "smartfarm.telemetry.v1",
      id: "telemetry:enrolled-edge-000001",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      metric: "temperature",
      value: 24.5,
      unit: "celsius",
      observedAt: "2026-07-17T00:00:10.000Z",
      sequence: 999,
    },
    { authorization: `Bearer ${exchanged.edgeKey}` },
  );
  assert.equal(scopedTelemetry.status, 202);

  const wrongDeviceTelemetry = await requestRaw(
    runtime,
    "POST",
    "/v1/farms/farm%3Ademo/telemetry",
    {
      schemaVersion: "smartfarm.telemetry.v1",
      id: "telemetry:enrolled-edge-000002",
      farmId: "farm:demo",
      deviceId: "device:bed-2",
      metric: "temperature",
      value: 24.5,
      unit: "celsius",
      observedAt: "2026-07-17T00:00:11.000Z",
      sequence: 1,
    },
    { authorization: `Bearer ${exchanged.edgeKey}` },
  );
  assert.equal(wrongDeviceTelemetry.status, 403);

  const revoked = RevokeEdgeCredentialResponseSchema.parse(await requestJson(
    runtime,
    "POST",
    `/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/edge-credentials/${encodeURIComponent(exchanged.credential.id)}/revocations`,
    200,
    {},
    runtime.createHeaders("admin", "admin:test"),
  ));
  assert.equal(revoked.credential.status, "revoked");

  const revokedTelemetry = await requestRaw(
    runtime,
    "POST",
    "/v1/farms/farm%3Ademo/telemetry",
    {
      schemaVersion: "smartfarm.telemetry.v1",
      id: "telemetry:enrolled-edge-000003",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      metric: "temperature",
      value: 24.5,
      unit: "celsius",
      observedAt: "2026-07-17T00:00:12.000Z",
      sequence: 1000,
    },
    { authorization: `Bearer ${exchanged.edgeKey}` },
  );
  assert.equal(revokedTelemetry.status, 401);

  const primaryTemperature = await waitForLatestTelemetry(runtime, "temperature");
  const secondaryTemperature = await waitForLatestTelemetry(
    runtime,
    "temperature",
    runtime.deviceIds[1],
  );
  assert.equal(primaryTemperature.telemetry.deviceId, runtime.deviceId);
  assert.equal(secondaryTemperature.telemetry.deviceId, runtime.deviceIds[1]);
});

test("runs the low-water alarm through update, acknowledgement, clear, and audit", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-local-demo-alarm-"));
  const databasePath = join(directory, "local-demo.sqlite");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const backgroundErrors: unknown[] = [];
  const runtime = await startLocalDemo({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    databasePath,
    demoKey: "alarm-secret",
    port: 0,
    telemetryIntervalMs: 300,
    commandPollIntervalMs: 10_000,
    onBackgroundError: (error) => {
      backgroundErrors.push(error);
    },
  });
  t.after(async () => {
    await runtime.close();
  });

  const opened = await waitForAlarmState(runtime, "active");
  assert.equal(opened.alarms.length, 1);
  const alarm = opened.alarms[0];
  assert.ok(alarm !== undefined);
  assert.equal(alarm.ruleId, "alarm-rule:bed-2-low-water");
  assert.equal(alarm.cycleId, "cycle:basil-2026");
  assert.equal(alarm.areaId, "area:bed-2");
  assert.equal(alarm.deviceId, "device:bed-2");
  assert.equal(alarm.metric, "water_level");
  assert.equal(alarm.lastValue < alarm.threshold, true);
  assert.equal(alarm.acknowledgement, null);

  const updated = await waitFor(async () => {
    const response = AlarmListResponseSchema.parse(await requestJson(
      runtime,
      "GET",
      "/v1/farms/farm%3Ademo/alarms?state=active&cycleId=cycle%3Abasil-2026",
      200,
    ));
    const current = response.alarms[0];
    return current !== undefined && current.lastTelemetryId !== current.triggerTelemetryId
      ? response
      : null;
  });
  assert.equal(updated.alarms.length, 1);
  assert.equal(updated.alarms[0]?.id, alarm.id);

  const acknowledgementPath = `/v1/farms/farm%3Ademo/alarms/${encodeURIComponent(alarm.id)}/acknowledgements`;
  const acknowledged = AlarmResponseSchema.parse(await requestJson(
    runtime,
    "POST",
    acknowledgementPath,
    200,
    { idempotencyKey: "alarm-ack-demo-0001" },
  ));
  assert.equal(acknowledged.alarm.id, alarm.id);
  assert.equal(acknowledged.alarm.acknowledgement?.actorId, "user:test");

  const replayed = AlarmResponseSchema.parse(await requestJson(
    runtime,
    "POST",
    acknowledgementPath,
    200,
    { idempotencyKey: "alarm-ack-demo-0001" },
  ));
  assert.deepEqual(replayed, acknowledged);

  const audit = AuditEventListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/farms/farm%3Ademo/audit-events?cycleId=cycle%3Abasil-2026",
    200,
  ));
  assert.equal(audit.auditEvents.length, 1);
  assert.equal(audit.auditEvents[0]?.action, "alarm.acknowledged");
  assert.equal(audit.auditEvents[0]?.targetId, alarm.id);

  const cleared = await waitForAlarmState(runtime, "cleared");
  assert.equal(cleared.alarms.length, 1);
  const clearedAlarm = cleared.alarms[0];
  assert.ok(clearedAlarm !== undefined);
  assert.equal(clearedAlarm.id, alarm.id);
  assert.equal(clearedAlarm.lastValue >= clearedAlarm.threshold, true);
  assert.equal(clearedAlarm.acknowledgement?.actorId, "user:test");
  assert.notEqual(clearedAlarm.clearedAt, null);

  const activeAfterClear = AlarmListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/farms/farm%3Ademo/alarms?state=active&cycleId=cycle%3Abasil-2026",
    200,
  ));
  assert.equal(activeAfterClear.alarms.length, 0);
  assert.deepEqual(backgroundErrors, []);
});

test("keeps the usability low-water alarm active for the configured emission window", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-local-demo-usability-window-"));
  const databasePath = join(directory, "local-demo.sqlite");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const backgroundErrors: unknown[] = [];
  const runtime = await startLocalDemo({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    databasePath,
    demoKey: "usability-window-secret",
    port: 0,
    telemetryIntervalMs: 100,
    commandPollIntervalMs: 10_000,
    lowWaterRecoveryEmissionIndex: 50,
    onBackgroundError: (error) => {
      backgroundErrors.push(error);
    },
  });
  t.after(async () => {
    await runtime.close();
  });

  await waitForTelemetrySequence(
    runtime,
    "water_level",
    20,
    runtime.deviceIds[1],
  );
  const active = AlarmListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/farms/farm%3Ademo/alarms?state=active&cycleId=cycle%3Abasil-2026",
    200,
  ));
  assert.equal(active.alarms.length, 1);
  assert.equal(active.alarms[0]?.areaId, "area:bed-2");
  assert.equal((active.alarms[0]?.lastValue ?? 100) < (active.alarms[0]?.threshold ?? 0), true);
  assert.deepEqual(backgroundErrors, []);
});

test("applies an approved irrigation strategy to two areas with aggregated ACK audit", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-local-demo-irrigation-"));
  const databasePath = join(directory, "local-demo.sqlite");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const backgroundErrors: unknown[] = [];
  const runtime = await startLocalDemo({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    databasePath,
    demoKey: "irrigation-secret",
    port: 0,
    telemetryIntervalMs: 10_000,
    commandPollIntervalMs: 25,
    onBackgroundError: (error) => {
      backgroundErrors.push(error);
    },
  });
  t.after(async () => {
    await runtime.close();
  });

  const strategies = IrrigationStrategyListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/farms/farm%3Ademo/irrigation-strategies?cycleId=cycle%3Abasil-2026",
    200,
  ));
  assert.equal(strategies.irrigationStrategies.length, 2);
  const strategy = strategies.irrigationStrategies[0];
  assert.ok(strategy !== undefined);
  assert.equal(strategy.id, "strategy:basil-recovery");
  assert.equal(strategy.version, 2);
  assert.equal(strategy.status, "approved");
  assert.equal(strategy.pumpState, "on");
  assert.equal(strategy.runDurationSeconds, 5);

  const applyPath =
    "/v1/farms/farm%3Ademo/irrigation-strategies/strategy%3Abasil-recovery/applications";
  const request = {
    cycleId: "cycle:basil-2026",
    strategyVersion: 2,
    areaIds: ["area:bed-1", "area:bed-2"],
    idempotencyKey: "irrigation-apply-demo-0001",
  };
  const accepted = StrategyApplicationResponseSchema.parse(await requestJson(
    runtime,
    "POST",
    applyPath,
    202,
    request,
  ));
  assert.equal(accepted.strategyApplication.status, "pending");
  assert.equal(accepted.strategyApplication.targets.length, 2);
  assert.equal(accepted.strategyApplication.runDurationSeconds, 5);

  await delay(100);
  const stillPending = StrategyApplicationResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    `/v1/farms/farm%3Ademo/strategy-applications/${encodeURIComponent(accepted.strategyApplication.id)}`,
    200,
  ));
  assert.equal(stillPending.strategyApplication.status, "pending");

  const completed = await waitForStrategyApplication(
    runtime,
    accepted.strategyApplication.id,
  );
  assert.equal(completed.strategyApplication.status, "succeeded");
  assert.equal(
    completed.strategyApplication.targets.every((target) =>
      target.status === "acknowledged" && target.resultingPumpState === "off"),
    true,
  );

  const replayed = StrategyApplicationResponseSchema.parse(await requestJson(
    runtime,
    "POST",
    applyPath,
    200,
    request,
  ));
  assert.equal(replayed.strategyApplication.id, completed.strategyApplication.id);
  assert.equal(replayed.strategyApplication.status, "succeeded");

  const commandHistory = CommandListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/farms/farm%3Ademo/commands?limit=10",
    200,
  ));
  assert.equal(commandHistory.commands.length, 2);
  assert.deepEqual(
    new Set(commandHistory.commands.map((projection) => projection.command.deviceId)),
    new Set(["device:bed-1", "device:bed-2"]),
  );
  assert.equal(commandHistory.commands.every((projection) => projection.status === "acknowledged"), true);
  assert.equal(
    commandHistory.commands.every((projection) =>
      projection.command.schemaVersion === "smartfarm.command.v2"
      && projection.command.payload.durationSeconds === 5
      && projection.ack?.result?.pumpState === "off"),
    true,
  );

  const audit = AuditEventListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/farms/farm%3Ademo/audit-events?cycleId=cycle%3Abasil-2026",
    200,
  ));
  assert.equal(audit.auditEvents.length, 3);
  assert.equal(
    audit.auditEvents.filter((event) => event.action === "command.completed").length,
    2,
  );
  assert.equal(
    audit.auditEvents.filter((event) => event.action === "strategy.applied").length,
    1,
  );
  assert.equal(
    audit.auditEvents
      .filter((event) => event.action === "command.completed")
      .every((event) => event.details.runDurationSeconds === 5),
    true,
  );

  await requestJson(
    runtime,
    "POST",
    applyPath,
    409,
    { ...request, areaIds: ["area:bed-1"] },
  );
  assert.deepEqual(backgroundErrors, []);
});

test("keeps command polling independent while another device runs timed irrigation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-local-demo-independent-poll-"));
  const databasePath = join(directory, "local-demo.sqlite");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const backgroundErrors: unknown[] = [];
  const runtime = await startLocalDemo({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    databasePath,
    demoKey: "independent-poll-secret",
    port: 0,
    telemetryIntervalMs: 10_000,
    commandPollIntervalMs: 25,
    onBackgroundError: (error) => {
      backgroundErrors.push(error);
    },
  });
  t.after(async () => {
    await runtime.close();
  });

  const accepted = StrategyApplicationResponseSchema.parse(await requestJson(
    runtime,
    "POST",
    "/v1/farms/farm%3Ademo/irrigation-strategies/strategy%3Abasil-recovery/applications",
    202,
    {
      cycleId: "cycle:basil-2026",
      strategyVersion: 2,
      areaIds: ["area:bed-2"],
      idempotencyKey: "irrigation-independent-poll-0001",
    },
  ));
  await delay(150);

  const manualStartedAt = Date.now();
  const manual = CommandProjectionSchema.parse(await requestJson(
    runtime,
    "POST",
    "/v1/farms/farm%3Ademo/commands",
    202,
    {
      deviceId: "device:bed-1",
      state: "off",
      idempotencyKey: "manual-independent-poll-0001",
      ttlSeconds: 60,
    },
  ));
  const manualCompleted = await waitForCommand(runtime, manual.command.id);
  assert.equal(manualCompleted.status, "acknowledged");
  assert.equal(manualCompleted.ack?.result?.pumpState, "off");
  assert.equal(Date.now() - manualStartedAt < 2_000, true);

  const timedStillPending = StrategyApplicationResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    `/v1/farms/farm%3Ademo/strategy-applications/${encodeURIComponent(accepted.strategyApplication.id)}`,
    200,
  ));
  assert.equal(timedStillPending.strategyApplication.status, "pending");

  const timedCompleted = await waitForStrategyApplication(
    runtime,
    accepted.strategyApplication.id,
  );
  assert.equal(timedCompleted.strategyApplication.status, "succeeded");
  assert.equal(timedCompleted.strategyApplication.targets[0]?.resultingPumpState, "off");
  assert.deepEqual(backgroundErrors, []);
});

test("stops an active timed irrigation before its timer completes and preserves causal history", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-local-demo-manual-stop-"));
  const databasePath = join(directory, "local-demo.sqlite");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const backgroundErrors: unknown[] = [];
  const runtime = await startLocalDemo({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    databasePath,
    demoKey: "manual-stop-secret",
    port: 0,
    telemetryIntervalMs: 10_000,
    commandPollIntervalMs: 25,
    onBackgroundError: (error) => {
      backgroundErrors.push(error);
    },
  });
  t.after(async () => {
    await runtime.close();
  });

  const accepted = StrategyApplicationResponseSchema.parse(await requestJson(
    runtime,
    "POST",
    "/v1/farms/farm%3Ademo/irrigation-strategies/strategy%3Abasil-recovery/applications",
    202,
    {
      cycleId: "cycle:basil-2026",
      strategyVersion: 2,
      areaIds: ["area:bed-1"],
      idempotencyKey: "irrigation-manual-stop-0001",
    },
  ));
  await delay(150);

  const stopStartedAt = Date.now();
  const stop = CommandProjectionSchema.parse(await requestJson(
    runtime,
    "POST",
    "/v1/farms/farm%3Ademo/commands",
    202,
    {
      deviceId: "device:bed-1",
      state: "off",
      idempotencyKey: "manual-stop-active-run-0001",
      ttlSeconds: 60,
    },
  ));
  const stopped = await waitForCommand(runtime, stop.command.id);
  const interrupted = await waitForStrategyApplication(
    runtime,
    accepted.strategyApplication.id,
  );
  const timedCommandId = accepted.strategyApplication.targets[0]?.commandId;
  assert.ok(timedCommandId !== undefined);
  const timedProjection = await waitForCommand(runtime, timedCommandId);

  assert.equal(Date.now() - stopStartedAt < 2_000, true);
  assert.equal(stopped.status, "acknowledged");
  assert.equal(stopped.ack?.result?.pumpState, "off");
  assert.equal(interrupted.strategyApplication.status, "failed");
  assert.equal(interrupted.strategyApplication.targets[0]?.status, "failed");
  assert.equal(interrupted.strategyApplication.targets[0]?.reasonCode, "manual_stop");
  assert.equal(timedProjection.status, "failed");
  assert.equal(timedProjection.ack?.schemaVersion, "smartfarm.command-ack.v2");
  assert.equal(timedProjection.ack?.reasonCode, "manual_stop");
  assert.equal(
    timedProjection.ack?.schemaVersion === "smartfarm.command-ack.v2"
      ? timedProjection.ack.causedByCommandId
      : null,
    stop.command.id,
  );
  const audit = AuditEventListResponseSchema.parse(await requestJson(
    runtime,
    "GET",
    "/v1/farms/farm%3Ademo/audit-events?cycleId=cycle%3Abasil-2026",
    200,
  ));
  const interruptedAudit = audit.auditEvents.find((event) =>
    event.action === "command.completed" && event.targetId === timedCommandId,
  );
  assert.equal(interruptedAudit?.result, "failure");
  assert.equal(interruptedAudit?.details.reasonCode, "manual_stop");
  assert.equal(interruptedAudit?.details.manualStopCommandId, stop.command.id);
  assert.deepEqual(backgroundErrors, []);
});

test("resumes the telemetry sequence safely from persisted SQLite state", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-local-demo-resume-"));
  const databasePath = join(directory, "local-demo.sqlite");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const first = await startLocalDemo({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    databasePath,
    demoKey: "resume-secret",
    port: 0,
    telemetryIntervalMs: 10_000,
    commandPollIntervalMs: 10_000,
  });
  const initialCrops = CropListResponseSchema.parse(await requestJson(
    first,
    "GET",
    "/v1/farms/farm%3Ademo/crops",
    200,
  ));
  assert.equal(initialCrops.crops.length, 2);
  const initialTemperature = await waitForLatestTelemetry(first, "temperature");
  const initialHumidity = await waitForLatestTelemetry(first, "humidity");
  const initialIlluminance = await waitForLatestTelemetry(first, "illuminance");
  const initialWaterLevel = await waitForLatestTelemetry(first, "water_level");
  assert.equal(initialTemperature.telemetry.sequence, 1);
  assert.equal(initialHumidity.telemetry.sequence, 2);
  assert.equal(initialIlluminance.telemetry.sequence, 3);
  assert.equal(initialWaterLevel.telemetry.sequence, 4);
  const createdCrop = CropResponseSchema.parse(await requestJson(
    first,
    "POST",
    "/v1/farms/farm%3Ademo/crops",
    201,
    {
      deviceId: "device:bed-1",
      name: "Tomato",
      healthStatus: "good",
      managerName: "Runtime Tester",
      notes: "Created before restart",
    },
  ));
  assert.equal(createdCrop.crop.name, "Tomato");
  await first.close();

  const second = await startLocalDemo({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    databasePath,
    demoKey: "resume-secret",
    port: 0,
    telemetryIntervalMs: 10_000,
    commandPollIntervalMs: 10_000,
  });
  t.after(async () => {
    await second.close();
  });

  const resumedCrops = CropListResponseSchema.parse(await requestJson(
    second,
    "GET",
    "/v1/farms/farm%3Ademo/crops",
    200,
  ));
  const resumedTemperature = await waitForLatestTelemetry(second, "temperature");
  const resumedHumidity = await waitForLatestTelemetry(second, "humidity");
  const resumedIlluminance = await waitForLatestTelemetry(second, "illuminance");
  const resumedWaterLevel = await waitForLatestTelemetry(second, "water_level");
  assert.equal(resumedCrops.crops.length, 3);
  assert.equal(
    resumedCrops.crops.some((crop) => crop.id === createdCrop.crop.id),
    true,
  );
  assert.equal(resumedTemperature.telemetry.sequence, 5);
  assert.equal(resumedHumidity.telemetry.sequence, 6);
  assert.equal(resumedIlluminance.telemetry.sequence, 7);
  assert.equal(resumedWaterLevel.telemetry.sequence, 8);
});

test("rejects a persisted demo when configured device IDs no longer match its areas", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-local-demo-device-scope-"));
  const databasePath = join(directory, "local-demo.sqlite");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const first = await startLocalDemo({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    databasePath,
    demoKey: "device-scope-secret",
    port: 0,
    telemetryIntervalMs: 10_000,
    commandPollIntervalMs: 10_000,
  });
  await first.close();

  await assert.rejects(
    startLocalDemo({
      farmId: "farm:demo",
      deviceId: "device:replacement-1",
      secondaryDeviceId: "device:replacement-2",
      databasePath,
      demoKey: "device-scope-secret",
      port: 0,
      telemetryIntervalMs: 10_000,
      commandPollIntervalMs: 10_000,
    }),
    /original device IDs or a fresh SQLite path/,
  );

  const verified = await startLocalDemo({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    databasePath,
    demoKey: "device-scope-secret",
    port: 0,
    telemetryIntervalMs: 10_000,
    commandPollIntervalMs: 10_000,
  });
  t.after(async () => {
    await verified.close();
  });
  const devices = DeviceListResponseSchema.parse(await requestJson(
    verified,
    "GET",
    "/v1/farms/farm%3Ademo/devices",
    200,
  ));
  assert.equal(devices.devices.length, 2);
});

test("keeps default environment telemetry within contract bounds over repeated emissions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-local-demo-bounds-"));
  const databasePath = join(directory, "local-demo.sqlite");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const runtime = await startLocalDemo({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    databasePath,
    demoKey: "bounds-secret",
    port: 0,
    telemetryIntervalMs: 20,
    commandPollIntervalMs: 10_000,
  });
  t.after(async () => {
    await runtime.close();
  });

  const waterLevel = await waitForTelemetrySequence(runtime, "water_level", 40);
  const temperature = await waitForLatestTelemetry(runtime, "temperature");
  const humidity = await waitForLatestTelemetry(runtime, "humidity");
  const illuminance = await waitForLatestTelemetry(runtime, "illuminance");

  assert.equal(waterLevel.telemetry.sequence >= 40, true);
  assert.equal(temperature.telemetry.value >= -50 && temperature.telemetry.value <= 100, true);
  assert.equal(humidity.telemetry.value >= 0 && humidity.telemetry.value <= 100, true);
  assert.equal(illuminance.telemetry.value >= 0 && illuminance.telemetry.value <= 200_000, true);
  assert.equal(waterLevel.telemetry.value >= 0 && waterLevel.telemetry.value <= 100, true);
});

async function waitForLatestTelemetry(
  runtime: LocalDemoRuntime,
  metric: TelemetryMetric,
  deviceId: DeviceId = runtime.deviceId,
) {
  return waitFor(async () => {
    const response = await requestRaw(
      runtime,
      "GET",
      `/v1/farms/farm%3Ademo/devices/${encodeURIComponent(deviceId)}/telemetry/latest?metric=${encodeURIComponent(metric)}`,
    );
    if (response.status !== 200) return null;
    return LatestTelemetryResponseSchema.parse(await response.json());
  });
}

async function waitForTelemetrySequence(
  runtime: LocalDemoRuntime,
  metric: TelemetryMetric,
  minimumSequence: number,
  deviceId: DeviceId = runtime.deviceId,
) {
  return waitFor(async () => {
    const response = await requestRaw(
      runtime,
      "GET",
      `/v1/farms/farm%3Ademo/devices/${encodeURIComponent(deviceId)}/telemetry/latest?metric=${encodeURIComponent(metric)}`,
    );
    if (response.status !== 200) return null;
    const latest = LatestTelemetryResponseSchema.parse(await response.json());
    return latest.telemetry.sequence >= minimumSequence ? latest : null;
  });
}

async function waitForCommand(runtime: LocalDemoRuntime, commandId: string) {
  return waitFor(async () => {
    const response = await requestRaw(
      runtime,
      "GET",
      `/v1/farms/farm%3Ademo/commands/${encodeURIComponent(commandId)}`,
    );
    if (response.status !== 200) return null;
    const projection = CommandProjectionSchema.parse(await response.json());
    return projection.status === "pending" ? null : projection;
  });
}

async function waitForAlarmState(
  runtime: LocalDemoRuntime,
  state: "active" | "cleared",
) {
  return waitFor(async () => {
    const response = await requestRaw(
      runtime,
      "GET",
      `/v1/farms/farm%3Ademo/alarms?state=${state}&cycleId=cycle%3Abasil-2026`,
    );
    if (response.status !== 200) return null;
    const alarms = AlarmListResponseSchema.parse(await response.json());
    return alarms.alarms.length === 0 ? null : alarms;
  });
}

async function waitForStrategyApplication(
  runtime: LocalDemoRuntime,
  applicationId: string,
) {
  return waitFor(async () => {
    const response = await requestRaw(
      runtime,
      "GET",
      `/v1/farms/farm%3Ademo/strategy-applications/${encodeURIComponent(applicationId)}`,
    );
    if (response.status !== 200) return null;
    const application = StrategyApplicationResponseSchema.parse(await response.json());
    return application.strategyApplication.status === "pending" ? null : application;
  });
}

async function requestJson(
  runtime: LocalDemoRuntime,
  method: "GET" | "POST",
  path: string,
  expectedStatus: number,
  body?: unknown,
  headers?: Readonly<Record<string, string>>,
): Promise<unknown> {
  const response = await requestRaw(runtime, method, path, body, headers);
  assert.equal(response.status, expectedStatus);
  if (expectedStatus === 204) {
    return null;
  }
  return response.json();
}

async function requestRaw(
  runtime: LocalDemoRuntime,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  headers?: Readonly<Record<string, string>>,
): Promise<Response> {
  return fetch(new URL(path, runtime.baseUrl), {
    method,
    headers: {
      ...(headers ?? runtime.createHeaders("user", "user:test")),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}


async function waitFor<T>(operation: () => Promise<T | null>): Promise<T> {
  const timeoutAt = Date.now() + 8_000;

  while (Date.now() < timeoutAt) {
    const value = await operation();
    if (value !== null) return value;
    await delay(25);
  }

  throw new Error("Timed out while waiting for the local demo runtime");
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}
