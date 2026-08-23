import assert from "node:assert/strict";
import test from "node:test";
import {
  EdgeCredentialKeySchema,
  EdgeCredentialRecordSchema,
  GatewayEnrollmentRecordSchema,
  GatewayEnrollmentTokenSchema,
} from "./gateway-auth.js";

const issuedAt = "2026-08-12T01:00:00.000Z";
const expiresAt = "2026-08-12T01:10:00.000Z";
const opaqueSecret = "a".repeat(43);

test("accepts public-id.secret gateway tokens and edge keys", () => {
  const enrollmentToken = GatewayEnrollmentTokenSchema.parse(
    `gateway-enrollment:demo-enroll.${opaqueSecret}`,
  );
  const edgeKey = EdgeCredentialKeySchema.parse(
    `edge-credential:demo-edge.${opaqueSecret}`,
  );

  assert.equal(
    enrollmentToken,
    `gateway-enrollment:demo-enroll.${opaqueSecret}`,
  );
  assert.equal(
    edgeKey,
    `edge-credential:demo-edge.${opaqueSecret}`,
  );
});

test("rejects malformed gateway tokens and credential keys", () => {
  assert.equal(
    GatewayEnrollmentTokenSchema.safeParse("gateway-enrollment:demo-enroll").success,
    false,
  );
  assert.equal(
    GatewayEnrollmentTokenSchema.safeParse(
      "gateway-enrollment:demo-enroll.short",
    ).success,
    false,
  );
  assert.equal(
    EdgeCredentialKeySchema.safeParse(
      "edge-credential:demo-edge.abcdefghijklmnopqrstuvwxyzABCDE123456=",
    ).success,
    false,
  );
});

test("accepts audit-ready enrollment and credential records without secrets", () => {
  const enrollment = GatewayEnrollmentRecordSchema.parse({
    schemaVersion: "smartfarm.gateway-enrollment-record.v1",
    id: "gateway-enrollment:demo-enroll",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    status: "pending",
    issuedByActorId: "admin:demo",
    issuedAt,
    expiresAt,
    exchangedAt: null,
    exchangedCredentialId: null,
    revokedAt: null,
    revokedByActorId: null,
  });
  const credential = EdgeCredentialRecordSchema.parse({
    schemaVersion: "smartfarm.edge-credential-record.v1",
    id: "edge-credential:demo-edge",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    status: "active",
    createdFromEnrollmentId: enrollment.id,
    createdAt: issuedAt,
    revokedAt: null,
    revokedByActorId: null,
  });

  assert.equal("enrollmentToken" in enrollment, false);
  assert.equal("edgeKey" in credential, false);
});

test("requires exchanged and revoked records to carry lifecycle evidence", () => {
  assert.equal(
    GatewayEnrollmentRecordSchema.safeParse({
      schemaVersion: "smartfarm.gateway-enrollment-record.v1",
      id: "gateway-enrollment:demo-enroll",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      status: "exchanged",
      issuedByActorId: "admin:demo",
      issuedAt,
      expiresAt,
      exchangedAt: null,
      exchangedCredentialId: null,
      revokedAt: null,
      revokedByActorId: null,
    }).success,
    false,
  );
  assert.equal(
    EdgeCredentialRecordSchema.safeParse({
      schemaVersion: "smartfarm.edge-credential-record.v1",
      id: "edge-credential:demo-edge",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      status: "revoked",
      createdFromEnrollmentId: "gateway-enrollment:demo-enroll",
      createdAt: issuedAt,
      revokedAt: null,
      revokedByActorId: null,
    }).success,
    false,
  );
});
