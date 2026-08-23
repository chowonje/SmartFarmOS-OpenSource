import { createHash } from "node:crypto";
import {
  AlarmInstanceSchema,
  AlarmRuleSchema,
  AuditActorSchema,
  AuditEventSchema,
  FarmIdSchema,
  IsoDateTimeSchema,
  type AlarmInstance,
  type AlarmRule,
  type AlarmState,
  type AuditActor,
  type AuditEvent,
  type CropCycleId,
  type FarmId,
  type Telemetry,
} from "@smartfarm-os/contracts";

export type AlarmInstanceListOptions = {
  readonly state?: AlarmState;
  readonly cycleId?: CropCycleId;
  readonly limit?: number;
};

export type AuditEventListOptions = {
  readonly cycleId?: CropCycleId;
  readonly includeUnscoped?: boolean;
  readonly limit?: number;
};

export type AcknowledgeAlarmInput = {
  readonly farmId: FarmId;
  readonly alarmId: string;
  readonly actor: AuditActor;
  readonly idempotencyKey: string;
  readonly acknowledgedAt: string;
};

export type AcknowledgeAlarmResult =
  | {
    readonly kind: "acknowledged";
    readonly alarm: AlarmInstance;
    readonly auditEvent: AuditEvent;
  }
  | {
    readonly kind: "replayed";
    readonly alarm: AlarmInstance;
    readonly auditEvent: AuditEvent;
  }
  | { readonly kind: "not_found" }
  | { readonly kind: "conflict"; readonly reason: string };

export function parseAlarmRule(input: AlarmRule): AlarmRule {
  return AlarmRuleSchema.parse(input);
}

export function parseAlarmInstance(input: AlarmInstance): AlarmInstance {
  return AlarmInstanceSchema.parse(input);
}

export function parseAuditEvent(input: AuditEvent): AuditEvent {
  return AuditEventSchema.parse(input);
}

export function parseAcknowledgeAlarmInput(input: AcknowledgeAlarmInput): AcknowledgeAlarmInput {
  const value = input as Record<string, unknown>;

  return {
    farmId: FarmIdSchema.parse(value.farmId),
    alarmId: parseString(value.alarmId, "alarm acknowledgement alarmId", 1, 128),
    actor: AuditActorSchema.parse(value.actor),
    idempotencyKey: parseString(
      value.idempotencyKey,
      "alarm acknowledgement idempotencyKey",
      8,
      128,
    ),
    acknowledgedAt: IsoDateTimeSchema.parse(value.acknowledgedAt),
  };
}

export function alarmRuleScopeKey(farmId: FarmId, ruleId: string): string {
  return `${farmId}\u0000${ruleId}`;
}

export function alarmInstanceScopeKey(farmId: FarmId, alarmId: string): string {
  return `${farmId}\u0000${alarmId}`;
}

export function createDeterministicEntityId(
  prefix: "alarm" | "audit",
  ...parts: readonly string[]
): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\u0000");
  }

  return `${prefix}:${hash.digest("hex").slice(0, 24)}`;
}

export function isTelemetryBreached(rule: AlarmRule, telemetry: Telemetry): boolean {
  return rule.comparison === "above"
    ? telemetry.value > rule.threshold
    : telemetry.value < rule.threshold;
}

export function openAlarmInstance(rule: AlarmRule, telemetry: Telemetry): AlarmInstance {
  return AlarmInstanceSchema.parse({
    schemaVersion: "smartfarm.alarm-instance.v1",
    id: createDeterministicEntityId("alarm", rule.farmId, rule.id, telemetry.id),
    farmId: rule.farmId,
    ruleId: rule.id,
    cycleId: rule.cycleId,
    areaId: rule.areaId,
    deviceId: rule.deviceId,
    ruleName: rule.name,
    metric: rule.metric,
    comparison: rule.comparison,
    threshold: rule.threshold,
    severity: rule.severity,
    state: "active",
    triggerTelemetryId: telemetry.id,
    lastTelemetryId: telemetry.id,
    openedAt: telemetry.observedAt,
    lastObservedAt: telemetry.observedAt,
    lastValue: telemetry.value,
    clearedAt: null,
    acknowledgement: null,
    updatedAt: telemetry.observedAt,
  });
}

export function updateAlarmInstance(
  alarm: AlarmInstance,
  telemetry: Telemetry,
): AlarmInstance {
  return AlarmInstanceSchema.parse({
    ...alarm,
    state: "active",
    lastTelemetryId: telemetry.id,
    lastObservedAt: telemetry.observedAt,
    lastValue: telemetry.value,
    clearedAt: null,
    updatedAt: telemetry.observedAt,
  });
}

export function clearAlarmInstance(
  alarm: AlarmInstance,
  telemetry: Telemetry,
): AlarmInstance {
  return AlarmInstanceSchema.parse({
    ...alarm,
    state: "cleared",
    lastTelemetryId: telemetry.id,
    lastObservedAt: telemetry.observedAt,
    lastValue: telemetry.value,
    clearedAt: telemetry.observedAt,
    updatedAt: telemetry.observedAt,
  });
}

export function acknowledgeAlarmInstance(
  alarm: AlarmInstance,
  actorId: string,
  acknowledgedAt: string,
): AlarmInstance {
  return AlarmInstanceSchema.parse({
    ...alarm,
    acknowledgement: {
      actorId,
      acknowledgedAt,
    },
    updatedAt: acknowledgedAt,
  });
}

export function buildAlarmAuditEvent(
  alarm: AlarmInstance,
  actor: AuditActor,
  occurredAt: string,
  auditEventId: string,
): AuditEvent {
  return AuditEventSchema.parse({
    schemaVersion: "smartfarm.audit-event.v1",
    id: auditEventId,
    farmId: alarm.farmId,
    cycleId: alarm.cycleId,
    actor,
    action: "alarm.acknowledged",
    targetType: "alarm",
    targetId: alarm.id,
    result: "success",
    occurredAt,
    details: {
      ruleId: alarm.ruleId,
      areaId: alarm.areaId,
      deviceId: alarm.deviceId,
      metric: alarm.metric,
      severity: alarm.severity,
      state: alarm.state,
    },
  });
}

export function compareAlarmRules(left: AlarmRule, right: AlarmRule): number {
  return left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id);
}

export function compareAlarmInstances(left: AlarmInstance, right: AlarmInstance): number {
  if (left.state !== right.state) {
    return left.state === "active" ? -1 : 1;
  }

  return right.lastObservedAt.localeCompare(left.lastObservedAt)
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.id.localeCompare(right.id);
}

export function compareAuditEvents(left: AuditEvent, right: AuditEvent): number {
  return right.occurredAt.localeCompare(left.occurredAt)
    || left.id.localeCompare(right.id);
}

function parseString(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid ${label}`);
  }

  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new Error(`Invalid ${label}`);
  }

  return trimmed;
}
