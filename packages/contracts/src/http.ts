import * as z from "zod";
import {
  AlarmInstanceSchema,
  AlarmStateSchema,
  AuditEventSchema,
} from "./alarm.js";
import {
  CommandAckSchema,
  CommandLifecycleStatusSchema,
  CommandSchema,
  PumpStateSchema,
} from "./command.js";
import {
  CreateCropCycleRequestSchema,
  CropCycleDetailSchema,
  CropRecordSchema,
  GrowingAreaSchema,
  PatchCropCycleRequestSchema,
} from "./crop.js";
import { DeviceSchema } from "./device.js";
import {
  FarmControlProfileExpectedRevisionSchema,
  FarmControlProfileSchema,
  FarmControlWidgetsSchema,
} from "./farm-control.js";
import { FarmSchema } from "./farm.js";
import {
  GatewayEnrollmentIdSchema,
  EdgeCredentialIdSchema,
  EdgeCredentialKeySchema,
  EdgeCredentialRecordSchema,
  GatewayEnrollmentRecordSchema,
  GatewayEnrollmentTokenSchema,
} from "./gateway-auth.js";
import {
  AlarmInstanceIdSchema,
  CommandIdSchema,
  CropCycleIdSchema,
  CropIdSchema,
  DeviceIdSchema,
  FarmIdSchema,
  GrowingAreaIdSchema,
  IrrigationStrategyIdSchema,
  IsoDateTimeSchema,
  StrategyApplicationIdSchema,
  TelemetryIdSchema,
} from "./identifiers.js";
import {
  IrrigationStrategySchema,
  IrrigationStrategyVersionSchema,
  StrategyApplicationSchema,
} from "./irrigation.js";
import { TelemetryMetricSchema, TelemetrySchema } from "./telemetry.js";

export const ApiErrorCodeSchema = z.enum([
  "unauthorized",
  "forbidden",
  "invalid_request",
  "not_found",
  "conflict",
  "upstream_unavailable",
  "internal_error",
]);

export const ApiErrorIssueSchema = z.strictObject({
  path: z.string(),
  message: z.string(),
});

export const ApiErrorSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.error.v1"),
  code: ApiErrorCodeSchema,
  message: z.string().min(1).max(200),
  issues: z.array(ApiErrorIssueSchema).max(20).optional(),
});

export const HealthResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.health.v1"),
  status: z.literal("ok"),
});

export const TelemetryReceiptSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.telemetry-receipt.v1"),
  status: z.enum(["accepted", "replayed"]),
  telemetryId: TelemetryIdSchema,
  acceptedAt: IsoDateTimeSchema,
});

export const LatestTelemetryResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.latest-telemetry.v1"),
  telemetry: TelemetrySchema,
});

const TelemetryHistoryLimitSchema = z.coerce.number().int().min(1).max(100).default(24);

export const TelemetryHistoryQuerySchema = z.strictObject({
  metric: TelemetryMetricSchema,
  limit: TelemetryHistoryLimitSchema,
});

export const TelemetryHistoryResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.telemetry-history.v1"),
  telemetry: z.array(TelemetrySchema).max(100),
});

export const FarmListResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.farm-list.v1"),
  farms: z.array(FarmSchema),
});

export const DeviceListResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.device-list.v1"),
  devices: z.array(DeviceSchema),
});

export const GrowingAreaListResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.growing-area-list.v1"),
  areas: z.array(GrowingAreaSchema),
});

export const CropListResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.crop-list.v1"),
  crops: z.array(CropRecordSchema),
});

export const CropCycleListResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.crop-cycle-list.v1"),
  cropCycles: z.array(CropCycleDetailSchema),
});

export const CropResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.crop-response.v1"),
  crop: CropRecordSchema,
});

export const CropCycleResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.crop-cycle-response.v1"),
  cropCycle: CropCycleDetailSchema,
});

