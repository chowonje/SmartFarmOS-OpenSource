import assert from "node:assert/strict";
import test from "node:test";
import {
  AlarmInstanceSchema,
  AlarmListQuerySchema,
  AlarmRuleSchema,
  AuditEventListQuerySchema,
  AuditEventListResponseSchema,
  AuditEventSchema,
  AuditEventV1Schema,
  AuditEventV2Schema,
} from "./index.js";

const observedAt = "2026-08-09T00:00:00.000Z";

function validAlarmRuleInput() {
  return {
    schemaVersion: "smartfarm.alarm-rule.v1",
    id: "alarm-rule:east-bed-high-temperature",
    farmId: "farm:demo",
    cycleId: "cycle:basil-week-31",
    areaId: "area:east-bed",
    deviceId: "device:bed-1",
    name: "East bed high temperature",
    metric: "temperature",
    comparison: "above",
    threshold: 30,
    severity: "critical",
    enabled: true,
    createdAt: observedAt,
    updatedAt: observedAt,
  } as const;
}

function validAlarmInstanceInput() {
  return {
    schemaVersion: "smartfarm.alarm-instance.v1",
    id: "alarm:east-bed-high-temperature-1",
    farmId: "farm:demo",
    ruleId: "alarm-rule:east-bed-high-temperature",
    cycleId: "cycle:basil-week-31",
    areaId: "area:east-bed",
    deviceId: "device:bed-1",
    ruleName: "East bed high temperature",
    metric: "temperature",
    comparison: "above",
    threshold: 30,
    severity: "critical",
    state: "active",
    triggerTelemetryId: "telemetry:bed-1-000001",
    lastTelemetryId: "telemetry:bed-1-000002",
    openedAt: observedAt,
    lastObservedAt: "2026-08-09T00:01:00.000Z",
    lastValue: 31,
    clearedAt: null,
    acknowledgement: null,
    updatedAt: "2026-08-09T00:01:00.000Z",
  } as const;
}

test("accepts strict alarm rules and rejects unknown fields", () => {
  const rule = AlarmRuleSchema.parse(validAlarmRuleInput());
  const unknown = AlarmRuleSchema.safeParse({
    ...validAlarmRuleInput(),
    internalOnly: true,
  });

  assert.equal(rule.id, "alarm-rule:east-bed-high-temperature");
  assert.equal(unknown.success, false);
});

test("validates alarm thresholds against each telemetry metric range", () => {
  const cases = [
    { metric: "temperature", minimum: -50, maximum: 100 },
    { metric: "humidity", minimum: 0, maximum: 100 },
    { metric: "illuminance", minimum: 0, maximum: 200_000 },
    { metric: "water_level", minimum: 0, maximum: 100 },
  ] as const;

  for (const { metric, minimum, maximum } of cases) {
    assert.equal(
      AlarmRuleSchema.safeParse({ ...validAlarmRuleInput(), metric, threshold: minimum })
        .success,
      true,
    );
    assert.equal(
      AlarmRuleSchema.safeParse({ ...validAlarmRuleInput(), metric, threshold: maximum })
        .success,
      true,
    );
    assert.equal(
      AlarmRuleSchema.safeParse({ ...validAlarmRuleInput(), metric, threshold: minimum - 1 })
        .success,
      false,
    );
    assert.equal(
      AlarmRuleSchema.safeParse({ ...validAlarmRuleInput(), metric, threshold: maximum + 1 })
        .success,
      false,
    );
  }
});

test("enforces active and cleared alarm state invariants", () => {
  const active = AlarmInstanceSchema.parse(validAlarmInstanceInput());
  const activeWithClearTime = AlarmInstanceSchema.safeParse({
    ...validAlarmInstanceInput(),
    clearedAt: "2026-08-09T00:02:00.000Z",
  });
  const clearedWithoutClearTime = AlarmInstanceSchema.safeParse({
    ...validAlarmInstanceInput(),
    state: "cleared",
  });
  const cleared = AlarmInstanceSchema.parse({
    ...validAlarmInstanceInput(),
    state: "cleared",
    lastValue: 29,
    clearedAt: "2026-08-09T00:02:00.000Z",
    acknowledgement: {
      actorId: "user:operator",
      acknowledgedAt: "2026-08-09T00:01:30.000Z",
    },
  });

  assert.equal(active.clearedAt, null);
  assert.equal(activeWithClearTime.success, false);
  assert.equal(clearedWithoutClearTime.success, false);
  assert.equal(cleared.state, "cleared");
  assert.equal(cleared.acknowledgement?.actorId, "user:operator");
});

test("keeps alarm acknowledgement objects strict", () => {
  const unknownAcknowledgementField = AlarmInstanceSchema.safeParse({
    ...validAlarmInstanceInput(),
    acknowledgement: {
      actorId: "user:operator",
      acknowledgedAt: "2026-08-09T00:01:30.000Z",
      displayName: "Operator",
    },
  });

  assert.equal(unknownAcknowledgementField.success, false);
});

