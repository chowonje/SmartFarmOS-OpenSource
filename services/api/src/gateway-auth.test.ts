import assert from "node:assert/strict";
import test from "node:test";
import {
  DeviceIdSchema,
  FarmIdSchema,
  GatewayEnrollmentIdSchema,
  EdgeCredentialIdSchema,
} from "@smartfarm-os/contracts";
import {
  authenticateEdgeBearerCredential,
  authenticateGatewayEnrollmentBearerToken,
  createEdgeCredentialKey,
  createGatewayEnrollmentToken,
} from "./gateway-auth.js";
import { InMemorySmartFarmStore } from "./store.js";

const demoFarmId = FarmIdSchema.parse("farm:demo");
const demoDeviceId = DeviceIdSchema.parse("device:bed-1");
const enrollmentId = GatewayEnrollmentIdSchema.parse("gateway-enrollment:demo-enroll");
const credentialId = EdgeCredentialIdSchema.parse("edge-credential:demo-key");

test("authenticates exchanged bearer credentials and enrollment tokens against stored digests", async () => {
  const store = new InMemorySmartFarmStore();
  store.upsertFarm({
    schemaVersion: "smartfarm.farm.v1",
    id: demoFarmId,
    name: "Demo Farm",
    timezone: "Asia/Seoul",
    createdAt: "2026-08-12T01:00:00.000Z",
  });
  store.upsertDevice({
    schemaVersion: "smartfarm.device.v1",
    id: demoDeviceId,
    farmId: demoFarmId,
    name: "Bed 1",
    kind: "hybrid",
    capabilities: ["temperature", "pump"],
    status: "online",
    lastSeenAt: null,
  });

  const enrollmentSecret = createGatewayEnrollmentToken(enrollmentId);
  store.issueGatewayEnrollment({
    id: enrollmentId,
    farmId: demoFarmId,
    deviceId: demoDeviceId,
    tokenDigest: enrollmentSecret.tokenDigest,
    issuedByActorId: "admin:demo",
    issuedAt: "2026-08-12T01:00:00.000Z",
    expiresAt: "2026-08-12T01:10:00.000Z",
  });

  const enrollmentRequest = {
    headers: {
      authorization: `Bearer ${enrollmentSecret.enrollmentToken}`,
    },
  } as const;
  const authenticatedEnrollment = authenticateGatewayEnrollmentBearerToken(
    enrollmentRequest.headers.authorization,
    store,
  );
  assert.equal(authenticatedEnrollment?.enrollmentId, enrollmentId);

  const credentialSecret = createEdgeCredentialKey(credentialId);
  const exchange = store.exchangeGatewayEnrollment({
    enrollmentId,
    expectedTokenDigest: enrollmentSecret.tokenDigest,
    credentialId,
    credentialDigest: credentialSecret.credentialDigest,
    exchangedAt: "2026-08-12T01:01:00.000Z",
  });
  assert.equal(exchange.kind, "exchanged");

  const credentialRequest = {
    headers: {
      authorization: `Bearer ${credentialSecret.edgeKey}`,
    },
  } as const;
  const principal = authenticateEdgeBearerCredential(credentialRequest as never, store);
  assert.equal(principal?.id, credentialId);
  assert.deepEqual(principal?.farmIds, [demoFarmId]);
  assert.deepEqual(principal?.deviceScopes, [{
    farmId: demoFarmId,
    deviceId: demoDeviceId,
  }]);
});
