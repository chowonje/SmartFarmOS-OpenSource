import { createHash } from "node:crypto";
import {
  AuditEventSchema,
  CommandAckSchema,
  CommandActorSchema,
  CommandProjectionSchema,
  IrrigationStrategyPathParamsSchema,
  IrrigationStrategySchema,
  IrrigationStrategyListQuerySchema,
  IrrigationStrategyListResponseSchema,
  ApplyIrrigationStrategyRequestSchema,
  StrategyApplicationPathParamsSchema,
  StrategyApplicationResponseSchema,
  StrategyApplicationSchema,
  StrategyApplicationTargetSchema,
  commandRequestedPumpState,
  type AuditEvent,
  type Command,
  type CommandAck,
  type CommandActor,
  type CommandLifecycleStatus,
  type CommandProjection,
  type CropCycleId,
  type DeviceId,
  type FarmId,
  type GrowingAreaId,
  type IrrigationStrategy,
  type IrrigationStrategyPathParams,
  type IrrigationStrategyListQuery,
  type IrrigationStrategyListResponse,
  type IrrigationStrategyVersion,
  type PumpState,
  type StrategyApplication,
  type StrategyApplicationPathParams,
  type StrategyApplicationResponse,
  type StrategyApplicationStatus,
  type StrategyApplicationTarget,
  type ApplyIrrigationStrategyRequest,
} from "@smartfarm-os/contracts";

export {
  IrrigationStrategyPathParamsSchema,
  IrrigationStrategySchema,
  IrrigationStrategyListQuerySchema,
  IrrigationStrategyListResponseSchema,
  ApplyIrrigationStrategyRequestSchema,
  StrategyApplicationPathParamsSchema,
  StrategyApplicationResponseSchema,
};

export type {
  ApplyIrrigationStrategyRequest,
  IrrigationStrategy,
  IrrigationStrategyListQuery,
  IrrigationStrategyListResponse,
  IrrigationStrategyPathParams,
  IrrigationStrategyVersion,
  StrategyApplication,
  StrategyApplicationPathParams,
  StrategyApplicationResponse,
  StrategyApplicationTarget,
};

export type StrategyApplicationCommandTarget = {
  readonly areaId: GrowingAreaId;
  readonly deviceId: DeviceId;
  readonly command: Command;
};

export type SeedIrrigationStrategyResult =
  | { readonly kind: "created"; readonly strategy: IrrigationStrategy }
  | { readonly kind: "replayed"; readonly strategy: IrrigationStrategy }
  | { readonly kind: "conflict"; readonly reason: string };

export type CreateStrategyApplicationResult =
  | { readonly kind: "created"; readonly application: StrategyApplication }
  | { readonly kind: "replayed"; readonly application: StrategyApplication }
  | { readonly kind: "conflict"; readonly reason: string };

export function parseIrrigationStrategy(input: unknown): IrrigationStrategy {
  return IrrigationStrategySchema.parse(input);
}

export function parseStrategyApplication(input: unknown): StrategyApplication {
  return StrategyApplicationSchema.parse(input);
}

export function createStrategyFingerprint(input: {
  readonly cycleId: CropCycleId;
  readonly strategyId: string;
  readonly strategyVersion: IrrigationStrategyVersion;
  readonly pumpState: PumpState;
  readonly runDurationSeconds?: number;
  readonly targets: readonly { readonly areaId: GrowingAreaId; readonly deviceId: DeviceId }[];
}): string {
  const normalizedTargets = [...input.targets]
    .sort((left, right) =>
      left.areaId.localeCompare(right.areaId)
      || left.deviceId.localeCompare(right.deviceId),
    )
    .map((target) => ({ areaId: target.areaId, deviceId: target.deviceId }));

  return JSON.stringify({
    cycleId: input.cycleId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    pumpState: input.pumpState,
    ...(input.runDurationSeconds === undefined
      ? {}
      : { runDurationSeconds: input.runDurationSeconds }),
    targets: normalizedTargets,
  });
}

