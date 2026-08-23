import * as z from "zod";
import { FarmIdSchema, IsoDateTimeSchema, TimezoneSchema } from "./identifiers.js";

export const FarmSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.farm.v1"),
  id: FarmIdSchema,
  name: z.string().trim().min(1).max(80),
  timezone: TimezoneSchema,
  createdAt: IsoDateTimeSchema,
});

export type Farm = z.infer<typeof FarmSchema>;

