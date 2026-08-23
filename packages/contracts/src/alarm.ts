import * as z from "zod";
import {
  AlarmInstanceIdSchema,
  AlarmRuleIdSchema,
  AuditEventIdSchema,
  CommandIdSchema,
  CropCycleIdSchema,
  DeviceIdSchema,
  FarmIdSchema,
  GrowingAreaIdSchema,
  IsoDateTimeSchema,
  TelemetryIdSchema,
} from "./identifiers.js";
import {
  CommandAckReasonCodeSchema,
  CommandAckStatusSchema,
  PumpStateSchema,
} from "./command.js";
import { TelemetryMetricSchema } from "./telemetry.js";

const AlarmNameSchema = z.string().trim().min(1).max(120);
const ActorIdSchema = z.string().trim().min(1).max(128);
const AuditTargetIdSchema = z.string().trim().min(1).max(128);
const AuditDetailKeySchema = z.string().trim().min(1).max(64);
const AuditDetailValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const metricBounds = {
  temperature: { minimum: -50, maximum: 100 },
  humidity: { minimum: 0, maximum: 100 },
  illuminance: { minimum: 0, maximum: 200_000 },
  water_level: { minimum: 0, maximum: 100 },
} as const satisfies Record<
  z.output<typeof TelemetryMetricSchema>,
  { minimum: number; maximum: number }
>;

function isWithinMetricBounds(
  metric: z.output<typeof TelemetryMetricSchema>,
  value: number,
): boolean {
  const bounds = metricBounds[metric];
  return value >= bounds.minimum && value <= bounds.maximum;
}

export const AlarmComparisonSchema = z.enum(["above", "below"]);
export const AlarmSeveritySchema = z.enum(["warning", "critical"]);
export const AlarmStateSchema = z.enum(["active", "cleared"]);

export const AlarmRuleSchema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.alarm-rule.v1"),
    id: AlarmRuleIdSchema,
    farmId: FarmIdSchema,
    cycleId: CropCycleIdSchema,
    areaId: GrowingAreaIdSchema,
    deviceId: DeviceIdSchema,
    name: AlarmNameSchema,
    metric: TelemetryMetricSchema,
    comparison: AlarmComparisonSchema,
    threshold: z.number().finite(),
    severity: AlarmSeveritySchema,
    enabled: z.boolean(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .refine((rule) => isWithinMetricBounds(rule.metric, rule.threshold), {
    message: "Alarm threshold is outside the accepted metric range",
    path: ["threshold"],
  });

export const AlarmAcknowledgementSchema = z.strictObject({
  actorId: ActorIdSchema,
  acknowledgedAt: IsoDateTimeSchema,
});

export const AlarmInstanceSchema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.alarm-instance.v1"),
    id: AlarmInstanceIdSchema,
    farmId: FarmIdSchema,
    ruleId: AlarmRuleIdSchema,
    cycleId: CropCycleIdSchema,
    areaId: GrowingAreaIdSchema,
    deviceId: DeviceIdSchema,
    ruleName: AlarmNameSchema,
    metric: TelemetryMetricSchema,
    comparison: AlarmComparisonSchema,
    threshold: z.number().finite(),
    severity: AlarmSeveritySchema,
    state: AlarmStateSchema,
    triggerTelemetryId: TelemetryIdSchema,
    lastTelemetryId: TelemetryIdSchema,
    openedAt: IsoDateTimeSchema,
    lastObservedAt: IsoDateTimeSchema,
    lastValue: z.number().finite(),
    clearedAt: IsoDateTimeSchema.nullable(),
    acknowledgement: AlarmAcknowledgementSchema.nullable(),
    updatedAt: IsoDateTimeSchema,
  })
  .refine((alarm) => isWithinMetricBounds(alarm.metric, alarm.threshold), {
    message: "Alarm threshold is outside the accepted metric range",
    path: ["threshold"],
  })
  .refine((alarm) => isWithinMetricBounds(alarm.metric, alarm.lastValue), {
    message: "Alarm value is outside the accepted metric range",
    path: ["lastValue"],
  })
  .refine(
    (alarm) =>
      alarm.state === "active"
        ? alarm.clearedAt === null
        : alarm.clearedAt !== null,
    {
      message: "Alarm clearedAt does not match state",
      path: ["clearedAt"],
    },
  );

export const AuditActorTypeSchema = z.enum(["user", "system"]);

export const AuditActorSchema = z.strictObject({
  type: AuditActorTypeSchema,
  id: ActorIdSchema,
});

export const AuditActionSchema = z.enum([
  "alarm.acknowledged",
  "strategy.applied",
  "command.completed",
]);

export const AuditTargetTypeSchema = z.enum([
  "alarm",
  "strategy_application",
  "command",
]);

export const AuditResultSchema = z.enum(["success", "failure"]);

export const AuditDetailsSchema = z
  .record(AuditDetailKeySchema, AuditDetailValueSchema)
  .refine((details) => Object.keys(details).length <= 20, {
    message: "Audit details must contain at most 20 entries",
  });

