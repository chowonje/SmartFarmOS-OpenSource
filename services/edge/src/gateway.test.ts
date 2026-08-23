import assert from "node:assert/strict";
import test from "node:test";
import {
  CommandAckSchema,
  CommandProjectionSchema,
  CommandSchema,
  TelemetryReceiptSchema,
  TelemetrySchema,
  commandExpectedFinalPumpState,
  type Command,
  type CommandAck,
  type CommandProjection,
  type DeviceId,
  type FarmId,
  type Telemetry,
  type TelemetryReceipt,
} from "@smartfarm-os/contracts";
import {
  EdgeGateway,
  EdgeGatewayValidationError,
  type CentralApiPort,
} from "./gateway.js";
import { InMemoryEdgeExecutionRepository } from "./execution-repository.js";

class FakeApi implements CentralApiPort {
  readonly telemetryWrites: Telemetry[] = [];
  readonly acknowledgements: CommandAck[] = [];
  pullCalls = 0;
  stopPullCalls = 0;

  constructor(
    readonly next: unknown | null,
    readonly nextStop: unknown | null = null,
  ) {}

  async submitTelemetry(_farmId: FarmId, telemetry: Telemetry): Promise<TelemetryReceipt> {
    this.telemetryWrites.push(telemetry);
    return TelemetryReceiptSchema.parse({
      schemaVersion: "smartfarm.telemetry-receipt.v1",
      status: "accepted",
      telemetryId: telemetry.id,
      acceptedAt: "2026-07-17T00:00:10.000Z",
    });
  }

  async pullNextCommand(_farmId: FarmId, _deviceId: DeviceId): Promise<unknown | null> {
    this.pullCalls += 1;
    return this.next;
  }

  async pullNextStopCommand(_farmId: FarmId, _deviceId: DeviceId): Promise<unknown | null> {
    this.stopPullCalls += 1;
    return this.nextStop;
  }

  async submitAck(_farmId: FarmId, ack: CommandAck): Promise<CommandProjection> {
    this.acknowledgements.push(ack);
    const commandInput = [this.next, this.nextStop]
      .map((candidate) => CommandSchema.safeParse(candidate))
      .find((candidate) => candidate.success && candidate.data.id === ack.commandId);
    if (commandInput === undefined || !commandInput.success) {
      throw new Error("Fake command is invalid");
    }

    return projectionFor(commandInput.data, ack);
  }
}

function command(overrides: Record<string, unknown> = {}): Command {
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
    ...overrides,
  });
}

function telemetry(overrides: Record<string, unknown> = {}) {
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
    ...overrides,
  });
}

function acknowledged(commandInput: Command) {
  return CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: commandInput.id,
    farmId: commandInput.farmId,
    deviceId: commandInput.deviceId,
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: commandExpectedFinalPumpState(commandInput) },
    processedAt: "2026-07-17T00:00:10.000Z",
  });
}

function projectionFor(commandInput: Command, ack: CommandAck): CommandProjection {
  return CommandProjectionSchema.parse({
    schemaVersion: "smartfarm.command-projection.v1",
    command: commandInput,
    status: ack.status === "acknowledged"
      ? "acknowledged"
      : ack.status === "timed_out"
        ? "timed_out"
        : "failed",
    ack,
    updatedAt: ack.processedAt,
  });
}

function gateway(api: FakeApi, executeCommand: (input: Command) => unknown) {
  return new EdgeGateway({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    api,
    device: { executeCommand },
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });
}

test("forwards only validated telemetry from the configured farm and device", async () => {
  const api = new FakeApi(null);
  const edge = gateway(api, () => undefined);

  const receipt = await edge.forwardTelemetry(telemetry());
  assert.equal(receipt.status, "accepted");
  assert.equal(api.telemetryWrites.length, 1);

  await assert.rejects(
    edge.forwardTelemetry(telemetry({ deviceId: "device:other" })),
    EdgeGatewayValidationError,
  );
  assert.equal(api.telemetryWrites.length, 1);
});

test("returns idle without touching the device when no command is pending", async () => {
  const api = new FakeApi(null);
  let deviceCalls = 0;

  const result = await gateway(api, () => { deviceCalls += 1; }).processNextCommand();

  assert.deepEqual(result, { kind: "idle" });
  assert.equal(deviceCalls, 0);
  assert.equal(api.acknowledgements.length, 0);
});

