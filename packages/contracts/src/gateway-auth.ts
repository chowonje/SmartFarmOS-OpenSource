import * as z from "zod";
import {
  DeviceIdSchema,
  FarmIdSchema,
  IsoDateTimeSchema,
} from "./identifiers.js";

const idBodyPattern = "[a-z0-9](?:[a-z0-9-]{0,62})";
const opaqueSecretPattern = /^[A-Za-z0-9_-]{43}$/;

export const GatewayEnrollmentIdSchema = z
  .string()
  .regex(
    new RegExp(`^gateway-enrollment:${idBodyPattern}$`),
    "Expected gateway-enrollment:<lowercase-slug>",
  )
  .brand<"GatewayEnrollmentId">();

export const EdgeCredentialIdSchema = z
  .string()
  .regex(
    new RegExp(`^edge-credential:${idBodyPattern}$`),
    "Expected edge-credential:<lowercase-slug>",
  )
  .brand<"EdgeCredentialId">();

export const GatewayOpaqueSecretSchema = z
  .string()
  .regex(
    opaqueSecretPattern,
    "Expected a 32-byte base64url secret without padding",
  );

export const GatewayEnrollmentTokenSchema = z
  .string()
  .superRefine((value, context) => {
    const separatorIndex = value.indexOf(".");
    if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
      context.addIssue({
        code: "custom",
        message: "Expected gateway-enrollment-id.secret",
      });
      return;
    }

    const id = value.slice(0, separatorIndex);
    const secret = value.slice(separatorIndex + 1);
    if (!GatewayEnrollmentIdSchema.safeParse(id).success) {
      context.addIssue({
        code: "custom",
        message: "Expected gateway-enrollment-id.secret",
      });
    }
    if (!GatewayOpaqueSecretSchema.safeParse(secret).success) {
      context.addIssue({
        code: "custom",
        message: "Expected gateway-enrollment-id.secret",
      });
    }
  });

export const EdgeCredentialKeySchema = z
  .string()
  .superRefine((value, context) => {
    const separatorIndex = value.indexOf(".");
    if (separatorIndex <= 0 || separatorIndex === value.length - 1) {
      context.addIssue({
        code: "custom",
        message: "Expected edge-credential-id.secret",
      });
      return;
    }

    const id = value.slice(0, separatorIndex);
    const secret = value.slice(separatorIndex + 1);
    if (!EdgeCredentialIdSchema.safeParse(id).success) {
      context.addIssue({
        code: "custom",
        message: "Expected edge-credential-id.secret",
      });
    }
    if (!GatewayOpaqueSecretSchema.safeParse(secret).success) {
      context.addIssue({
        code: "custom",
        message: "Expected edge-credential-id.secret",
      });
    }
  });

export const GatewayEnrollmentStatusSchema = z.enum([
  "pending",
  "exchanged",
  "expired",
  "revoked",
]);

export const EdgeCredentialStatusSchema = z.enum([
  "active",
  "revoked",
]);

const ActorIdSchema = z.string().trim().min(1).max(128);

export const GatewayEnrollmentRecordSchema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.gateway-enrollment-record.v1"),
    id: GatewayEnrollmentIdSchema,
    farmId: FarmIdSchema,
    deviceId: DeviceIdSchema,
    status: GatewayEnrollmentStatusSchema,
    issuedByActorId: ActorIdSchema,
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    exchangedAt: IsoDateTimeSchema.nullable(),
    exchangedCredentialId: EdgeCredentialIdSchema.nullable(),
    revokedAt: IsoDateTimeSchema.nullable(),
    revokedByActorId: ActorIdSchema.nullable(),
  })
  .refine(
    (record) => Date.parse(record.expiresAt) > Date.parse(record.issuedAt),
    {
      message: "Gateway enrollment expiry must be later than issue time",
      path: ["expiresAt"],
    },
  )
  .refine(
    (record) => record.status !== "exchanged"
      || (record.exchangedAt !== null && record.exchangedCredentialId !== null),
    {
      message: "Exchanged gateway enrollments must record the credential outcome",
      path: ["status"],
    },
  )
  .refine(
    (record) => record.status !== "revoked"
      || (record.revokedAt !== null && record.revokedByActorId !== null),
    {
      message: "Revoked gateway enrollments must record the revocation actor and time",
      path: ["status"],
    },
  );

export const EdgeCredentialRecordSchema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.edge-credential-record.v1"),
    id: EdgeCredentialIdSchema,
    farmId: FarmIdSchema,
    deviceId: DeviceIdSchema,
    status: EdgeCredentialStatusSchema,
    createdFromEnrollmentId: GatewayEnrollmentIdSchema,
    createdAt: IsoDateTimeSchema,
    revokedAt: IsoDateTimeSchema.nullable(),
    revokedByActorId: ActorIdSchema.nullable(),
  })
  .refine(
    (record) => record.status !== "revoked"
      || (record.revokedAt !== null && record.revokedByActorId !== null),
    {
      message: "Revoked edge credentials must record the revocation actor and time",
      path: ["status"],
    },
  );

export type GatewayEnrollmentIdInput = z.input<typeof GatewayEnrollmentIdSchema>;
export type GatewayEnrollmentId = z.output<typeof GatewayEnrollmentIdSchema>;
export type EdgeCredentialIdInput = z.input<typeof EdgeCredentialIdSchema>;
export type EdgeCredentialId = z.output<typeof EdgeCredentialIdSchema>;
export type GatewayOpaqueSecret = z.infer<typeof GatewayOpaqueSecretSchema>;
export type GatewayEnrollmentToken = z.infer<typeof GatewayEnrollmentTokenSchema>;
export type EdgeCredentialKey = z.infer<typeof EdgeCredentialKeySchema>;
export type GatewayEnrollmentStatus = z.infer<typeof GatewayEnrollmentStatusSchema>;
export type EdgeCredentialStatus = z.infer<typeof EdgeCredentialStatusSchema>;
export type GatewayEnrollmentRecordInput = z.input<typeof GatewayEnrollmentRecordSchema>;
export type GatewayEnrollmentRecord = z.output<typeof GatewayEnrollmentRecordSchema>;
export type EdgeCredentialRecordInput = z.input<typeof EdgeCredentialRecordSchema>;
export type EdgeCredentialRecord = z.output<typeof EdgeCredentialRecordSchema>;
