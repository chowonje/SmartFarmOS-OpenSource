import {
  ApplyIrrigationStrategyRequestSchema,
  CreateCropCycleRequestSchema,
  type CropCycleId,
  CropCycleDetailSchema,
  CropCycleListResponseSchema,
  CropCyclePathParamsSchema,
  CropCycleResponseSchema,
  CropCycleIdSchema,
  FarmPathParamsSchema,
  GrowingAreaListResponseSchema,
  IrrigationStrategyListQuerySchema,
  IrrigationStrategyListResponseSchema,
  IrrigationStrategyPathParamsSchema,
  PatchCropCycleRequestSchema,
  StrategyApplicationPathParamsSchema,
  StrategyApplicationResponseSchema,
  StrategyApplicationSchema,
  CommandSchema,
  type Command,
  type PumpState,
} from "@smartfarm-os/contracts";
import {
  createPendingStrategyApplication,
  deriveStrategyCommandIdempotencyKey,
  type StrategyApplicationCommandTarget,
} from "../irrigation-center.js";
import {
  requireFarm,
  requirePrincipal,
  requireRole,
  requireStoredFarm,
  sendError,
  sendValidationError,
} from "../http-boundary.js";
import type { ApiModuleContext } from "../module-context.js";

export function registerCropOperationsModule(context: ApiModuleContext): void {
  const {
    app,
    authenticate,
    createCommandId,
    createCropCycleId,
    createStrategyApplicationId,
    now,
    store,
  } = context;

  app.get("/v1/farms/:farmId/areas", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    return GrowingAreaListResponseSchema.parse({
      schemaVersion: "smartfarm.growing-area-list.v1",
      areas: store.listGrowingAreas(params.data.farmId),
    });
  });

  app.get("/v1/farms/:farmId/crop-cycles", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    return CropCycleListResponseSchema.parse({
      schemaVersion: "smartfarm.crop-cycle-list.v1",
      cropCycles: store.listCropCycles(params.data.farmId),
    });
  });

  app.get("/v1/farms/:farmId/irrigation-strategies", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const query = IrrigationStrategyListQuerySchema.safeParse(request.query);
    if (!query.success) return sendValidationError(reply, query.error.issues);
    if (store.getCropCycle(params.data.farmId, query.data.cycleId) === null) {
      return sendError(reply, 404, "not_found", "Crop cycle not found");
    }

    return IrrigationStrategyListResponseSchema.parse({
      schemaVersion: "smartfarm.irrigation-strategy-list.v1",
      irrigationStrategies: store.listIrrigationStrategies(
        params.data.farmId,
        query.data.cycleId,
      ),
    });
  });

  app.post("/v1/farms/:farmId/crop-cycles", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const body = CreateCropCycleRequestSchema.safeParse(request.body);
    if (!body.success) return sendValidationError(reply, body.error.issues);

    for (const areaId of body.data.areaIds) {
      if (store.getGrowingArea(params.data.farmId, areaId) === null) {
        return sendError(reply, 404, "not_found", "Growing area not found");
      }
    }

    const timestamp = now().toISOString();
    const cropCycle = buildCropCycleDetail({
      schemaVersion: "smartfarm.crop-cycle-detail.v1",
      cycle: {
        schemaVersion: "smartfarm.crop-cycle.v1",
        id: CropCycleIdSchema.parse(createCropCycleId()),
        farmId: params.data.farmId,
        name: body.data.name,
        cropName: body.data.cropName,
        variety: body.data.variety ?? null,
        status: body.data.status,
        startedAt: body.data.startedAt ?? null,
        plannedEndAt: body.data.plannedEndAt ?? null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      areaIds: body.data.areaIds,
    });
    const result = store.createCropCycle(cropCycle);
    if (result.kind === "conflict") {
      return sendError(reply, 409, "conflict", result.reason);
    }

    return reply.code(201).send(CropCycleResponseSchema.parse({
      schemaVersion: "smartfarm.crop-cycle-response.v1",
      cropCycle: result.cropCycle,
    }));
  });

  app.patch("/v1/farms/:farmId/crop-cycles/:cycleId", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = CropCyclePathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const body = PatchCropCycleRequestSchema.safeParse(request.body);
    if (!body.success) return sendValidationError(reply, body.error.issues);

    const existing = store.getCropCycle(params.data.farmId, params.data.cycleId);
    if (existing === null) {
      return sendError(reply, 404, "not_found", "Crop cycle not found");
    }

    const areaIds = body.data.areaIds ?? existing.areaIds;
    for (const areaId of areaIds) {
      if (store.getGrowingArea(params.data.farmId, areaId) === null) {
        return sendError(reply, 404, "not_found", "Growing area not found");
      }
    }

    const merged = CropCycleDetailSchema.safeParse({
      schemaVersion: existing.schemaVersion,
      cycle: {
        schemaVersion: existing.cycle.schemaVersion,
        id: existing.cycle.id,
        farmId: existing.cycle.farmId,
        name: body.data.name ?? existing.cycle.name,
        cropName: body.data.cropName ?? existing.cycle.cropName,
        variety: body.data.variety === undefined ? existing.cycle.variety : body.data.variety,
        status: body.data.status ?? existing.cycle.status,
        startedAt: body.data.startedAt === undefined ? existing.cycle.startedAt : body.data.startedAt,
        plannedEndAt: body.data.plannedEndAt === undefined
          ? existing.cycle.plannedEndAt
          : body.data.plannedEndAt,
        createdAt: existing.cycle.createdAt,
        updatedAt: now().toISOString(),
      },
      areaIds,
    });
    if (!merged.success) return sendValidationError(reply, merged.error.issues);

    const result = store.updateCropCycle(merged.data);
    if (result.kind === "not_found") {
      return sendError(reply, 404, "not_found", "Crop cycle not found");
    }
    if (result.kind === "conflict") {
      return sendError(reply, 409, "conflict", result.reason);
    }

    return CropCycleResponseSchema.parse({
      schemaVersion: "smartfarm.crop-cycle-response.v1",
      cropCycle: result.cropCycle,
    });
  });

  app.post("/v1/farms/:farmId/irrigation-strategies/:strategyId/applications", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = IrrigationStrategyPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const body = ApplyIrrigationStrategyRequestSchema.safeParse(request.body);
    if (!body.success) return sendValidationError(reply, body.error.issues);

    const cropCycle = store.getCropCycle(params.data.farmId, body.data.cycleId);
    if (cropCycle === null) {
      return sendError(reply, 404, "not_found", "Crop cycle not found");
    }
    if (cropCycle.cycle.status !== "active") {
      return sendError(reply, 409, "conflict", "Crop cycle is not active");
    }

    const strategy = store.getIrrigationStrategy(
      params.data.farmId,
      params.data.strategyId,
      body.data.strategyVersion,
    );
    if (strategy === null) {
      return sendError(reply, 404, "not_found", "Irrigation strategy not found");
    }
    if (strategy.status !== "approved") {
      return sendError(reply, 409, "conflict", "Irrigation strategy is not approved");
    }
    if (strategy.cycleId !== body.data.cycleId) {
      return sendError(reply, 409, "conflict", "Irrigation strategy cycle does not match request");
    }

    const resolvedTargets: StrategyApplicationCommandTarget[] = [];
    for (const areaId of body.data.areaIds) {
      const area = store.getGrowingArea(params.data.farmId, areaId);
      if (area === null) {
        return sendError(reply, 404, "not_found", "Growing area not found");
      }
      if (area.status !== "active") {
        return sendError(reply, 409, "conflict", "Growing area is not active");
      }
      if (!cropCycle.areaIds.includes(areaId)) {
        return sendError(reply, 409, "conflict", "Growing area is not assigned to the crop cycle");
      }
      if (area.primaryDeviceId === null) {
        return sendError(reply, 409, "conflict", "Growing area does not have a primary device");
      }
      const device = store.getDevice(params.data.farmId, area.primaryDeviceId);
      if (device === null) {
        return sendError(reply, 404, "not_found", "Device not found");
      }
      if (!device.capabilities.includes("pump")) {
        return sendError(reply, 409, "conflict", "Device cannot receive irrigation commands");
      }
      if (
        strategy.runDurationSeconds !== undefined
        && !device.capabilities.includes("timed_pump")
      ) {
        return sendError(
          reply,
          409,
          "conflict",
          "Device cannot execute timed irrigation locally",
        );
      }

      resolvedTargets.push({
        areaId,
        deviceId: device.id,
        command: buildIrrigationCommand({
          createCommandId,
          cycleId: body.data.cycleId,
          deviceId: device.id,
          farmId: params.data.farmId,
          idempotencyKey: deriveStrategyCommandIdempotencyKey(
            body.data.idempotencyKey,
            device.id,
          ),
          issuedAt: now(),
          principalId: principal.id,
          pumpState: strategy.pumpState,
          ...(strategy.runDurationSeconds === undefined
            ? {}
            : { runDurationSeconds: strategy.runDurationSeconds }),
        }),
      });
    }

    resolvedTargets.sort((left, right) =>
      left.areaId.localeCompare(right.areaId)
      || left.deviceId.localeCompare(right.deviceId),
    );
    if (new Set(resolvedTargets.map((target) => target.deviceId)).size !== resolvedTargets.length) {
      return sendError(reply, 409, "conflict", "Resolved irrigation targets must map to unique devices");
    }

    const createdAt = now().toISOString();
    const application = createPendingStrategyApplication({
      id: createStrategyApplicationId(),
      farmId: params.data.farmId,
      cycleId: body.data.cycleId,
      strategy,
      actor: { type: "user", id: principal.id },
      idempotencyKey: body.data.idempotencyKey,
      targets: resolvedTargets,
      createdAt,
    });
    const result = store.createStrategyApplication(application, resolvedTargets);
    if (result.kind === "conflict") {
      return sendError(reply, 409, "conflict", result.reason);
    }

    return reply
      .code(result.kind === "created" ? 202 : 200)
      .send(StrategyApplicationResponseSchema.parse({
        schemaVersion: "smartfarm.strategy-application-response.v1",
        strategyApplication: result.application,
      }));
  });

  app.get("/v1/farms/:farmId/strategy-applications/:applicationId", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = StrategyApplicationPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const application = store.getStrategyApplication(
      params.data.farmId,
      params.data.applicationId,
    );
    if (application === null) {
      return sendError(reply, 404, "not_found", "Strategy application not found");
    }

    return StrategyApplicationResponseSchema.parse({
      schemaVersion: "smartfarm.strategy-application-response.v1",
      strategyApplication: application,
    });
  });
}

