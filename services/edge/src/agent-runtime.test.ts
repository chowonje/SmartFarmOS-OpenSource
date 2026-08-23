import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import {
  CommandAckSchema,
  CommandProjectionSchema,
  CommandSchema,
  DeviceIdSchema,
  FarmIdSchema,
  TelemetryReceiptSchema,
} from "@smartfarm-os/contracts";
import type { EdgeAgentConfig } from "./agent-config.js";
import { startEdgeAgentRuntime } from "./agent-runtime.js";
import { InMemoryEdgeExecutionRepository } from "./execution-repository.js";
import type { CentralApiPort } from "./gateway.js";

function createConfig(): EdgeAgentConfig {
  return {
    apiUrl: "https://api.example.test",
    farmId: FarmIdSchema.parse("farm:demo"),
    deviceId: DeviceIdSchema.parse("device:bed-1"),
    credentialPath: "/tmp/credential.json",
    journalPath: "/tmp/execution.sqlite",
    enrollmentPath: "/v1/gateway-enrollments/exchange",
    commandPollIntervalMs: 1,
    stopPollIntervalMs: 1,
    telemetryIntervalMs: 1,
    requestTimeoutMs: 1_000,
    maxResponseBytes: 1_024,
  };
}

function createPendingCommand() {
  return CommandSchema.parse({
    schemaVersion: "smartfarm.command.v1",
    id: "command:edge-runtime-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    payload: { action: "set_pump_state", state: "on" },
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "edge-runtime-key-000001",
    issuedAt: "2026-08-12T00:00:00.000Z",
    expiresAt: "2026-08-12T00:01:00.000Z",
  });
}

function acknowledged(command = createPendingCommand()) {
  return CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: command.id,
    farmId: command.farmId,
    deviceId: command.deviceId,
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: "on" },
    processedAt: "2026-08-12T00:00:01.000Z",
  });
}

test("runs stop, normal, and telemetry loops with injected ports", async () => {
  const command = createPendingCommand();
  const ack = acknowledged(command);
  let normalPulls = 0;
  let stopPulls = 0;
  let telemetryWrites = 0;
  let deviceCalls = 0;
  const api: CentralApiPort = {
    submitTelemetry: async () => {
      telemetryWrites += 1;
      return TelemetryReceiptSchema.parse({
        schemaVersion: "smartfarm.telemetry-receipt.v1",
        status: "accepted",
        telemetryId: "telemetry:bed-1-000001",
        acceptedAt: "2026-08-12T00:00:01.000Z",
      });
    },
    pullNextCommand: async () => {
      normalPulls += 1;
      return normalPulls === 1 ? command : null;
    },
    pullNextStopCommand: async () => {
      stopPulls += 1;
      return null;
    },
    submitAck: async () => CommandProjectionSchema.parse({
      schemaVersion: "smartfarm.command-projection.v1",
      command,
      status: "acknowledged",
      ack,
      updatedAt: ack.processedAt,
    }),
  };
  const runtime = await startEdgeAgentRuntime({
    config: createConfig(),
    api,
    repository: new InMemoryEdgeExecutionRepository(),
    deviceExecutor: {
      executeCommand: (pending) => {
        deviceCalls += 1;
        return acknowledged(pending);
      },
    },
    telemetrySource: {
      readTelemetry: async () => telemetryWrites === 0
        ? [{
          schemaVersion: "smartfarm.telemetry.v1",
          id: "telemetry:bed-1-000001",
          farmId: "farm:demo",
          deviceId: "device:bed-1",
          metric: "temperature",
          value: 24.5,
          unit: "celsius",
          sequence: 1,
          observedAt: "2026-08-12T00:00:01.000Z",
        }]
        : [],
    },
    now: () => new Date("2026-08-12T00:00:30.000Z"),
    sleep: async () => delay(0).then(() => undefined),
  });

  try {
    await waitFor(() =>
      deviceCalls === 1
      && normalPulls >= 1
      && stopPulls >= 1
      && telemetryWrites === 1,
    );
  } finally {
    await runtime.stop();
  }

  assert.equal(deviceCalls, 1);
  assert.equal(normalPulls >= 1, true);
  assert.equal(stopPulls >= 1, true);
  assert.equal(telemetryWrites, 1);
  assert.equal(runtime.getLastBackgroundError(), null);
});

test("captures recovery-required as a background error instead of re-executing", async () => {
  const runtime = await startEdgeAgentRuntime({
    config: createConfig(),
    api: {
      submitTelemetry: async () => {
        throw new Error("unused");
      },
      pullNextCommand: async () => createPendingCommand(),
      pullNextStopCommand: async () => null,
      submitAck: async () => {
        throw new Error("unused");
      },
    },
    repository: (() => {
      const repository = new InMemoryEdgeExecutionRepository();
      const command = createPendingCommand();
      repository.accept(command, "2026-08-12T00:00:00.000Z");
      repository.markExecuting(command.id, "2026-08-12T00:00:00.100Z");
      return repository;
    })(),
    deviceExecutor: {
      executeCommand: () => {
        throw new Error("must not execute");
      },
    },
    sleep: async () => delay(0).then(() => undefined),
  });

  await waitFor(() => runtime.getLastBackgroundError() !== null);
  await runtime.stop();
  assert.match(String(runtime.getLastBackgroundError()), /recovery is required/);
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for runtime work");
    }
    await delay(1);
  }
}
