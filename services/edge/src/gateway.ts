import {
  CommandAckSchema,
  CommandProjectionSchema,
  CommandSchema,
  DeviceIdSchema,
  FarmIdSchema,
  TelemetrySchema,
  isCommandAckCompatible,
  isCommandExpired,
  isPumpStopCommand,
  type Command,
  type CommandAck,
  type CommandAckReasonCode,
  type CommandProjection,
  type DeviceId,
  type FarmId,
  type Telemetry,
  type TelemetryReceipt,
} from "@smartfarm-os/contracts";
import {
  InMemoryEdgeExecutionRepository,
  type EdgeExecutionRecord,
  type EdgeExecutionRepository,
} from "./execution-repository.js";

export interface CentralApiPort {
  submitTelemetry(farmId: FarmId, telemetry: Telemetry): Promise<TelemetryReceipt>;
  pullNextCommand(farmId: FarmId, deviceId: DeviceId): Promise<unknown | null>;
  pullNextStopCommand(farmId: FarmId, deviceId: DeviceId): Promise<unknown | null>;
  submitAck(farmId: FarmId, ack: CommandAck): Promise<CommandProjection>;
}

export interface DeviceCommandExecutor {
  executeCommand(
    command: Command,
    persistTerminalAck: (input: unknown) => CommandAck,
  ): Promise<unknown> | unknown;
}

export type EdgeGatewayOptions = {
  readonly farmId: string;
  readonly deviceId: string;
  readonly api: CentralApiPort;
  readonly device: DeviceCommandExecutor;
  readonly repository?: EdgeExecutionRepository;
  readonly now?: () => Date;
};

export type ProcessNextCommandResult =
  | { readonly kind: "idle" }
  | { readonly kind: "recovery_required"; readonly commandId: Command["id"] }
  | { readonly kind: "processed"; readonly projection: CommandProjection };

export class EdgeGatewayValidationError extends Error {
  override readonly name = "EdgeGatewayValidationError";
}

export class EdgeGateway {
  readonly farmId: FarmId;
  readonly deviceId: DeviceId;

  private readonly api: CentralApiPort;
  private readonly device: DeviceCommandExecutor;
  private readonly repository: EdgeExecutionRepository;
  private readonly now: () => Date;
  private processInFlight: Promise<ProcessNextCommandResult> | null = null;
  private stopProcessInFlight: Promise<ProcessNextCommandResult> | null = null;
  private readonly commandOperations = new Map<Command["id"], Promise<ProcessNextCommandResult>>();

  constructor(options: EdgeGatewayOptions) {
    this.farmId = FarmIdSchema.parse(options.farmId);
    this.deviceId = DeviceIdSchema.parse(options.deviceId);
    this.api = options.api;
    this.device = options.device;
    this.repository = options.repository ?? new InMemoryEdgeExecutionRepository();
    this.now = options.now ?? (() => new Date());
  }

  async forwardTelemetry(input: unknown): Promise<TelemetryReceipt> {
    const parsed = TelemetrySchema.safeParse(input);
    if (!parsed.success) {
      throw new EdgeGatewayValidationError("Device telemetry did not match the contract");
    }
    if (parsed.data.farmId !== this.farmId || parsed.data.deviceId !== this.deviceId) {
      throw new EdgeGatewayValidationError("Device telemetry scope does not match this gateway");
    }

    return this.api.submitTelemetry(this.farmId, parsed.data);
  }

