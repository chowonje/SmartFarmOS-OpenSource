import assert from "node:assert/strict";
import test from "node:test";
import {
  DeviceIdSchema,
  EdgeCredentialRecordSchema,
  FarmIdSchema,
  GatewayEnrollmentExchangeRequestSchema,
} from "@smartfarm-os/contracts";
import {
  CentralApiClientError,
  type ApiRequest,
  type ApiRequestExecutor,
  type ApiResponse,
} from "./api-client.js";
import { EdgeEnrollmentClient, parseEnrollmentResponse } from "./enrollment-client.js";

const opaqueSecret = "a".repeat(43);
const enrollmentToken = `gateway-enrollment:demo-enroll.${opaqueSecret}`;
const edgeKey = `edge-credential:demo-edge.${opaqueSecret}`;

class FakeExecutor implements ApiRequestExecutor {
  readonly requests: ApiRequest[] = [];

  constructor(private readonly responses: ApiResponse[]) {}

  async execute(request: ApiRequest): Promise<ApiResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) throw new Error("Missing fake enrollment response");
    return response;
  }
}

test("exchanges a token for a server-returned edge credential", async () => {
  const executor = new FakeExecutor([{
    statusCode: 201,
    body: {
      schemaVersion: "smartfarm.gateway-enrollment-exchange-response.v1",
      credential: EdgeCredentialRecordSchema.parse({
        schemaVersion: "smartfarm.edge-credential-record.v1",
        id: "edge-credential:demo-edge",
        farmId: "farm:demo",
        deviceId: "device:bed-1",
        status: "active",
        createdFromEnrollmentId: "gateway-enrollment:demo-enroll",
        createdAt: "2026-08-12T00:00:00.000Z",
        revokedAt: null,
        revokedByActorId: null,
      }),
      edgeKey,
    },
  }]);
  const client = new EdgeEnrollmentClient(executor, { path: "/v1/enroll" });

  const result = await client.exchangeToken({
    farmId: FarmIdSchema.parse("farm:demo"),
    deviceId: DeviceIdSchema.parse("device:bed-1"),
  }, `  ${enrollmentToken}  `);

  assert.equal(result.credential.id, "edge-credential:demo-edge");
  assert.equal(result.edgeKey, edgeKey);
  assert.deepEqual(executor.requests, [{
    method: "POST",
    path: "/v1/enroll",
    headers: {
      authorization: `Bearer ${enrollmentToken}`,
    },
    body: GatewayEnrollmentExchangeRequestSchema.parse({}),
  }]);
});

test("rejects mismatched enrollment scope", () => {
  assert.throws(
    () => parseEnrollmentResponse({
      schemaVersion: "smartfarm.gateway-enrollment-exchange-response.v1",
      credential: {
        schemaVersion: "smartfarm.edge-credential-record.v1",
        id: "edge-credential:demo-edge",
        farmId: "farm:other",
        deviceId: "device:bed-1",
        status: "active",
        createdFromEnrollmentId: "gateway-enrollment:demo-enroll",
        createdAt: "2026-08-12T00:00:00.000Z",
        revokedAt: null,
        revokedByActorId: null,
      },
      edgeKey,
    }, {
      expectedFarmId: FarmIdSchema.parse("farm:demo"),
      expectedDeviceId: DeviceIdSchema.parse("device:bed-1"),
    }),
    /does not match this gateway/,
  );
});

test("rejects a response for another enrollment or edge key ID", () => {
  const baseResponse = {
    schemaVersion: "smartfarm.gateway-enrollment-exchange-response.v1",
    credential: {
      schemaVersion: "smartfarm.edge-credential-record.v1",
      id: "edge-credential:demo-edge",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      status: "active",
      createdFromEnrollmentId: "gateway-enrollment:other-enroll",
      createdAt: "2026-08-12T00:00:00.000Z",
      revokedAt: null,
      revokedByActorId: null,
    },
    edgeKey,
  };
  const options = {
    expectedFarmId: FarmIdSchema.parse("farm:demo"),
    expectedDeviceId: DeviceIdSchema.parse("device:bed-1"),
    expectedEnrollmentId: "gateway-enrollment:demo-enroll",
  };

  assert.throws(
    () => parseEnrollmentResponse(baseResponse, options),
    /submitted enrollment token/,
  );
  assert.throws(
    () => parseEnrollmentResponse({
      ...baseResponse,
      credential: {
        ...baseResponse.credential,
        createdFromEnrollmentId: "gateway-enrollment:demo-enroll",
      },
      edgeKey: `edge-credential:other-edge.${opaqueSecret}`,
    }, options),
    /key IDs do not match/,
  );
});

test("normalizes enrollment API failures without copying remote messages", async () => {
  const client = new EdgeEnrollmentClient(new FakeExecutor([{
    statusCode: 409,
    body: {
      schemaVersion: "smartfarm.error.v1",
      code: "conflict",
      message: "Used token",
    },
  }]));

  await assert.rejects(
    client.exchangeToken({
      farmId: FarmIdSchema.parse("farm:demo"),
      deviceId: DeviceIdSchema.parse("device:bed-1"),
    }, enrollmentToken),
    (error: unknown) => error instanceof CentralApiClientError
      && error.statusCode === 409
      && error.code === "conflict"
      && error.message.includes("Used token") === false,
  );
});
