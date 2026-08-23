import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  AlarmRuleSchema,
  type CommandAck,
  CommandAckSchema,
  CommandSchema,
  CropCycleIdSchema,
  CropIdSchema,
  DeviceIdSchema,
  EdgeCredentialIdSchema,
  FarmIdSchema,
  GatewayEnrollmentIdSchema,
  GrowingAreaIdSchema,
  IrrigationStrategySchema,
  TelemetrySchema,
} from "@smartfarm-os/contracts";
import {
  createPendingStrategyApplication,
  type StrategyApplicationCommandTarget,
} from "./irrigation-center.js";
import { SQLITE_SCHEMA_VERSION, SqliteSmartFarmStore } from "./sqlite-store.js";

const demoFarmId = FarmIdSchema.parse("farm:demo");
const otherFarmId = FarmIdSchema.parse("farm:other");
const demoDeviceId = DeviceIdSchema.parse("device:bed-1");
const secondDemoDeviceId = DeviceIdSchema.parse("device:bed-2");
const sensorOnlyDeviceId = DeviceIdSchema.parse("device:sensor-only");
const eastAreaId = GrowingAreaIdSchema.parse("area:east-bed");
const westAreaId = GrowingAreaIdSchema.parse("area:west-bed");
const activeCycleId = CropCycleIdSchema.parse("cycle:basil-week-31");
const nextCycleId = CropCycleIdSchema.parse("cycle:basil-week-32");
const basilCropId = CropIdSchema.parse("crop:basil-bed-1");
const lettuceCropId = CropIdSchema.parse("crop:lettuce-bed-1");

function telemetry(overrides: Record<string, unknown> = {}) {
  return TelemetrySchema.parse({
    schemaVersion: "smartfarm.telemetry.v1",
    id: "telemetry:bed-1-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    metric: "temperature",
    value: 24.5,
    unit: "celsius",
    sequence: 1,
    observedAt: "2026-07-17T00:00:10.000Z",
    ...overrides,
  });
}

function command(overrides: Record<string, unknown> = {}) {
  return CommandSchema.parse({
    schemaVersion: "smartfarm.command.v1",
    id: "command:pump-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    payload: { action: "set_pump_state", state: "on" },
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "demo-pump-000001",
    issuedAt: "2026-07-17T00:00:00.000Z",
    expiresAt: "2026-07-17T00:01:00.000Z",
    ...overrides,
  });
}

function acknowledgement(commandId = "command:pump-000001") {
  return CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId,
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: "on" },
    processedAt: "2026-07-17T00:00:10.000Z",
  });
}

function manualStopAcknowledgement(overrides: Record<string, unknown> = {}): CommandAck {
  return CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v2",
    commandId: "command:timed-pump-000001",
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    status: "failed",
    reasonCode: "manual_stop",
    result: null,
    causedByCommandId: "command:pump-stop-000001",
    processedAt: "2026-07-17T00:00:10.000Z",
    ...overrides,
  });
}

function alarmRule(overrides: Record<string, unknown> = {}) {
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

function irrigationStrategy(overrides: Record<string, unknown> = {}) {
  return IrrigationStrategySchema.parse({
    schemaVersion: "smartfarm.irrigation-strategy.v1",
    id: "strategy:irrigation-once",
    version: 1,
    farmId: demoFarmId,
    cycleId: activeCycleId,
    name: "Irrigation Once",
    description: "Turn the pump on for assigned areas.",
    pumpState: "on",
    status: "approved",
    createdAt: "2026-07-17T00:00:00.000Z",
    approvedAt: "2026-07-17T00:00:00.000Z",
    ...overrides,
  });
}

function seedIrrigationStore(store: SqliteSmartFarmStore): void {
  store.upsertFarm({
    schemaVersion: "smartfarm.farm.v1",
    id: demoFarmId,
    name: "Demo Farm",
    timezone: "Asia/Seoul",
    createdAt: "2026-07-17T00:00:00.000Z",
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
  assert.equal(store.createCropCycle({
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
  }).kind, "created");
}

test("persists farm control profiles across SQLite restarts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-control-profile-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = new SqliteSmartFarmStore({ path });
  seedIrrigationStore(first);
  const firstUpdate = first.updateFarmControlProfile({
    schemaVersion: "smartfarm.farm-control-profile.v1",
    farmId: demoFarmId,
    revision: 1,
    widgets: [{
      schemaVersion: "smartfarm.farm-control-widget.v1",
      kind: "pump_control",
      deviceId: secondDemoDeviceId,
      label: "West Bed Start",
      showStart: false,
    }],
    updatedAt: "2026-07-17T00:00:10.000Z",
  }, 0);
  assert.equal(firstUpdate.kind, "updated");
  first.close();

  const second = new SqliteSmartFarmStore({ path });
  assert.deepEqual(second.getFarmControlProfile(demoFarmId), {
    schemaVersion: "smartfarm.farm-control-profile.v1",
    farmId: demoFarmId,
    revision: 1,
    widgets: [{
      schemaVersion: "smartfarm.farm-control-widget.v1",
      kind: "pump_control",
      deviceId: secondDemoDeviceId,
      label: "West Bed Start",
      showStart: false,
    }],
    updatedAt: "2026-07-17T00:00:10.000Z",
  });
  const conflict = second.updateFarmControlProfile({
    schemaVersion: "smartfarm.farm-control-profile.v1",
    farmId: demoFarmId,
    revision: 2,
    widgets: [{
      schemaVersion: "smartfarm.farm-control-widget.v1",
      kind: "pump_control",
      deviceId: demoDeviceId,
      label: "East Bed Start",
      showStart: true,
    }],
    updatedAt: "2026-07-17T00:00:20.000Z",
  }, 0);
  assert.deepEqual(conflict, {
    kind: "conflict",
    reason: "Farm control profile revision does not match",
  });
  second.close();
});

test("persists gateway enrollments and edge credential lifecycle across SQLite restarts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-gateway-auth-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = new SqliteSmartFarmStore({ path });
  seedIrrigationStore(first);
  const enrollmentId = GatewayEnrollmentIdSchema.parse("gateway-enrollment:test-enroll");
  const credentialId = EdgeCredentialIdSchema.parse("edge-credential:test-cred");
  const enrollment = first.issueGatewayEnrollment({
    id: enrollmentId,
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    tokenDigest: "a".repeat(64),
    issuedByActorId: "admin:demo",
    issuedAt: "2026-08-12T01:00:00.000Z",
    expiresAt: "2026-08-12T01:10:00.000Z",
  });
  assert.equal(enrollment.status, "pending");
  assert.equal(first.listGatewayEnrollments(demoFarmId, demoDeviceId, {
    now: "2026-08-12T01:05:00.000Z",
  }).length, 1);
  first.close();

  const second = new SqliteSmartFarmStore({ path });
  const storedEnrollment = second.getGatewayEnrollmentAuthentication(enrollmentId);
  assert.equal(storedEnrollment?.tokenDigest, "a".repeat(64));
  const exchanged = second.exchangeGatewayEnrollment({
    enrollmentId,
    expectedTokenDigest: "a".repeat(64),
    credentialId,
    credentialDigest: "b".repeat(64),
    exchangedAt: "2026-08-12T01:02:00.000Z",
  });
  assert.equal(exchanged.kind, "exchanged");
  assert.equal(second.exchangeGatewayEnrollment({
    enrollmentId,
    expectedTokenDigest: "a".repeat(64),
    credentialId: EdgeCredentialIdSchema.parse("edge-credential:test-cred-2"),
    credentialDigest: "c".repeat(64),
    exchangedAt: "2026-08-12T01:03:00.000Z",
  }).kind, "invalid");
  second.close();

  const third = new SqliteSmartFarmStore({ path });
  assert.equal(
    third.listGatewayEnrollments(demoFarmId, demoDeviceId, {
      now: "2026-08-12T01:05:00.000Z",
    })[0]?.status,
    "exchanged",
  );
  assert.equal(third.getEdgeCredentialAuthentication(credentialId)?.credentialDigest, "b".repeat(64));
  const revoked = third.revokeEdgeCredential({
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    credentialId,
    revokedAt: "2026-08-12T01:04:00.000Z",
    revokedByActorId: "admin:demo",
  });
  assert.equal(revoked.kind, "revoked");
  const replayed = third.revokeEdgeCredential({
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    credentialId,
    revokedAt: "2026-08-12T01:05:00.000Z",
    revokedByActorId: "admin:other",
  });
  assert.equal(replayed.kind, "replayed");
  third.close();
});

test("persists gateway enrollment revocation and rejects exchanged enrollment revocation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-gateway-revoke-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = new SqliteSmartFarmStore({ path });
  seedIrrigationStore(first);
  const revokableEnrollmentId = GatewayEnrollmentIdSchema.parse("gateway-enrollment:revokable");
  const exchangedEnrollmentId = GatewayEnrollmentIdSchema.parse("gateway-enrollment:exchanged");
  const credentialId = EdgeCredentialIdSchema.parse("edge-credential:exchange-result");

  first.issueGatewayEnrollment({
    id: revokableEnrollmentId,
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    tokenDigest: "d".repeat(64),
    issuedByActorId: "admin:demo",
    issuedAt: "2026-08-12T01:00:00.000Z",
    expiresAt: "2026-08-12T01:10:00.000Z",
  });
  first.issueGatewayEnrollment({
    id: exchangedEnrollmentId,
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    tokenDigest: "e".repeat(64),
    issuedByActorId: "admin:demo",
    issuedAt: "2026-08-12T01:01:00.000Z",
    expiresAt: "2026-08-12T01:11:00.000Z",
  });
  const revoked = first.revokeGatewayEnrollment({
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    enrollmentId: revokableEnrollmentId,
    revokedAt: "2026-08-12T01:02:00.000Z",
    revokedByActorId: "admin:demo",
  });
  assert.equal(revoked.kind, "revoked");
  assert.equal(revoked.enrollment.status, "revoked");
  first.exchangeGatewayEnrollment({
    enrollmentId: exchangedEnrollmentId,
    expectedTokenDigest: "e".repeat(64),
    credentialId,
    credentialDigest: "f".repeat(64),
    exchangedAt: "2026-08-12T01:03:00.000Z",
  });
  first.close();

  const second = new SqliteSmartFarmStore({ path });
  assert.equal(
    second.listGatewayEnrollments(demoFarmId, demoDeviceId, {
      now: "2026-08-12T01:04:00.000Z",
    }).find((enrollment) => enrollment.id === revokableEnrollmentId)?.status,
    "revoked",
  );
  const replayed = second.revokeGatewayEnrollment({
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    enrollmentId: revokableEnrollmentId,
    revokedAt: "2026-08-12T01:05:00.000Z",
    revokedByActorId: "admin:other",
  });
  assert.equal(replayed.kind, "replayed");

  const conflict = second.revokeGatewayEnrollment({
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    enrollmentId: exchangedEnrollmentId,
    revokedAt: "2026-08-12T01:06:00.000Z",
    revokedByActorId: "admin:demo",
  });
  assert.deepEqual(conflict, {
    kind: "conflict",
    reason: "Gateway enrollment has already been exchanged",
  });

  const notFound = second.revokeGatewayEnrollment({
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    enrollmentId: GatewayEnrollmentIdSchema.parse("gateway-enrollment:missing"),
    revokedAt: "2026-08-12T01:07:00.000Z",
    revokedByActorId: "admin:demo",
  });
  assert.deepEqual(notFound, { kind: "not_found" });
  second.close();
});