  async processNextCommand(): Promise<ProcessNextCommandResult> {
    if (this.processInFlight !== null) return this.processInFlight;

    const operation = this.processNextCommandOnce();
    this.processInFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.processInFlight === operation) this.processInFlight = null;
    }
  }

  async processNextStopCommand(): Promise<ProcessNextCommandResult> {
    if (this.stopProcessInFlight !== null) return this.stopProcessInFlight;

    const operation = this.processNextStopCommandOnce();
    this.stopProcessInFlight = operation;
    try {
      return await operation;
    } finally {
      if (this.stopProcessInFlight === operation) this.stopProcessInFlight = null;
    }
  }

  private async processNextCommandOnce(): Promise<ProcessNextCommandResult> {
    const pendingAck = this.repository.nextPendingAck(this.farmId, this.deviceId);
    if (pendingAck !== null) {
      return this.submitStoredAck(pendingAck);
    }

    const ambiguous = this.repository.nextAmbiguousExecution(this.farmId, this.deviceId);
    if (ambiguous !== null) {
      return { kind: "recovery_required", commandId: ambiguous.command.id };
    }

    const input = await this.api.pullNextCommand(this.farmId, this.deviceId);
    if (input === null) return { kind: "idle" };

    return this.processPulledCommand(input, false);
  }

  private async processNextStopCommandOnce(): Promise<ProcessNextCommandResult> {
    const input = await this.api.pullNextStopCommand(this.farmId, this.deviceId);
    if (input === null) return { kind: "idle" };

    return this.processPulledCommand(input, true);
  }

  private async processPulledCommand(
    input: unknown,
    requireStopCommand: boolean,
  ): Promise<ProcessNextCommandResult> {
    const parsed = CommandSchema.safeParse(input);
    if (!parsed.success) {
      throw new EdgeGatewayValidationError("Central API command did not match the contract");
    }
    const command = parsed.data;
    if (requireStopCommand && !isPumpStopCommand(command)) {
      throw new EdgeGatewayValidationError(
        "Central API stop lane returned a command that was not pump off",
      );
    }

    const existing = this.commandOperations.get(command.id);
    if (existing !== undefined) {
      const replay = this.repository.accept(command, this.now().toISOString());
      if (replay.kind === "conflict") {
        throw new EdgeGatewayValidationError(
          `Edge execution journal rejected the command (${replay.reason})`,
        );
      }
      return existing;
    }

    const operation = this.processPulledCommandOnce(command, requireStopCommand);
    this.commandOperations.set(command.id, operation);
    try {
      return await operation;
    } finally {
      if (this.commandOperations.get(command.id) === operation) {
        this.commandOperations.delete(command.id);
      }
    }
  }

  private async processPulledCommandOnce(
    command: Command,
    stopLane: boolean,
  ): Promise<ProcessNextCommandResult> {
    const checkedAt = this.now();

    if (command.farmId !== this.farmId || command.deviceId !== this.deviceId) {
      throw new EdgeGatewayValidationError(
        "Central API command scope does not match this gateway",
      );
    }
    if (Date.parse(command.issuedAt) > checkedAt.getTime()) {
      throw new EdgeGatewayValidationError(
        "Central API command issue time is later than this gateway clock",
      );
    }

    const accepted = this.repository.accept(command, checkedAt.toISOString());
    if (accepted.kind === "conflict") {
      throw new EdgeGatewayValidationError(
        `Edge execution journal rejected the command (${accepted.reason})`,
      );
    }
    if (accepted.record.state === "terminal") {
      return this.submitStoredAck(accepted.record);
    }
    if (accepted.record.state === "executing") {
      return { kind: "recovery_required", commandId: command.id };
    }

    if (isCommandExpired(command, checkedAt)) {
      return this.completeAndSubmit(
        command,
        createFailureAck(command, "timed_out", "expired", checkedAt),
      );
    }

    if (!stopLane && isPumpActivationCommand(command)) {
      const stopFence = this.repository.latestAcknowledgedPumpStop(
        this.farmId,
        this.deviceId,
      );
      if (
        stopFence !== null
        && Date.parse(command.issuedAt) <= Date.parse(stopFence.command.issuedAt)
      ) {
        return this.completeAndSubmit(
          command,
          createManualStopAck(command, stopFence.command.id, checkedAt, "rejected"),
        );
      }
    }

    const executing = this.repository.markExecuting(command.id, checkedAt.toISOString());
    if (executing.kind === "conflict" || executing.kind === "not_found") {
      throw new EdgeGatewayValidationError("Edge execution journal could not start the command");
    }
    if (executing.kind === "replayed") {
      return { kind: "recovery_required", commandId: command.id };
    }

    let deviceResult: unknown;
    let persistedTerminalRecord: EdgeExecutionRecord | null = null;
    const persistTerminalAck = (input: unknown): CommandAck => {
      const ack = parseDeviceAck(command, input)
        ?? createFailureAck(command, "failed", "execution_failed", this.now());
      const completed = this.repository.completeAndEnqueueAck(
        command.id,
        ack,
        this.now().toISOString(),
      );
      if (completed.kind === "conflict" || completed.kind === "not_found") {
        throw new EdgeGatewayValidationError(
          "Edge execution journal could not store the device terminal ACK",
        );
      }
      persistedTerminalRecord = completed.record;
      if (completed.record.ack === null) {
        throw new EdgeGatewayValidationError(
          "Edge execution journal did not preserve the device terminal ACK",
        );
      }
      return completed.record.ack;
    };
    try {
      deviceResult = await this.device.executeCommand(command, persistTerminalAck);
    } catch {
      if (persistedTerminalRecord !== null) {
        return this.submitStoredAck(persistedTerminalRecord);
      }
      return this.completeAndSubmit(
        command,
        createFailureAck(command, "failed", "execution_failed", this.now()),
      );
    }

    if (persistedTerminalRecord !== null) {
      return this.submitStoredAck(persistedTerminalRecord);
    }

    const ack = parseDeviceAck(command, deviceResult)
      ?? createFailureAck(command, "failed", "execution_failed", this.now());
    return this.completeAndSubmit(command, ack);
  }

  private async completeAndSubmit(
    command: Command,
    ack: CommandAck,
  ): Promise<ProcessNextCommandResult> {
    const completed = this.repository.completeAndEnqueueAck(
      command.id,
      ack,
      this.now().toISOString(),
    );
    if (completed.kind === "conflict" || completed.kind === "not_found") {
      throw new EdgeGatewayValidationError("Edge execution journal could not store the terminal ACK");
    }
    return this.submitStoredAck(completed.record);
  }

  private async submitStoredAck(
    record: EdgeExecutionRecord,
  ): Promise<ProcessNextCommandResult> {
    if (record.state !== "terminal" || record.ack === null) {
      throw new EdgeGatewayValidationError("Edge execution journal terminal record is invalid");
    }

    const ack = record.ack;
    if (ack.schemaVersion === "smartfarm.command-ack.v2") {
      const causeOperation = this.commandOperations.get(ack.causedByCommandId);
      if (causeOperation !== undefined) await causeOperation;

      const causeRecord = this.repository.get(ack.causedByCommandId);
      if (
        causeRecord === null
        || causeRecord.state !== "terminal"
        || !isPumpStopCommand(causeRecord.command)
        || causeRecord.ack?.status !== "acknowledged"
        || causeRecord.ack.result?.pumpState !== "off"
      ) {
        throw new EdgeGatewayValidationError(
          "Manual stop cause has no durable final-off acknowledgement",
        );
      }
      if (causeRecord.ackDelivery === "pending") {
        await this.submitStoredAck(causeRecord);
      }
    }

    const projectionInput = await this.api.submitAck(this.farmId, ack);
    const projection = CommandProjectionSchema.safeParse(projectionInput);
    if (!projection.success) {
      throw new EdgeGatewayValidationError(
        "Central API command projection did not match the contract",
      );
    }

    const delivered = this.repository.markAckDelivered(
      record.command.id,
      ack,
      projection.data,
      this.now().toISOString(),
    );
    if (delivered.kind === "conflict" || delivered.kind === "not_found") {
      throw new EdgeGatewayValidationError(
        "Central API acknowledgement result did not match the durable Edge record",
      );
    }
    return { kind: "processed", projection: projection.data };
  }
}