test("executes a valid command and submits its validated acknowledgement", async () => {
  const pending = command();
  const api = new FakeApi(pending);
  let deviceCalls = 0;

  const result = await gateway(api, (input) => {
    deviceCalls += 1;
    return acknowledged(input);
  }).processNextCommand();

  assert.equal(result.kind, "processed");
  assert.equal(result.kind === "processed" ? result.projection.status : null, "acknowledged");
  assert.equal(deviceCalls, 1);
  assert.equal(api.acknowledgements[0]?.status, "acknowledged");
});

test("persists a terminal acknowledgement before upload and retries it without re-executing", async () => {
  const pending = command();
  const repository = new InMemoryEdgeExecutionRepository();
  const submitted: CommandAck[] = [];
  let pullCalls = 0;
  let deviceCalls = 0;
  let failUpload = true;
  const api: CentralApiPort = {
    submitTelemetry: async () => { throw new Error("unused"); },
    pullNextCommand: async () => {
      pullCalls += 1;
      return pending;
    },
    pullNextStopCommand: async () => null,
    submitAck: async (_farmId, ack) => {
      submitted.push(ack);
      if (failUpload) {
        failUpload = false;
        throw new Error("central unavailable");
      }
      return projectionFor(pending, ack);
    },
  };
  const edge = new EdgeGateway({
    farmId: pending.farmId,
    deviceId: pending.deviceId,
    api,
    repository,
    device: {
      executeCommand: (input) => {
        deviceCalls += 1;
        return acknowledged(input);
      },
    },
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });

  await assert.rejects(edge.processNextCommand(), /central unavailable/);
  const stored = repository.get(pending.id);
  assert.equal(stored?.state, "terminal");
  assert.equal(stored?.ackDelivery, "pending");

  const recovered = await edge.processNextCommand();
  assert.equal(recovered.kind, "processed");
  assert.equal(pullCalls, 1);
  assert.equal(deviceCalls, 1);
  assert.equal(submitted.length, 2);
  assert.deepEqual(submitted[1], submitted[0]);
  assert.equal(repository.get(pending.id)?.ackDelivery, "delivered");
});

test("uses a terminal ACK persisted inside the device boundary even if the executor unwinds", async () => {
  const pending = command();
  const api = new FakeApi(pending);
  const repository = new InMemoryEdgeExecutionRepository();
  let deviceCalls = 0;
  const edge = new EdgeGateway({
    farmId: pending.farmId,
    deviceId: pending.deviceId,
    api,
    repository,
    device: {
      executeCommand: (input, persistTerminalAck) => {
        deviceCalls += 1;
        persistTerminalAck(acknowledged(input));
        throw new Error("executor stopped after publishing its terminal result");
      },
    },
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });

  const result = await edge.processNextCommand();

  assert.equal(result.kind, "processed");
  assert.equal(deviceCalls, 1);
  assert.deepEqual(api.acknowledgements, [acknowledged(pending)]);
  assert.equal(repository.get(pending.id)?.ackDelivery, "delivered");
});

test("keeps the ACK pending when a successful central response contains a different result", async () => {
  const pending = command();
  const repository = new InMemoryEdgeExecutionRepository();
  let deviceCalls = 0;
  const mismatchedAck = CommandAckSchema.parse({
    ...acknowledged(pending),
    processedAt: "2026-07-17T00:00:11.000Z",
  });
  const api: CentralApiPort = {
    submitTelemetry: async () => { throw new Error("unused"); },
    pullNextCommand: async () => pending,
    pullNextStopCommand: async () => null,
    submitAck: async () => projectionFor(pending, mismatchedAck),
  };
  const edge = new EdgeGateway({
    farmId: pending.farmId,
    deviceId: pending.deviceId,
    api,
    repository,
    device: {
      executeCommand: (input) => {
        deviceCalls += 1;
        return acknowledged(input);
      },
    },
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });

  await assert.rejects(edge.processNextCommand(), EdgeGatewayValidationError);

  assert.equal(deviceCalls, 1);
  assert.equal(repository.get(pending.id)?.ackDelivery, "pending");
  assert.deepEqual(repository.get(pending.id)?.ack, acknowledged(pending));
});