function seedAlarmStore(store: SqliteSmartFarmStore): void {
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
    id: demoDeviceId,
    farmId: otherFarmId,
    name: "Other Farm Bed 1",
    kind: "sensor",
    capabilities: ["temperature"],
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
    id: eastAreaId,
    farmId: otherFarmId,
    name: "Other Farm East Bed",
    kind: "bed",
    primaryDeviceId: demoDeviceId,
    status: "active",
    createdAt: "2026-07-17T00:02:00.000Z",
    updatedAt: "2026-07-17T00:02:00.000Z",
  });
  assert.equal(store.createCropCycle({
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
    areaIds: [eastAreaId],
  }).kind, "created");
  assert.equal(store.createCropCycle({
    schemaVersion: "smartfarm.crop-cycle-detail.v1",
    cycle: {
      schemaVersion: "smartfarm.crop-cycle.v1",
      id: activeCycleId,
      farmId: otherFarmId,
      name: "Other Farm Cycle",
      cropName: "Basil",
      variety: null,
      status: "active",
      startedAt: "2026-07-17T00:02:00.000Z",
      plannedEndAt: "2026-08-14T00:00:00.000Z",
      createdAt: "2026-07-17T00:02:00.000Z",
      updatedAt: "2026-07-17T00:02:00.000Z",
    },
    areaIds: [eastAreaId],
  }).kind, "created");
  store.upsertAlarmRule(alarmRule());
  store.upsertAlarmRule(alarmRule({
    id: "alarm-rule:other-temperature-high",
    farmId: otherFarmId,
    areaId: eastAreaId,
    deviceId: demoDeviceId,
    cycleId: activeCycleId,
    name: "Other Farm High Temperature",
    createdAt: "2026-07-17T00:02:00.000Z",
    updatedAt: "2026-07-17T00:02:00.000Z",
  }));
}

test("persists telemetry and its replay rules across a database restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-telemetry-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = new SqliteSmartFarmStore({ path });
  assert.deepEqual(first.putTelemetry(telemetry()), { kind: "accepted" });
  assert.deepEqual(first.putTelemetry(telemetry()), { kind: "replayed" });
  assert.equal(
    first.putTelemetry(telemetry({ value: 25 })).kind,
    "conflict",
  );
  first.close();

  const second = new SqliteSmartFarmStore({ path });
  assert.deepEqual(
    second.latestTelemetry(demoFarmId, demoDeviceId, "temperature"),
    telemetry(),
  );
  assert.deepEqual(
    second.putTelemetry(telemetry({
      id: "telemetry:bed-1-000002",
      value: 24.75,
      sequence: 2,
      observedAt: "2026-07-17T00:00:20.000Z",
    })),
    { kind: "accepted" },
  );
  second.close();

  const third = new SqliteSmartFarmStore({ path });
  assert.equal(
    third.latestTelemetry(demoFarmId, demoDeviceId, "temperature")?.sequence,
    2,
  );
  assert.deepEqual(
    third.recentTelemetry(demoFarmId, demoDeviceId, "temperature", 2).map((entry) => entry.sequence),
    [1, 2],
  );
  third.close();
});

test("persists a complete command lifecycle across database restarts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-command-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = new SqliteSmartFarmStore({ path });
  assert.equal(first.createCommand(command(), "2026-07-17T00:00:00.000Z").kind, "created");
  first.close();

  const second = new SqliteSmartFarmStore({ path });
  assert.equal(
    second.nextPendingCommand(demoFarmId, demoDeviceId)?.command.id,
    command().id,
  );
  assert.equal(
    second.applyAck(acknowledgement(), "2026-07-17T00:00:10.000Z").kind,
    "applied",
  );
  assert.deepEqual(second.listAuditEvents(demoFarmId, { limit: 10 }), []);
  const secondAudits = second.listAuditEvents(demoFarmId, { includeUnscoped: true, limit: 10 });
  assert.equal(secondAudits.length, 1);
  assert.equal(secondAudits[0]?.schemaVersion, "smartfarm.audit-event.v2");
  assert.equal(secondAudits[0]?.details.source, "direct");
  second.close();

  const third = new SqliteSmartFarmStore({ path });
  assert.equal(third.getCommand(command().id)?.status, "acknowledged");
  assert.equal(third.nextPendingCommand(demoFarmId, demoDeviceId), null);
  assert.equal(third.listAuditEvents(demoFarmId, { includeUnscoped: true, limit: 10 }).length, 1);
  assert.equal(
    third.applyAck(acknowledgement(), "2026-07-17T00:00:10.000Z").kind,
    "replayed",
  );
  assert.equal(third.listAuditEvents(demoFarmId, { includeUnscoped: true, limit: 10 }).length, 1);
  third.close();
});

test("lists commands in newest-result order with device filtering across restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-command-list-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = new SqliteSmartFarmStore({ path });
  assert.equal(
    first.createCommand(command(), "2026-07-17T00:00:00.000Z").kind,
    "created",
  );
  assert.equal(
    first.createCommand(command({
      id: "command:pump-000002",
      deviceId: secondDemoDeviceId,
      payload: { action: "set_pump_state", state: "off" },
      idempotencyKey: "demo-pump-000002",
      issuedAt: "2026-07-17T00:00:05.000Z",
      expiresAt: "2026-07-17T00:01:05.000Z",
    }), "2026-07-17T00:00:05.000Z").kind,
    "created",
  );
  assert.equal(
    first.applyAck(CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: "command:pump-000001",
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      status: "acknowledged",
      reasonCode: null,
      result: { pumpState: "on" },
      processedAt: "2026-07-17T00:00:10.000Z",
    }), "2026-07-17T00:00:10.000Z").kind,
    "applied",
  );
  first.close();

  const second = new SqliteSmartFarmStore({ path });
  assert.deepEqual(
    second.listCommands(demoFarmId).map((projection) => projection.command.id),
    ["command:pump-000001", "command:pump-000002"],
  );
  assert.deepEqual(
    second.listCommands(demoFarmId, { deviceId: secondDemoDeviceId, limit: 10 })
      .map((projection) => projection.command.id),
    ["command:pump-000002"],
  );
  assert.equal(second.listCommands(demoFarmId, { limit: 1 }).length, 1);
  assert.deepEqual(second.listCommands(otherFarmId), []);
  second.close();
});

