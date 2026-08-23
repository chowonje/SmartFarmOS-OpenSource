import {
  AcknowledgeAlarmRequestSchema,
  AlarmListQuerySchema,
  AlarmListResponseSchema,
  AlarmPathParamsSchema,
  AlarmResponseSchema,
  AuditEventListQuerySchema,
  AuditEventListResponseSchema,
  FarmPathParamsSchema,
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

export function registerAlarmCenterModule(context: ApiModuleContext): void {
  const { app, authenticate, now, store } = context;

  app.get("/v1/farms/:farmId/alarms", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const query = AlarmListQuerySchema.safeParse(request.query);
    if (!query.success) return sendValidationError(reply, query.error.issues);
    if (
      query.data.cycleId !== undefined
      && store.getCropCycle(params.data.farmId, query.data.cycleId) === null
    ) {
      return sendError(reply, 404, "not_found", "Crop cycle not found");
    }

    const options = {
      limit: query.data.limit,
      ...(query.data.state === undefined ? {} : { state: query.data.state }),
      ...(query.data.cycleId === undefined ? {} : { cycleId: query.data.cycleId }),
    };

    return AlarmListResponseSchema.parse({
      schemaVersion: "smartfarm.alarm-list.v1",
      alarms: store.listAlarmInstances(params.data.farmId, options),
    });
  });

  app.post("/v1/farms/:farmId/alarms/:alarmId/acknowledgements", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = AlarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const body = AcknowledgeAlarmRequestSchema.safeParse(request.body);
    if (!body.success) return sendValidationError(reply, body.error.issues);

    const result = store.acknowledgeAlarm({
      farmId: params.data.farmId,
      alarmId: params.data.alarmId,
      actor: { type: "user", id: principal.id },
      idempotencyKey: body.data.idempotencyKey,
      acknowledgedAt: now().toISOString(),
    });

    switch (result.kind) {
      case "not_found":
        return sendError(reply, 404, "not_found", "Alarm not found");
      case "conflict":
        return sendError(reply, 409, "conflict", result.reason);
      case "acknowledged":
      case "replayed":
        return reply.code(200).send(AlarmResponseSchema.parse({
          schemaVersion: "smartfarm.alarm-response.v1",
          alarm: result.alarm,
        }));
      default:
        return assertNever(result);
    }
  });

  app.get("/v1/farms/:farmId/audit-events", async (request, reply) => {
    const principal = await requirePrincipal(authenticate, request, reply);
    if (principal === null) return reply;
    if (!requireRole(principal, ["user", "admin"], reply)) return reply;

    const params = FarmPathParamsSchema.safeParse(request.params);
    if (!params.success) return sendValidationError(reply, params.error.issues);
    if (!requireFarm(principal, params.data.farmId, reply)) return reply;
    if (!requireStoredFarm(store, params.data.farmId, reply)) return reply;

    const query = AuditEventListQuerySchema.safeParse(request.query);
    if (!query.success) return sendValidationError(reply, query.error.issues);
    if (
      query.data.cycleId !== undefined
      && store.getCropCycle(params.data.farmId, query.data.cycleId) === null
    ) {
      return sendError(reply, 404, "not_found", "Crop cycle not found");
    }

    const options = {
      limit: query.data.limit,
      includeUnscoped: query.data.includeUnscoped,
      ...(query.data.cycleId === undefined ? {} : { cycleId: query.data.cycleId }),
    };

    return AuditEventListResponseSchema.parse({
      schemaVersion: "smartfarm.audit-event-list.v1",
      auditEvents: store.listAuditEvents(params.data.farmId, options),
    });
  });
}

function assertNever(value: never): never {
  throw new Error(`Unhandled result: ${JSON.stringify(value)}`);
}
