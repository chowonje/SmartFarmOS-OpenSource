import {
  GatewayEnrollmentExchangeRequestSchema,
  GatewayEnrollmentExchangeResponseSchema,
  GatewayEnrollmentTokenSchema,
  type DeviceId,
  type EdgeCredentialKey,
  type EdgeCredentialRecord,
  type FarmId,
} from "@smartfarm-os/contracts";
import {
  CentralApiClientError,
  type ApiRequestExecutor,
} from "./api-client.js";
import { type EdgeAgentConfig } from "./agent-config.js";

export type EdgeEnrollmentResult = {
  readonly credential: EdgeCredentialRecord;
  readonly edgeKey: EdgeCredentialKey;
};

export type EnrollmentClientOptions = {
  readonly path?: string;
};

export class EdgeEnrollmentClient {
  private readonly path: string;

  constructor(
    private readonly executor: ApiRequestExecutor,
    options: EnrollmentClientOptions = {},
  ) {
    this.path = options.path ?? "/v1/gateway-enrollments/exchange";
  }

  async exchangeToken(
    config: Pick<EdgeAgentConfig, "farmId" | "deviceId">,
    enrollmentToken: string,
  ): Promise<EdgeEnrollmentResult> {
    const token = GatewayEnrollmentTokenSchema.parse(enrollmentToken.trim());
    const tokenSeparatorIndex = token.indexOf(".");
    const expectedEnrollmentId = token.slice(0, tokenSeparatorIndex);

    const response = await this.executor.execute({
      method: "POST",
      path: this.path,
      headers: {
        authorization: `Bearer ${token}`,
      },
      body: GatewayEnrollmentExchangeRequestSchema.parse({}),
    });

    if (response.statusCode !== 200 && response.statusCode !== 201) {
      throwEnrollmentApiError(response.statusCode, response.body);
    }

    return parseEnrollmentResponse(response.body, {
      expectedFarmId: config.farmId,
      expectedDeviceId: config.deviceId,
      expectedEnrollmentId,
    });
  }
}

export function parseEnrollmentResponse(
  input: unknown,
  options: {
    readonly expectedFarmId: FarmId;
    readonly expectedDeviceId: DeviceId;
    readonly expectedEnrollmentId?: string;
  },
): EdgeEnrollmentResult {
  const parsed = GatewayEnrollmentExchangeResponseSchema.parse(input);
  if (
    parsed.credential.farmId !== options.expectedFarmId
    || parsed.credential.deviceId !== options.expectedDeviceId
  ) {
    throw new Error("Enrollment response farm/device scope does not match this gateway");
  }
  if (parsed.credential.status !== "active") {
    throw new Error("Enrollment response credential is not active");
  }
  if (
    options.expectedEnrollmentId !== undefined
    && parsed.credential.createdFromEnrollmentId !== options.expectedEnrollmentId
  ) {
    throw new Error("Enrollment response does not match the submitted enrollment token");
  }
  if (parsed.edgeKey.slice(0, parsed.edgeKey.indexOf(".")) !== parsed.credential.id) {
    throw new Error("Enrollment response credential and edge key IDs do not match");
  }
  return parsed;
}

function throwEnrollmentApiError(statusCode: number, body: unknown): never {
  const code = isRecord(body) && typeof body.code === "string"
    ? body.code
    : "enrollment_failed";
  throw new CentralApiClientError(statusCode, code);
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}
