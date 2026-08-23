import * as z from "zod";
import { DeviceIdSchema, FarmIdSchema, IsoDateTimeSchema } from "./identifiers.js";

export const FarmControlProfileRevisionSchema = z.number().int().min(0).max(2_147_483_647);
export const FarmControlProfileExpectedRevisionSchema = z.number().int().min(0).max(2_147_483_646);

export const FarmControlWidgetSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.farm-control-widget.v1"),
  kind: z.literal("pump_control"),
  deviceId: DeviceIdSchema,
  label: z.string().trim().min(1).max(80),
  showStart: z.boolean(),
});

export const FarmControlWidgetsSchema = z
  .array(FarmControlWidgetSchema)
  .max(16)
  .superRefine((widgets, context) => {
    const seen = new Set<string>();

    widgets.forEach((widget, index) => {
      if (seen.has(widget.deviceId)) {
        context.addIssue({
          code: "custom",
          message: "Farm control widgets must use unique device IDs",
          path: [index, "deviceId"],
        });
        return;
      }
      seen.add(widget.deviceId);
    });
  });

export const FarmControlProfileSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.farm-control-profile.v1"),
  farmId: FarmIdSchema,
  revision: FarmControlProfileRevisionSchema,
  widgets: FarmControlWidgetsSchema,
  updatedAt: IsoDateTimeSchema,
});

export type FarmControlWidget = z.infer<typeof FarmControlWidgetSchema>;
export type FarmControlProfile = z.infer<typeof FarmControlProfileSchema>;