export function createPendingStrategyApplication(input: {
  readonly id: string;
  readonly farmId: FarmId;
  readonly cycleId: CropCycleId;
  readonly strategy: IrrigationStrategy;
  readonly actor: CommandActor;
  readonly idempotencyKey: string;
  readonly targets: readonly StrategyApplicationCommandTarget[];
  readonly createdAt: string;
}): StrategyApplication {
  return StrategyApplicationSchema.parse({
    schemaVersion: "smartfarm.strategy-application.v1",
    id: input.id,
    farmId: input.farmId,
    cycleId: input.cycleId,
    strategyId: input.strategy.id,
    strategyVersion: input.strategy.version,
    strategyName: input.strategy.name,
    pumpState: input.strategy.pumpState,
    ...(input.strategy.runDurationSeconds === undefined
      ? {}
      : { runDurationSeconds: input.strategy.runDurationSeconds }),
    actor: input.actor,
    idempotencyKey: input.idempotencyKey,
    targets: input.targets.map((target) => ({
      schemaVersion: "smartfarm.strategy-application-target.v1",
      areaId: target.areaId,
      deviceId: target.deviceId,
      commandId: target.command.id,
      status: "pending",
      reasonCode: null,
      resultingPumpState: null,
      updatedAt: input.createdAt,
    })),
    status: "pending",
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

export function validateStrategyApplicationCommandTargets(
  application: StrategyApplication,
  commands: readonly StrategyApplicationCommandTarget[],
): string | null {
  if (
    application.status !== "pending"
    || application.targets.some((target) => target.status !== "pending")
  ) {
    return "Strategy application creation requires pending targets";
  }
  if (application.targets.length !== commands.length) {
    return "Strategy application targets do not match commands";
  }

  const commandsById = new Map(commands.map((target) => [target.command.id, target]));
  if (commandsById.size !== commands.length) {
    return "Strategy application commands must be unique";
  }

  for (const target of application.targets) {
    const mapped = commandsById.get(target.commandId);
    if (
      mapped === undefined
      || mapped.areaId !== target.areaId
      || mapped.deviceId !== target.deviceId
      || mapped.command.farmId !== application.farmId
      || mapped.command.deviceId !== mapped.deviceId
      || mapped.command.actor.type !== application.actor.type
      || mapped.command.actor.id !== application.actor.id
      || commandRequestedPumpState(mapped.command) !== application.pumpState
      || !commandMatchesApplicationDuration(mapped.command, application.runDurationSeconds)
    ) {
      return "Strategy application targets do not match commands";
    }
  }

  return null;
}

export function applyAckToStrategyApplication(
  application: StrategyApplication,
  ack: CommandAck,
  updatedAt: string,
): StrategyApplication {
  const targets = application.targets.map((target) => {
    if (target.commandId !== ack.commandId) return target;

    return StrategyApplicationTargetSchema.parse({
      ...target,
      status: ackToTargetStatus(ack),
      reasonCode: ack.reasonCode,
      resultingPumpState: ack.result?.pumpState ?? null,
      updatedAt,
    });
  });

  return StrategyApplicationSchema.parse({
    ...application,
    targets,
    status: aggregateApplicationStatus(targets),
    updatedAt,
  });
}

export function buildCommandCompletedAuditEvent(input: {
  readonly application: StrategyApplication;
  readonly target: StrategyApplicationTarget;
  readonly ack: CommandAck;
  readonly occurredAt: string;
}): AuditEvent {
  return AuditEventSchema.parse({
    schemaVersion: "smartfarm.audit-event.v1",
    id: createDeterministicIrrigationAuditId(
      input.application.farmId,
      input.application.id,
      input.target.commandId,
      "command.completed",
    ),
    farmId: input.application.farmId,
    cycleId: input.application.cycleId,
    actor: input.application.actor,
    action: "command.completed",
    targetType: "command",
    targetId: input.target.commandId,
    result: input.target.status === "acknowledged" ? "success" : "failure",
    occurredAt: input.occurredAt,
    details: {
      applicationId: input.application.id,
      areaId: input.target.areaId,
      deviceId: input.target.deviceId,
      status: input.target.status,
      reasonCode: input.target.reasonCode,
      resultingPumpState: input.target.resultingPumpState,
      ...(input.ack.schemaVersion === "smartfarm.command-ack.v2"
        ? { manualStopCommandId: input.ack.causedByCommandId }
        : {}),
      ...(input.application.runDurationSeconds === undefined
        ? {}
        : { runDurationSeconds: input.application.runDurationSeconds }),
    },
  });
}

export function buildStrategyAppliedAuditEvent(
  application: StrategyApplication,
): AuditEvent {
  return AuditEventSchema.parse({
    schemaVersion: "smartfarm.audit-event.v1",
    id: createDeterministicIrrigationAuditId(
      application.farmId,
      application.id,
      "strategy.applied",
    ),
    farmId: application.farmId,
    cycleId: application.cycleId,
    actor: application.actor,
    action: "strategy.applied",
    targetType: "strategy_application",
    targetId: application.id,
    result: application.status === "succeeded" ? "success" : "failure",
    occurredAt: application.updatedAt,
    details: {
      strategyId: application.strategyId,
      strategyVersion: application.strategyVersion,
      status: application.status,
      ...(application.runDurationSeconds === undefined
        ? {}
        : { runDurationSeconds: application.runDurationSeconds }),
      totalTargets: application.targets.length,
      acknowledgedTargets: application.targets.filter((target) => target.status === "acknowledged").length,
      failedTargets: application.targets.filter((target) => target.status === "failed").length,
      timedOutTargets: application.targets.filter((target) => target.status === "timed_out").length,
    },
  });
}

export function strategyIdentityKey(
  farmId: FarmId,
  strategyId: string,
  version: number,
): string {
  return `${farmId}\u0000${strategyId}\u0000${version}`;
}

export function strategyApplicationScopeKey(
  farmId: FarmId,
  applicationId: string,
): string {
  return `${farmId}\u0000${applicationId}`;
}

export function strategyApplicationIdempotencyKey(
  farmId: FarmId,
  actorId: string,
  idempotencyKey: string,
): string {
  return `${farmId}\u0000${actorId}\u0000${idempotencyKey}`;
}

export function commandToApplicationScopeKey(commandId: string): string {
  return commandId;
}

export function createDeterministicIrrigationAuditId(
  farmId: FarmId,
  ...parts: readonly string[]
): string {
  const hash = createHash("sha256");
  hash.update(farmId);
  hash.update("\u0000");
  for (const part of parts) {
    hash.update(part);
    hash.update("\u0000");
  }

  return `audit:${hash.digest("hex").slice(0, 24)}`;
}

export function deriveStrategyCommandIdempotencyKey(
  applicationIdempotencyKey: string,
  deviceId: string,
): string {
  const hash = createHash("sha256");
  hash.update(applicationIdempotencyKey);
  hash.update("\u0000");
  hash.update(deviceId);
  return `strategy-command:${hash.digest("hex").slice(0, 32)}`;
}

export function strategyPayloadFingerprint(strategy: IrrigationStrategy): string {
  return JSON.stringify({
    approvedAt: strategy.approvedAt,
    createdAt: strategy.createdAt,
    cycleId: strategy.cycleId,
    description: strategy.description,
    farmId: strategy.farmId,
    id: strategy.id,
    name: strategy.name,
    pumpState: strategy.pumpState,
    ...(strategy.runDurationSeconds === undefined
      ? {}
      : { runDurationSeconds: strategy.runDurationSeconds }),
    status: strategy.status,
    version: strategy.version,
  });
}

export function applicationIntentFingerprint(input: {
  readonly cycleId: CropCycleId;
  readonly strategyId: string;
  readonly strategyVersion: number;
  readonly pumpState: PumpState;
  readonly runDurationSeconds?: number;
  readonly targets: readonly { readonly areaId: GrowingAreaId; readonly deviceId: DeviceId }[];
}): string {
  return createStrategyFingerprint({
    cycleId: input.cycleId,
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    pumpState: input.pumpState,
    ...(input.runDurationSeconds === undefined
      ? {}
      : { runDurationSeconds: input.runDurationSeconds }),
    targets: input.targets,
  });
}

function commandMatchesApplicationDuration(
  command: Command,
  runDurationSeconds: number | undefined,
): boolean {
  if (runDurationSeconds === undefined) {
    return command.schemaVersion === "smartfarm.command.v1";
  }

  return command.schemaVersion === "smartfarm.command.v2"
    && command.payload.durationSeconds === runDurationSeconds;
}

export function compareIrrigationStrategies(
  left: IrrigationStrategy,
  right: IrrigationStrategy,
): number {
  return right.createdAt.localeCompare(left.createdAt)
    || left.id.localeCompare(right.id)
    || left.version - right.version;
}

export function compareStrategyApplications(
  left: StrategyApplication,
  right: StrategyApplication,
): number {
  return right.updatedAt.localeCompare(left.updatedAt)
    || right.createdAt.localeCompare(left.createdAt)
    || left.id.localeCompare(right.id);
}

export function aggregateApplicationStatus(
  targets: readonly StrategyApplicationTarget[],
): StrategyApplicationStatus {
  if (targets.some((target) => target.status === "pending")) {
    return "pending";
  }
  if (targets.every((target) => target.status === "acknowledged")) {
    return "succeeded";
  }
  if (targets.every((target) => target.status === "failed" || target.status === "timed_out")) {
    return "failed";
  }
  return "partial";
}

export function ackToTargetStatus(ack: CommandAck): CommandLifecycleStatus {
  if (ack.status === "acknowledged") return "acknowledged";
  if (ack.status === "timed_out") return "timed_out";
  return "failed";
}

export function parseCommandProjection(value: unknown): CommandProjection {
  return CommandProjectionSchema.parse(value);
}

export function parseCommandActor(value: unknown): CommandActor {
  return CommandActorSchema.parse(value);
}

export function parseCommandAck(value: unknown): CommandAck {
  return CommandAckSchema.parse(value);
}
