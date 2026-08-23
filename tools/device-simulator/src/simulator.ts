import {
  CommandAckSchema,
  CommandSchema,
  DeviceIdSchema,
  FarmIdSchema,
  TelemetryMetricSchema,
  TelemetrySchema,
  isCommandExpired,
  isPumpStopCommand,
  type Command,
  type CommandAck,
  type DeviceId,
  type FarmId,
  type PumpState,
  type Telemetry,
  type TelemetryMetric,
  type TimedPumpCommand,
} from "@smartfarm-os/contracts";

export type DeviceSimulatorOptions = {
  readonly farmId: string;
  readonly deviceId: string;
  readonly initialPumpState?: PumpState;
  readonly initialSequence?: number;
  readonly now?: () => Date;
  readonly wait?: (durationMs: number) => Promise<void>;
};

export type TerminalAckObserver = (ack: CommandAck) => void;

type ProcessedCommand = {
  readonly command: Command;
  readonly fingerprint: string;
  readonly ack: CommandAck;
};

type InFlightCommand = {
  readonly fingerprint: string;
  readonly promise: Promise<CommandAck>;
};

type ActiveTimedRun = {
  readonly command: TimedPumpCommand;
  readonly fingerprint: string;
  readonly onTerminalAck: TerminalAckObserver | undefined;
  readonly cancellation: Promise<CommandAck>;
  readonly resolveCancellation: (ack: CommandAck) => void;
  terminalAck: CommandAck | null;
};

export class DeviceSimulator {
  readonly farmId: FarmId;
  readonly deviceId: DeviceId;

  private readonly now: () => Date;
  private readonly wait: (durationMs: number) => Promise<void>;
  private readonly processedByCommandId = new Map<string, ProcessedCommand>();
  private readonly inFlightByCommandId = new Map<string, InFlightCommand>();
  private readonly commandIdByIdempotencyScope = new Map<string, string>();
  private activeTimedRun: ActiveTimedRun | null = null;
  private sequence = 0;
  private pumpState: PumpState;

  constructor(options: DeviceSimulatorOptions) {
    this.farmId = FarmIdSchema.parse(options.farmId);
    this.deviceId = DeviceIdSchema.parse(options.deviceId);
    this.pumpState = options.initialPumpState ?? "off";
    this.sequence = parseInitialSequence(options.initialSequence);
    this.now = options.now ?? (() => new Date());
    this.wait = options.wait ?? waitForDuration;
  }

  currentPumpState(): PumpState {
    return this.pumpState;
  }

  emitTelemetry(metricInput: TelemetryMetric, value: number): Telemetry {
    const metric = TelemetryMetricSchema.parse(metricInput);
    const deviceSlug = this.deviceId.slice("device:".length).slice(0, 50);
    const nextSequence = this.sequence + 1;
    const unitByMetric: Record<TelemetryMetric, "celsius" | "percent" | "lux"> = {
      temperature: "celsius",
      humidity: "percent",
      illuminance: "lux",
      water_level: "percent",
    };

    const telemetry = TelemetrySchema.parse({
      schemaVersion: "smartfarm.telemetry.v1",
      id: `telemetry:${deviceSlug}-${nextSequence.toString().padStart(6, "0")}`,
      farmId: this.farmId,
      deviceId: this.deviceId,
      metric,
      value,
      unit: unitByMetric[metric],
      sequence: nextSequence,
      observedAt: this.now().toISOString(),
    });
    this.sequence = nextSequence;
    return telemetry;
  }

  emitTemperature(value: number): Telemetry {
    return this.emitTelemetry("temperature", value);
  }

  handleCommand(
    input: unknown,
    onTerminalAck?: TerminalAckObserver,
  ): CommandAck | Promise<CommandAck> {
    const command = CommandSchema.parse(input);
    const fingerprint = JSON.stringify(command);
    const processedAt = this.now();
    const existing = this.processedByCommandId.get(command.id);

    if (existing !== undefined) {
      if (existing.fingerprint === fingerprint) {
        return this.publishTerminalAck(existing.ack, onTerminalAck);
      }

      return this.publishTerminalAck(
        this.createFailureAck(command, "idempotency_conflict", "rejected", processedAt),
        onTerminalAck,
      );
    }

    const inFlight = this.inFlightByCommandId.get(command.id);
    if (inFlight !== undefined) {
      return inFlight.fingerprint === fingerprint
        ? inFlight.promise
        : this.publishTerminalAck(
          this.createFailureAck(
            command,
            "idempotency_conflict",
            "rejected",
            processedAt,
          ),
          onTerminalAck,
        );
    }

    const idempotencyScope = commandIdempotencyScope(command);
    const commandForKey = this.commandIdByIdempotencyScope.get(idempotencyScope);

    if (commandForKey !== undefined && commandForKey !== command.id) {
      const ack = this.createFailureAck(
        command,
        "idempotency_conflict",
        "rejected",
        processedAt,
      );
      this.remember(command, fingerprint, ack, false);
      return this.publishTerminalAck(ack, onTerminalAck);
    }

    let ack: CommandAck;

    if (command.farmId !== this.farmId || command.deviceId !== this.deviceId) {
      ack = this.createFailureAck(command, "scope_mismatch", "rejected", processedAt);
    } else if (isCommandExpired(command, processedAt)) {
      ack = this.createFailureAck(command, "expired", "timed_out", processedAt);
    } else if (command.schemaVersion === "smartfarm.command.v2") {
      if (this.activeTimedRun !== null) {
        ack = this.createFailureAck(command, "execution_failed", "failed", processedAt);
        this.remember(command, fingerprint, ack, true);
        return this.publishTerminalAck(ack, onTerminalAck);
      }
      this.commandIdByIdempotencyScope.set(idempotencyScope, command.id);
      const promise = this.executeTimedPumpCommand(command, fingerprint, onTerminalAck)
        .finally(() => {
          this.inFlightByCommandId.delete(command.id);
        });
      this.inFlightByCommandId.set(command.id, { fingerprint, promise });
      return promise;
    } else {
      if (isPumpStopCommand(command)) {
        this.cancelActiveTimedRun(command, processedAt);
      } else if (this.activeTimedRun !== null) {
        ack = this.createFailureAck(command, "execution_failed", "failed", processedAt);
        this.remember(command, fingerprint, ack, true);
        return this.publishTerminalAck(ack, onTerminalAck);
      }
      this.pumpState = command.payload.state;
      ack = CommandAckSchema.parse({
        schemaVersion: "smartfarm.command-ack.v1",
        commandId: command.id,
        farmId: command.farmId,
        deviceId: command.deviceId,
        status: "acknowledged",
        reasonCode: null,
        result: { pumpState: this.pumpState },
        processedAt: processedAt.toISOString(),
      });
    }

    this.remember(command, fingerprint, ack, true);
    return this.publishTerminalAck(ack, onTerminalAck);
  }