test("blocks an ambiguous started execution after restart instead of repeating the command", async () => {
  const pending = command({
    schemaVersion: "smartfarm.command.v2",
    payload: { action: "run_pump_for", durationSeconds: 5 },
  });
  const repository = new InMemoryEdgeExecutionRepository();
  assert.equal(repository.accept(pending, "2026-07-17T00:00:10.000Z").kind, "accepted");
  assert.equal(repository.markExecuting(pending.id, "2026-07-17T00:00:10.000Z").kind, "updated");
  let pullCalls = 0;
  let deviceCalls = 0;
  const api: CentralApiPort = {
    submitTelemetry: async () => { throw new Error("unused"); },
    pullNextCommand: async () => {
      pullCalls += 1;
      return pending;
    },
    pullNextStopCommand: async () => null,
    submitAck: async () => { throw new Error("unused"); },
  };
  const edge = new EdgeGateway({
    farmId: pending.farmId,
    deviceId: pending.deviceId,
    api,
    repository,
    device: { executeCommand: () => { deviceCalls += 1; } },
  });

  const result = await edge.processNextCommand();

  assert.deepEqual(result, { kind: "recovery_required", commandId: pending.id });
  assert.equal(pullCalls, 0);
  assert.equal(deviceCalls, 0);
});

test("serializes concurrent polling so one command reaches the device once", async () => {
  const pending = command();
  const api = new FakeApi(pending);
  let deviceCalls = 0;
  let release = (_ack: CommandAck): void => {
    throw new Error("Concurrent command release was not initialized");
  };
  const edge = gateway(api, (input) => {
    deviceCalls += 1;
    return new Promise<CommandAck>((resolve) => {
      release = resolve;
    });
  });

  const first = edge.processNextCommand();
  const second = edge.processNextCommand();
  await Promise.resolve();
  assert.equal(deviceCalls, 1);
  release(acknowledged(pending));
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.kind, "processed");
  assert.equal(secondResult.kind, "processed");
  assert.equal(api.pullCalls, 1);
  assert.equal(deviceCalls, 1);
  assert.equal(api.acknowledgements.length, 1);
});

test("keeps a timed pump command pending at the edge until the device reports final off", async () => {
  const pending = command({
    schemaVersion: "smartfarm.command.v2",
    payload: { action: "run_pump_for", durationSeconds: 5 },
  });
  const api = new FakeApi(pending);
  let release = (_ack: CommandAck): void => {
    throw new Error("Timed command release was not initialized");
  };
  const processing = gateway(api, (input) => new Promise<CommandAck>((resolve) => {
    release = resolve;
  })).processNextCommand();

  await Promise.resolve();
  assert.equal(api.acknowledgements.length, 0);
  release(acknowledged(pending));

  const result = await processing;
  assert.equal(result.kind, "processed");
  assert.equal(api.acknowledgements[0]?.status, "acknowledged");
  assert.equal(api.acknowledgements[0]?.result?.pumpState, "off");
});

test("processes a pump-off stop lane while a timed command is still executing", async () => {
  const timed = command({
    schemaVersion: "smartfarm.command.v2",
    id: "command:timed-pump-000001",
    payload: { action: "run_pump_for", durationSeconds: 5 },
    idempotencyKey: "timed-pump-key-000001",
  });
  const stop = command({
    id: "command:manual-stop-000001",
    payload: { action: "set_pump_state", state: "off" },
    idempotencyKey: "manual-stop-key-000001",
    issuedAt: "2026-07-17T00:00:05.000Z",
  });
  const api = new FakeApi(timed, stop);
  let persistTimedAck: ((input: unknown) => CommandAck) | null = null;
  let resolveTimed = (_ack: CommandAck): void => {
    throw new Error("Timed command completion was not initialized");
  };
  const deviceCalls: string[] = [];
  const edge = new EdgeGateway({
    farmId: timed.farmId,
    deviceId: timed.deviceId,
    api,
    device: {
      executeCommand: (input, persistTerminalAck) => {
        deviceCalls.push(input.id);
        if (input.id === timed.id) {
          persistTimedAck = persistTerminalAck;
          return new Promise<CommandAck>((resolve) => {
            resolveTimed = resolve;
          });
        }

        const interrupted = CommandAckSchema.parse({
          schemaVersion: "smartfarm.command-ack.v2",
          commandId: timed.id,
          farmId: timed.farmId,
          deviceId: timed.deviceId,
          status: "failed",
          reasonCode: "manual_stop",
          result: null,
          causedByCommandId: stop.id,
          processedAt: "2026-07-17T00:00:10.000Z",
        });
        if (persistTimedAck === null) throw new Error("Timed command was not active");
        persistTimedAck(interrupted);
        resolveTimed(interrupted);
        return acknowledged(stop);
      },
    },
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });

  const normalResult = edge.processNextCommand();
  await Promise.resolve();
  const stopResult = edge.processNextStopCommand();
  const [normal, stopped] = await Promise.all([normalResult, stopResult]);

  assert.equal(normal.kind, "processed");
  assert.equal(stopped.kind, "processed");
  assert.deepEqual(deviceCalls, [timed.id, stop.id]);
  assert.equal(api.stopPullCalls, 1);
  assert.equal(api.acknowledgements.length, 2);
  assert.deepEqual(
    api.acknowledgements.map((ack) => ack.commandId),
    [stop.id, timed.id],
  );
  assert.equal(
    api.acknowledgements.find((ack) => ack.commandId === timed.id)?.reasonCode,
    "manual_stop",
  );
  assert.equal(
    api.acknowledgements.find((ack) => ack.commandId === stop.id)?.result?.pumpState,
    "off",
  );
});

