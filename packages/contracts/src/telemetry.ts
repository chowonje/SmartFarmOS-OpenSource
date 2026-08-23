import * as z from "zod";
import {
  DeviceIdSchema,
  FarmIdSchema,
  IsoDateTimeSchema,
  TelemetryIdSchema,
} from "./identifiers.js";

export const TelemetryMetricSchema = z.enum([
  "temperature",
  "humidity",
  "illuminance",
  "water_level",
]);

export const TelemetryUnitSchema = z.enum(["celsius", "percent", "lux"]);

const metricRules = {
  temperature: { unit: "celsius", minimum: -50, maximum: 100 },
  humidity: { unit: "percent", minimum: 0, maximum: 100 },
  illuminance: { unit: "lux", minimum: 0, maximum: 200_000 },
  water_level: { unit: "percent", minimum: 0, maximum: 100 },
} as const;

export const TelemetrySchema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.telemetry.v1"),
    id: TelemetryIdSchema,
    farmId: FarmIdSchema,
    deviceId: DeviceIdSchema,
    metric: TelemetryMetricSchema,
    value: z.number().finite(),
    unit: TelemetryUnitSchema,
    sequence: z.number().int().nonnegative(),
    observedAt: IsoDateTimeSchema,
  })
  .refine((telemetry) => telemetry.unit === metricRules[telemetry.metric].unit, {
    message: "Telemetry unit does not match metric",
    path: ["unit"],
  })
  .refine(
    (telemetry) => {
      const rule = metricRules[telemetry.metric];
      return telemetry.value >= rule.minimum && telemetry.value <= rule.maximum;
    },
    {
      message: "Telemetry value is outside the accepted metric range",
      path: ["value"],
    },
  );

export type TelemetryMetric = z.infer<typeof TelemetryMetricSchema>;
export type TelemetryUnit = z.infer<typeof TelemetryUnitSchema>;
export type Telemetry = z.infer<typeof TelemetrySchema>;

