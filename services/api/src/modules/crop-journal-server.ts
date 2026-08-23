import {
  CreateCropRequestSchema,
  CropIdSchema,
  CropListResponseSchema,
  CropPathParamsSchema,
  CropRecordSchema,
  CropResponseSchema,
  FarmPathParamsSchema,
  PatchCropRequestSchema,
  type CropRecord,
} from "@smartfarm-os/contracts";
import {
  requireFarm,
  requirePrincipal,
  requireRole,
  requireStoredFarm,
  sendError,
  sendValidationError,
} from "../http-boundary.js";
import type { ApiModuleContext } from "../module-context.js";

export function registerCropJournalModule(context: ApiModuleContext): void {
  const { app, authenticate, createCropId, now, store } = context;

  app.get("/v1/farms/:farmId/crops", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    return CropListResponseSchema.parse({
      schemaVersion: "smartfarm.crop-list.v1",
      crops: store.listCrops(params.data.farmId),
    });
  });

  app.get("/v1/farms/:farmId/crops/:cropId", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = CropPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const crop = store.getCrop(params.data.farmId, params.data.cropId);
    if (crop === null) return sendError(reply, 404, "not_found", "Crop not found");

    return CropResponseSchema.parse({
      schemaVersion: "smartfarm.crop-response.v1",
      crop,
    });
  });

  app.post("/v1/farms/:farmId/crops", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const body = CreateCropRequestSchema.safeParse(request.body);
    if (!body.success) return sendValidationError(reply, body.error.issues);

    const deviceId = body.data.deviceId ?? null;
    if (deviceId !== null && store.getDevice(params.data.farmId, deviceId) === null) {
      return sendError(reply, 404, "not_found", "Device not found");
    }

    const timestamp = now().toISOString();
    const crop = buildCropRecord({
      schemaVersion: "smartfarm.crop.v1",
      id: CropIdSchema.parse(createCropId()),
      farmId: params.data.farmId,
      deviceId,
      name: body.data.name,
      healthStatus: body.data.healthStatus,
      managerName: body.data.managerName ?? null,
      notes: body.data.notes ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const result = store.createCrop(crop);
    if (result.kind === "conflict") {
      return sendError(reply, 409, "conflict", result.reason);
    }

    return reply.code(201).send(CropResponseSchema.parse({
      schemaVersion: "smartfarm.crop-response.v1",
      crop: result.crop,
    }));
  });

  app.patch("/v1/farms/:farmId/crops/:cropId", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = CropPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const body = PatchCropRequestSchema.safeParse(request.body);
    if (!body.success) return sendValidationError(reply, body.error.issues);

    const existingCrop = store.getCrop(params.data.farmId, params.data.cropId);
    if (existingCrop === null) {
      return sendError(reply, 404, "not_found", "Crop not found");
    }

    const deviceId = body.data.deviceId === undefined
      ? existingCrop.deviceId
      : body.data.deviceId;
    if (deviceId !== null && store.getDevice(params.data.farmId, deviceId) === null) {
      return sendError(reply, 404, "not_found", "Device not found");
    }

    const crop = buildCropRecord({
      schemaVersion: existingCrop.schemaVersion,
      id: existingCrop.id,
      farmId: existingCrop.farmId,
      deviceId,
      name: body.data.name ?? existingCrop.name,
      healthStatus: body.data.healthStatus ?? existingCrop.healthStatus,
      managerName: body.data.managerName === undefined
        ? existingCrop.managerName
        : body.data.managerName,
      notes: body.data.notes === undefined ? existingCrop.notes : body.data.notes,
      createdAt: existingCrop.createdAt,
      updatedAt: now().toISOString(),
    });
    const result = store.updateCrop(crop);
    if (result.kind === "not_found") {
      return sendError(reply, 404, "not_found", "Crop not found");
    }

    return CropResponseSchema.parse({
      schemaVersion: "smartfarm.crop-response.v1",
      crop: result.crop,
    });
  });

  app.delete("/v1/farms/:farmId/crops/:cropId", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = CropPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    if (!store.deleteCrop(params.data.farmId, params.data.cropId)) {
      return sendError(reply, 404, "not_found", "Crop not found");
    }

    return reply.code(204).send();
  });
}

function buildCropRecord(input: CropRecord): CropRecord {
  return CropRecordSchema.parse(input);
}