test("persists strategy applications with replay conflict and partial aggregation across restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-strategy-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = new SqliteSmartFarmStore({ path });
  seedIrrigationStore(first);
  assert.equal(first.seedIrrigationStrategy(irrigationStrategy()).kind, "created");
  assert.equal(first.seedIrrigationStrategy(irrigationStrategy()).kind, "replayed");
  assert.equal(
    first.seedIrrigationStrategy(irrigationStrategy({ name: "Changed Strategy" })).kind,
    "conflict",
  );

  const strategy = first.getIrrigationStrategy(demoFarmId, "strategy:irrigation-once", 1)!;
  const createdAt = "2026-07-17T00:00:00.000Z";
  const targets: StrategyApplicationCommandTarget[] = [
    {
      areaId: eastAreaId,
      deviceId: demoDeviceId,
      command: command({
        id: "command:pump-000001",
        deviceId: demoDeviceId,
        idempotencyKey: "strategy-command-000001",
        issuedAt: createdAt,
        expiresAt: "2026-07-17T00:01:00.000Z",
      }),
    },
    {
      areaId: westAreaId,
      deviceId: secondDemoDeviceId,
      command: command({
        id: "command:pump-000002",
        deviceId: secondDemoDeviceId,
        payload: { action: "set_pump_state", state: "on" },
        idempotencyKey: "strategy-command-000002",
        issuedAt: "2026-07-17T00:00:05.000Z",
        expiresAt: "2026-07-17T00:01:05.000Z",
      }),
    },
  ];
  const application = createPendingStrategyApplication({
    id: "strategy-application:test-000001",
    farmId: demoFarmId,
    cycleId: activeCycleId,
    strategy,
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "strategy-apply-000001",
    targets,
    createdAt,
  });

  const mismatchedTargets: StrategyApplicationCommandTarget[] = [
    {
      ...targets[0]!,
      command: command({
        id: "command:pump-mismatch-000001",
        deviceId: demoDeviceId,
        idempotencyKey: "strategy-command-mismatch-000001",
        issuedAt: createdAt,
        expiresAt: "2026-07-17T00:01:00.000Z",
      }),
    },
    targets[1]!,
  ];
  const mismatchedApplication = createPendingStrategyApplication({
    id: "strategy-application:test-mismatch-000001",
    farmId: demoFarmId,
    cycleId: activeCycleId,
    strategy,
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "strategy-apply-mismatch-000001",
    targets: mismatchedTargets,
    createdAt,
  });
  assert.equal(
    first.createStrategyApplication(mismatchedApplication, targets).kind,
    "conflict",
  );
  assert.equal(
    first.getStrategyApplication(demoFarmId, mismatchedApplication.id),
    null,
  );
  assert.equal(first.getCommand(targets[0]!.command.id), null);

  assert.equal(first.createStrategyApplication(application, targets).kind, "created");

  const replayTargets: StrategyApplicationCommandTarget[] = [
    {
      areaId: eastAreaId,
      deviceId: demoDeviceId,
      command: command({
        id: "command:pump-000003",
        deviceId: demoDeviceId,
        idempotencyKey: "strategy-command-000003",
        issuedAt: createdAt,
        expiresAt: "2026-07-17T00:01:00.000Z",
      }),
    },
    {
      areaId: westAreaId,
      deviceId: secondDemoDeviceId,
      command: command({
        id: "command:pump-000004",
        deviceId: secondDemoDeviceId,
        payload: { action: "set_pump_state", state: "on" },
        idempotencyKey: "strategy-command-000004",
        issuedAt: "2026-07-17T00:00:05.000Z",
        expiresAt: "2026-07-17T00:01:05.000Z",
      }),
    },
  ];
  const replayApplication = createPendingStrategyApplication({
    id: "strategy-application:test-000002",
    farmId: demoFarmId,
    cycleId: activeCycleId,
    strategy,
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "strategy-apply-000001",
    targets: replayTargets,
    createdAt,
  });
  assert.equal(first.createStrategyApplication(replayApplication, replayTargets).kind, "replayed");

  const conflictTargets: StrategyApplicationCommandTarget[] = [targets[0]!];
  const conflictApplication = createPendingStrategyApplication({
    id: "strategy-application:test-000003",
    farmId: demoFarmId,
    cycleId: activeCycleId,
    strategy,
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "strategy-apply-000001",
    targets: conflictTargets,
    createdAt,
  });
  assert.equal(first.createStrategyApplication(conflictApplication, conflictTargets).kind, "conflict");

  assert.equal(
    first.applyAck(CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: "command:pump-000001",
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      status: "acknowledged",
      reasonCode: null,
      result: { pumpState: "on" },
      processedAt: "2026-07-17T00:00:10.000Z",
    }), "2026-07-17T00:00:10.000Z").kind,
    "applied",
  );
  assert.equal(
    first.applyAck(CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: "command:pump-000002",
      farmId: demoFarmId,
      deviceId: secondDemoDeviceId,
      status: "timed_out",
      reasonCode: "expired",
      result: null,
      processedAt: "2026-07-17T00:00:11.000Z",
    }), "2026-07-17T00:00:11.000Z").kind,
    "applied",
  );
  assert.equal(
    first.applyAck(CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: "command:pump-000002",
      farmId: demoFarmId,
      deviceId: secondDemoDeviceId,
      status: "timed_out",
      reasonCode: "expired",
      result: null,
      processedAt: "2026-07-17T00:00:11.000Z",
    }), "2026-07-17T00:00:11.000Z").kind,
    "replayed",
  );
  first.close();

  const second = new SqliteSmartFarmStore({ path });
  assert.equal(second.listIrrigationStrategies(demoFarmId, activeCycleId).length, 1);
  const persisted = second.getStrategyApplication(demoFarmId, "strategy-application:test-000001");
  assert.equal(persisted?.status, "partial");
  assert.equal(persisted?.targets[0]?.status, "acknowledged");
  assert.equal(persisted?.targets[1]?.status, "timed_out");
  const audits = second.listAuditEvents(demoFarmId, { cycleId: activeCycleId, limit: 10 });
  assert.equal(audits.filter((event) => event.action === "command.completed").length, 2);
  assert.equal(audits.filter((event) => event.action === "strategy.applied").length, 1);
  second.close();
});

test("persists a timed irrigation command until its final off acknowledgement", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-timed-irrigation-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = new SqliteSmartFarmStore({ path });
  seedIrrigationStore(first);
  const strategy = irrigationStrategy({
    version: 2,
    name: "Timed Irrigation",
    runDurationSeconds: 5,
  });
  assert.equal(first.seedIrrigationStrategy(strategy).kind, "created");
  const timedCommand = command({
    schemaVersion: "smartfarm.command.v2",
    id: "command:timed-pump-000001",
    payload: { action: "run_pump_for", durationSeconds: 5 },
    idempotencyKey: "strategy-timed-command-000001",
  });
  const targets: StrategyApplicationCommandTarget[] = [{
    areaId: eastAreaId,
    deviceId: demoDeviceId,
    command: timedCommand,
  }];
  const application = createPendingStrategyApplication({
    id: "strategy-application:timed-000001",
    farmId: demoFarmId,
    cycleId: activeCycleId,
    strategy,
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "strategy-apply-timed-000001",
    targets,
    createdAt: "2026-07-17T00:00:00.000Z",
  });
  assert.equal(first.createStrategyApplication(application, targets).kind, "created");
  first.close();

  const second = new SqliteSmartFarmStore({ path });
  const restoredPending = second.getStrategyApplication(demoFarmId, application.id);
  assert.equal(restoredPending?.runDurationSeconds, 5);
  assert.equal(restoredPending?.status, "pending");
  assert.equal(second.getCommand(timedCommand.id)?.command.schemaVersion, "smartfarm.command.v2");

  const falseFinalState = CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: timedCommand.id,
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: "on" },
    processedAt: "2026-07-17T00:00:04.000Z",
  });
  assert.equal(second.applyAck(falseFinalState, falseFinalState.processedAt).kind, "conflict");
  assert.equal(second.getStrategyApplication(demoFarmId, application.id)?.status, "pending");

  const finalOff = CommandAckSchema.parse({
    ...falseFinalState,
    result: { pumpState: "off" },
    processedAt: "2026-07-17T00:00:05.000Z",
  });
  assert.equal(second.applyAck(finalOff, finalOff.processedAt).kind, "applied");
  second.close();

  const third = new SqliteSmartFarmStore({ path });
  const completed = third.getStrategyApplication(demoFarmId, application.id);
  assert.equal(completed?.status, "succeeded");
  assert.equal(completed?.targets[0]?.resultingPumpState, "off");
  const audits = third.listAuditEvents(demoFarmId, { cycleId: activeCycleId, limit: 10 });
  assert.equal(
    audits.find((event) => event.action === "command.completed")
      ?.details.runDurationSeconds,
    5,
  );
  third.close();
});

