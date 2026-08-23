import {
  FarmPathParamsSchema,
  LatestTelemetryPathParamsSchema,
  LatestTelemetryQuerySchema,
  LatestTelemetryResponseSchema,
  TelemetryHistoryQuerySchema,
  TelemetryHistoryResponseSchema,
  TelemetryReceiptSchema,
  TelemetrySchema,
} from "@smartfarm-os/contracts";
import {
  requireEdgeDevice,
  requireFarm,
  requirePrincipal,
  requireRole,
  requireStoredFarm,
  sendError,
  sendValidationError,
} from "../http-boundary.js";
import type { ApiModuleContext } from "../module-context.js";

export function registerFarmEnvironmentModule(context: ApiModuleContext): void {
  const { app, authenticate, now, store } = context;

  app.post("/v1/farms/:farmId/telemetry", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["edge"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const telemetry = TelemetrySchema.safeParse(request.body);
    if (!telemetry.success) return sendValidationError(reply, telemetry.error.issues);
    if (telemetry.data.farmId !== params.data.farmId) {
      return sendError(reply, 403, "forbidden", "Telemetry farm scope does not match route");
    }
    if (!requireEdgeDevice(principal, params.data.farmId, telemetry.data.deviceId, reply)) return reply;
    if (store.getDevice(params.data.farmId, telemetry.data.deviceId) === null) {
      return sendError(reply, 404, "not_found", "Device not found");
    }

    const result = store.putTelemetry(telemetry.data);
    if (result.kind === "conflict") {
      return sendError(reply, 409, "conflict", result.reason);
    }

    const receipt = TelemetryReceiptSchema.parse({
      schemaVersion: "smartfarm.telemetry-receipt.v1",
      status: result.kind === "accepted" ? "accepted" : "replayed",
      telemetryId: telemetry.data.id,
      acceptedAt: now().toISOString(),
    });
    return reply.code(result.kind === "accepted" ? 202 : 200).send(receipt);
  });

  app.get(
    "/v1/farms/:farmId/devices/:deviceId/telemetry/latest",
    async (request, reply) => {
      const principal = await requirePrincipal(authenticate, request, reply);
      if (principal === null) return reply;
      if (!requireRole(principal, ["user", "admin"], reply)) return reply;

      const params = LatestTelemetryPathParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(reply, params.error.issues);
      if (!requireFarm(principal, params.data.farmId, reply)) return reply;
      if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;
      if (store.getDevice(params.data.farmId, params.data.deviceId) === null) {
        return sendError(reply, 404, "not_found", "Device not found");
      }

      const query = LatestTelemetryQuerySchema.safeParse(request.query);
      if (!query.success) return sendValidationError(reply, query.error.issues);

      const telemetry = store.latestTelemetry(
        params.data.farmId,
        params.data.deviceId,
        query.data.metric,
      );
      if (telemetry === null) {
        return sendError(reply, 404, "not_found", "Telemetry not found");
      }

      return LatestTelemetryResponseSchema.parse({
        schemaVersion: "smartfarm.latest-telemetry.v1",
        telemetry,
      });
    },
  );

  app.get(
    "/v1/farms/:farmId/devices/:deviceId/telemetry/history",
    async (request, reply) => {
      const principal = await requirePrincipal(authenticate, request, reply);
      if (principal === null) return reply;
      if (!requireRole(principal, ["user", "admin"], reply)) return reply;

      const params = LatestTelemetryPathParamsSchema.safeParse(request.params);
      if (!params.success) return sendValidationError(reply, params.error.issues);
      if (!requireFarm(principal, params.data.farmId, reply)) return reply;
      if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;
      if (store.getDevice(params.data.farmId, params.data.deviceId) === null) {
        return sendError(reply, 404, "not_found", "Device not found");
      }

      const query = TelemetryHistoryQuerySchema.safeParse(request.query);
      if (!query.success) return sendValidationError(reply, query.error.issues);

      const telemetry = store.recentTelemetry(
        params.data.farmId,
        params.data.deviceId,
        query.data.metric,
        query.data.limit,
      );
      if (telemetry.length === 0) {
        return sendError(reply, 404, "not_found", "Telemetry not found");
      }

      return TelemetryHistoryResponseSchema.parse({
        schemaVersion: "smartfarm.telemetry-history.v1",
        telemetry,
      });
    },
  );
}
