import {
  ApiErrorSchema,
  DeviceGatewayPathParamsSchema,
  DeviceListResponseSchema,
  EdgeCredentialPathParamsSchema,
  FarmIdSchema,
  FarmListResponseSchema,
  GatewayAccessListQuerySchema,
  GatewayAccessListResponseSchema,
  GatewayEnrollmentPathParamsSchema,
  IssueGatewayEnrollmentRequestSchema,
  IssueGatewayEnrollmentResponseSchema,
  RevokeEdgeCredentialRequestSchema,
  RevokeEdgeCredentialResponseSchema,
  RevokeGatewayEnrollmentRequestSchema,
  RevokeGatewayEnrollmentResponseSchema,
  type Device,
  type Farm,
} from "@smartfarm-os/contracts";
import type {
  GatewayAccessView,
  IssuedGatewayEnrollment,
} from "../gateway-admin-model";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1_024 * 1_024;

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type AdminGatewayApiErrorKind =
  | "http"
  | "invalid_configuration"
  | "invalid_response"
  | "network"
  | "timeout";

export class AdminGatewayApiError extends Error {
  override readonly name = "AdminGatewayApiError";

  constructor(
    readonly kind: AdminGatewayApiErrorKind,
    message: string,
    readonly statusCode: number | null = null,
    readonly apiCode: string | null = null,
  ) {
    super(message);
  }
}

export type AdminGatewayApiOptions = {
  readonly baseUrl: string;
  readonly fetchImplementation?: FetchImplementation;
  readonly timeoutMs?: number;
};

export class AdminGatewayApi {
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly timeoutMs: number;

  constructor(options: AdminGatewayApiOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImplementation = options.fetchImplementation
      ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = parsePositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
  }

  async listFarms(): Promise<readonly Farm[]> {
    const body = await this.request("/v1/farms");
    return parseResponse(FarmListResponseSchema, body).farms;
  }