test("evaluates alarms only for accepted telemetry and preserves acknowledgement audit across restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-alarms-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = new SqliteSmartFarmStore({ path });
  seedAlarmStore(first);

  assert.deepEqual(first.putTelemetry(telemetry({ value: 31 })), { kind: "accepted" });
  const opened = first.listAlarmInstances(demoFarmId, { state: "active", limit: 10 });
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.lastValue, 31);

  assert.deepEqual(first.putTelemetry(telemetry({ value: 31 })), { kind: "replayed" });
  assert.equal(first.listAlarmInstances(demoFarmId, { state: "active", limit: 10 })[0]?.lastValue, 31);

  assert.equal(
    first.putTelemetry(telemetry({ value: 35 })).kind,
    "conflict",
  );
  assert.equal(first.listAlarmInstances(demoFarmId, { state: "active", limit: 10 })[0]?.lastValue, 31);

  assert.deepEqual(first.putTelemetry(telemetry({
    id: "telemetry:bed-1-000002",
    sequence: 2,
    value: 32,
    observedAt: "2026-07-17T00:00:20.000Z",
  })), { kind: "accepted" });
  const updated = first.listAlarmInstances(demoFarmId, { state: "active", limit: 10 });
  assert.equal(updated.length, 1);
  assert.equal(updated[0]?.lastValue, 32);

  const acknowledgementResult = first.acknowledgeAlarm({
    farmId: demoFarmId,
    alarmId: updated[0]!.id,
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "alarm-ack-000001",
    acknowledgedAt: "2026-07-17T00:00:25.000Z",
  });
  assert.equal(acknowledgementResult.kind, "acknowledged");
  const replayedAcknowledgement = first.acknowledgeAlarm({
    farmId: demoFarmId,
    alarmId: updated[0]!.id,
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "alarm-ack-000001",
    acknowledgedAt: "2026-07-17T00:00:25.000Z",
  });
  assert.equal(replayedAcknowledgement.kind, "replayed");
  assert.equal(first.listAuditEvents(demoFarmId, { limit: 10 }).length, 1);
  assert.equal(first.listAuditEvents(otherFarmId, { limit: 10 }).length, 0);

  assert.deepEqual(first.putTelemetry(telemetry({
    id: "telemetry:bed-1-000003",
    sequence: 3,
    value: 28,
    observedAt: "2026-07-17T00:00:30.000Z",
  })), { kind: "accepted" });
  first.close();

  const second = new SqliteSmartFarmStore({ path });
  const cleared = second.listAlarmInstances(demoFarmId, { state: "cleared", limit: 10 });
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0]?.acknowledgement?.actorId, "user:demo");
  assert.equal(cleared[0]?.state, "cleared");

  const audit = second.listAuditEvents(demoFarmId, { limit: 10 });
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.action, "alarm.acknowledged");
  assert.equal(audit[0]?.targetId, cleared[0]?.id);
  second.close();
});

test("clears stale completed-cycle alarms and leaves only the new-cycle rule active across restart", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-stale-cycle-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = new SqliteSmartFarmStore({ path });
  seedAlarmStore(first);

  assert.deepEqual(first.putTelemetry(telemetry({ value: 31 })), { kind: "accepted" });
  assert.equal(first.updateCropCycle({
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
    areaIds: [eastAreaId],
  }).kind, "updated");
  assert.equal(first.createCropCycle({
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
  first.upsertAlarmRule(alarmRule({
    id: "alarm-rule:demo-temperature-high-next",
    cycleId: nextCycleId,
    name: "High Temperature Next Cycle",
    createdAt: "2026-07-17T00:10:00.000Z",
    updatedAt: "2026-07-17T00:10:00.000Z",
  }));

  assert.deepEqual(first.putTelemetry(telemetry({
    id: "telemetry:bed-1-000002",
    sequence: 2,
    value: 32,
    observedAt: "2026-07-17T00:00:20.000Z",
  })), { kind: "accepted" });
  first.close();

  const second = new SqliteSmartFarmStore({ path });
  const active = second.listAlarmInstances(demoFarmId, { state: "active", limit: 10 });
  const cleared = second.listAlarmInstances(demoFarmId, { state: "cleared", limit: 10 });

  assert.equal(active.length, 1);
  assert.equal(active[0]?.cycleId, nextCycleId);
  assert.equal(active[0]?.ruleId, "alarm-rule:demo-temperature-high-next");
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0]?.cycleId, activeCycleId);
  assert.equal(cleared[0]?.state, "cleared");
  second.close();
});