const AlarmListLimitSchema = z.coerce.number().int().min(1).max(100).default(100);

export const AlarmListQuerySchema = z.strictObject({
  state: AlarmStateSchema.optional(),
  cycleId: CropCycleIdSchema.optional(),
  limit: AlarmListLimitSchema,
});

export const AlarmListResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.alarm-list.v1"),
  alarms: z.array(AlarmInstanceSchema).max(100),
});

export const AlarmResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.alarm-response.v1"),
  alarm: AlarmInstanceSchema,
});

export const AcknowledgeAlarmRequestSchema = z.strictObject({
  idempotencyKey: z.string().trim().min(8).max(128),
});

const AuditEventListLimitSchema = z.coerce.number().int().min(1).max(100).default(50);
const AuditEventIncludeUnscopedSchema = z
  .union([
    z.boolean(),
    z.enum(["true", "false"]).transform((value) => value === "true"),
  ])
  .default(false);

export const AuditEventListQuerySchema = z.strictObject({
  cycleId: CropCycleIdSchema.optional(),
  includeUnscoped: AuditEventIncludeUnscopedSchema,
  limit: AuditEventListLimitSchema,
});

export const AuditEventListResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.audit-event-list.v1"),
  auditEvents: z.array(AuditEventSchema).max(100),
});

export const IrrigationStrategyListQuerySchema = z.strictObject({
  cycleId: CropCycleIdSchema,
});

export const IrrigationStrategyListResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.irrigation-strategy-list.v1"),
  irrigationStrategies: z.array(IrrigationStrategySchema).max(100),
});

const ApplyIrrigationStrategyAreaIdsSchema = z
  .array(GrowingAreaIdSchema)
  .min(1)
  .max(20)
  .refine(
    (areaIds) => new Set(areaIds).size === areaIds.length,
    "Irrigation strategy application areaIds must be unique",
  );

export const ApplyIrrigationStrategyRequestSchema = z.strictObject({
  cycleId: CropCycleIdSchema,
  strategyVersion: IrrigationStrategyVersionSchema,
  areaIds: ApplyIrrigationStrategyAreaIdsSchema,
  idempotencyKey: z.string().trim().min(8).max(128),
});

export const StrategyApplicationResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.strategy-application-response.v1"),
  strategyApplication: StrategyApplicationSchema,
});

export const CreatePumpCommandRequestSchema = z.strictObject({
  deviceId: DeviceIdSchema,
  state: PumpStateSchema,
  idempotencyKey: z.string().trim().min(8).max(128),
  ttlSeconds: z.number().int().min(1).max(300).default(60),
});

export const PutFarmControlProfileRequestSchema = z.strictObject({
  expectedRevision: FarmControlProfileExpectedRevisionSchema,
  widgets: FarmControlWidgetsSchema,
});

export const FarmControlProfileResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.farm-control-profile-response.v1"),
  controlProfile: FarmControlProfileSchema,
});

export const CommandProjectionSchema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.command-projection.v1"),
    command: CommandSchema,
    status: CommandLifecycleStatusSchema,
    ack: CommandAckSchema.nullable(),
    updatedAt: IsoDateTimeSchema,
  })
  .refine(
    (projection) => {
      if (projection.status === "pending") {
        return projection.ack === null;
      }

      if (projection.ack === null) {
        return false;
      }

      switch (projection.status) {
        case "acknowledged":
          return projection.ack.status === "acknowledged";
        case "failed":
          return projection.ack.status === "failed" || projection.ack.status === "rejected";
        case "timed_out":
          return projection.ack.status === "timed_out";
        default:
          return false;
      }
    },
    {
      message: "Command projection status does not match acknowledgement",
      path: ["status"],
    },
  );

const CommandListLimitSchema = z.coerce.number().int().min(1).max(100).default(50);

export const CommandListQuerySchema = z.strictObject({
  deviceId: DeviceIdSchema.optional(),
  limit: CommandListLimitSchema,
});

