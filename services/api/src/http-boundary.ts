import {
  ApiErrorSchema,
  DeviceIdSchema,
  FarmIdSchema,
  type ApiErrorCode,
  type DeviceId,
  type FarmId,
} from "@smartfarm-os/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import type {
  AuthPrincipal,
  AuthRole,
  AuthenticateRequest,
  EdgeAuthPrincipal,
  EdgeDeviceScope,
} from "./auth.js";
import type { SmartFarmStore } from "./store.js";

export async function requirePrincipal(
  authenticate: AuthenticateRequest,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthPrincipal | null> {
  let principal: unknown;

  try {
    principal = await authenticate(request);
  } catch {
    sendError(reply, 500, "internal_error", "Authentication service failed");
    return null;
  }

  if (principal === null) {
    sendError(reply, 401, "unauthorized", "Authentication is required");
    return null;
  }

  if (!isValidPrincipal(principal)) {
    sendError(reply, 500, "internal_error", "Authentication service returned invalid context");
    return null;
  }

  return principal;
}

export function requireRole(
  principal: AuthPrincipal,
  allowed: readonly AuthRole[],
  reply: FastifyReply,
): boolean {
  if (!allowed.includes(principal.role)) {
    sendError(reply, 403, "forbidden", "Principal role cannot perform this action");
    return false;
  }

  return true;
}

export function requireFarm(
  principal: AuthPrincipal,
  farmId: FarmId,
  reply: FastifyReply,
): boolean {
  if (!principal.farmIds.includes(farmId)) {
    sendError(reply, 403, "forbidden", "Principal cannot access this farm");
    return false;
  }

  return true;
}

export function requireEdgeDevice(
  principal: AuthPrincipal,
  farmId: FarmId,
  deviceId: DeviceId,
  reply: FastifyReply,
): principal is EdgeAuthPrincipal {
  if (principal.role !== "edge") {
    sendError(reply, 403, "forbidden", "Principal role cannot perform this action");
    return false;
  }

  if (!principal.deviceScopes.some((scope) => scope.farmId === farmId && scope.deviceId === deviceId)) {
    sendError(reply, 403, "forbidden", "Principal cannot access this device");
    return false;
  }

  return true;
}

export function requireStoredFarm(
  store: SmartFarmStore,
  farmId: FarmId,
  reply: FastifyReply,
): boolean {
  if (store.getFarm(farmId) === null) {
    sendError(reply, 404, "not_found", "Farm not found");
    return false;
  }

  return true;
}

export function sendValidationError(
  reply: FastifyReply,
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
): FastifyReply {
  return sendError(
    reply,
    400,
    "invalid_request",
    "Request validation failed",
    issues.slice(0, 20).map((issue) => ({
      path: issue.path.length === 0 ? "$" : issue.path.map(String).join("."),
      message: issue.message,
    })),
  );
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: ApiErrorCode,
  message: string,
  issues?: readonly { readonly path: string; readonly message: string }[],
): FastifyReply {
  const body = ApiErrorSchema.parse({
    schemaVersion: "smartfarm.error.v1",
    code,
    message,
    ...(issues === undefined ? {} : { issues }),
  });
  return reply.code(statusCode).send(body);
}

function isValidPrincipal(principal: unknown): principal is AuthPrincipal {
  if (!isRecord(principal)) {
    return false;
  }

  const { farmIds, id, role } = principal;
  if (
    typeof id !== "string"
    || id.trim().length === 0
    || (role !== "user" && role !== "edge" && role !== "admin")
    || !Array.isArray(farmIds)
    || farmIds.length === 0
    || !farmIds.every((farmId) => FarmIdSchema.safeParse(farmId).success)
  ) {
    return false;
  }

  if (role === "edge") {
    return isValidEdgePrincipal(principal, farmIds);
  }

  return !hasOwn(principal, "deviceScopes");
}

function isValidEdgePrincipal(
  principal: Record<PropertyKey, unknown>,
  farmIds: readonly FarmId[],
): principal is EdgeAuthPrincipal {
  if (
    !hasOwn(principal, "deviceScopes")
    || !Array.isArray(principal.deviceScopes)
    || principal.deviceScopes.length === 0
  ) {
    return false;
  }

  const seen = new Set<string>();

  for (const scope of principal.deviceScopes) {
    if (!isValidEdgeDeviceScope(scope)) {
      return false;
    }
    if (!farmIds.includes(scope.farmId)) {
      return false;
    }

    const key = `${scope.farmId}\u0000${scope.deviceId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
  }

  return true;
}

function isValidEdgeDeviceScope(scope: unknown): scope is EdgeDeviceScope {
  return isRecord(scope)
    && FarmIdSchema.safeParse(scope.farmId).success
    && DeviceIdSchema.safeParse(scope.deviceId).success;
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOwn<Key extends PropertyKey>(
  value: Record<PropertyKey, unknown>,
  key: Key,
): value is Record<Key, unknown> & Record<PropertyKey, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}