test("persists farm, device, and crop catalog records across database restarts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-catalog-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = new SqliteSmartFarmStore({ path });
  first.upsertFarm({
    schemaVersion: "smartfarm.farm.v1",
    id: demoFarmId,
    name: "Demo Farm",
    timezone: "Asia/Seoul",
    createdAt: "2026-07-17T00:00:00.000Z",
  });
  first.upsertFarm({
    schemaVersion: "smartfarm.farm.v1",
    id: otherFarmId,
    name: "Other Farm",
    timezone: "UTC",
    createdAt: "2026-07-17T00:10:00.000Z",
  });
  first.upsertDevice({
    schemaVersion: "smartfarm.device.v1",
    id: demoDeviceId,
    farmId: demoFarmId,
    name: "Grow Bed 1",
    kind: "hybrid",
    capabilities: ["temperature", "pump"],
    status: "online",
    lastSeenAt: null,
  });
  first.upsertDevice({
    schemaVersion: "smartfarm.device.v1",
    id: secondDemoDeviceId,
    farmId: demoFarmId,
    name: "Grow Bed 2",
    kind: "hybrid",
    capabilities: ["temperature", "pump"],
    status: "online",
    lastSeenAt: null,
  });
  first.upsertDevice({
    schemaVersion: "smartfarm.device.v1",
    id: demoDeviceId,
    farmId: otherFarmId,
    name: "Other Farm Bed 1",
    kind: "sensor",
    capabilities: ["temperature"],
    status: "degraded",
    lastSeenAt: "2026-07-17T00:08:00.000Z",
  });
  first.upsertGrowingArea({
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
  first.upsertGrowingArea({
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
  first.upsertGrowingArea({
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
  first.upsertCrop({
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
  assert.equal(
    first.createCropCycle({
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
    }).kind,
    "created",
  );
  assert.equal(
    first.createCropCycle({
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
    }).kind,
    "created",
  );
  first.close();

  const second = new SqliteSmartFarmStore({ path });
  assert.equal(second.getFarm(demoFarmId)?.name, "Demo Farm");
  assert.equal(second.getDevice(demoFarmId, demoDeviceId)?.name, "Grow Bed 1");
  assert.equal(second.getDevice(demoFarmId, secondDemoDeviceId)?.name, "Grow Bed 2");
  assert.equal(second.getDevice(otherFarmId, demoDeviceId)?.name, "Other Farm Bed 1");
  assert.equal(second.getGrowingArea(demoFarmId, eastAreaId)?.primaryDeviceId, demoDeviceId);
  assert.equal(second.getGrowingArea(otherFarmId, eastAreaId)?.name, "Other Farm East Bed");
  assert.deepEqual(second.getCropCycle(demoFarmId, activeCycleId)?.areaIds, [eastAreaId, westAreaId]);
  assert.equal(second.getCropCycle(otherFarmId, activeCycleId)?.cycle.name, "Other Farm Basil Cycle");
  assert.equal(second.getCrop(demoFarmId, basilCropId)?.healthStatus, "good");
  second.upsertCrop({
    schemaVersion: "smartfarm.crop.v1",
    id: basilCropId,
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    name: "Basil",
    healthStatus: "fair",
    managerName: "Demo Operator",
    notes: "Updated after restart",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:10:00.000Z",
  });
  second.close();

  const third = new SqliteSmartFarmStore({ path });
  assert.equal(third.listFarms().length, 2);
  assert.equal(third.listDevices(demoFarmId).length, 2);
  assert.equal(third.listDevices(otherFarmId).length, 1);
  assert.equal(third.listGrowingAreas(demoFarmId).length, 2);
  assert.equal(third.listGrowingAreas(otherFarmId).length, 1);
  assert.equal(third.listCropCycles(demoFarmId).length, 1);
  assert.equal(third.listCropCycles(otherFarmId).length, 1);
  assert.equal(third.listCrops(demoFarmId).length, 1);
  assert.equal(third.getCrop(demoFarmId, basilCropId)?.notes, "Updated after restart");
  third.close();
});

test("keeps command idempotency and terminal conflict rules in SQLite", () => {
  const store = new SqliteSmartFarmStore({ path: ":memory:" });

  try {
    assert.equal(store.createCommand(command(), "2026-07-17T00:00:00.000Z").kind, "created");
    assert.equal(store.createCommand(command(), "2026-07-17T00:00:00.000Z").kind, "replayed");
    assert.equal(
      store.createCommand(command({
        id: "command:pump-000002",
        payload: { action: "set_pump_state", state: "off" },
      }), "2026-07-17T00:00:01.000Z").kind,
      "conflict",
    );

    assert.equal(
      store.applyAck(acknowledgement(), "2026-07-17T00:00:10.000Z").kind,
      "applied",
    );
    const differentAck = CommandAckSchema.parse({
      ...acknowledgement(),
      status: "failed",
      reasonCode: "execution_failed",
      result: null,
    });
    assert.equal(
      store.applyAck(differentAck, "2026-07-17T00:00:11.000Z").kind,
      "conflict",
    );
  } finally {
    store.close();
  }
});

test("selects pending stop commands separately from the normal pending queue in SQLite", () => {
  const store = new SqliteSmartFarmStore({ path: ":memory:" });

  try {
    assert.equal(store.createCommand(CommandSchema.parse({
      schemaVersion: "smartfarm.command.v2",
      id: "command:timed-pump-000020",
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      payload: { action: "run_pump_for", durationSeconds: 5 },
      actor: { type: "user", id: "user:demo" },
      idempotencyKey: "demo-timed-pump-000020",
      issuedAt: "2026-07-17T00:00:00.000Z",
      expiresAt: "2026-07-17T00:01:00.000Z",
    }), "2026-07-17T00:00:00.000Z").kind, "created");
    assert.equal(store.createCommand(CommandSchema.parse({
      schemaVersion: "smartfarm.command.v1",
      id: "command:pump-000020",
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      payload: { action: "set_pump_state", state: "on" },
      actor: { type: "user", id: "user:demo" },
      idempotencyKey: "demo-pump-on-000020",
      issuedAt: "2026-07-17T00:00:01.000Z",
      expiresAt: "2026-07-17T00:01:01.000Z",
    }), "2026-07-17T00:00:01.000Z").kind, "created");
    assert.equal(store.createCommand(CommandSchema.parse({
      schemaVersion: "smartfarm.command.v1",
      id: "command:pump-000021",
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      payload: { action: "set_pump_state", state: "off" },
      actor: { type: "user", id: "user:demo" },
      idempotencyKey: "demo-pump-off-000021",
      issuedAt: "2026-07-17T00:00:02.000Z",
      expiresAt: "2026-07-17T00:01:02.000Z",
    }), "2026-07-17T00:00:02.000Z").kind, "created");

    assert.equal(store.nextPendingCommand(demoFarmId, demoDeviceId)?.command.id, "command:timed-pump-000020");
    assert.equal(store.nextPendingStopCommand(demoFarmId, demoDeviceId)?.command.id, "command:pump-000021");
  } finally {
    store.close();
  }
});

test("rejects invalid manual stop causal acknowledgements in SQLite", () => {
  const store = new SqliteSmartFarmStore({ path: ":memory:" });

  try {
    assert.equal(store.createCommand(CommandSchema.parse({
      schemaVersion: "smartfarm.command.v2",
      id: "command:timed-pump-000001",
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      payload: { action: "run_pump_for", durationSeconds: 5 },
      actor: { type: "user", id: "user:demo" },
      idempotencyKey: "demo-timed-pump-000001",
      issuedAt: "2026-07-17T00:00:05.000Z",
      expiresAt: "2026-07-17T00:01:05.000Z",
    }), "2026-07-17T00:00:05.000Z").kind, "created");
    assert.equal(store.createCommand(CommandSchema.parse({
      schemaVersion: "smartfarm.command.v1",
      id: "command:pump-stop-000001",
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      payload: { action: "set_pump_state", state: "off" },
      actor: { type: "user", id: "user:demo" },
      idempotencyKey: "demo-pump-stop-000001",
      issuedAt: "2026-07-17T00:00:08.000Z",
      expiresAt: "2026-07-17T00:01:08.000Z",
    }), "2026-07-17T00:00:08.000Z").kind, "created");
    assert.equal(store.createCommand(CommandSchema.parse({
      schemaVersion: "smartfarm.command.v1",
      id: "command:pump-on-000001",
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      payload: { action: "set_pump_state", state: "on" },
      actor: { type: "user", id: "user:demo" },
      idempotencyKey: "demo-pump-on-000001",
      issuedAt: "2026-07-17T00:00:09.000Z",
      expiresAt: "2026-07-17T00:01:09.000Z",
    }), "2026-07-17T00:00:09.000Z").kind, "created");
    assert.equal(store.createCommand(CommandSchema.parse({
      schemaVersion: "smartfarm.command.v1",
      id: "command:pump-stop-early-000001",
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      payload: { action: "set_pump_state", state: "off" },
      actor: { type: "user", id: "user:demo" },
      idempotencyKey: "demo-pump-stop-early-000001",
      issuedAt: "2026-07-17T00:00:04.000Z",
      expiresAt: "2026-07-17T00:01:04.000Z",
    }), "2026-07-17T00:00:04.000Z").kind, "created");
    assert.equal(store.createCommand(CommandSchema.parse({
      schemaVersion: "smartfarm.command.v1",
      id: "command:pump-target-off-000001",
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      payload: { action: "set_pump_state", state: "off" },
      actor: { type: "user", id: "user:demo" },
      idempotencyKey: "demo-pump-target-off-000001",
      issuedAt: "2026-07-17T00:00:06.000Z",
      expiresAt: "2026-07-17T00:01:06.000Z",
    }), "2026-07-17T00:00:06.000Z").kind, "created");

    assert.equal(
      store.applyAck(
        manualStopAcknowledgement({ causedByCommandId: "command:missing" }),
        "2026-07-17T00:00:10.000Z",
      ).kind,
      "conflict",
    );
    assert.equal(
      store.applyAck(
        manualStopAcknowledgement({
          causedByCommandId: "command:pump-on-000001",
          processedAt: "2026-07-17T00:00:10.000Z",
        }),
        "2026-07-17T00:00:10.000Z",
      ).kind,
      "conflict",
    );
    assert.equal(
      store.applyAck(
        manualStopAcknowledgement({
          causedByCommandId: "command:pump-stop-early-000001",
          processedAt: "2026-07-17T00:00:10.000Z",
        }),
        "2026-07-17T00:00:10.000Z",
      ).kind,
      "conflict",
    );
    assert.equal(
      store.applyAck(
        manualStopAcknowledgement({
          commandId: "command:pump-target-off-000001",
          causedByCommandId: "command:pump-stop-000001",
          processedAt: "2026-07-17T00:00:10.000Z",
        }),
        "2026-07-17T00:00:10.000Z",
      ).kind,
      "conflict",
    );
    const pendingCause = store.applyAck(
      manualStopAcknowledgement(),
      "2026-07-17T00:00:10.000Z",
    );
    assert.equal(pendingCause.kind, "conflict");
    assert.match(
      pendingCause.kind === "conflict" ? pendingCause.reason : "",
      /final-off acknowledgement/,
    );
    assert.equal(store.applyAck(CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: "command:pump-stop-000001",
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      status: "acknowledged",
      reasonCode: null,
      result: { pumpState: "off" },
      processedAt: "2026-07-17T00:00:09.000Z",
    }), "2026-07-17T00:00:09.000Z").kind, "applied");
    assert.equal(
      store.applyAck(
        manualStopAcknowledgement({
          causedByCommandId: "command:pump-stop-000001",
          processedAt: "2026-07-17T00:00:07.000Z",
        }),
        "2026-07-17T00:00:07.000Z",
      ).kind,
      "conflict",
    );
  } finally {
    store.close();
  }
});

test("persists manual stop causal acknowledgements and replays them exactly in SQLite", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-manual-stop-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = new SqliteSmartFarmStore({ path });
  assert.equal(first.createCommand(CommandSchema.parse({
    schemaVersion: "smartfarm.command.v2",
    id: "command:timed-pump-000001",
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    payload: { action: "run_pump_for", durationSeconds: 5 },
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "demo-timed-pump-000001",
    issuedAt: "2026-07-17T00:00:05.000Z",
    expiresAt: "2026-07-17T00:01:05.000Z",
  }), "2026-07-17T00:00:05.000Z").kind, "created");
  assert.equal(first.createCommand(CommandSchema.parse({
    schemaVersion: "smartfarm.command.v1",
    id: "command:pump-stop-000001",
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    payload: { action: "set_pump_state", state: "off" },
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "demo-pump-stop-000001",
    issuedAt: "2026-07-17T00:00:08.000Z",
    expiresAt: "2026-07-17T00:01:08.000Z",
  }), "2026-07-17T00:00:08.000Z").kind, "created");
  const stopAck = CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: "command:pump-stop-000001",
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: "off" },
    processedAt: "2026-07-17T00:00:09.000Z",
  });
  assert.equal(first.applyAck(stopAck, "2026-07-17T00:00:09.000Z").kind, "applied");
  const ack = manualStopAcknowledgement();
  assert.equal(first.applyAck(ack, "2026-07-17T00:00:10.000Z").kind, "applied");
  assert.deepEqual(first.listAuditEvents(demoFarmId, { limit: 10 }), []);
  const firstAudits = first.listAuditEvents(demoFarmId, { includeUnscoped: true, limit: 10 });
  assert.equal(firstAudits.length, 2);
  first.close();

  const second = new SqliteSmartFarmStore({ path });
  const timedProjection = second.getCommand("command:timed-pump-000001");
  assert.equal(timedProjection?.status, "failed");
  assert.equal(
    (timedProjection?.ack as Record<string, unknown> | null)?.causedByCommandId,
    "command:pump-stop-000001",
  );
  assert.equal(second.applyAck(ack, "2026-07-17T00:00:10.000Z").kind, "replayed");
  const timedAudit = second.listAuditEvents(demoFarmId, { includeUnscoped: true, limit: 10 })
    .find((event) => event.targetId === "command:timed-pump-000001");
  assert.equal(timedAudit?.schemaVersion, "smartfarm.audit-event.v2");
  assert.equal(timedAudit?.details.requestedAction, "run_pump_for");
  assert.equal(timedAudit?.details.runDurationSeconds, 5);
  assert.equal(timedAudit?.details.status, "failed");
  assert.equal(timedAudit?.details.reasonCode, "manual_stop");
  assert.equal(timedAudit?.details.resultingPumpState, null);
  assert.equal(timedAudit?.details.manualStopCommandId, "command:pump-stop-000001");
  assert.equal(second.listAuditEvents(demoFarmId, { includeUnscoped: true, limit: 10 }).length, 2);
  second.close();
});

test("migrates a v1 telemetry-command database to v8 without losing data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-migrate-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const raw = new DatabaseSync(path);
  raw.exec(`
    CREATE TABLE telemetry (
      id TEXT PRIMARY KEY,
      farm_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      metric TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence >= 0),
      observed_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;

    CREATE INDEX telemetry_latest_idx
      ON telemetry (farm_id, device_id, metric, sequence DESC, observed_at DESC, id DESC);

    CREATE TABLE commands (
      id TEXT PRIMARY KEY,
      farm_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      intent_fingerprint TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('pending', 'acknowledged', 'failed', 'timed_out')
      ),
      projection_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (farm_id, actor_id, idempotency_key)
    ) STRICT;

    CREATE INDEX commands_pending_idx
      ON commands (farm_id, device_id, status, issued_at ASC, id ASC);
  `);
  raw.prepare(`
    INSERT INTO telemetry (
      id, farm_id, device_id, metric, sequence, observed_at, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    telemetry().id,
    telemetry().farmId,
    telemetry().deviceId,
    telemetry().metric,
    telemetry().sequence,
    telemetry().observedAt,
    JSON.stringify(telemetry()),
  );
  raw.prepare(`
    INSERT INTO commands (
      id, farm_id, device_id, actor_id, idempotency_key,
      intent_fingerprint, issued_at, status, projection_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    command().id,
    command().farmId,
    command().deviceId,
    command().actor.id,
    command().idempotencyKey,
    JSON.stringify({
      actor: command().actor,
      deviceId: command().deviceId,
      farmId: command().farmId,
      idempotencyKey: command().idempotencyKey,
      payload: command().payload,
    }),
    command().issuedAt,
    "pending",
    JSON.stringify({
      schemaVersion: "smartfarm.command-projection.v1",
      command: command(),
      status: "pending",
      ack: null,
      updatedAt: command().issuedAt,
    }),
    command().issuedAt,
  );
  raw.exec("PRAGMA user_version = 1");
  raw.close();

  const migrated = new SqliteSmartFarmStore({ path });
  assert.deepEqual(
    migrated.latestTelemetry(demoFarmId, demoDeviceId, "temperature"),
    telemetry(),
  );
  assert.equal(migrated.getCommand(command().id)?.status, "pending");
  migrated.upsertFarm({
    schemaVersion: "smartfarm.farm.v1",
    id: demoFarmId,
    name: "Demo Farm",
    timezone: "Asia/Seoul",
    createdAt: "2026-07-17T00:00:00.000Z",
  });
  migrated.upsertFarm({
    schemaVersion: "smartfarm.farm.v1",
    id: otherFarmId,
    name: "Other Farm",
    timezone: "UTC",
    createdAt: "2026-07-17T00:10:00.000Z",
  });
  migrated.upsertDevice({
    schemaVersion: "smartfarm.device.v1",
    id: demoDeviceId,
    farmId: demoFarmId,
    name: "Grow Bed 1",
    kind: "hybrid",
    capabilities: ["temperature", "pump"],
    status: "online",
    lastSeenAt: null,
  });
  migrated.upsertGrowingArea({
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
  migrated.upsertDevice({
    schemaVersion: "smartfarm.device.v1",
    id: demoDeviceId,
    farmId: otherFarmId,
    name: "Other Farm Bed 1",
    kind: "sensor",
    capabilities: ["temperature"],
    status: "degraded",
    lastSeenAt: "2026-07-17T00:08:00.000Z",
  });
  migrated.upsertCrop({
    schemaVersion: "smartfarm.crop.v1",
    id: lettuceCropId,
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    name: "Lettuce",
    healthStatus: "fair",
    managerName: "Demo Operator",
    notes: "Created after migration",
    createdAt: "2026-07-17T00:05:00.000Z",
    updatedAt: "2026-07-17T00:05:00.000Z",
  });
  assert.equal(
    migrated.createCropCycle({
      schemaVersion: "smartfarm.crop-cycle-detail.v1",
      cycle: {
        schemaVersion: "smartfarm.crop-cycle.v1",
        id: activeCycleId,
        farmId: demoFarmId,
        name: "Basil Cycle Week 31",
        cropName: "Basil",
        variety: "Sweet Basil",
        status: "planned",
        startedAt: "2026-07-17T00:00:00.000Z",
        plannedEndAt: "2026-08-14T00:00:00.000Z",
        createdAt: "2026-07-17T00:00:00.000Z",
        updatedAt: "2026-07-17T00:00:00.000Z",
      },
      areaIds: [eastAreaId],
    }).kind,
    "created",
  );
  migrated.close();

  const reopened = new DatabaseSync(path);
  const version = reopened.prepare("PRAGMA user_version").get() as {
    readonly user_version: number;
  };
  assert.equal(version.user_version, SQLITE_SCHEMA_VERSION);
  reopened.close();

  const verified = new SqliteSmartFarmStore({ path });
  assert.equal(verified.getCrop(demoFarmId, lettuceCropId)?.name, "Lettuce");
  assert.equal(verified.getDevice(otherFarmId, demoDeviceId)?.name, "Other Farm Bed 1");
  assert.equal(verified.getGrowingArea(demoFarmId, eastAreaId)?.name, "East Bed");
  assert.equal(verified.getCropCycle(demoFarmId, activeCycleId)?.cycle.name, "Basil Cycle Week 31");
  verified.close();
});

test("migrates a v2 catalog database to v8 without losing catalog rows", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-migrate-v2-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const bootstrap = new SqliteSmartFarmStore({ path });
  bootstrap.upsertFarm({
    schemaVersion: "smartfarm.farm.v1",
    id: demoFarmId,
    name: "Demo Farm",
    timezone: "Asia/Seoul",
    createdAt: "2026-07-17T00:00:00.000Z",
  });
  bootstrap.upsertDevice({
    schemaVersion: "smartfarm.device.v1",
    id: demoDeviceId,
    farmId: demoFarmId,
    name: "Grow Bed 1",
    kind: "hybrid",
    capabilities: ["temperature", "pump"],
    status: "online",
    lastSeenAt: null,
  });
  bootstrap.upsertCrop({
    schemaVersion: "smartfarm.crop.v1",
    id: basilCropId,
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    name: "Basil",
    healthStatus: "good",
    managerName: "Demo Operator",
    notes: "Preserved from schema 2",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  });
  bootstrap.close();

  const schemaTwo = new DatabaseSync(path);
  schemaTwo.exec(`
    DROP TABLE edge_credentials;
    DROP TABLE gateway_enrollments;
    DROP TABLE farm_control_profiles;
    DROP TABLE strategy_application_commands;
    DROP TABLE strategy_applications;
    DROP TABLE irrigation_strategies;
    DROP TABLE audit_events;
    DROP TABLE alarm_instances;
    DROP TABLE alarm_rules;
    DROP TABLE crop_cycle_areas;
    DROP TABLE crop_cycles;
    DROP TABLE growing_areas;
    PRAGMA user_version = 2;
  `);
  schemaTwo.close();

  const migrated = new SqliteSmartFarmStore({ path });
  assert.equal(migrated.getFarm(demoFarmId)?.name, "Demo Farm");
  assert.equal(migrated.getDevice(demoFarmId, demoDeviceId)?.name, "Grow Bed 1");
  assert.equal(migrated.getCrop(demoFarmId, basilCropId)?.notes, "Preserved from schema 2");
  assert.deepEqual(migrated.listGrowingAreas(demoFarmId), []);
  assert.deepEqual(migrated.listCropCycles(demoFarmId), []);

  migrated.upsertGrowingArea({
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
  assert.equal(migrated.createCropCycle({
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
    areaIds: [eastAreaId],
  }).kind, "created");
  migrated.close();

  const verified = new SqliteSmartFarmStore({ path });
  assert.equal(verified.getCrop(demoFarmId, basilCropId)?.name, "Basil");
  assert.equal(verified.getGrowingArea(demoFarmId, eastAreaId)?.name, "East Bed");
  assert.deepEqual(verified.getCropCycle(demoFarmId, activeCycleId)?.areaIds, [eastAreaId]);
  verified.close();
});

test("migrates a v3 catalog database to v8 and preserves cycle data while adding alarm tables", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-migrate-v3-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const bootstrap = new SqliteSmartFarmStore({ path });
  seedAlarmStore(bootstrap);
  bootstrap.close();

  const schemaThree = new DatabaseSync(path);
  schemaThree.exec(`
    DROP TABLE edge_credentials;
    DROP TABLE gateway_enrollments;
    DROP TABLE farm_control_profiles;
    DROP TABLE strategy_application_commands;
    DROP TABLE strategy_applications;
    DROP TABLE irrigation_strategies;
    DROP TABLE audit_events;
    DROP TABLE alarm_instances;
    DROP TABLE alarm_rules;
    PRAGMA user_version = 3;
  `);
  schemaThree.close();

  const migrated = new SqliteSmartFarmStore({ path });
  assert.deepEqual(migrated.getCropCycle(demoFarmId, activeCycleId)?.areaIds, [eastAreaId]);
  assert.deepEqual(migrated.listAlarmRules(demoFarmId), []);
  assert.deepEqual(migrated.listAlarmInstances(demoFarmId, { limit: 10 }), []);
  assert.deepEqual(migrated.listAuditEvents(demoFarmId, { limit: 10 }), []);

  migrated.upsertAlarmRule(alarmRule());
  assert.deepEqual(migrated.putTelemetry(telemetry({ value: 31 })), { kind: "accepted" });
  assert.equal(migrated.listAlarmInstances(demoFarmId, { state: "active", limit: 10 }).length, 1);
  migrated.close();

  const reopened = new DatabaseSync(path);
  const version = reopened.prepare("PRAGMA user_version").get() as {
    readonly user_version: number;
  };
  assert.equal(version.user_version, SQLITE_SCHEMA_VERSION);
  reopened.close();
});

test("migrates an actual v4 audit table to v8 while preserving alarm audit rows", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-migrate-v4-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const bootstrap = new SqliteSmartFarmStore({ path });
  seedIrrigationStore(bootstrap);
  bootstrap.upsertAlarmRule(alarmRule());
  assert.deepEqual(bootstrap.putTelemetry(telemetry({ value: 31 })), { kind: "accepted" });
  const alarm = bootstrap.listAlarmInstances(demoFarmId, { state: "active", limit: 10 })[0];
  assert.ok(alarm !== undefined);
  assert.equal(bootstrap.acknowledgeAlarm({
    farmId: demoFarmId,
    alarmId: alarm.id,
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "alarm-ack-v4-migration",
    acknowledgedAt: "2026-07-17T00:00:05.000Z",
  }).kind, "acknowledged");
  bootstrap.close();

  const schemaFour = new DatabaseSync(path);
  schemaFour.exec(`
    DROP TABLE edge_credentials;
    DROP TABLE gateway_enrollments;
    DROP TABLE farm_control_profiles;
    DROP TABLE strategy_application_commands;
    DROP TABLE strategy_applications;
    DROP TABLE irrigation_strategies;

    DROP INDEX audit_events_list_idx;
    ALTER TABLE audit_events RENAME TO audit_events_v5;
    CREATE TABLE audit_events (
      farm_id TEXT NOT NULL,
      id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('alarm.acknowledged')),
      target_type TEXT NOT NULL CHECK (target_type IN ('alarm')),
      target_id TEXT NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (farm_id, id),
      FOREIGN KEY (farm_id, cycle_id) REFERENCES crop_cycles (farm_id, id) ON DELETE CASCADE
    ) STRICT;
    INSERT INTO audit_events (
      farm_id, id, cycle_id, action, target_type, target_id,
      result, occurred_at, payload_json
    )
    SELECT
      farm_id, id, cycle_id, action, target_type, target_id,
      result, occurred_at, payload_json
    FROM audit_events_v5;
    DROP TABLE audit_events_v5;
    CREATE INDEX audit_events_list_idx
      ON audit_events (farm_id ASC, cycle_id ASC, occurred_at DESC, id ASC);
    PRAGMA user_version = 4;
  `);
  schemaFour.close();

  const migrated = new SqliteSmartFarmStore({ path });
  const carriedAudits = migrated.listAuditEvents(demoFarmId, {
    cycleId: activeCycleId,
    limit: 10,
  });
  assert.equal(carriedAudits.length, 1);
  assert.equal(carriedAudits[0]?.action, "alarm.acknowledged");
  assert.equal(migrated.seedIrrigationStrategy(irrigationStrategy()).kind, "created");

  const strategy = migrated.getIrrigationStrategy(demoFarmId, "strategy:irrigation-once", 1)!;
  const createdAt = "2026-07-17T00:00:00.000Z";
  const targets: StrategyApplicationCommandTarget[] = [
    {
      areaId: eastAreaId,
      deviceId: demoDeviceId,
      command: command({
        id: "command:pump-100001",
        deviceId: demoDeviceId,
        idempotencyKey: "strategy-command-100001",
        issuedAt: createdAt,
        expiresAt: "2026-07-17T00:01:00.000Z",
      }),
    },
  ];
  const application = createPendingStrategyApplication({
    id: "strategy-application:test-100001",
    farmId: demoFarmId,
    cycleId: activeCycleId,
    strategy,
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "strategy-apply-100001",
    targets,
    createdAt,
  });
  assert.equal(migrated.createStrategyApplication(application, targets).kind, "created");
  assert.equal(
    migrated.applyAck(CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: "command:pump-100001",
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      status: "acknowledged",
      reasonCode: null,
      result: { pumpState: "on" },
      processedAt: "2026-07-17T00:00:10.000Z",
    }), "2026-07-17T00:00:10.000Z").kind,
    "applied",
  );
  const audits = migrated.listAuditEvents(demoFarmId, { cycleId: activeCycleId, limit: 10 });
  assert.equal(audits.filter((event) => event.action === "alarm.acknowledged").length, 1);
  assert.equal(audits.filter((event) => event.action === "command.completed").length, 1);
  assert.equal(audits.filter((event) => event.action === "strategy.applied").length, 1);
  migrated.close();

  const reopened = new DatabaseSync(path);
  const version = reopened.prepare("PRAGMA user_version").get() as {
    readonly user_version: number;
  };
  assert.equal(version.user_version, SQLITE_SCHEMA_VERSION);
  reopened.close();
});

