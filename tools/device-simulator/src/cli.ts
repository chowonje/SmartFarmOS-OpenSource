import { CommandSchema } from "@smartfarm-os/contracts";
import { DeviceSimulator } from "./simulator.js";

const fixedNow = new Date("2026-07-17T00:00:10.000Z");
const simulator = new DeviceSimulator({
  farmId: "farm:demo",
  deviceId: "device:bed-1",
  now: () => new Date(fixedNow),
});

const telemetry = simulator.emitTemperature(24.5);
const command = CommandSchema.parse({
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
const ack = await simulator.handleCommand(command);

for (const event of [
  { event: "telemetry", data: telemetry },
  { event: "command", data: command },
  { event: "command_ack", data: ack },
]) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}