function buildCropCycleDetail(input: unknown) {
  return CropCycleDetailSchema.parse(input);
}

function buildIrrigationCommand(input: {
  readonly createCommandId: () => string;
  readonly cycleId: CropCycleId;
  readonly deviceId: string;
  readonly farmId: string;
  readonly idempotencyKey: string;
  readonly issuedAt: Date;
  readonly principalId: string;
  readonly pumpState: PumpState;
  readonly runDurationSeconds?: number;
}): Command {
  const common = {
    id: input.createCommandId() as Command["id"],
    farmId: input.farmId as Command["farmId"],
    deviceId: input.deviceId as Command["deviceId"],
    actor: { type: "user", id: input.principalId },
    idempotencyKey: input.idempotencyKey,
    issuedAt: input.issuedAt.toISOString(),
    expiresAt: new Date(input.issuedAt.getTime() + 60_000).toISOString(),
  };

  return CommandSchema.parse(input.runDurationSeconds === undefined
    ? {
      ...common,
      schemaVersion: "smartfarm.command.v1",
      payload: { action: "set_pump_state", state: input.pumpState },
    }
    : {
      ...common,
      schemaVersion: "smartfarm.command.v2",
      payload: {
        action: "run_pump_for",
        durationSeconds: input.runDurationSeconds,
      },
    });
}
