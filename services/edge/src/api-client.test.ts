import assert from "node:assert/strict";
import test from "node:test";
import {
  CommandAckSchema,
  CommandProjectionSchema,
  CommandSchema,
  TelemetryReceiptSchema,
  TelemetrySchema,
} from "@smartfarm-os/contracts";
import {
  CentralApiClient,
  CentralApiClientError,
  EdgeTransportError,
  FetchApiRequestExecutor,
  type ApiRequest,
  type ApiRequestExecutor,
  type ApiResponse,
} from "./api-client.js";

class FakeExecutor implements ApiRequestExecutor {
  readonly requests: ApiRequest[] = [];

  constructor(private readonly responses: ApiResponse[]) {}

  async execute(request: ApiRequest): Promise<ApiResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    if (response === undefined) throw new Error("Fake response queue is empty");
    return response;
  }
}

function telemetry() {
  return TelemetrySchema.parse({
    schemaVersion: "smartfarm.telemetry.v1",
    id: "telemetry:bed-1-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    metric: "temperature",
    value: 24.5,
    unit: "celsius",
    sequence: 1,
    observedAt: "2026-07-17T00:00:10.000Z",
  });
}

function command() {
  return CommandSchema.parse({
    schemaVersion: "smartfarm.command.v1",
    id: "command:pump-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    payload: { action: "set_pump_state", state: "on" },
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "demo-pump-000001",
    issuedAt: "2026-07-17T00:00:00.000Z",
    expiresAt: "2026-07-17T00:01:00.000Z",
  });
}

test("submits scoped telemetry and accepts both receipt status codes", async () => {
  const receipt = TelemetryReceiptSchema.parse({
    schemaVersion: "smartfarm.telemetry-receipt.v1",
    status: "accepted",
    telemetryId: telemetry().id,
    acceptedAt: "2026-07-17T00:00:10.000Z",
  });
  const executor = new FakeExecutor([{ statusCode: 202, body: receipt }]);
  const client = new CentralApiClient(executor);

  const result = await client.submitTelemetry("farm:demo", telemetry());

  assert.deepEqual(result, receipt);
  assert.deepEqual(executor.requests, [{
    method: "POST",
    path: "/v1/farms/farm%3Ademo/telemetry",
    body: telemetry(),
  }]);
});

test("pulls a pending command and represents an empty queue as null", async () => {
  const pending = {
    schemaVersion: "smartfarm.pending-command.v1",
    command: command(),
  };
  const executor = new FakeExecutor([
    { statusCode: 204, body: null },
    { statusCode: 200, body: pending },
  ]);
  const client = new CentralApiClient(executor);

  assert.equal(await client.pullNextCommand("farm:demo", "device:bed-1"), null);
  assert.deepEqual(
    await client.pullNextCommand("farm:demo", "device:bed-1"),
    command(),
  );
  assert.equal(
    executor.requests[0]?.path,
    "/v1/farms/farm%3Ademo/edge/commands/next?deviceId=device%3Abed-1",
  );
});

test("pulls the independent pending stop lane with the same strict response contract", async () => {
  const stop = command();
  const pending = {
    schemaVersion: "smartfarm.pending-command.v1",
    command: {
      ...stop,
      payload: { action: "set_pump_state", state: "off" },
    },
  };
  const executor = new FakeExecutor([
    { statusCode: 204, body: null },
    { statusCode: 200, body: pending },
  ]);
  const client = new CentralApiClient(executor);

  assert.equal(await client.pullNextStopCommand("farm:demo", "device:bed-1"), null);
  assert.deepEqual(
    await client.pullNextStopCommand("farm:demo", "device:bed-1"),
    pending.command,
  );
  assert.equal(
    executor.requests[1]?.path,
    "/v1/farms/farm%3Ademo/edge/commands/next-stop?deviceId=device%3Abed-1",
  );
});

test("submits a terminal acknowledgement and validates its projection", async () => {
  const ack = CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: command().id,
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: "on" },
    processedAt: "2026-07-17T00:00:10.000Z",
  });
  const projection = CommandProjectionSchema.parse({
    schemaVersion: "smartfarm.command-projection.v1",
    command: command(),
    status: "acknowledged",
    ack,
    updatedAt: "2026-07-17T00:00:10.000Z",
  });
  const executor = new FakeExecutor([{ statusCode: 200, body: projection }]);

  const result = await new CentralApiClient(executor).submitAck("farm:demo", ack);

  assert.deepEqual(result, projection);
  assert.equal(executor.requests[0]?.path, "/v1/farms/farm%3Ademo/command-acks");
});

test("normalizes a versioned API error without copying its message into Error.message", async () => {
  const executor = new FakeExecutor([{
    statusCode: 403,
    body: {
      schemaVersion: "smartfarm.error.v1",
      code: "forbidden",
      message: "Remote detail stays in the typed field",
    },
  }]);
  const client = new CentralApiClient(executor);

  await assert.rejects(
    client.pullNextCommand("farm:demo", "device:bed-1"),
    (error: unknown) => {
      assert.ok(error instanceof CentralApiClientError);
      assert.equal(error.statusCode, 403);
      assert.equal(error.code, "forbidden");
      assert.equal(error.message.includes("Remote detail"), false);
      return true;
    },
  );
});

test("rejects successful responses that violate the runtime contract", async () => {
  const executor = new FakeExecutor([{
    statusCode: 200,
    body: { schemaVersion: "unexpected" },
  }]);

  await assert.rejects(
    new CentralApiClient(executor).pullNextCommand("farm:demo", "device:bed-1"),
    (error: unknown) => error instanceof EdgeTransportError
      && error.code === "invalid_response",
  );
});

test("rejects credentials in base URLs and cross-origin request syntax", async () => {
  assert.throws(
    () => new FetchApiRequestExecutor({ baseUrl: "https://user:pass@example.test" }),
    (error: unknown) => error instanceof EdgeTransportError
      && error.code === "invalid_configuration",
  );
  assert.throws(
    () => new FetchApiRequestExecutor({ baseUrl: "https://example.test/api" }),
    (error: unknown) => error instanceof EdgeTransportError
      && error.code === "invalid_configuration",
  );

  const executor = new FetchApiRequestExecutor({ baseUrl: "https://example.test" });
  await assert.rejects(
    executor.execute({ method: "GET", path: "//other.example.test/v1" }),
    (error: unknown) => error instanceof EdgeTransportError
      && error.code === "invalid_request",
  );
});
