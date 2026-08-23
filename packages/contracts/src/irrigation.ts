import * as z from "zod";
import {
  CommandAckReasonCodeSchema,
  CommandActorSchema,
  CommandLifecycleStatusSchema,
  PumpStateSchema,
} from "./command.js";
import {
  CommandIdSchema,
  CropCycleIdSchema,
  DeviceIdSchema,
  FarmIdSchema,
  GrowingAreaIdSchema,
  IrrigationStrategyIdSchema,
  IsoDateTimeSchema,
  StrategyApplicationIdSchema,
} from "./identifiers.js";

const IrrigationStrategyNameSchema = z.string().trim().min(1).max(120);
const RunDurationSecondsSchema = z.number().int().min(1).max(300);

export const IrrigationStrategyVersionSchema = z.number().int().min(1).max(9_999);
export const IrrigationStrategyStatusSchema = z.enum([
  "draft",
  "approved",
  "retired",
]);

export const IrrigationStrategySchema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.irrigation-strategy.v1"),
    id: IrrigationStrategyIdSchema,
    version: IrrigationStrategyVersionSchema,
    farmId: FarmIdSchema,
    cycleId: CropCycleIdSchema,
    name: IrrigationStrategyNameSchema,
    description: z.string().max(500).nullable(),
    pumpState: PumpStateSchema,
    runDurationSeconds: RunDurationSecondsSchema.optional(),
    status: IrrigationStrategyStatusSchema,
    createdAt: IsoDateTimeSchema,
    approvedAt: IsoDateTimeSchema.nullable(),
  })
  .refine(
    (strategy) => {
      if (strategy.status === "approved") {
        return strategy.approvedAt !== null;
      }

      if (strategy.status === "draft") {
        return strategy.approvedAt === null;
      }

      return true;
    },
    {
      message: "Irrigation strategy approvedAt does not match status",
      path: ["approvedAt"],
    },
  )
  .refine(
    (strategy) =>
      strategy.runDurationSeconds === undefined || strategy.pumpState === "on",
    {
      message: "Irrigation strategy run duration requires pumpState on",
      path: ["runDurationSeconds"],
    },
  );

export const StrategyApplicationTargetSchema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.strategy-application-target.v1"),
    areaId: GrowingAreaIdSchema,
    deviceId: DeviceIdSchema,
    commandId: CommandIdSchema,
    status: CommandLifecycleStatusSchema,
    reasonCode: CommandAckReasonCodeSchema.nullable(),
    resultingPumpState: PumpStateSchema.nullable(),
    updatedAt: IsoDateTimeSchema,
  })
  .refine(
    (target) => {
      switch (target.status) {
        case "pending":
          return target.reasonCode === null && target.resultingPumpState === null;
        case "acknowledged":
          return target.reasonCode === null && target.resultingPumpState !== null;
        case "failed":
        case "timed_out":
          return target.reasonCode !== null && target.resultingPumpState === null;
      }
    },
    {
      message: "Strategy application target result and reason do not match status",
      path: ["status"],
    },
  );

export const StrategyApplicationStatusSchema = z.enum([
  "pending",
  "succeeded",
  "partial",
  "failed",
]);

export const StrategyApplicationSchema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.strategy-application.v1"),
    id: StrategyApplicationIdSchema,
    farmId: FarmIdSchema,
    cycleId: CropCycleIdSchema,
    strategyId: IrrigationStrategyIdSchema,
    strategyVersion: IrrigationStrategyVersionSchema,
    strategyName: IrrigationStrategyNameSchema,
    pumpState: PumpStateSchema,
    runDurationSeconds: RunDurationSecondsSchema.optional(),
    actor: CommandActorSchema,
    idempotencyKey: z.string().trim().min(8).max(128),
    targets: z.array(StrategyApplicationTargetSchema).min(1).max(20),
    status: StrategyApplicationStatusSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .refine(
    (application) =>
      application.runDurationSeconds === undefined
      || application.pumpState === "on",
    {
      message: "Strategy application run duration requires pumpState on",
      path: ["runDurationSeconds"],
    },
  )
  .refine(
    (application) =>
      new Set(application.targets.map((target) => target.areaId)).size
      === application.targets.length,
    {
      message: "Strategy application target areaIds must be unique",
      path: ["targets"],
    },
  )
  .refine(
    (application) =>
      new Set(application.targets.map((target) => target.deviceId)).size
      === application.targets.length,
    {
      message: "Strategy application target deviceIds must be unique",
      path: ["targets"],
    },
  )
  .refine(
    (application) =>
      new Set(application.targets.map((target) => target.commandId)).size
      === application.targets.length,
    {
      message: "Strategy application target commandIds must be unique",
      path: ["targets"],
    },
  )
  .refine(
    (application) => {
      if (application.targets.some((target) => target.status === "pending")) {
        return application.status === "pending";
      }

      if (application.targets.every((target) => target.status === "acknowledged")) {
        return application.status === "succeeded";
      }

      if (
        application.targets.every(
          (target) => target.status === "failed" || target.status === "timed_out",
        )
      ) {
        return application.status === "failed";
      }

      return application.status === "partial";
    },
    {
      message: "Strategy application status does not match target statuses",
      path: ["status"],
    },
  );

export type IrrigationStrategyVersion = z.output<
  typeof IrrigationStrategyVersionSchema
>;
export type IrrigationStrategyStatus = z.output<typeof IrrigationStrategyStatusSchema>;
export type IrrigationStrategyInput = z.input<typeof IrrigationStrategySchema>;
export type IrrigationStrategy = z.output<typeof IrrigationStrategySchema>;
export type StrategyApplicationTargetInput = z.input<
  typeof StrategyApplicationTargetSchema
>;
export type StrategyApplicationTarget = z.output<
  typeof StrategyApplicationTargetSchema
>;
export type StrategyApplicationStatus = z.output<
  typeof StrategyApplicationStatusSchema
>;
export type StrategyApplicationInput = z.input<typeof StrategyApplicationSchema>;
export type StrategyApplication = z.output<typeof StrategyApplicationSchema>;
