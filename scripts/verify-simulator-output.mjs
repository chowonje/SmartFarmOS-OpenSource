import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  CommandAckSchema,
  CommandSchema,
  TelemetrySchema,
} from "../packages/contracts/dist/index.js";

const result = spawnSync(
  process.execPath,
  ["tools/device-simulator/dist/cli.js"],
  { cwd: process.cwd(), encoding: "utf8" },
);

if (result.error !== undefined) {
  throw result.error;
}

assert.equal(result.status, 0, result.stderr);

const lines = result.stdout.trim().split("\n").filter(Boolean);
assert.equal(lines.length, 3, "Expected telemetry, command, and command_ack events");

const events = lines.map((line) => JSON.parse(line));
assert.deepEqual(
  events.map((event) => event.event),
  ["telemetry", "command", "command_ack"],
);

const telemetry = TelemetrySchema.parse(events[0].data);
const command = CommandSchema.parse(events[1].data);
const ack = CommandAckSchema.parse(events[2].data);

assert.equal(telemetry.farmId, command.farmId);
assert.equal(telemetry.deviceId, command.deviceId);
assert.equal(ack.commandId, command.id);
assert.equal(ack.farmId, command.farmId);
assert.equal(ack.deviceId, command.deviceId);
assert.equal(ack.status, "acknowledged");
assert.equal(ack.result?.pumpState, "on");

process.stdout.write("Simulator producer/consumer contract smoke passed.\n");