export const DirectCommandAuditDetailsSchema = z
  .strictObject({
    source: z.literal("direct"),
    deviceId: DeviceIdSchema,
    requestedAction: z.enum(["set_pump_state", "run_pump_for"]),
    requestedPumpState: PumpStateSchema.optional(),
    runDurationSeconds: z.number().int().min(1).max(300).optional(),
    status: CommandAckStatusSchema,
    reasonCode: CommandAckReasonCodeSchema.nullable(),
    resultingPumpState: PumpStateSchema.nullable(),
    manualStopCommandId: CommandIdSchema.optional(),
  })
  .superRefine((details, context) => {
    const hasExpectedIntent = details.requestedAction === "set_pump_state"
      ? details.requestedPumpState !== undefined && details.runDurationSeconds === undefined
      : details.requestedPumpState === undefined && details.runDurationSeconds !== undefined;
    if (!hasExpectedIntent) {
      context.addIssue({
        code: "custom",
        message: "Direct command audit details do not match the requested action",
        path: ["requestedAction"],
      });
    }

    const acknowledged = details.status === "acknowledged";
    if (
      acknowledged
        ? details.reasonCode !== null || details.resultingPumpState === null
        : details.reasonCode === null || details.resultingPumpState !== null
    ) {
      context.addIssue({
        code: "custom",
        message: "Direct command audit outcome does not match its status",
        path: ["status"],
      });
    }

    if (
      details.reasonCode === "manual_stop"
        ? details.manualStopCommandId === undefined
        : details.manualStopCommandId !== undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Direct command audit manual-stop cause does not match its reason",
        path: ["manualStopCommandId"],
      });
    }

    if (
      details.reasonCode === "manual_stop"
      && details.status !== "failed"
      && details.status !== "rejected"
    ) {
      context.addIssue({
        code: "custom",
        message: "Manual-stop audit status must be failed or rejected",
        path: ["status"],
      });
    }
  });

export const AuditEventV1Schema = z.strictObject({
  schemaVersion: z.literal("smartfarm.audit-event.v1"),
  id: AuditEventIdSchema,
  farmId: FarmIdSchema,
  cycleId: CropCycleIdSchema,
  actor: AuditActorSchema,
  action: AuditActionSchema,
  targetType: AuditTargetTypeSchema,
  targetId: AuditTargetIdSchema,
  result: AuditResultSchema,
  occurredAt: IsoDateTimeSchema,
  details: AuditDetailsSchema,
});

export const AuditEventV2Schema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.audit-event.v2"),
    id: AuditEventIdSchema,
    farmId: FarmIdSchema,
    cycleId: z.null(),
    actor: AuditActorSchema,
    action: z.literal("command.completed"),
    targetType: z.literal("command"),
    targetId: AuditTargetIdSchema,
    result: AuditResultSchema,
    occurredAt: IsoDateTimeSchema,
    details: DirectCommandAuditDetailsSchema,
  })
  .refine(
    (event) => event.result === (
      event.details.status === "acknowledged" ? "success" : "failure"
    ),
    {
      message: "Direct command audit result does not match its terminal status",
      path: ["result"],
    },
  )
  .refine(
    (event) => event.details.manualStopCommandId !== event.targetId,
    {
      message: "Direct command audit manual-stop cause must differ from its target",
      path: ["details", "manualStopCommandId"],
    },
  );

export const AuditEventSchema = z.union([
  AuditEventV1Schema,
  AuditEventV2Schema,
]);

export type AlarmComparison = z.output<typeof AlarmComparisonSchema>;
export type AlarmSeverity = z.output<typeof AlarmSeveritySchema>;
export type AlarmState = z.output<typeof AlarmStateSchema>;
export type AlarmRuleInput = z.input<typeof AlarmRuleSchema>;
export type AlarmRule = z.output<typeof AlarmRuleSchema>;
export type AlarmAcknowledgementInput = z.input<typeof AlarmAcknowledgementSchema>;
export type AlarmAcknowledgement = z.output<typeof AlarmAcknowledgementSchema>;
export type AlarmInstanceInput = z.input<typeof AlarmInstanceSchema>;
export type AlarmInstance = z.output<typeof AlarmInstanceSchema>;
export type AuditActorType = z.output<typeof AuditActorTypeSchema>;
export type AuditActorInput = z.input<typeof AuditActorSchema>;
export type AuditActor = z.output<typeof AuditActorSchema>;
export type AuditAction = z.output<typeof AuditActionSchema>;
export type AuditTargetType = z.output<typeof AuditTargetTypeSchema>;
export type AuditResult = z.output<typeof AuditResultSchema>;
export type AuditDetailsInput = z.input<typeof AuditDetailsSchema>;
export type AuditDetails = z.output<typeof AuditDetailsSchema>;
export type DirectCommandAuditDetailsInput = z.input<typeof DirectCommandAuditDetailsSchema>;
export type DirectCommandAuditDetails = z.output<typeof DirectCommandAuditDetailsSchema>;
export type AuditEventV1Input = z.input<typeof AuditEventV1Schema>;
export type AuditEventV1 = z.output<typeof AuditEventV1Schema>;
export type AuditEventV2Input = z.input<typeof AuditEventV2Schema>;
export type AuditEventV2 = z.output<typeof AuditEventV2Schema>;
export type AuditEventInput = z.input<typeof AuditEventSchema>;
export type AuditEvent = z.output<typeof AuditEventSchema>;
