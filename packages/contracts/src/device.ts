import * as z from "zod";
import { DeviceIdSchema, FarmIdSchema, IsoDateTimeSchema } from "./identifiers.js";

export const DeviceCapabilitySchema = z.enum([
  "temperature",
  "humidity",
  "illuminance",
  "water_level",
  "pump",
  "timed_pump",
]);

export const DeviceStatusSchema = z.enum(["online", "offline", "degraded"]);
export const DeviceKindSchema = z.enum(["sensor", "controller", "hybrid"]);

export const DeviceSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.device.v1"),
  id: DeviceIdSchema,
  farmId: FarmIdSchema,
  name: z.string().trim().min(1).max(80),
  kind: DeviceKindSchema,
  capabilities: z
    .array(DeviceCapabilitySchema)
    .min(1)
    .refine(
      (capabilities) => new Set(capabilities).size === capabilities.length,
      "Device capabilities must be unique",
    ),
  status: DeviceStatusSchema,
  lastSeenAt: IsoDateTimeSchema.nullable(),
});

export type DeviceCapability = z.infer<typeof DeviceCapabilitySchema>;
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;
export type DeviceKind = z.infer<typeof DeviceKindSchema>;
export type Device = z.infer<typeof DeviceSchema>;
