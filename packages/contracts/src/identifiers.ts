import * as z from "zod";

const idBodyPattern = "[a-z0-9](?:[a-z0-9-]{0,62})";

export const FarmIdSchema = z
  .string()
  .regex(new RegExp(`^farm:${idBodyPattern}$`), "Expected farm:<lowercase-slug>")
  .brand<"FarmId">();

export const DeviceIdSchema = z
  .string()
  .regex(new RegExp(`^device:${idBodyPattern}$`), "Expected device:<lowercase-slug>")
  .brand<"DeviceId">();

export const TelemetryIdSchema = z
  .string()
  .regex(new RegExp(`^telemetry:${idBodyPattern}$`), "Expected telemetry:<lowercase-slug>")
  .brand<"TelemetryId">();

export const CommandIdSchema = z
  .string()
  .regex(new RegExp(`^command:${idBodyPattern}$`), "Expected command:<lowercase-slug>")
  .brand<"CommandId">();

export const CropIdSchema = z
  .string()
  .regex(new RegExp(`^crop:${idBodyPattern}$`), "Expected crop:<lowercase-slug>")
  .brand<"CropId">();

export const GrowingAreaIdSchema = z
  .string()
  .regex(new RegExp(`^area:${idBodyPattern}$`), "Expected area:<lowercase-slug>")
  .brand<"GrowingAreaId">();

export const CropCycleIdSchema = z
  .string()
  .regex(new RegExp(`^cycle:${idBodyPattern}$`), "Expected cycle:<lowercase-slug>")
  .brand<"CropCycleId">();

export const AlarmRuleIdSchema = z
  .string()
  .regex(
    new RegExp(`^alarm-rule:${idBodyPattern}$`),
    "Expected alarm-rule:<lowercase-slug>",
  )
  .brand<"AlarmRuleId">();

export const AlarmInstanceIdSchema = z
  .string()
  .regex(new RegExp(`^alarm:${idBodyPattern}$`), "Expected alarm:<lowercase-slug>")
  .brand<"AlarmInstanceId">();

export const AuditEventIdSchema = z
  .string()
  .regex(new RegExp(`^audit:${idBodyPattern}$`), "Expected audit:<lowercase-slug>")
  .brand<"AuditEventId">();

export const IrrigationStrategyIdSchema = z
  .string()
  .regex(
    new RegExp(`^strategy:${idBodyPattern}$`),
    "Expected strategy:<lowercase-slug>",
  )
  .brand<"IrrigationStrategyId">();

export const StrategyApplicationIdSchema = z
  .string()
  .regex(
    new RegExp(`^strategy-application:${idBodyPattern}$`),
    "Expected strategy-application:<lowercase-slug>",
  )
  .brand<"StrategyApplicationId">();

export const IsoDateTimeSchema = z.iso.datetime({ offset: true });

export const TimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (value) => value === "UTC" || /^[A-Za-z_]+\/[A-Za-z0-9_+/-]+$/.test(value),
    "Expected UTC or an IANA-style timezone such as Asia/Seoul",
  );

export type FarmId = z.infer<typeof FarmIdSchema>;
export type DeviceId = z.infer<typeof DeviceIdSchema>;
export type TelemetryId = z.infer<typeof TelemetryIdSchema>;
export type CommandId = z.infer<typeof CommandIdSchema>;
export type CropId = z.infer<typeof CropIdSchema>;
export type GrowingAreaId = z.infer<typeof GrowingAreaIdSchema>;
export type CropCycleId = z.infer<typeof CropCycleIdSchema>;
export type AlarmRuleIdInput = z.input<typeof AlarmRuleIdSchema>;
export type AlarmRuleId = z.output<typeof AlarmRuleIdSchema>;
export type AlarmInstanceIdInput = z.input<typeof AlarmInstanceIdSchema>;
export type AlarmInstanceId = z.output<typeof AlarmInstanceIdSchema>;
export type AuditEventIdInput = z.input<typeof AuditEventIdSchema>;
export type AuditEventId = z.output<typeof AuditEventIdSchema>;
export type IrrigationStrategyIdInput = z.input<typeof IrrigationStrategyIdSchema>;
export type IrrigationStrategyId = z.output<typeof IrrigationStrategyIdSchema>;
export type StrategyApplicationIdInput = z.input<typeof StrategyApplicationIdSchema>;
export type StrategyApplicationId = z.output<typeof StrategyApplicationIdSchema>;
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;
