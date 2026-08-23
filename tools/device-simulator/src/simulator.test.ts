import assert from "node:assert/strict";
import test from "node:test";
import { CommandSchema, type CommandAck } from "@smartfarm-os/contracts";
import { DeviceSimulator } from "./simulator.js";

function createCommand(overrides: Record<string, unknown> = {}) {
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

function createTimedCommand(overrides: Record<string, unknown> = {}) {
  return CommandSchema.parse({
    schemaVersion: "smartfarm.command.v2",
    id: "command:timed-pump-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    payload: { action: "run_pump_for", durationSeconds: 5 },
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "demo-timed-pump-000001",
    issuedAt: "2026-07-17T00:00:00.000Z",
    expiresAt: "2026-07-17T00:01:00.000Z",
    ...overrides,
  });
}

test("emits deterministic, validated telemetry with increasing sequence", () => {
  const simulator = new DeviceSimulator({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });

  const first = simulator.emitTelemetry("temperature", 24.5);
  const second = simulator.emitTelemetry("humidity", 61.5);

  assert.equal(first.id, "telemetry:bed-1-000001");
  assert.equal(first.sequence, 1);
  assert.equal(first.metric, "temperature");
  assert.equal(first.unit, "celsius");
  assert.equal(second.sequence, 2);
  assert.equal(second.metric, "humidity");
  assert.equal(second.unit, "percent");
  assert.equal(second.observedAt, "2026-07-17T00:00:10.000Z");
});

test("resumes telemetry sequence from a persisted starting point", () => {
  const simulator = new DeviceSimulator({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    initialSequence: 7,
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });

  const telemetry = simulator.emitTelemetry("illuminance", 12_500);

  assert.equal(telemetry.sequence, 8);
  assert.equal(telemetry.id, "telemetry:bed-1-000008");
  assert.equal(telemetry.metric, "illuminance");
  assert.equal(telemetry.unit, "lux");
});

test("enforces metric-specific unit and value validation through the generic emitter", () => {
  const simulator = new DeviceSimulator({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });

  const waterLevel = simulator.emitTelemetry("water_level", 72.25);
  assert.equal(waterLevel.unit, "percent");
  assert.equal(waterLevel.metric, "water_level");

  assert.throws(
    () => simulator.emitTelemetry("humidity", 101),
    /Telemetry value is outside the accepted metric range/,
  );

  const resumed = simulator.emitTelemetry("temperature", 24.75);
  assert.equal(resumed.sequence, 2);
  assert.equal(resumed.id, "telemetry:bed-1-000002");
});

test("executes a scoped pump command and returns an acknowledgement", async () => {
  const simulator = new DeviceSimulator({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });
  const ack = await simulator.handleCommand(createCommand());

  assert.equal(ack.status, "acknowledged");
  assert.equal(ack.result?.pumpState, "on");
  assert.equal(simulator.currentPumpState(), "on");
});

test("returns the same acknowledgement for an exact duplicate command", async () => {
  let calls = 0;
  const simulator = new DeviceSimulator({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    now: () => {
      calls += 1;
      return new Date(`2026-07-17T00:00:${(10 + calls).toString().padStart(2, "0")}.000Z`);
    },
  });
  const command = createCommand();
  const first = await simulator.handleCommand(command);
  const second = await simulator.handleCommand(command);

  assert.deepEqual(second, first);
});

test("rejects reused idempotency keys with different command identity", async () => {
  const simulator = new DeviceSimulator({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });
  await simulator.handleCommand(createCommand());
  const conflict = await simulator.handleCommand(
    createCommand({ id: "command:pump-000002", payload: { action: "set_pump_state", state: "off" } }),
  );

  assert.equal(conflict.status, "rejected");
  assert.equal(conflict.reasonCode, "idempotency_conflict");
  assert.equal(simulator.currentPumpState(), "on");
});

test("scopes idempotency keys by actor like the central command store", async () => {
  const simulator = new DeviceSimulator({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });
  const first = await simulator.handleCommand(createCommand());
  const second = await simulator.handleCommand(createCommand({
    id: "command:pump-000002",
    actor: { type: "user", id: "user:other" },
    payload: { action: "set_pump_state", state: "off" },
  }));

  assert.equal(first.status, "acknowledged");
  assert.equal(second.status, "acknowledged");
  assert.equal(second.result?.pumpState, "off");
  assert.equal(simulator.currentPumpState(), "off");
});

test("rejects commands for a different farm or device", async () => {
  const simulator = new DeviceSimulator({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    now: () => new Date("2026-07-17T00:00:10.000Z"),
  });
  const ack = await simulator.handleCommand(createCommand({ farmId: "farm:other" }));

  assert.equal(ack.status, "rejected");
  assert.equal(ack.reasonCode, "scope_mismatch");
  assert.equal(simulator.currentPumpState(), "off");
});

test("times out expired commands without changing device state", async () => {
  const simulator = new DeviceSimulator({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    now: () => new Date("2026-07-17T00:02:00.000Z"),
  });
  const ack = await simulator.handleCommand(createCommand());

  assert.equal(ack.status, "timed_out");
  assert.equal(ack.reasonCode, "expired");
  assert.equal(simulator.currentPumpState(), "off");
});

test("fails closed on malformed command input", () => {
  const simulator = new DeviceSimulator({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
  });

  assert.throws(() => simulator.handleCommand({ action: "turn_everything_on" }));
});

test("runs a timed pump command locally and acknowledges only after final off", async () => {
  let releaseTimer = (): void => {
    throw new Error("Timed pump release was not initialized");
  };
  let nowMs = Date.parse("2026-07-17T00:00:10.000Z");
  const simulator = new DeviceSimulator({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    now: () => new Date(nowMs),
    wait: (durationMs) => new Promise((resolve) => {
      releaseTimer = () => {
        nowMs += durationMs;
        resolve();
      };
    }),
  });
  const command = createTimedCommand();
  let observedTerminalAck: CommandAck | null = null;
  const first = simulator.handleCommand(command, (ack) => {
    observedTerminalAck = ack;
  });
  const replay = simulator.handleCommand(command);

  assert.equal(simulator.currentPumpState(), "on");
  assert.equal(observedTerminalAck, null);
  assert.equal(first, replay);
  releaseTimer();

  const ack = await first;
  assert.equal(ack.status, "acknowledged");
  assert.equal(ack.result?.pumpState, "off");
  assert.equal(ack.processedAt, "2026-07-17T00:00:15.000Z");
  assert.equal(simulator.currentPumpState(), "off");
  assert.deepEqual(observedTerminalAck, ack);
  assert.deepEqual(await simulator.handleCommand(command), ack);
});

test("a manual off command interrupts an active timed run once and preserves the causal ACK", async () => {
  let releaseTimer = (): void => {
    throw new Error("Timed pump release was not initialized");
  };
  let nowMs = Date.parse("2026-07-17T00:00:10.000Z");
  const simulator = new DeviceSimulator({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    now: () => new Date(nowMs),
    wait: () => new Promise((resolve) => {
      releaseTimer = resolve;
    }),
  });
  const timed = createTimedCommand();
  const stop = createCommand({
    id: "command:manual-stop-000001",
    payload: { action: "set_pump_state", state: "off" },
    idempotencyKey: "manual-stop-key-000001",
    issuedAt: "2026-07-17T00:00:11.000Z",
    expiresAt: "2026-07-17T00:01:11.000Z",
  });
  const observed: CommandAck[] = [];
  const timedResult = simulator.handleCommand(timed, (ack) => observed.push(ack));

  assert.equal(simulator.currentPumpState(), "on");
  nowMs = Date.parse("2026-07-17T00:00:12.000Z");
  const stopAck = await simulator.handleCommand(stop);
  const interruptedAck = await timedResult;

  assert.equal(stopAck.status, "acknowledged");
  assert.equal(stopAck.result?.pumpState, "off");
  assert.equal(interruptedAck.schemaVersion, "smartfarm.command-ack.v2");
  assert.equal(interruptedAck.status, "failed");
  assert.equal(interruptedAck.reasonCode, "manual_stop");
  assert.equal(
    interruptedAck.schemaVersion === "smartfarm.command-ack.v2"
      ? interruptedAck.causedByCommandId
      : null,
    stop.id,
  );
  assert.equal(simulator.currentPumpState(), "off");
  assert.deepEqual(observed, [interruptedAck]);

  releaseTimer();
  await Promise.resolve();
  assert.deepEqual(observed, [interruptedAck]);
  assert.deepEqual(await simulator.handleCommand(timed), interruptedAck);
  assert.deepEqual(await simulator.handleCommand(stop), stopAck);
});

test("fails a second activation while a timed run owns the pump", async () => {
  let releaseTimer = (): void => {
    throw new Error("Timed pump release was not initialized");
  };
  const simulator = new DeviceSimulator({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    now: () => new Date("2026-07-17T00:00:10.000Z"),
    wait: () => new Promise((resolve) => {
      releaseTimer = resolve;
    }),
  });
  const timed = simulator.handleCommand(createTimedCommand());
  const second = await simulator.handleCommand(createCommand({
    id: "command:pump-000002",
    idempotencyKey: "demo-pump-000002",
  }));

  assert.equal(second.status, "failed");
  assert.equal(second.reasonCode, "execution_failed");
  assert.equal(simulator.currentPumpState(), "on");
  releaseTimer();
  assert.equal((await timed).status, "acknowledged");
});

test("fails a timed pump command closed when its local timer fails", async () => {
  const simulator = new DeviceSimulator({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    now: () => new Date("2026-07-17T00:00:10.000Z"),
    wait: async () => {
      throw new Error("timer unavailable");
    },
  });

  const ack = await simulator.handleCommand(createTimedCommand());

  assert.equal(ack.status, "failed");
  assert.equal(ack.reasonCode, "execution_failed");
  assert.equal(ack.result, null);
  assert.equal(simulator.currentPumpState(), "off");
});