function parseDeviceAck(command: Command, input: unknown): CommandAck | null {
  const parsed = CommandAckSchema.safeParse(input);
  if (!parsed.success) return null;

  return isCommandAckCompatible(command, parsed.data)
    && Date.parse(parsed.data.processedAt) >= Date.parse(command.issuedAt)
    ? parsed.data
    : null;
}

function createFailureAck(
  command: Command,
  status: "rejected" | "failed" | "timed_out",
  reasonCode: Extract<CommandAckReasonCode, "scope_mismatch" | "expired" | "execution_failed">,
  processedAt: Date,
): CommandAck {
  return CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: command.id,
    farmId: command.farmId,
    deviceId: command.deviceId,
    status,
    reasonCode,
    result: null,
    processedAt: processedAt.toISOString(),
  });
}

function createManualStopAck(
  command: Command,
  causedByCommandId: Command["id"],
  processedAt: Date,
  status: "rejected" | "failed",
): CommandAck {
  return CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v2",
    commandId: command.id,
    farmId: command.farmId,
    deviceId: command.deviceId,
    status,
    reasonCode: "manual_stop",
    result: null,
    causedByCommandId,
    processedAt: processedAt.toISOString(),
  });
}

function isPumpActivationCommand(command: Command): boolean {
  return command.schemaVersion === "smartfarm.command.v2"
    || command.payload.state === "on";
}