test("fails closed when the dedicated stop lane returns a non-stop command", async () => {
  const start = command();
  const api = new FakeApi(null, start);
  let deviceCalls = 0;
  const edge = gateway(api, () => {
    deviceCalls += 1;
  });

  await assert.rejects(edge.processNextStopCommand(), EdgeGatewayValidationError);

  assert.equal(deviceCalls, 0);
  assert.equal(api.acknowledgements.length, 0);
});

test("rejects a changed command body that reuses an in-flight command ID across lanes", async () => {
  const timed = command({
    schemaVersion: "smartfarm.command.v2",
    id: "command:shared-in-flight-000001",
    payload: { action: "run_pump_for", durationSeconds: 5 },
    idempotencyKey: "shared-in-flight-timed-key",
  });
  const changedStop = command({
    id: timed.id,
    payload: { action: "set_pump_state", state: "off" },
    idempotencyKey: "shared-in-flight-stop-key",
  });
  const api = new FakeApi(timed, changedStop);
  let releaseTimed = (_ack: CommandAck): void => {
    throw new Error("Timed command completion was not initialized");
  };
  let deviceCalls = 0;
  const edge = gateway(api, (input) => {
    deviceCalls += 1;
    return new Promise<CommandAck>((resolve) => {
      releaseTimed = resolve;
    });
  });

  const normal = edge.processNextCommand();
  await Promise.resolve();
  await assert.rejects(
    edge.processNextStopCommand(),
    /command_identity_conflict/,
  );

  assert.equal(deviceCalls, 1);
  releaseTimed(acknowledged(timed));
  assert.equal((await normal).kind, "processed");
  assert.equal(api.acknowledgements.length, 1);
});

test("rejects an activation older than the latest acknowledged stop without touching the pump", async () => {
  const oldStart = command();
  const stop = command({
    id: "command:manual-stop-fence-000001",
    payload: { action: "set_pump_state", state: "off" },
    idempotencyKey: "manual-stop-fence-key-000001",
    issuedAt: "2026-07-17T00:00:05.000Z",
  });
  const repository = new InMemoryEdgeExecutionRepository();
  const stopAck = acknowledged(stop);
  const stopProjection = projectionFor(stop, stopAck);
  repository.accept(stop, "2026-07-17T00:00:06.000Z");
  repository.markExecuting(stop.id, "2026-07-17T00:00:07.000Z");
  repository.completeAndEnqueueAck(stop.id, stopAck, "2026-07-17T00:00:10.000Z");
  repository.markAckDelivered(
    stop.id,
    stopAck,
    stopProjection,
    "2026-07-17T00:00:10.000Z",
  );
  const api = new FakeApi(oldStart);
  let deviceCalls = 0;
  const edge = new EdgeGateway({
    farmId: oldStart.farmId,
    deviceId: oldStart.deviceId,
    api,
    repository,
    device: { executeCommand: () => { deviceCalls += 1; } },
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });

  const result = await edge.processNextCommand();
  const rejection = api.acknowledgements.find((ack) => ack.commandId === oldStart.id);

  assert.equal(result.kind, "processed");
  assert.equal(deviceCalls, 0);
  assert.equal(rejection?.schemaVersion, "smartfarm.command-ack.v2");
  assert.equal(rejection?.status, "rejected");
  assert.equal(rejection?.reasonCode, "manual_stop");
  assert.equal(
    rejection?.schemaVersion === "smartfarm.command-ack.v2"
      ? rejection.causedByCommandId
      : null,
    stop.id,
  );
});

