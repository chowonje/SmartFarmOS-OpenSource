import * as z from "zod";
import {
  CropCycleIdSchema,
  CropIdSchema,
  DeviceIdSchema,
  FarmIdSchema,
  GrowingAreaIdSchema,
  IsoDateTimeSchema,
} from "./identifiers.js";

const CropNameSchema = z.string().trim().min(1).max(120);
const CropManagerNameSchema = z.string().trim().min(1).max(80);
const CropNotesSchema = z.string().trim().min(1).max(4_000);
const GrowingAreaNameSchema = z.string().trim().min(1).max(120);
const CropCycleNameSchema = z.string().trim().min(1).max(120);
const CropVarietySchema = z.string().trim().min(1).max(120);
const CropCycleAreaIdsSchema = z.array(GrowingAreaIdSchema).min(1).max(32)
  .refine(
    (areaIds) => new Set(areaIds).size === areaIds.length,
    "Crop cycle areaIds must be unique",
  );

export const CropHealthStatusSchema = z.enum(["good", "fair", "poor"]);
export const GrowingAreaKindSchema = z.enum(["greenhouse", "bed", "tank"]);
export const GrowingAreaStatusSchema = z.enum(["active", "inactive"]);
export const CropCycleStatusSchema = z.enum(["planned", "active", "completed"]);

export const CropRecordSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.crop.v1"),
  id: CropIdSchema,
  farmId: FarmIdSchema,
  deviceId: DeviceIdSchema.nullable(),
  name: CropNameSchema,
  healthStatus: CropHealthStatusSchema,
  managerName: CropManagerNameSchema.nullable(),
  notes: CropNotesSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const GrowingAreaSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.growing-area.v1"),
  id: GrowingAreaIdSchema,
  farmId: FarmIdSchema,
  name: GrowingAreaNameSchema,
  kind: GrowingAreaKindSchema,
  primaryDeviceId: DeviceIdSchema.nullable(),
  status: GrowingAreaStatusSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});

export const CropCycleSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.crop-cycle.v1"),
  id: CropCycleIdSchema,
  farmId: FarmIdSchema,
  name: CropCycleNameSchema,
  cropName: CropNameSchema,
  variety: CropVarietySchema.nullable(),
  status: CropCycleStatusSchema,
  startedAt: IsoDateTimeSchema.nullable(),
  plannedEndAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).refine(
  (cycle) => (
    cycle.startedAt === null
    || cycle.plannedEndAt === null
    || Date.parse(cycle.startedAt) < Date.parse(cycle.plannedEndAt)
  ),
  {
    message: "Crop cycle plannedEndAt must be after startedAt",
    path: ["plannedEndAt"],
  },
);

export const CropCycleDetailSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.crop-cycle-detail.v1"),
  cycle: CropCycleSchema,
  areaIds: CropCycleAreaIdsSchema,
});

export const CreateCropRequestSchema = z.strictObject({
  deviceId: DeviceIdSchema.optional(),
  name: CropNameSchema,
  healthStatus: CropHealthStatusSchema.default("fair"),
  managerName: CropManagerNameSchema.nullable().optional(),
  notes: CropNotesSchema.nullable().optional(),
});

export const CreateCropCycleRequestSchema = z.strictObject({
  name: CropCycleNameSchema,
  cropName: CropNameSchema,
  variety: CropVarietySchema.nullable().optional(),
  status: CropCycleStatusSchema.default("planned"),
  startedAt: IsoDateTimeSchema.nullable().optional(),
  plannedEndAt: IsoDateTimeSchema.nullable().optional(),
  areaIds: CropCycleAreaIdsSchema,
}).refine(
  (cycle) => cycle.startedAt === undefined
    || cycle.startedAt === null
    || cycle.plannedEndAt === undefined
    || cycle.plannedEndAt === null
    || Date.parse(cycle.startedAt) < Date.parse(cycle.plannedEndAt),
  {
    message: "Crop cycle plannedEndAt must be after startedAt",
    path: ["plannedEndAt"],
  },
);

export const PatchCropRequestSchema = z
  .strictObject({
    deviceId: DeviceIdSchema.nullable().optional(),
    name: CropNameSchema.optional(),
    healthStatus: CropHealthStatusSchema.optional(),
    managerName: CropManagerNameSchema.nullable().optional(),
    notes: CropNotesSchema.nullable().optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    {
      message: "At least one crop field must be provided",
      path: [],
    },
  );

export const PatchCropCycleRequestSchema = z
  .strictObject({
    name: CropCycleNameSchema.optional(),
    cropName: CropNameSchema.optional(),
    variety: CropVarietySchema.nullable().optional(),
    status: CropCycleStatusSchema.optional(),
    startedAt: IsoDateTimeSchema.nullable().optional(),
    plannedEndAt: IsoDateTimeSchema.nullable().optional(),
    areaIds: CropCycleAreaIdsSchema.optional(),
  })
  .refine(
    (value) => Object.keys(value).length > 0,
    {
      message: "At least one crop cycle field must be provided",
      path: [],
    },
  );

export type CropHealthStatus = z.infer<typeof CropHealthStatusSchema>;
export type GrowingAreaKind = z.infer<typeof GrowingAreaKindSchema>;
export type GrowingAreaStatus = z.infer<typeof GrowingAreaStatusSchema>;
export type CropCycleStatus = z.infer<typeof CropCycleStatusSchema>;
export type CropRecord = z.infer<typeof CropRecordSchema>;
export type GrowingArea = z.infer<typeof GrowingAreaSchema>;
export type CropCycle = z.infer<typeof CropCycleSchema>;
export type CropCycleDetail = z.infer<typeof CropCycleDetailSchema>;
export type CreateCropRequest = z.infer<typeof CreateCropRequestSchema>;
export type CreateCropRequestInput = z.input<typeof CreateCropRequestSchema>;
export type CreateCropCycleRequest = z.infer<typeof CreateCropCycleRequestSchema>;
export type CreateCropCycleRequestInput = z.input<typeof CreateCropCycleRequestSchema>;
export type PatchCropRequest = z.infer<typeof PatchCropRequestSchema>;
export type PatchCropRequestInput = z.input<typeof PatchCropRequestSchema>;
export type PatchCropCycleRequest = z.infer<typeof PatchCropCycleRequestSchema>;
export type PatchCropCycleRequestInput = z.input<typeof PatchCropCycleRequestSchema>;
