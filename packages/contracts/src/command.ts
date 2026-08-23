import * as z from "zod";
import {
  CommandIdSchema,
  DeviceIdSchema,
  FarmIdSchema,
  IsoDateTimeSchema,
} from "./identifiers.js";

export const MAX_COMMAND_TTL_MS = 5 * 60 * 1_000;

export const PumpStateSchema = z.enum(["on", "off"]);
export const CommandActorTypeSchema = z.enum(["user", "system"]);

export const CommandActorSchema = z.strictObject({
  type: CommandActorTypeSchema,
  id: z.string().trim().min(1).max(128),
});

export const SetPumpStatePayloadSchema = z.strictObject({
  action: z.literal("set_pump_state"),
  state: PumpStateSchema,
});

export const TimedPumpRunPayloadSchema = z.strictObject({
  action: z.literal("run_pump_for"),
  durationSeconds: z.number().int().min(1).max(300),
});

const SetPumpStateCommandSchema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.command.v1"),
    id: CommandIdSchema,
    farmId: FarmIdSchema,
    deviceId: DeviceIdSchema,
    payload: SetPumpStatePayloadSchema,
    actor: CommandActorSchema,
    idempotencyKey: z.string().trim().min(8).max(128),
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .refine(
    (command) => Date.parse(command.expiresAt) > Date.parse(command.issuedAt),
    {
      message: "Command expiry must be later than issue time",
      path: ["expiresAt"],
    },
  )
  .refine(
    (command) =>
      Date.parse(command.expiresAt) - Date.parse(command.issuedAt) <= MAX_COMMAND_TTL_MS,
    {
      message: "Command lifetime exceeds the five-minute limit",
      path: ["expiresAt"],
    },
  );

export const TimedPumpCommandSchema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.command.v2"),
    id: CommandIdSchema,
    farmId: FarmIdSchema,
    deviceId: DeviceIdSchema,
    payload: TimedPumpRunPayloadSchema,
    actor: CommandActorSchema,
    idempotencyKey: z.string().trim().min(8).max(128),
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
  })
  .refine(
    (command) => Date.parse(command.expiresAt) > Date.parse(command.issuedAt),
    {
      message: "Command expiry must be later than issue time",
      path: ["expiresAt"],
    },
  )
  .refine(
    (command) =>
      Date.parse(command.expiresAt) - Date.parse(command.issuedAt) <= MAX_COMMAND_TTL_MS,
    {
      message: "Command lifetime exceeds the five-minute limit",
      path: ["expiresAt"],
    },
  );

export const CommandSchema = z.union([
  SetPumpStateCommandSchema,
  TimedPumpCommandSchema,
]);

export const CommandAckStatusSchema = z.enum([
  "acknowledged",
  "rejected",
  "failed",
  "timed_out",
]);

export const CommandAckV1ReasonCodeSchema = z.enum([
  "scope_mismatch",
  "expired",
  "idempotency_conflict",
  "execution_failed",
  "invalid_command",
]);

export const CommandAckV2ReasonCodeSchema = z.literal("manual_stop");

export const CommandAckReasonCodeSchema = z.union([
  CommandAckV1ReasonCodeSchema,
  CommandAckV2ReasonCodeSchema,
]);

export const CommandAckResultSchema = z.strictObject({
  pumpState: PumpStateSchema,
});

export const CommandAckV1Schema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.command-ack.v1"),
    commandId: CommandIdSchema,
    farmId: FarmIdSchema,
    deviceId: DeviceIdSchema,
    status: CommandAckStatusSchema,
    reasonCode: CommandAckV1ReasonCodeSchema.nullable(),
    result: CommandAckResultSchema.nullable(),
    processedAt: IsoDateTimeSchema,
  })
  .refine(
    (ack) =>
      ack.status === "acknowledged"
        ? ack.reasonCode === null && ack.result !== null
        : ack.reasonCode !== null && ack.result === null,
    {
      message: "Command acknowledgement result and reason do not match status",
      path: ["status"],
    },
  );

export const CommandAckV2Schema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.command-ack.v2"),
    commandId: CommandIdSchema,
    farmId: FarmIdSchema,
    deviceId: DeviceIdSchema,
    status: z.enum(["failed", "rejected"]),
    reasonCode: CommandAckV2ReasonCodeSchema,
    result: z.null(),
    causedByCommandId: CommandIdSchema,
    processedAt: IsoDateTimeSchema,
  })
  .refine((ack) => ack.causedByCommandId !== ack.commandId, {
    message: "Manual stop acknowledgement cause must differ from the interrupted command",
    path: ["causedByCommandId"],
  });

export const CommandAckSchema = z.union([
  CommandAckV1Schema,
  CommandAckV2Schema,
]);

export const CommandLifecycleStatusSchema = z.enum([
  "pending",
  "acknowledged",
  "failed",
  "timed_out",
]);

export function isCommandExpired(command: Command, at: Date): boolean {
  return at.getTime() >= Date.parse(command.expiresAt);
}

export function commandRequestedPumpState(command: Command): PumpState {
  return command.schemaVersion === "smartfarm.command.v2"
    ? "on"
    : command.payload.state;
}

export function commandExpectedFinalPumpState(command: Command): PumpState {
  return command.schemaVersion === "smartfarm.command.v2"
    ? "off"
    : command.payload.state;
}

export function isPumpStopCommand(command: Command): boolean {
  return command.schemaVersion === "smartfarm.command.v1"
    && command.payload.action === "set_pump_state"
    && command.payload.state === "off";
}

export function isCommandAckCompatible(
  command: Command,
  ack: CommandAck,
): boolean {
  if (
    ack.commandId !== command.id
    || ack.farmId !== command.farmId
    || ack.deviceId !== command.deviceId
  ) {
    return false;
  }

  if (ack.schemaVersion === "smartfarm.command-ack.v2") {
    return command.schemaVersion === "smartfarm.command.v2"
      || command.payload.state === "on";
  }

  return ack.status !== "acknowledged"
    || ack.result?.pumpState === commandExpectedFinalPumpState(command);
}

export type PumpState = z.infer<typeof PumpStateSchema>;
export type CommandActorType = z.infer<typeof CommandActorTypeSchema>;
export type CommandActor = z.infer<typeof CommandActorSchema>;
export type SetPumpStatePayload = z.infer<typeof SetPumpStatePayloadSchema>;
export type TimedPumpRunPayload = z.infer<typeof TimedPumpRunPayloadSchema>;
export type TimedPumpCommand = z.infer<typeof TimedPumpCommandSchema>;
export type Command = z.infer<typeof CommandSchema>;
export type CommandAckStatus = z.infer<typeof CommandAckStatusSchema>;
export type CommandAckV1ReasonCode = z.infer<typeof CommandAckV1ReasonCodeSchema>;
export type CommandAckV2ReasonCode = z.infer<typeof CommandAckV2ReasonCodeSchema>;
export type CommandAckReasonCode = z.infer<typeof CommandAckReasonCodeSchema>;
export type CommandAckResult = z.infer<typeof CommandAckResultSchema>;
export type CommandAckV1 = z.infer<typeof CommandAckV1Schema>;
export type CommandAckV2 = z.infer<typeof CommandAckV2Schema>;
export type CommandAck = z.infer<typeof CommandAckSchema>;
export type CommandLifecycleStatus = z.infer<typeof CommandLifecycleStatusSchema>;