export const CommandListResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.command-list.v1"),
  commands: z.array(CommandProjectionSchema).max(100),
});

export const PendingCommandResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.pending-command.v1"),
  command: CommandSchema,
});

const GatewayAccessListLimitSchema = z.coerce.number().int().min(1).max(100).default(50);

export const FarmPathParamsSchema = z.strictObject({
  farmId: FarmIdSchema,
});

export const DeviceGatewayPathParamsSchema = z.strictObject({
  farmId: FarmIdSchema,
  deviceId: DeviceIdSchema,
});

export const LatestTelemetryPathParamsSchema = z.strictObject({
  farmId: FarmIdSchema,
  deviceId: DeviceIdSchema,
});

export const LatestTelemetryQuerySchema = z.strictObject({
  metric: TelemetryMetricSchema,
});

export const NextCommandQuerySchema = z.strictObject({
  deviceId: DeviceIdSchema,
});

export const CommandPathParamsSchema = z.strictObject({
  farmId: FarmIdSchema,
  commandId: CommandIdSchema,
});

export const AlarmPathParamsSchema = z.strictObject({
  farmId: FarmIdSchema,
  alarmId: AlarmInstanceIdSchema,
});

export const CropPathParamsSchema = z.strictObject({
  farmId: FarmIdSchema,
  cropId: CropIdSchema,
});

export const GrowingAreaPathParamsSchema = z.strictObject({
  farmId: FarmIdSchema,
  areaId: GrowingAreaIdSchema,
});

export const CropCyclePathParamsSchema = z.strictObject({
  farmId: FarmIdSchema,
  cycleId: CropCycleIdSchema,
});

export const IrrigationStrategyPathParamsSchema = z.strictObject({
  farmId: FarmIdSchema,
  strategyId: IrrigationStrategyIdSchema,
});

export const StrategyApplicationPathParamsSchema = z.strictObject({
  farmId: FarmIdSchema,
  applicationId: StrategyApplicationIdSchema,
});

export const EdgeCredentialPathParamsSchema = z.strictObject({
  farmId: FarmIdSchema,
  deviceId: DeviceIdSchema,
  credentialId: EdgeCredentialIdSchema,
});

export const GatewayEnrollmentPathParamsSchema = z.strictObject({
  farmId: FarmIdSchema,
  deviceId: DeviceIdSchema,
  enrollmentId: GatewayEnrollmentIdSchema,
});

export const IssueGatewayEnrollmentRequestSchema = z.strictObject({});

export const IssueGatewayEnrollmentResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.issue-gateway-enrollment-response.v1"),
  enrollment: GatewayEnrollmentRecordSchema,
  enrollmentToken: GatewayEnrollmentTokenSchema,
});

export const GatewayAccessListQuerySchema = z.strictObject({
  limit: GatewayAccessListLimitSchema,
});

export const GatewayAccessListResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.gateway-access-list.v1"),
  enrollments: z.array(GatewayEnrollmentRecordSchema).max(100),
  credentials: z.array(EdgeCredentialRecordSchema).max(100),
});

export const GatewayEnrollmentExchangeRequestSchema = z.strictObject({});

export const GatewayEnrollmentExchangeResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.gateway-enrollment-exchange-response.v1"),
  credential: EdgeCredentialRecordSchema,
  edgeKey: EdgeCredentialKeySchema,
});

export const RevokeGatewayEnrollmentRequestSchema = z.strictObject({});

export const RevokeGatewayEnrollmentResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.revoke-gateway-enrollment-response.v1"),
  enrollment: GatewayEnrollmentRecordSchema,
});

export const RevokeEdgeCredentialRequestSchema = z.strictObject({});

export const RevokeEdgeCredentialResponseSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.revoke-edge-credential-response.v1"),
  credential: EdgeCredentialRecordSchema,
});

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type TelemetryReceipt = z.infer<typeof TelemetryReceiptSchema>;
export type LatestTelemetryResponse = z.infer<typeof LatestTelemetryResponseSchema>;
export type TelemetryHistoryQuery = z.infer<typeof TelemetryHistoryQuerySchema>;
export type TelemetryHistoryResponse = z.infer<typeof TelemetryHistoryResponseSchema>;
export type FarmListResponse = z.infer<typeof FarmListResponseSchema>;
export type DeviceListResponse = z.infer<typeof DeviceListResponseSchema>;
export type GrowingAreaListResponse = z.infer<typeof GrowingAreaListResponseSchema>;
export type CropListResponse = z.infer<typeof CropListResponseSchema>;
export type CropCycleListResponse = z.infer<typeof CropCycleListResponseSchema>;
export type CropResponse = z.infer<typeof CropResponseSchema>;
export type CropCycleResponse = z.infer<typeof CropCycleResponseSchema>;
export type AlarmListQueryInput = z.input<typeof AlarmListQuerySchema>;
export type AlarmListQuery = z.output<typeof AlarmListQuerySchema>;
export type AlarmListResponseInput = z.input<typeof AlarmListResponseSchema>;
export type AlarmListResponse = z.output<typeof AlarmListResponseSchema>;
export type AlarmResponseInput = z.input<typeof AlarmResponseSchema>;
export type AlarmResponse = z.output<typeof AlarmResponseSchema>;
export type AcknowledgeAlarmRequestInput = z.input<typeof AcknowledgeAlarmRequestSchema>;
export type AcknowledgeAlarmRequest = z.output<typeof AcknowledgeAlarmRequestSchema>;
export type AuditEventListQueryInput = z.input<typeof AuditEventListQuerySchema>;
export type AuditEventListQuery = z.output<typeof AuditEventListQuerySchema>;
export type AuditEventListResponseInput = z.input<typeof AuditEventListResponseSchema>;
export type AuditEventListResponse = z.output<typeof AuditEventListResponseSchema>;
export type IrrigationStrategyListQueryInput = z.input<
  typeof IrrigationStrategyListQuerySchema
>;
export type IrrigationStrategyListQuery = z.output<
  typeof IrrigationStrategyListQuerySchema
>;
export type IrrigationStrategyListResponseInput = z.input<
  typeof IrrigationStrategyListResponseSchema
>;
export type IrrigationStrategyListResponse = z.output<
  typeof IrrigationStrategyListResponseSchema
>;
export type ApplyIrrigationStrategyRequestInput = z.input<
  typeof ApplyIrrigationStrategyRequestSchema
>;
export type ApplyIrrigationStrategyRequest = z.output<
  typeof ApplyIrrigationStrategyRequestSchema
>;
export type StrategyApplicationResponseInput = z.input<
  typeof StrategyApplicationResponseSchema
>;
export type StrategyApplicationResponse = z.output<
  typeof StrategyApplicationResponseSchema
>;
export type CreatePumpCommandRequest = z.infer<typeof CreatePumpCommandRequestSchema>;
export type CreatePumpCommandRequestInput = z.input<typeof CreatePumpCommandRequestSchema>;
export type PutFarmControlProfileRequestInput = z.input<typeof PutFarmControlProfileRequestSchema>;
export type PutFarmControlProfileRequest = z.output<typeof PutFarmControlProfileRequestSchema>;
export type FarmControlProfileResponseInput = z.input<typeof FarmControlProfileResponseSchema>;
export type FarmControlProfileResponse = z.output<typeof FarmControlProfileResponseSchema>;
export type CommandProjection = z.infer<typeof CommandProjectionSchema>;
export type CommandListQueryInput = z.input<typeof CommandListQuerySchema>;
export type CommandListQuery = z.output<typeof CommandListQuerySchema>;
export type CommandListResponseInput = z.input<typeof CommandListResponseSchema>;
export type CommandListResponse = z.output<typeof CommandListResponseSchema>;
export type PendingCommandResponse = z.infer<typeof PendingCommandResponseSchema>;
export type DeviceGatewayPathParamsInput = z.input<typeof DeviceGatewayPathParamsSchema>;
export type DeviceGatewayPathParams = z.output<typeof DeviceGatewayPathParamsSchema>;
export type AlarmPathParamsInput = z.input<typeof AlarmPathParamsSchema>;
export type AlarmPathParams = z.output<typeof AlarmPathParamsSchema>;
export type IrrigationStrategyPathParamsInput = z.input<
  typeof IrrigationStrategyPathParamsSchema