test("migrates a v5 audit table to v8, preserves scoped rows, and appends unscoped direct audits", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-migrate-v5-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const bootstrap = new SqliteSmartFarmStore({ path });
  seedAlarmStore(bootstrap);
  bootstrap.upsertAlarmRule(alarmRule());
  assert.deepEqual(bootstrap.putTelemetry(telemetry({ value: 31 })), { kind: "accepted" });
  const alarm = bootstrap.listAlarmInstances(demoFarmId, { state: "active", limit: 10 })[0];
  assert.ok(alarm !== undefined);
  assert.equal(bootstrap.acknowledgeAlarm({
    farmId: demoFarmId,
    alarmId: alarm.id,
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "alarm-ack-v5-migration",
    acknowledgedAt: "2026-07-17T00:00:05.000Z",
  }).kind, "acknowledged");
  bootstrap.close();

  const schemaFive = new DatabaseSync(path);
  schemaFive.exec(`
    DROP TABLE edge_credentials;
    DROP TABLE gateway_enrollments;
    DROP TABLE farm_control_profiles;
    DROP INDEX audit_events_list_idx;
    ALTER TABLE audit_events RENAME TO audit_events_v6;
    CREATE TABLE audit_events (
      farm_id TEXT NOT NULL,
      id TEXT NOT NULL,
      cycle_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('alarm.acknowledged', 'strategy.applied', 'command.completed')),
      target_type TEXT NOT NULL CHECK (target_type IN ('alarm', 'strategy_application', 'command')),
      target_id TEXT NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      PRIMARY KEY (farm_id, id),
      FOREIGN KEY (farm_id, cycle_id) REFERENCES crop_cycles (farm_id, id) ON DELETE CASCADE
    ) STRICT;
    INSERT INTO audit_events (
      farm_id, id, cycle_id, action, target_type, target_id,
      result, occurred_at, payload_json
    )
    SELECT
      farm_id, id, cycle_id, action, target_type, target_id,
      result, occurred_at, payload_json
    FROM audit_events_v6;
    DROP TABLE audit_events_v6;
    CREATE INDEX audit_events_list_idx
      ON audit_events (farm_id ASC, cycle_id ASC, occurred_at DESC, id ASC);
    PRAGMA user_version = 5;
  `);
  schemaFive.close();

  const migrated = new SqliteSmartFarmStore({ path });
  const carriedAudits = migrated.listAuditEvents(demoFarmId, {
    cycleId: activeCycleId,
    limit: 10,
  });
  assert.equal(carriedAudits.length, 1);
  assert.equal(carriedAudits[0]?.action, "alarm.acknowledged");
  assert.equal(
    migrated.createCommand(command({
      id: "command:pump-v5-migration-000001",
      idempotencyKey: "direct-v5-migration-000001",
      issuedAt: "2026-07-17T00:00:10.000Z",
      expiresAt: "2026-07-17T00:01:10.000Z",
    }), "2026-07-17T00:00:10.000Z").kind,
    "created",
  );
  assert.equal(
    migrated.applyAck(CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: "command:pump-v5-migration-000001",
      farmId: demoFarmId,
      deviceId: demoDeviceId,
      status: "acknowledged",
      reasonCode: null,
      result: { pumpState: "on" },
      processedAt: "2026-07-17T00:00:15.000Z",
    }), "2026-07-17T00:00:15.000Z").kind,
    "applied",
  );

  const defaultAudits = migrated.listAuditEvents(demoFarmId, { limit: 10 });
  const includedAudits = migrated.listAuditEvents(demoFarmId, {
    cycleId: activeCycleId,
    includeUnscoped: true,
    limit: 10,
  });
  assert.equal(defaultAudits.length, 1);
  assert.equal(defaultAudits[0]?.schemaVersion, "smartfarm.audit-event.v1");
  assert.equal(includedAudits.length, 2);
  assert.equal(includedAudits.filter((event) => event.schemaVersion === "smartfarm.audit-event.v1").length, 1);
  assert.equal(includedAudits.filter((event) => event.schemaVersion === "smartfarm.audit-event.v2").length, 1);
  migrated.close();
});