  private createFailureAck(
    command: Command,
    reasonCode: "scope_mismatch" | "expired" | "idempotency_conflict" | "execution_failed",
    status: "rejected" | "failed" | "timed_out",
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

  private async executeTimedPumpCommand(
    command: TimedPumpCommand,
    fingerprint: string,
    onTerminalAck?: TerminalAckObserver,
  ): Promise<CommandAck> {
    this.pumpState = "on";
    let resolveCancellation = (_ack: CommandAck): void => {
      throw new Error("Timed pump cancellation was not initialized");
    };
    const cancellation = new Promise<CommandAck>((resolve) => {
      resolveCancellation = resolve;
    });
    const activeRun: ActiveTimedRun = {
      command,
      fingerprint,
      onTerminalAck,
      cancellation,
      resolveCancellation,
      terminalAck: null,
    };
    this.activeTimedRun = activeRun;

    let ack: CommandAck;
    try {
      const outcome = await Promise.race([
        this.wait(command.payload.durationSeconds * 1_000).then(
          () => ({ kind: "elapsed" as const }),
          () => ({ kind: "failed" as const }),
        ),
        cancellation.then((cancelledAck) => ({
          kind: "cancelled" as const,
          ack: cancelledAck,
        })),
      ]);
      if (activeRun.terminalAck !== null) return activeRun.terminalAck;
      if (outcome.kind === "cancelled") return outcome.ack;

      this.pumpState = "off";
      ack = outcome.kind === "elapsed"
        ? CommandAckSchema.parse({
          schemaVersion: "smartfarm.command-ack.v1",
          commandId: command.id,
          farmId: command.farmId,
          deviceId: command.deviceId,
          status: "acknowledged",
          reasonCode: null,
          result: { pumpState: "off" },
          processedAt: this.now().toISOString(),
        })
        : this.createFailureAck(
          command,
          "execution_failed",
          "failed",
          this.now(),
        );
    } finally {
      if (this.activeTimedRun === activeRun) this.activeTimedRun = null;
    }

    this.remember(command, fingerprint, ack, false);
    return this.publishTerminalAck(ack, onTerminalAck);
  }

  private cancelActiveTimedRun(stopCommand: Command, processedAt: Date): void {
    const activeRun = this.activeTimedRun;
    if (activeRun === null || activeRun.terminalAck !== null) return;

    this.pumpState = "off";
    const ack = CommandAckSchema.parse({
      schemaVersion: "smartfarm.command-ack.v2",
      commandId: activeRun.command.id,
      farmId: activeRun.command.farmId,
      deviceId: activeRun.command.deviceId,
      status: "failed",
      reasonCode: "manual_stop",
      result: null,
      causedByCommandId: stopCommand.id,
      processedAt: processedAt.toISOString(),
    });
    activeRun.terminalAck = ack;
    this.remember(activeRun.command, activeRun.fingerprint, ack, false);
    try {
      this.publishTerminalAck(ack, activeRun.onTerminalAck);
    } finally {
      if (this.activeTimedRun === activeRun) this.activeTimedRun = null;
      activeRun.resolveCancellation(ack);
    }
  }

  private publishTerminalAck(
    ack: CommandAck,
    onTerminalAck: TerminalAckObserver | undefined,
  ): CommandAck {
    onTerminalAck?.(ack);
    return ack;
  }

  private remember(
    command: Command,
    fingerprint: string,
    ack: CommandAck,
    reserveIdempotencyKey: boolean,
  ): void {
    this.processedByCommandId.set(command.id, { command, fingerprint, ack });

    if (reserveIdempotencyKey) {
      this.commandIdByIdempotencyScope.set(
        commandIdempotencyScope(command),
        command.id,
      );
    }
  }
}

function commandIdempotencyScope(command: Command): string {
  return `${command.actor.id}\u0000${command.idempotencyKey}`;
}

function waitForDuration(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function parseInitialSequence(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Device simulator initial sequence must be a non-negative integer");
  }
  return value;
}
