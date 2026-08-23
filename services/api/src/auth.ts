import type { DeviceId, FarmId } from "@smartfarm-os/contracts";
import type { FastifyRequest } from "fastify";

export type AuthRole = "user" | "edge" | "admin";

type BaseAuthPrincipal<Role extends AuthRole> = {
  readonly id: string;
  readonly role: Role;
  readonly farmIds: readonly FarmId[];
};

export type EdgeDeviceScope = {
  readonly farmId: FarmId;
  readonly deviceId: DeviceId;
};

export type UserAuthPrincipal = BaseAuthPrincipal<"user">;

export type AdminAuthPrincipal = BaseAuthPrincipal<"admin">;

export type EdgeAuthPrincipal = BaseAuthPrincipal<"edge"> & {
  readonly deviceScopes: readonly EdgeDeviceScope[];
};

export type AuthPrincipal = UserAuthPrincipal | AdminAuthPrincipal | EdgeAuthPrincipal;

export type AuthenticateRequest = (
  request: FastifyRequest,
) => AuthPrincipal | null | Promise<AuthPrincipal | null>;