test("allows a new activation issued after the durable stop fence", async () => {
  const stop = command({
    id: "command:manual-stop-fence-000002",
    payload: { action: "set_pump_state", state: "off" },
    idempotencyKey: "manual-stop-fence-key-000002",
    issuedAt: "2026-07-17T00:00:05.000Z",
  });
  const newStart = command({
    id: "command:pump-after-stop-000001",
    idempotencyKey: "pump-after-stop-key-000001",
    issuedAt: "2026-07-17T00:00:06.000Z",
    expiresAt: "2026-07-17T00:01:06.000Z",
  });
  const repository = new InMemoryEdgeExecutionRepository();
  const stopAck = acknowledged(stop);
  repository.accept(stop, "2026-07-17T00:00:06.000Z");
  repository.markExecuting(stop.id, "2026-07-17T00:00:07.000Z");
  repository.completeAndEnqueueAck(stop.id, stopAck, "2026-07-17T00:00:08.000Z");
  repository.markAckDelivered(
    stop.id,
    stopAck,
    projectionFor(stop, stopAck),
    "2026-07-17T00:00:09.000Z",
  );
  const api = new FakeApi(newStart);
  let deviceCalls = 0;
  const edge = new EdgeGateway({
    farmId: newStart.farmId,
    deviceId: newStart.deviceId,
    api,
    repository,
    device: {
      executeCommand: (input) => {
        deviceCalls += 1;
        return acknowledged(input);
      },
    },
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });

  const result = await edge.processNextCommand();

  assert.equal(result.kind, "processed");
  assert.equal(deviceCalls, 1);
  assert.equal(api.acknowledgements[0]?.status, "acknowledged");
});

test("rejects a timed pump acknowledgement that falsely reports final on", async () => {
  const pending = command({
    schemaVersion: "smartfarm.command.v2",
    payload: { action: "run_pump_for", durationSeconds: 5 },
  });
  const api = new FakeApi(pending);
  const falseAck = CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: pending.id,
    farmId: pending.farmId,
    deviceId: pending.deviceId,
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: "on" },
    processedAt: "2026-07-17T00:00:15.000Z",
  });

  await gateway(api, () => falseAck).processNextCommand();

  assert.equal(api.acknowledgements[0]?.status, "failed");
  assert.equal(api.acknowledgements[0]?.reasonCode, "execution_failed");
});

test("times out an expired command before device execution", async () => {
  const api = new FakeApi(command({ expiresAt: "2026-07-17T00:00:05.000Z" }));
  let deviceCalls = 0;

  const edge = new EdgeGateway({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    api,
    device: { executeCommand: () => { deviceCalls += 1; } },
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });
  await edge.processNextCommand();

  assert.equal(deviceCalls, 0);
  assert.equal(api.acknowledgements[0]?.status, "timed_out");
  assert.equal(api.acknowledgements[0]?.reasonCode, "expired");
});

test("fails closed on a command issued later than the gateway clock", async () => {
  const api = new FakeApi(command({
    issuedAt: "2026-07-17T00:00:11.000Z",
    expiresAt: "2026-07-17T00:01:11.000Z",
  }));
  let deviceCalls = 0;

  await assert.rejects(
    gateway(api, () => { deviceCalls += 1; }).processNextCommand(),
    EdgeGatewayValidationError,
  );

  assert.equal(deviceCalls, 0);
  assert.equal(api.acknowledgements.length, 0);
});

test("fails closed on an out-of-scope command before device execution or acknowledgement", async () => {
  const api = new FakeApi(command({ deviceId: "device:other" }));
  let deviceCalls = 0;

  await assert.rejects(
    gateway(api, () => { deviceCalls += 1; }).processNextCommand(),
    EdgeGatewayValidationError,
  );

  assert.equal(deviceCalls, 0);
  assert.equal(api.acknowledgements.length, 0);
});

test("converts a device exception into a failed terminal acknowledgement", async () => {
  const api = new FakeApi(command());

  await gateway(api, () => { throw new Error("device detail must not escape"); })
    .processNextCommand();

  assert.equal(api.acknowledgements[0]?.status, "failed");
  assert.equal(api.acknowledgements[0]?.reasonCode, "execution_failed");
});

test("converts a malformed device response into a failed terminal acknowledgement", async () => {
  const api = new FakeApi(command());

  await gateway(api, () => ({ status: "pretend-success" })).processNextCommand();

  assert.equal(api.acknowledgements[0]?.status, "failed");
  assert.equal(api.acknowledgements[0]?.reasonCode, "execution_failed");
});

test("converts a pre-issued device acknowledgement into a failed terminal result", async () => {
  const pending = command();
  const api = new FakeApi(pending);
  const preIssued = CommandAckSchema.parse({
    ...acknowledged(pending),
    processedAt: "2026-07-16T23:59:59.000Z",
  });

  await gateway(api, () => preIssued).processNextCommand();

  assert.equal(api.acknowledgements[0]?.status, "failed");
  assert.equal(api.acknowledgements[0]?.reasonCode, "execution_failed");
});
