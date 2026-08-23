import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiErrorSchema,
  DeviceIdSchema,
  FarmIdSchema,
  GatewayAccessListResponseSchema,
  GatewayEnrollmentExchangeResponseSchema,
  IssueGatewayEnrollmentResponseSchema,
  RevokeEdgeCredentialResponseSchema,
  RevokeGatewayEnrollmentResponseSchema,
} from "@smartfarm-os/contracts";
import type { FastifyRequest } from "fastify";
import { buildApi } from "../app.js";
import type { AuthPrincipal } from "../auth.js";
import { InMemorySmartFarmStore } from "../store.js";

const demoFarmId = FarmIdSchema.parse("farm:demo");
const demoDeviceId = DeviceIdSchema.parse("device:bed-1");

function authenticate(request: FastifyRequest): AuthPrincipal | null {
  const value = request.headers["x-test-principal"];
  const name = Array.isArray(value) ? value[0] : value;

  if (name === "admin") {
    return { id: "admin:demo", role: "admin", farmIds: [demoFarmId] };
  }
  if (name === "user") {
    return { id: "user:demo", role: "user", farmIds: [demoFarmId] };
  }
  return null;
}

function buildSeededStore(): InMemorySmartFarmStore {
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
  return store;
}

test("issues exchanges lists and revokes admin-managed gateway credentials", async () => {
  const app = buildApi({
    authenticate,
    store: buildSeededStore(),
    now: () => new Date("2026-08-12T01:00:00.000Z"),
  });

  const forbidden = await app.inject({
    method: "POST",
    url: "/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/gateway-enrollments",
    headers: { "x-test-principal": "user" },
    payload: {},
  });
  assert.equal(forbidden.statusCode, 403);

  const issued = await app.inject({
    method: "POST",
    url: "/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/gateway-enrollments",
    headers: { "x-test-principal": "admin" },
    payload: {},
  });
  assert.equal(issued.statusCode, 201);
  assert.equal(issued.headers["cache-control"], "no-store");
  const issuedBody = IssueGatewayEnrollmentResponseSchema.parse(issued.json());
  assert.equal(issuedBody.enrollment.status, "pending");
  assert.equal(issuedBody.enrollment.deviceId, "device:bed-1");

  const exchanged = await app.inject({
    method: "POST",
    url: "/v1/gateway-enrollments/exchange",
    headers: { authorization: `Bearer ${issuedBody.enrollmentToken}` },
    payload: {},
  });
  assert.equal(exchanged.statusCode, 201);
  assert.equal(exchanged.headers["cache-control"], "no-store");
  const exchangedBody = GatewayEnrollmentExchangeResponseSchema.parse(exchanged.json());
  assert.equal(exchangedBody.credential.status, "active");
  assert.equal(exchangedBody.credential.deviceId, "device:bed-1");

  const replay = await app.inject({
    method: "POST",
    url: "/v1/gateway-enrollments/exchange",
    headers: { authorization: `Bearer ${issuedBody.enrollmentToken}` },
    payload: {},
  });
  assert.equal(replay.statusCode, 401);

  const malformed = await app.inject({
    method: "POST",
    url: "/v1/gateway-enrollments/exchange",
    headers: { authorization: "Bearer not-a-valid-token" },
    payload: {},
  });
  assert.equal(malformed.statusCode, 401);

  const listed = await app.inject({
    method: "GET",
    url: "/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/gateway-access?limit=10",
    headers: { "x-test-principal": "admin" },
  });
  assert.equal(listed.statusCode, 200);
  const listedBody = GatewayAccessListResponseSchema.parse(listed.json());
  assert.equal(listedBody.enrollments.length, 1);
  assert.equal(listedBody.enrollments[0]?.status, "exchanged");
  assert.equal(listedBody.credentials.length, 1);
  assert.equal("enrollmentToken" in listedBody.enrollments[0]!, false);
  assert.equal("edgeKey" in listedBody.credentials[0]!, false);

  const revoked = await app.inject({
    method: "POST",
    url: `/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/edge-credentials/${encodeURIComponent(exchangedBody.credential.id)}/revocations`,
    headers: { "x-test-principal": "admin" },
    payload: {},
  });
  assert.equal(revoked.statusCode, 200);
  const revokedBody = RevokeEdgeCredentialResponseSchema.parse(revoked.json());
  assert.equal(revokedBody.credential.status, "revoked");

  const revokeReplay = await app.inject({
    method: "POST",
    url: `/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/edge-credentials/${encodeURIComponent(exchangedBody.credential.id)}/revocations`,
    headers: { "x-test-principal": "admin" },
    payload: {},
  });
  assert.equal(revokeReplay.statusCode, 200);

  await app.close();
});

