import {
  AuditEventSchema,
  type AuditEvent,
  type Command,
  type CommandAck,
} from "@smartfarm-os/contracts";
import { createDeterministicEntityId } from "./alarm-center.js";

export function buildDirectCommandCompletedAuditEvent(input: {
  readonly command: Command;
  readonly ack: CommandAck;
  readonly occurredAt: string;
}): AuditEvent {
  const { command, ack } = input;

  return AuditEventSchema.parse({
    schemaVersion: "smartfarm.audit-event.v2",
    id: createDeterministicEntityId(
      "audit",
      command.farmId,
      command.id,
      "direct",
      "command.completed",
    ),
    farmId: command.farmId,
    cycleId: null,
    actor: command.actor,
    action: "command.completed",
    targetType: "command",
    targetId: command.id,
    result: ack.status === "acknowledged" ? "success" : "failure",
    occurredAt: input.occurredAt,
    details: {
      source: "direct",
      deviceId: command.deviceId,
      requestedAction: command.payload.action,
      ...(command.schemaVersion === "smartfarm.command.v1"
        ? { requestedPumpState: command.payload.state }
        : { runDurationSeconds: command.payload.durationSeconds }),
      status: ack.status,
      reasonCode: ack.reasonCode,
      resultingPumpState: ack.result?.pumpState ?? null,
      ...(ack.schemaVersion === "smartfarm.command-ack.v2"
        ? { manualStopCommandId: ack.causedByCommandId }
        : {}),
    },
  });
}
