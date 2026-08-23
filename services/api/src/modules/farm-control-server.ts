import {
  CommandAckSchema,
  CommandListQuerySchema,
  CommandListResponseSchema,
  CommandPathParamsSchema,
  CommandProjectionSchema,
  CommandSchema,
  CreatePumpCommandRequestSchema,
  FarmControlProfileResponseSchema,
  FarmPathParamsSchema,
  NextCommandQuerySchema,
  PendingCommandResponseSchema,
  PutFarmControlProfileRequestSchema,
  type Device,
  type Farm,
  type FarmControlProfile,
  type FarmId,
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

export function registerFarmControlModule(context: ApiModuleContext): void {
  const { app, authenticate, createCommandId, now, store } = context;

  app.get("/v1/farms/:farmId/control-profile", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const farm = store.getFarm(params.data.farmId);
    if (farm === null) {
      return sendError(reply, 404, "not_found", "Farm not found");
    }

    const profile = store.getFarmControlProfile(params.data.farmId)
      ?? buildDefaultFarmControlProfile(farm, store.listDevices(params.data.farmId));

    return FarmControlProfileResponseSchema.parse({
      schemaVersion: "smartfarm.farm-control-profile-response.v1",
      controlProfile: profile,
    });
  });

  app.put("/v1/farms/:farmId/control-profile", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const body = PutFarmControlProfileRequestSchema.safeParse(request.body);
    if (!body.success) return sendValidationError(reply, body.error.issues);

    const farm = store.getFarm(params.data.farmId);
    if (farm === null) {
      return sendError(reply, 404, "not_found", "Farm not found");
    }

    if (!widgetsTargetSameFarmPumpDevices(params.data.farmId, body.data.widgets, store)) {
      return sendError(
        reply,
        400,
        "invalid_request",
        "Farm control profile widgets must target same-farm pump devices",
      );
    }

    const updatedAt = now().toISOString();
    const result = store.updateFarmControlProfile({
      schemaVersion: "smartfarm.farm-control-profile.v1",
      farmId: farm.id,
      revision: body.data.expectedRevision + 1,
      widgets: body.data.widgets,
      updatedAt,
    }, body.data.expectedRevision);

    if (result.kind === "conflict") {
      return sendError(reply, 409, "conflict", result.reason);
    }

    return FarmControlProfileResponseSchema.parse({
      schemaVersion: "smartfarm.farm-control-profile-response.v1",
      controlProfile: result.profile,
    });
  });

  app.post("/v1/farms/:farmId/commands", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const body = CreatePumpCommandRequestSchema.safeParse(request.body);
    if (!body.success) return sendValidationError(reply, body.error.issues);
    if (store.getDevice(params.data.farmId, body.data.deviceId) === null) {
      return sendError(reply, 404, "not_found", "Device not found");
    }

    const issuedAt = now();
    const command = CommandSchema.parse({
      schemaVersion: "smartfarm.command.v1",
      id: createCommandId(),
      farmId: params.data.farmId,
      deviceId: body.data.deviceId,
      payload: { action: "set_pump_state", state: body.data.state },
      actor: { type: "user", id: principal.id },
      idempotencyKey: body.data.idempotencyKey,
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + body.data.ttlSeconds * 1_000).toISOString(),
    });
    const result = store.createCommand(command, issuedAt.toISOString());

    if (result.kind === "conflict") {
      return sendError(reply, 409, "conflict", result.reason);
    }

    return reply
      .code(result.kind === "created" ? 202 : 200)
      .send(CommandProjectionSchema.parse(result.projection));
  });

  app.get("/v1/farms/:farmId/commands/:commandId", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = CommandPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;

    const projection = store.getCommand(params.data.commandId);
    if (projection === null || projection.command.farmId !== params.data.farmId) {
      return sendError(reply, 404, "not_found", "Command not found");
    }

    return CommandProjectionSchema.parse(projection);
  });

  app.get("/v1/farms/:farmId/commands", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const query = CommandListQuerySchema.safeParse(request.query);
    if (!query.success) return sendValidationError(reply, query.error.issues);
    if (
      query.data.deviceId !== undefined
      && store.getDevice(params.data.farmId, query.data.deviceId) === null
    ) {
      return sendError(reply, 404, "not_found", "Device not found");
    }

    const options = {
      limit: query.data.limit,
      ...(query.data.deviceId === undefined ? {} : { deviceId: query.data.deviceId }),
    };

    return CommandListResponseSchema.parse({
      schemaVersion: "smartfarm.command-list.v1",
      commands: store.listCommands(params.data.farmId, options),
    });
  });

  app.get("/v1/farms/:farmId/edge/commands/next", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["edge"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;

    const query = NextCommandQuerySchema.safeParse(request.query);
    if (!query.success) return sendValidationError(reply, query.error.issues);
    if (!requireEdgeDevice(principal, params.data.farmId, query.data.deviceId, reply)) return reply;

    const projection = store.nextPendingCommand(params.data.farmId, query.data.deviceId);
    if (projection === null) return reply.code(204).send();

    return PendingCommandResponseSchema.parse({
      schemaVersion: "smartfarm.pending-command.v1",
      command: projection.command,
    });
  });

  app.get("/v1/farms/:farmId/edge/commands/next-stop", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["edge"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;

    const query = NextCommandQuerySchema.safeParse(request.query);
    if (!query.success) return sendValidationError(reply, query.error.issues);
    if (!requireEdgeDevice(principal, params.data.farmId, query.data.deviceId, reply)) return reply;

    const projection = store.nextPendingStopCommand(params.data.farmId, query.data.deviceId);
    if (projection === null) return reply.code(204).send();

    return PendingCommandResponseSchema.parse({
      schemaVersion: "smartfarm.pending-command.v1",
      command: projection.command,
    });
  });

  app.post("/v1/farms/:farmId/command-acks", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["edge"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;

    const ack = CommandAckSchema.safeParse(request.body);
    if (!ack.success) return sendValidationError(reply, ack.error.issues);
    if (ack.data.farmId !== params.data.farmId) {
      return sendError(
        reply,
        403,
        "forbidden",
        "Acknowledgement farm scope does not match route",
      );
    }
    if (!requireEdgeDevice(principal, params.data.farmId, ack.data.deviceId, reply)) return reply;

    const result = store.applyAck(ack.data, now().toISOString());

    switch (result.kind) {
      case "not_found":
        return sendError(reply, 404, "not_found", "Command not found");
      case "conflict":
        return sendError(reply, 409, "conflict", result.reason);
      case "applied":
      case "replayed":
        return reply.code(200).send(CommandProjectionSchema.parse(result.projection));
      default:
        return assertNever(result);
    }
  });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled result: ${JSON.stringify(value)}`);
}

function buildDefaultFarmControlProfile(
  farm: Farm,
  devices: readonly Device[],
): FarmControlProfile {
  return {
    schemaVersion: "smartfarm.farm-control-profile.v1",
    farmId: farm.id,
    revision: 0,
    widgets: devices
      .filter((device) => device.capabilities.includes("pump"))
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, 16)
      .map((device) => ({
        schemaVersion: "smartfarm.farm-control-widget.v1",
        kind: "pump_control",
        deviceId: device.id,
        label: device.name,
        showStart: true,
      })),
    updatedAt: farm.createdAt,
  };
}

function widgetsTargetSameFarmPumpDevices(
  farmId: FarmId,
  widgets: FarmControlProfile["widgets"],
  store: ApiModuleContext["store"],
): boolean {
  return widgets.every((widget) => {
    const device = store.getDevice(farmId, widget.deviceId);
    return device !== null && device.capabilities.includes("pump");
  });
}
