import type { Device, Farm } from "@smartfarm-os/contracts";

export type GatewayEnrollmentView = {
  readonly id: string;
  readonly status: "pending" | "expired" | "exchanged" | "revoked";
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly exchangedAt: string | null;
};

export type GatewayCredentialView = {
  readonly id: string;
  readonly status: "active" | "revoked";
  readonly createdAt: string;
  readonly revokedAt: string | null;
};

export type GatewayAccessView = {
  readonly farmId: Farm["id"];
  readonly deviceId: Device["id"];
  readonly enrollments: readonly GatewayEnrollmentView[];
  readonly credentials: readonly GatewayCredentialView[];
};

export type IssuedGatewayEnrollment = {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: string;
};
