import { randomUUID } from "node:crypto";
import {
  DeviceGatewayPathParamsSchema,
  EdgeCredentialIdSchema,
  EdgeCredentialPathParamsSchema,
  GatewayAccessListQuerySchema,
  GatewayAccessListResponseSchema,
  GatewayEnrollmentExchangeRequestSchema,
  GatewayEnrollmentExchangeResponseSchema,
  GatewayEnrollmentIdSchema,
  GatewayEnrollmentPathParamsSchema,
  IssueGatewayEnrollmentRequestSchema,
  IssueGatewayEnrollmentResponseSchema,
  RevokeEdgeCredentialRequestSchema,
  RevokeEdgeCredentialResponseSchema,
  RevokeGatewayEnrollmentRequestSchema,
  RevokeGatewayEnrollmentResponseSchema,
} from "@smartfarm-os/contracts";
import {
  GATEWAY_ENROLLMENT_TTL_MS,
  authenticateGatewayEnrollmentBearerToken,
  createEdgeCredentialKey,
  createGatewayEnrollmentToken,
} from "../gateway-auth.js";
import {
  requireFarm,
  requirePrincipal,
  requireRole,
  requireStoredFarm,
  sendError,
  sendValidationError,
} from "../http-boundary.js";
import type { ApiModuleContext } from "../module-context.js";

export function registerAdminGatewayEnrollmentRoutes(
  context: ApiModuleContext,
): void {
  const { app, authenticate, now, store } = context;

  app.post("/v1/admin/farms/:farmId/devices/:deviceId/gateway-enrollments", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["admin"], reply)) return reply;

    const params = DeviceGatewayPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;
    if (store.getDevice(params.data.farmId, params.data.deviceId) === null) {
      return sendError(reply, 404, "not_found", "Device not found");
    }

    const body = IssueGatewayEnrollmentRequestSchema.safeParse(request.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error.issues);

    const issuedAt = now();
    const enrollmentId = GatewayEnrollmentIdSchema.parse(
      `gateway-enrollment:${randomUUID()}`,
    );
    const enrollmentSecret = createGatewayEnrollmentToken(enrollmentId);
    const enrollment = store.issueGatewayEnrollment({
      id: enrollmentId,
      farmId: params.data.farmId,
      deviceId: params.data.deviceId,
      tokenDigest: enrollmentSecret.tokenDigest,
      issuedByActorId: principal.id,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + GATEWAY_ENROLLMENT_TTL_MS).toISOString(),
    });

    reply.header("cache-control", "no-store");
    return reply.code(201).send(IssueGatewayEnrollmentResponseSchema.parse({
      schemaVersion: "smartfarm.issue-gateway-enrollment-response.v1",
      enrollment,
      enrollmentToken: enrollmentSecret.enrollmentToken,
    }));
  });

  app.get("/v1/admin/farms/:farmId/devices/:deviceId/gateway-access", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["admin"], reply)) return reply;

    const params = DeviceGatewayPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;
    if (store.getDevice(params.data.farmId, params.data.deviceId) === null) {
      return sendError(reply, 404, "not_found", "Device not found");
    }

    const query = GatewayAccessListQuerySchema.safeParse(request.query);
    if (!query.success) return sendValidationError(reply, query.error.issues);

    return GatewayAccessListResponseSchema.parse({
      schemaVersion: "smartfarm.gateway-access-list.v1",
      enrollments: store.listGatewayEnrollments(
        params.data.farmId,
        params.data.deviceId,
        { limit: query.data.limit, now: now().toISOString() },
      ),
      credentials: store.listEdgeCredentials(
        params.data.farmId,
        params.data.deviceId,
        { limit: query.data.limit, now: now().toISOString() },
      ),
    });
  });

  app.post("/v1/admin/farms/:farmId/devices/:deviceId/gateway-enrollments/:enrollmentId/revocations", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["admin"], reply)) return reply;

    const params = GatewayEnrollmentPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;
    if (store.getDevice(params.data.farmId, params.data.deviceId) === null) {
      return sendError(reply, 404, "not_found", "Device not found");
    }

    const body = RevokeGatewayEnrollmentRequestSchema.safeParse(request.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error.issues);

    const result = store.revokeGatewayEnrollment({
      farmId: params.data.farmId,
      deviceId: params.data.deviceId,
      enrollmentId: params.data.enrollmentId,
      revokedAt: now().toISOString(),
      revokedByActorId: principal.id,
    });
    if (result.kind === "not_found") {
      return sendError(reply, 404, "not_found", "Gateway enrollment not found");
    }
    if (result.kind === "conflict") {
      return sendError(reply, 409, "conflict", result.reason);
    }

    return RevokeGatewayEnrollmentResponseSchema.parse({
      schemaVersion: "smartfarm.revoke-gateway-enrollment-response.v1",
      enrollment: result.enrollment,
    });
  });

  app.post("/v1/admin/farms/:farmId/devices/:deviceId/edge-credentials/:credentialId/revocations", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["admin"], reply)) return reply;

    const params = EdgeCredentialPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;
    if (store.getDevice(params.data.farmId, params.data.deviceId) === null) {
      return sendError(reply, 404, "not_found", "Device not found");
    }

    const body = RevokeEdgeCredentialRequestSchema.safeParse(request.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error.issues);

    const result = store.revokeEdgeCredential({
      farmId: params.data.farmId,
      deviceId: params.data.deviceId,
      credentialId: params.data.credentialId,
      revokedAt: now().toISOString(),
      revokedByActorId: principal.id,
    });
    if (result.kind === "not_found") {
      return sendError(reply, 404, "not_found", "Edge credential not found");
    }

    return RevokeEdgeCredentialResponseSchema.parse({
      schemaVersion: "smartfarm.revoke-edge-credential-response.v1",
      credential: result.credential,
    });
  });

  app.post("/v1/gateway-enrollments/exchange", async (request, reply) => {
    const body = GatewayEnrollmentExchangeRequestSchema.safeParse(request.body ?? {});
    if (!body.success) return sendValidationError(reply, body.error.issues);

    const enrollment = authenticateGatewayEnrollmentBearerToken(
      request.headers.authorization,
      store,
    );
    const exchangedAt = now().toISOString();
    if (
      enrollment === null
      || enrollment.exchangedAt !== null
      || enrollment.revokedAt !== null
      || Date.parse(enrollment.expiresAt) <= Date.parse(exchangedAt)
    ) {
      return sendError(reply, 401, "unauthorized", "Enrollment token is invalid or expired");
    }

    const credentialId = EdgeCredentialIdSchema.parse(
      `edge-credential:${randomUUID()}`,
    );
    const credentialSecret = createEdgeCredentialKey(credentialId);
    const result = store.exchangeGatewayEnrollment({
      enrollmentId: enrollment.enrollmentId,
      expectedTokenDigest: enrollment.tokenDigest,
      credentialId,
      credentialDigest: credentialSecret.credentialDigest,
      exchangedAt,
    });
    if (result.kind === "invalid") {
      return sendError(reply, 401, "unauthorized", "Enrollment token is invalid or expired");
    }

    reply.header("cache-control", "no-store");
    return reply.code(201).send(GatewayEnrollmentExchangeResponseSchema.parse({
      schemaVersion: "smartfarm.gateway-enrollment-exchange-response.v1",
      credential: result.credential,
      edgeKey: credentialSecret.edgeKey,
    }));
  });
}