test("filters unscoped direct audits explicitly and keeps farms isolated in SQLite", () => {
  const store = new SqliteSmartFarmStore({ path: ":memory:" });

  try {
    seedAlarmStore(store);
    assert.deepEqual(store.putTelemetry(telemetry({ value: 31 })), { kind: "accepted" });
    const alarm = store.listAlarmInstances(demoFarmId, { state: "active", limit: 10 })[0];
    assert.ok(alarm !== undefined);
    assert.equal(store.acknowledgeAlarm({
      farmId: demoFarmId,
      alarmId: alarm.id,
      actor: { type: "user", id: "user:demo" },
      idempotencyKey: "alarm-ack-filter-000001",
      acknowledgedAt: "2026-07-17T00:00:05.000Z",
    }).kind, "acknowledged");

    assert.equal(store.createCommand(command({
      id: "command:direct-filter-000001",
      idempotencyKey: "direct-filter-000001",
    }), "2026-07-17T00:00:00.000Z").kind, "created");
    assert.equal(store.applyAck(acknowledgement("command:direct-filter-000001"), "2026-07-17T00:00:10.000Z").kind, "applied");

    assert.equal(store.createCommand(command({
      id: "command:other-filter-000001",
      farmId: otherFarmId,
      deviceId: demoDeviceId,
      actor: { type: "user", id: "user:other" },
      idempotencyKey: "other-filter-000001",
    }), "2026-07-17T00:00:00.000Z").kind, "created");
    assert.equal(store.applyAck(CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v1",
      commandId: "command:other-filter-000001",
      farmId: otherFarmId,
      deviceId: demoDeviceId,
      status: "acknowledged",
      reasonCode: null,
      result: { pumpState: "on" },
      processedAt: "2026-07-17T00:00:10.000Z",
    }), "2026-07-17T00:00:10.000Z").kind, "applied");

    const defaultAudits = store.listAuditEvents(demoFarmId, { limit: 10 });
    const defaultCycleAudits = store.listAuditEvents(demoFarmId, { cycleId: activeCycleId, limit: 10 });
    const includeAllAudits = store.listAuditEvents(demoFarmId, { includeUnscoped: true, limit: 10 });
    const includeCycleAudits = store.listAuditEvents(demoFarmId, {
      cycleId: activeCycleId,
      includeUnscoped: true,
      limit: 10,
    });
    const otherFarmAudits = store.listAuditEvents(otherFarmId, {
      includeUnscoped: true,
      limit: 10,
    });

    assert.equal(defaultAudits.length, 1);
    assert.equal(defaultAudits[0]?.action, "alarm.acknowledged");
    assert.equal(defaultCycleAudits.length, 1);
    assert.equal(includeAllAudits.length, 2);
    assert.equal(includeCycleAudits.length, 2);
    assert.equal(includeCycleAudits.filter((event) => event.schemaVersion === "smartfarm.audit-event.v2").length, 1);
    assert.equal(otherFarmAudits.length, 1);
    assert.equal(otherFarmAudits[0]?.targetId, "command:other-filter-000001");
  } finally {
    store.close();
  }
});