test("accepts only bounded scalar audit details and strict actors", () => {
  const event = {
    schemaVersion: "smartfarm.audit-event.v1",
    id: "audit:alarm-acknowledged-1",
    farmId: "farm:demo",
    cycleId: "cycle:basil-week-31",
    actor: { type: "user", id: "user:operator" },
    action: "alarm.acknowledged",
    targetType: "alarm",
    targetId: "alarm:east-bed-high-temperature-1",
    result: "success",
    occurredAt: observedAt,
    details: {
      source: "alarm-center",
      replayed: false,
      attempt: 1,
      reason: null,
    },
  } as const;

  const parsed = AuditEventSchema.parse(event);
  const nestedDetail = AuditEventSchema.safeParse({
    ...event,
    details: { nested: { value: "not-a-scalar" } },
  });
  const unknownActorField = AuditEventSchema.safeParse({
    ...event,
    actor: { ...event.actor, role: "operator" },
  });

  assert.equal(parsed.action, "alarm.acknowledged");
  assert.equal(nestedDetail.success, false);
  assert.equal(unknownActorField.success, false);
});

test("preserves cycle-scoped audit v1 and adds only unscoped command-completion v2", () => {
  const v1 = AuditEventV1Schema.parse({
    schemaVersion: "smartfarm.audit-event.v1",
    id: "audit:alarm-acknowledged-1",
    farmId: "farm:demo",
    cycleId: "cycle:basil-week-31",
    actor: { type: "user", id: "user:operator" },
    action: "alarm.acknowledged",
    targetType: "alarm",
    targetId: "alarm:east-bed-high-temperature-1",
    result: "success",
    occurredAt: observedAt,
    details: { source: "alarm-center" },
  });
  const v2 = AuditEventV2Schema.parse({
    schemaVersion: "smartfarm.audit-event.v2",
    id: "audit:direct-command-completed-1",
    farmId: "farm:demo",
    cycleId: null,
    actor: { type: "user", id: "user:operator" },
    action: "command.completed",
    targetType: "command",
    targetId: "command:pump-000001",
    result: "success",
    occurredAt: observedAt,
    details: {
      source: "direct",
      deviceId: "device:bed-1",
      requestedAction: "set_pump_state",
      requestedPumpState: "off",
      status: "acknowledged",
      reasonCode: null,
      resultingPumpState: "off",
    },
  });

  assert.deepEqual(AuditEventSchema.parse(v1), v1);
  assert.deepEqual(AuditEventSchema.parse(v2), v2);
  assert.equal(AuditEventV1Schema.safeParse(v2).success, false);
  assert.equal(AuditEventV2Schema.safeParse(v1).success, false);
  assert.equal(AuditEventV2Schema.safeParse({ ...v2, cycleId: "cycle:basil-week-31" }).success, false);
  assert.equal(AuditEventV2Schema.safeParse({ ...v2, action: "alarm.acknowledged" }).success, false);
  assert.equal(AuditEventV2Schema.safeParse({ ...v2, targetType: "alarm" }).success, false);
  assert.equal(AuditEventV2Schema.safeParse({ ...v2, internalOnly: true }).success, false);
  assert.equal(AuditEventV2Schema.safeParse({
    ...v2,
    details: { ...v2.details, status: "failed", reasonCode: "execution_failed" },
  }).success, false);
  assert.equal(AuditEventV2Schema.safeParse({
    ...v2,
    details: { ...v2.details, requestedAction: "run_pump_for", runDurationSeconds: 5 },
  }).success, false);
  assert.equal(AuditEventV2Schema.safeParse({ ...v2, result: "failure" }).success, false);

  const manualStop = {
    ...v2,
    result: "failure",
    details: {
      ...v2.details,
      status: "failed",
      reasonCode: "manual_stop",
      resultingPumpState: null,
      manualStopCommandId: "command:pump-stop-000001",
    },
  } as const;
  assert.equal(AuditEventV2Schema.safeParse(manualStop).success, true);
  assert.equal(AuditEventV2Schema.safeParse({
    ...manualStop,
    details: { ...manualStop.details, status: "timed_out" },
  }).success, false);
  assert.equal(AuditEventV2Schema.safeParse({
    ...manualStop,
    details: { ...manualStop.details, manualStopCommandId: manualStop.targetId },
  }).success, false);

  const response = AuditEventListResponseSchema.parse({
    schemaVersion: "smartfarm.audit-event-list.v1",
    auditEvents: [v1, v2],
  });
  assert.equal(response.auditEvents[1]?.cycleId, null);
});

test("applies bounded alarm and audit query defaults", () => {
  const alarmQuery = AlarmListQuerySchema.parse({});
  const auditQuery = AuditEventListQuerySchema.parse({});
  const coercedAlarmLimit = AlarmListQuerySchema.parse({ limit: "25" });
  const includeUnscoped = AuditEventListQuerySchema.parse({
    includeUnscoped: "true",
  });
  const excludeUnscoped = AuditEventListQuerySchema.parse({
    includeUnscoped: "false",
  });

  assert.equal(alarmQuery.limit, 100);
  assert.equal(auditQuery.limit, 50);
  assert.equal(auditQuery.includeUnscoped, false);
  assert.equal(includeUnscoped.includeUnscoped, true);
  assert.equal(excludeUnscoped.includeUnscoped, false);
  assert.equal(coercedAlarmLimit.limit, 25);
  assert.equal(AlarmListQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(AuditEventListQuerySchema.safeParse({ limit: 0 }).success, false);
  assert.equal(AuditEventListQuerySchema.safeParse({ includeUnscoped: "1" }).success, false);
  assert.equal(AlarmListQuerySchema.safeParse({ unexpected: true }).success, false);
});
