import {
  DeviceListResponseSchema,
  FarmListResponseSchema,
  FarmPathParamsSchema,
} from "@smartfarm-os/contracts";
import {
  requireFarm,
  requirePrincipal,
  requireRole,
  requireStoredFarm,
  sendValidationError,
} from "../http-boundary.js";
import type { ApiModuleContext } from "../module-context.js";

export function registerPlatformCatalogRoutes(context: ApiModuleContext): void {
  const { app, authenticate, store } = context;

  app.get("/v1/farms", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const farms = store
      .listFarms()
      .filter((farm) => principal.farmIds.includes(farm.id));

    return FarmListResponseSchema.parse({
      schemaVersion: "smartfarm.farm-list.v1",
      farms,
    });
  });

  app.get("/v1/farms/:farmId/devices", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    return DeviceListResponseSchema.parse({
      schemaVersion: "smartfarm.device-list.v1",
      devices: store.listDevices(params.data.farmId),
    });
  });
}