test("rejects an unknown schema version without downgrading it", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-version-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const raw = new DatabaseSync(path);
  raw.exec(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION + 1}`);
  raw.close();

  assert.throws(
    () => new SqliteSmartFarmStore({ path }),
    /Unsupported SQLite schema version/,
  );

  const reopened = new DatabaseSync(path);
  const version = reopened.prepare("PRAGMA user_version").get() as {
    readonly user_version: number;
  };
  assert.equal(version.user_version, SQLITE_SCHEMA_VERSION + 1);
  reopened.close();
});

test("migrates a v6 database to v8 and adds later storage without touching existing data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-migrate-v6-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const bootstrap = new SqliteSmartFarmStore({ path });
  seedIrrigationStore(bootstrap);
  bootstrap.close();

  const schemaSix = new DatabaseSync(path);
  schemaSix.exec(`
    DROP TABLE edge_credentials;
    DROP TABLE gateway_enrollments;
    DROP TABLE farm_control_profiles;
    PRAGMA user_version = 6;
  `);
  schemaSix.close();

  const migrated = new SqliteSmartFarmStore({ path });
  assert.equal(migrated.getFarm(demoFarmId)?.name, "Demo Farm");
  assert.equal(migrated.getDevice(demoFarmId, demoDeviceId)?.name, "Grow Bed 1");
  assert.equal(migrated.getFarmControlProfile(demoFarmId), null);
  const updated = migrated.updateFarmControlProfile({
    schemaVersion: "smartfarm.farm-control-profile.v1",
    farmId: demoFarmId,
    revision: 1,
    widgets: [{
      schemaVersion: "smartfarm.farm-control-widget.v1",
      kind: "pump_control",
      deviceId: demoDeviceId,
      label: "Grow Bed 1",
      showStart: true,
    }],
    updatedAt: "2026-07-17T00:00:10.000Z",
  }, 0);
  assert.equal(updated.kind, "updated");
  migrated.close();

  const reopened = new DatabaseSync(path);
  const version = reopened.prepare("PRAGMA user_version").get() as {
    readonly user_version: number;
  };
  assert.equal(version.user_version, SQLITE_SCHEMA_VERSION);
  reopened.close();

  const verified = new SqliteSmartFarmStore({ path });
  assert.equal(verified.getFarmControlProfile(demoFarmId)?.revision, 1);
  assert.equal(verified.getFarmControlProfile(demoFarmId)?.widgets[0]?.deviceId, demoDeviceId);
  verified.close();
});

test("migrates a v7 database to v8, preserves farm control data, and adds gateway auth storage", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-migrate-v7-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const bootstrap = new SqliteSmartFarmStore({ path });
  seedIrrigationStore(bootstrap);
  assert.equal(bootstrap.updateFarmControlProfile({
    schemaVersion: "smartfarm.farm-control-profile.v1",
    farmId: demoFarmId,
    revision: 1,
    widgets: [{
      schemaVersion: "smartfarm.farm-control-widget.v1",
      kind: "pump_control",
      deviceId: demoDeviceId,
      label: "Grow Bed 1",
      showStart: true,
    }],
    updatedAt: "2026-08-12T01:00:00.000Z",
  }, 0).kind, "updated");
  bootstrap.close();

  const schemaSeven = new DatabaseSync(path);
  schemaSeven.exec(`
    DROP TABLE edge_credentials;
    DROP TABLE gateway_enrollments;
    PRAGMA user_version = 7;
  `);
  schemaSeven.close();

  const migrated = new SqliteSmartFarmStore({ path });
  assert.equal(migrated.getFarm(demoFarmId)?.name, "Demo Farm");
  assert.equal(migrated.getFarmControlProfile(demoFarmId)?.revision, 1);
  assert.deepEqual(migrated.listGatewayEnrollments(demoFarmId, demoDeviceId, {
    now: "2026-08-12T01:01:00.000Z",
  }), []);

  const enrollmentId = GatewayEnrollmentIdSchema.parse("gateway-enrollment:migration-v7");
  const credentialId = EdgeCredentialIdSchema.parse("edge-credential:migration-v7");
  const enrollmentDigest = "7".repeat(64);
  const edgeDigest = "8".repeat(64);
  assert.equal(migrated.issueGatewayEnrollment({
    id: enrollmentId,
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    tokenDigest: enrollmentDigest,
    issuedByActorId: "admin:migration",
    issuedAt: "2026-08-12T01:01:00.000Z",
    expiresAt: "2026-08-12T01:11:00.000Z",
  }).status, "pending");
  assert.equal(migrated.exchangeGatewayEnrollment({
    enrollmentId,
    expectedTokenDigest: enrollmentDigest,
    credentialId,
    credentialDigest: edgeDigest,
    exchangedAt: "2026-08-12T01:02:00.000Z",
  }).kind, "exchanged");
  assert.equal(migrated.listEdgeCredentials(demoFarmId, demoDeviceId, {
    now: "2026-08-12T01:03:00.000Z",
  })[0]?.id, credentialId);
  migrated.close();

  const reopened = new DatabaseSync(path);
  const version = reopened.prepare("PRAGMA user_version").get() as {
    readonly user_version: number;
  };
  assert.equal(version.user_version, SQLITE_SCHEMA_VERSION);
  reopened.close();
});

test("rejects a malformed pre-existing farm control table without blessing schema v6", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-sqlite-malformed-control-profile-"));
  const path = join(directory, "smartfarm.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const bootstrap = new SqliteSmartFarmStore({ path });
  bootstrap.close();

  const malformed = new DatabaseSync(path);
  malformed.exec(`
    DROP TABLE edge_credentials;
    DROP TABLE gateway_enrollments;
    DROP TABLE farm_control_profiles;
    CREATE TABLE farm_control_profiles (
      farm_id TEXT PRIMARY KEY
    ) STRICT;
    PRAGMA user_version = 6;
  `);
  malformed.close();

  assert.throws(
    () => new SqliteSmartFarmStore({ path }),
    /farm_control_profiles already exists/,
  );

  const reopened = new DatabaseSync(path);
  const version = reopened.prepare("PRAGMA user_version").get() as {
    readonly user_version: number;
  };
  assert.equal(version.user_version, 6);
  reopened.close();
});