test("rejects expired enrollment exchange tokens", async () => {
  const store = buildSeededStore();
  const issueApp = buildApi({
    authenticate,
    store,
    now: () => new Date("2026-08-12T01:00:00.000Z"),
  });
  const exchangeApp = buildApi({
    authenticate,
    store,
    now: () => new Date("2026-08-12T01:12:00.000Z"),
  });

  const issued = await issueApp.inject({
    method: "POST",
    url: "/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/gateway-enrollments",
    headers: { "x-test-principal": "admin" },
    payload: {},
  });
  const issuedBody = IssueGatewayEnrollmentResponseSchema.parse(issued.json());

  const expired = await exchangeApp.inject({
    method: "POST",
    url: "/v1/gateway-enrollments/exchange",
    headers: { authorization: `Bearer ${issuedBody.enrollmentToken}` },
    payload: {},
  });
  assert.equal(expired.statusCode, 401);

  await issueApp.close();
  await exchangeApp.close();
});

test("revokes unconsumed gateway enrollments and blocks later exchange", async () => {
  const app = buildApi({
    authenticate,
    store: buildSeededStore(),
    now: () => new Date("2026-08-12T01:00:00.000Z"),
  });

  const issued = await app.inject({
    method: "POST",
    url: "/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/gateway-enrollments",
    headers: { "x-test-principal": "admin" },
    payload: {},
  });
  const issuedBody = IssueGatewayEnrollmentResponseSchema.parse(issued.json());

  const revoked = await app.inject({
    method: "POST",
    url: `/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/gateway-enrollments/${encodeURIComponent(issuedBody.enrollment.id)}/revocations`,
    headers: { "x-test-principal": "admin" },
    payload: {},
  });
  assert.equal(revoked.statusCode, 200);
  const revokedBody = RevokeGatewayEnrollmentResponseSchema.parse(revoked.json());
  assert.equal(revokedBody.enrollment.status, "revoked");
  assert.equal(revokedBody.enrollment.revokedByActorId, "admin:demo");

  const revokeReplay = await app.inject({
    method: "POST",
    url: `/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/gateway-enrollments/${encodeURIComponent(issuedBody.enrollment.id)}/revocations`,
    headers: { "x-test-principal": "admin" },
    payload: {},
  });
  assert.equal(revokeReplay.statusCode, 200);
  assert.equal(
    RevokeGatewayEnrollmentResponseSchema.parse(revokeReplay.json()).enrollment.status,
    "revoked",
  );

  const exchangeAfterRevoke = await app.inject({
    method: "POST",
    url: "/v1/gateway-enrollments/exchange",
    headers: { authorization: `Bearer ${issuedBody.enrollmentToken}` },
    payload: {},
  });
  assert.equal(exchangeAfterRevoke.statusCode, 401);

  const listed = await app.inject({
    method: "GET",
    url: "/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/gateway-access?limit=10",
    headers: { "x-test-principal": "admin" },
  });
  assert.equal(
    GatewayAccessListResponseSchema.parse(listed.json()).enrollments[0]?.status,
    "revoked",
  );

  await app.close();
});

test("rejects gateway enrollment revocation outside exact scope or after exchange", async () => {
  const app = buildApi({
    authenticate,
    store: buildSeededStore(),
    now: () => new Date("2026-08-12T01:00:00.000Z"),
  });

  const issued = await app.inject({
    method: "POST",
    url: "/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/gateway-enrollments",
    headers: { "x-test-principal": "admin" },
    payload: {},
  });
  const issuedBody = IssueGatewayEnrollmentResponseSchema.parse(issued.json());

  const notFound = await app.inject({
    method: "POST",
    url: `/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/gateway-enrollments/${encodeURIComponent("gateway-enrollment:missing")}/revocations`,
    headers: { "x-test-principal": "admin" },
    payload: {},
  });
  assert.equal(notFound.statusCode, 404);
  assert.equal(ApiErrorSchema.parse(notFound.json()).code, "not_found");

  const exchanged = await app.inject({
    method: "POST",
    url: "/v1/gateway-enrollments/exchange",
    headers: { authorization: `Bearer ${issuedBody.enrollmentToken}` },
    payload: {},
  });
  assert.equal(exchanged.statusCode, 201);
  GatewayEnrollmentExchangeResponseSchema.parse(exchanged.json());

  const conflict = await app.inject({
    method: "POST",
    url: `/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/gateway-enrollments/${encodeURIComponent(issuedBody.enrollment.id)}/revocations`,
    headers: { "x-test-principal": "admin" },
    payload: {},
  });
  assert.equal(conflict.statusCode, 409);
  const conflictBody = ApiErrorSchema.parse(conflict.json());
  assert.equal(conflictBody.code, "conflict");
  assert.equal(conflictBody.message, "Gateway enrollment has already been exchanged");

  await app.close();
});
