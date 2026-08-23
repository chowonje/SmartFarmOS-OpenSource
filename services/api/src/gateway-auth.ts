import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import {
  EdgeCredentialKeySchema,
  type EdgeCredentialId,
  type EdgeCredentialKey,
  GatewayEnrollmentTokenSchema,
  type GatewayEnrollmentId,
  type GatewayEnrollmentToken,
} from "@smartfarm-os/contracts";
import type { FastifyRequest } from "fastify";
import type { EdgeAuthPrincipal } from "./auth.js";
import type {
  EdgeCredentialAuthenticationMaterial,
  GatewayEnrollmentAuthenticationMaterial,
  SmartFarmStore,
} from "./store.js";

const OPAQUE_SECRET_BYTES = 32;
const DIGEST_HEX_LENGTH = 64;
export const GATEWAY_ENROLLMENT_TTL_MS = 10 * 60 * 1_000;

export type GatewayEnrollmentTokenSecret = {
  readonly enrollmentToken: GatewayEnrollmentToken;
  readonly tokenDigest: string;
};

export type EdgeCredentialKeySecret = {
  readonly edgeKey: EdgeCredentialKey;
  readonly credentialDigest: string;
};

export type ParsedGatewayEnrollmentToken = {
  readonly enrollmentId: GatewayEnrollmentId;
  readonly tokenDigest: string;
};

export type ParsedEdgeCredentialKey = {
  readonly credentialId: EdgeCredentialId;
  readonly credentialDigest: string;
};

export function createGatewayEnrollmentToken(
  enrollmentId: GatewayEnrollmentId,
): GatewayEnrollmentTokenSecret {
  const secret = createOpaqueSecret();
  return {
    enrollmentToken: GatewayEnrollmentTokenSchema.parse(`${enrollmentId}.${secret}`),
    tokenDigest: digestGatewaySecret("gateway-enrollment", enrollmentId, secret),
  };
}

export function createEdgeCredentialKey(
  credentialId: EdgeCredentialId,
): EdgeCredentialKeySecret {
  const secret = createOpaqueSecret();
  return {
    edgeKey: EdgeCredentialKeySchema.parse(`${credentialId}.${secret}`),
    credentialDigest: digestGatewaySecret("edge-credential", credentialId, secret),
  };
}

export function parseGatewayEnrollmentToken(
  token: string,
): ParsedGatewayEnrollmentToken | null {
  const parsed = GatewayEnrollmentTokenSchema.safeParse(token);
  if (!parsed.success) return null;

  const separatorIndex = parsed.data.indexOf(".");
  return {
    enrollmentId: parsed.data.slice(0, separatorIndex) as GatewayEnrollmentId,
    tokenDigest: digestGatewaySecret(
      "gateway-enrollment",
      parsed.data.slice(0, separatorIndex),
      parsed.data.slice(separatorIndex + 1),
    ),
  };
}

export function parseEdgeCredentialKey(
  key: string,
): ParsedEdgeCredentialKey | null {
  const parsed = EdgeCredentialKeySchema.safeParse(key);
  if (!parsed.success) return null;

  const separatorIndex = parsed.data.indexOf(".");
  return {
    credentialId: parsed.data.slice(0, separatorIndex) as EdgeCredentialId,
    credentialDigest: digestGatewaySecret(
      "edge-credential",
      parsed.data.slice(0, separatorIndex),
      parsed.data.slice(separatorIndex + 1),
    ),
  };
}

export function hasMatchingGatewayDigest(
  storedDigest: string,
  candidateDigest: string,
): boolean {
  if (
    storedDigest.length !== DIGEST_HEX_LENGTH
    || candidateDigest.length !== DIGEST_HEX_LENGTH
    || !isHexDigest(storedDigest)
    || !isHexDigest(candidateDigest)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(storedDigest, "hex"),
    Buffer.from(candidateDigest, "hex"),
  );
}

export function authenticateEdgeBearerCredential(
  request: FastifyRequest,
  store: SmartFarmStore,
): EdgeAuthPrincipal | null {
  const token = readBearerToken(request.headers.authorization);
  if (token === null) return null;

  const parsed = parseEdgeCredentialKey(token);
  if (parsed === null) return null;

  const credential = store.getEdgeCredentialAuthentication(parsed.credentialId);
  if (credential === null || credential.revokedAt !== null) {
    return null;
  }
  if (!hasMatchingGatewayDigest(credential.credentialDigest, parsed.credentialDigest)) {
    return null;
  }

  return edgePrincipalFromCredential(credential);
}

export function authenticateGatewayEnrollmentBearerToken(
  authorizationHeader: string | string[] | undefined,
  store: SmartFarmStore,
): GatewayEnrollmentAuthenticationMaterial | null {
  const token = readBearerToken(authorizationHeader);
  if (token === null) return null;

  const parsed = parseGatewayEnrollmentToken(token);
  if (parsed === null) return null;

  const enrollment = store.getGatewayEnrollmentAuthentication(parsed.enrollmentId);
  if (enrollment === null) return null;
  if (!hasMatchingGatewayDigest(enrollment.tokenDigest, parsed.tokenDigest)) {
    return null;
  }

  return enrollment;
}

function edgePrincipalFromCredential(
  credential: EdgeCredentialAuthenticationMaterial,
): EdgeAuthPrincipal {
  return {
    id: credential.credentialId,
    role: "edge",
    farmIds: [credential.farmId],
    deviceScopes: [{
      farmId: credential.farmId,
      deviceId: credential.deviceId,
    }],
  };
}

function createOpaqueSecret(): string {
  return randomBytes(OPAQUE_SECRET_BYTES)
    .toString("base64url");
}

function digestGatewaySecret(
  kind: "gateway-enrollment" | "edge-credential",
  publicId: string,
  secret: string,
): string {
  return createHash("sha256")
    .update(kind)
    .update("\u0000")
    .update(publicId)
    .update("\u0000")
    .update(secret)
    .digest("hex");
}

function readBearerToken(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  const header = Array.isArray(value) ? value[0] : value;
  if (header === undefined) return null;

  const match = /^Bearer ([A-Za-z0-9:._-]+)$/u.exec(header);
  return match?.[1] ?? null;
}

function isHexDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}