  async listDevices(farmIdInput: string): Promise<readonly Device[]> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const body = await this.request(`/v1/farms/${encodeURIComponent(farmId)}/devices`);
    return parseResponse(DeviceListResponseSchema, body).devices;
  }

  async gatewayAccess(
    farmIdInput: string,
    deviceIdInput: string,
    limitInput = 50,
  ): Promise<GatewayAccessView> {
    const { farmId, deviceId } = DeviceGatewayPathParamsSchema.parse({
      farmId: farmIdInput,
      deviceId: deviceIdInput,
    });
    const { limit } = GatewayAccessListQuerySchema.parse({ limit: limitInput });
    const body = await this.request(
      `/v1/admin/farms/${encodeURIComponent(farmId)}/devices/${encodeURIComponent(deviceId)}/gateway-access?limit=${limit}`,
    );
    const response = parseResponse(GatewayAccessListResponseSchema, body);
    return {
      farmId,
      deviceId,
      enrollments: response.enrollments.map((enrollment) => ({
        id: enrollment.id,
        status: enrollment.status,
        issuedAt: enrollment.issuedAt,
        expiresAt: enrollment.expiresAt,
        exchangedAt: enrollment.exchangedAt,
      })),
      credentials: response.credentials.map((credential) => ({
        id: credential.id,
        status: credential.status,
        createdAt: credential.createdAt,
        revokedAt: credential.revokedAt,
      })),
    };
  }

  async issueEnrollment(
    farmIdInput: string,
    deviceIdInput: string,
  ): Promise<IssuedGatewayEnrollment> {
    const { farmId, deviceId } = DeviceGatewayPathParamsSchema.parse({
      farmId: farmIdInput,
      deviceId: deviceIdInput,
    });
    const request = IssueGatewayEnrollmentRequestSchema.parse({});
    const body = await this.request(
      `/v1/admin/farms/${encodeURIComponent(farmId)}/devices/${encodeURIComponent(deviceId)}/gateway-enrollments`,
      { method: "POST", body: JSON.stringify(request) },
    );
    const response = parseResponse(IssueGatewayEnrollmentResponseSchema, body);
    return {
      id: response.enrollment.id,
      token: response.enrollmentToken,
      expiresAt: response.enrollment.expiresAt,
    };
  }

  async revokeCredential(
    farmIdInput: string,
    deviceIdInput: string,
    credentialIdInput: string,
  ): Promise<void> {
    const { farmId, deviceId, credentialId } = EdgeCredentialPathParamsSchema.parse({
      farmId: farmIdInput,
      deviceId: deviceIdInput,
      credentialId: credentialIdInput,
    });
    const request = RevokeEdgeCredentialRequestSchema.parse({});
    const body = await this.request(
      `/v1/admin/farms/${encodeURIComponent(farmId)}/devices/${encodeURIComponent(deviceId)}/edge-credentials/${encodeURIComponent(credentialId)}/revocations`,
      { method: "POST", body: JSON.stringify(request) },
    );
    parseResponse(RevokeEdgeCredentialResponseSchema, body);
  }

  async revokeEnrollment(
    farmIdInput: string,
    deviceIdInput: string,
    enrollmentIdInput: string,
  ): Promise<void> {
    const { farmId, deviceId, enrollmentId } = GatewayEnrollmentPathParamsSchema.parse({
      farmId: farmIdInput,
      deviceId: deviceIdInput,
      enrollmentId: enrollmentIdInput,
    });
    const request = RevokeGatewayEnrollmentRequestSchema.parse({});
    const body = await this.request(
      `/v1/admin/farms/${encodeURIComponent(farmId)}/devices/${encodeURIComponent(deviceId)}/gateway-enrollments/${encodeURIComponent(enrollmentId)}/revocations`,
      { method: "POST", body: JSON.stringify(request) },
    );
    parseResponse(RevokeGatewayEnrollmentResponseSchema, body);
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined) headers.set("content-type", "application/json");

    let response: Response;
    try {
      response = await this.fetchImplementation(joinUrl(this.baseUrl, path), {
        ...init,
        cache: "no-store",
        credentials: "same-origin",
        headers,
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AdminGatewayApiError("timeout", "Admin API request timed out");
      }
      throw new AdminGatewayApiError(
        "network",
        error instanceof Error ? error.message : "Admin API request failed",
      );
    } finally {
      clearTimeout(timeout);
    }

    const body = await readBoundedJson(response);
    if (!response.ok) {
      const apiError = ApiErrorSchema.safeParse(body);
      if (!apiError.success) {
        throw new AdminGatewayApiError(
          "invalid_response",
          "Admin API error response did not match the contract",
          response.status,
        );
      }
      throw new AdminGatewayApiError(
        "http",
        apiError.data.message,
        response.status,
        apiError.data.code,
      );
    }
    return body;
  }
}

function normalizeBaseUrl(value: string): string {
  const baseUrl = value.trim().replace(/\/+$/, "");
  if (baseUrl === "") {
    throw new AdminGatewayApiError("invalid_configuration", "API base URL cannot be empty");
  }
  if (
    !baseUrl.startsWith("/")
    || baseUrl.startsWith("//")
    || baseUrl.includes("?")
    || baseUrl.includes("#")
    || baseUrl.split("/").includes("..")
  ) {
    throw new AdminGatewayApiError(
      "invalid_configuration",
      "Admin API base URL must be a same-origin path",
    );
  }
  return baseUrl;
}

function joinUrl(baseUrl: string, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new AdminGatewayApiError(
      "invalid_configuration",
      "API request path must be origin-relative",
    );
  }
  return `${baseUrl}${path}`;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_BYTES) {
    throw new AdminGatewayApiError("invalid_response", "Admin API response was too large");
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new AdminGatewayApiError("invalid_response", "Admin API response was too large");
  }
  if (text.trim() === "") return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AdminGatewayApiError("invalid_response", "Admin API response was not valid JSON");
  }
}

function parseResponse<T>(
  schema: { readonly safeParse: (input: unknown) => { success: true; data: T } | { success: false } },
  body: unknown,
): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AdminGatewayApiError(
      "invalid_response",
      "Admin API response did not match the expected contract",
    );
  }
  return result.data;
}

function parsePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AdminGatewayApiError(
      "invalid_configuration",
      `${label} must be a positive integer`,
    );
  }
  return value;
}