>;
export type IrrigationStrategyPathParams = z.output<
  typeof IrrigationStrategyPathParamsSchema
>;
export type StrategyApplicationPathParamsInput = z.input<
  typeof StrategyApplicationPathParamsSchema
>;
export type StrategyApplicationPathParams = z.output<
  typeof StrategyApplicationPathParamsSchema
>;
export type GatewayEnrollmentPathParamsInput = z.input<typeof GatewayEnrollmentPathParamsSchema>;
export type GatewayEnrollmentPathParams = z.output<typeof GatewayEnrollmentPathParamsSchema>;
export type EdgeCredentialPathParamsInput = z.input<typeof EdgeCredentialPathParamsSchema>;
export type EdgeCredentialPathParams = z.output<typeof EdgeCredentialPathParamsSchema>;
export type IssueGatewayEnrollmentRequestInput = z.input<typeof IssueGatewayEnrollmentRequestSchema>;
export type IssueGatewayEnrollmentRequest = z.output<typeof IssueGatewayEnrollmentRequestSchema>;
export type IssueGatewayEnrollmentResponseInput = z.input<typeof IssueGatewayEnrollmentResponseSchema>;
export type IssueGatewayEnrollmentResponse = z.output<typeof IssueGatewayEnrollmentResponseSchema>;
export type GatewayAccessListQueryInput = z.input<typeof GatewayAccessListQuerySchema>;
export type GatewayAccessListQuery = z.output<typeof GatewayAccessListQuerySchema>;
export type GatewayAccessListResponseInput = z.input<typeof GatewayAccessListResponseSchema>;
export type GatewayAccessListResponse = z.output<typeof GatewayAccessListResponseSchema>;
export type GatewayEnrollmentExchangeRequestInput = z.input<typeof GatewayEnrollmentExchangeRequestSchema>;
export type GatewayEnrollmentExchangeRequest = z.output<typeof GatewayEnrollmentExchangeRequestSchema>;
export type GatewayEnrollmentExchangeResponseInput = z.input<typeof GatewayEnrollmentExchangeResponseSchema>;
export type GatewayEnrollmentExchangeResponse = z.output<typeof GatewayEnrollmentExchangeResponseSchema>;
export type RevokeGatewayEnrollmentRequestInput = z.input<typeof RevokeGatewayEnrollmentRequestSchema>;
export type RevokeGatewayEnrollmentRequest = z.output<typeof RevokeGatewayEnrollmentRequestSchema>;
export type RevokeGatewayEnrollmentResponseInput = z.input<typeof RevokeGatewayEnrollmentResponseSchema>;
export type RevokeGatewayEnrollmentResponse = z.output<typeof RevokeGatewayEnrollmentResponseSchema>;
export type RevokeEdgeCredentialRequestInput = z.input<typeof RevokeEdgeCredentialRequestSchema>;
export type RevokeEdgeCredentialRequest = z.output<typeof RevokeEdgeCredentialRequestSchema>;
export type RevokeEdgeCredentialResponseInput = z.input<typeof RevokeEdgeCredentialResponseSchema>;
export type RevokeEdgeCredentialResponse = z.output<typeof RevokeEdgeCredentialResponseSchema>;
