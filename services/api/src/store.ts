import {
  type AlarmInstance,
  type AlarmRule,
  type AuditEvent,
  type CommandActor,
  type EdgeCredentialId,
  type EdgeCredentialRecord,
  EdgeCredentialRecordSchema,
  CropCycleDetailSchema,
  CommandProjectionSchema,
  type Command,
  type CommandAck,
  type CommandProjection,
  type CropCycleDetail,
  type CropCycleId,
  type CropId,
  type CropRecord,
  type Device,
  type DeviceId,
  type Farm,
  type FarmControlProfile,
  type FarmId,
  type GatewayEnrollmentId,
  type GatewayEnrollmentRecord,
  GatewayEnrollmentRecordSchema,
  GrowingAreaSchema,
  FarmControlProfileSchema,
  type IrrigationStrategy,
  type GrowingAreaId,
  type GrowingArea,
  type StrategyApplication,
  type Telemetry,
  type TelemetryMetric,
  isCommandAckCompatible,
} from "@smartfarm-os/contracts";
import {
  acknowledgeAlarmInstance,
  alarmInstanceScopeKey,
  alarmRuleScopeKey,
  buildAlarmAuditEvent,
  clearAlarmInstance,
  compareAlarmInstances,
  compareAlarmRules,
  compareAuditEvents,
  createDeterministicEntityId,
  isTelemetryBreached,
  openAlarmInstance,
  parseAcknowledgeAlarmInput,
  parseAlarmRule,
  updateAlarmInstance,
  type AcknowledgeAlarmInput,
  type AcknowledgeAlarmResult,
  type AlarmInstanceListOptions,
  type AuditEventListOptions,
} from "./alarm-center.js";
import { buildDirectCommandCompletedAuditEvent } from "./command-audit.js";
import {
  applyAckToStrategyApplication as applyAckToStrategyApplicationProjection,
  ackToTargetStatus,
  aggregateApplicationStatus,
  applicationIntentFingerprint,
  buildCommandCompletedAuditEvent,
  buildStrategyAppliedAuditEvent,
  commandToApplicationScopeKey,
  compareIrrigationStrategies,
  compareStrategyApplications,
  createPendingStrategyApplication,
  parseIrrigationStrategy,
  parseStrategyApplication,
  strategyApplicationIdempotencyKey,
  strategyApplicationScopeKey,
  strategyIdentityKey,
  strategyPayloadFingerprint,
  validateStrategyApplicationCommandTargets,
  type CreateStrategyApplicationResult,
  type SeedIrrigationStrategyResult,
  type StrategyApplicationCommandTarget,
} from "./irrigation-center.js";

export type PutTelemetryResult =
  | { readonly kind: "accepted" }
  | { readonly kind: "replayed" }
  | { readonly kind: "conflict"; readonly reason: string };

export type CreateCommandResult =
  | { readonly kind: "created"; readonly projection: CommandProjection }
  | { readonly kind: "replayed"; readonly projection: CommandProjection }
  | { readonly kind: "conflict"; readonly reason: string };

export type ApplyAckResult =
  | { readonly kind: "applied"; readonly projection: CommandProjection }
  | { readonly kind: "replayed"; readonly projection: CommandProjection }
  | { readonly kind: "not_found" }
  | { readonly kind: "conflict"; readonly reason: string };

export type CreateCropResult =
  | { readonly kind: "created"; readonly crop: CropRecord }
  | { readonly kind: "conflict"; readonly reason: string };

export type UpdateCropResult =
  | { readonly kind: "updated"; readonly crop: CropRecord }
  | { readonly kind: "not_found" };

export type CreateCropCycleResult =
  | { readonly kind: "created"; readonly cropCycle: CropCycleDetail }
  | { readonly kind: "conflict"; readonly reason: string };

export type UpdateCropCycleResult =
  | { readonly kind: "updated"; readonly cropCycle: CropCycleDetail }
  | { readonly kind: "not_found" }
  | { readonly kind: "conflict"; readonly reason: string };

export type CommandListOptions = {
  readonly deviceId?: DeviceId;
  readonly limit?: number;
};

export type UpdateFarmControlProfileResult =
  | { readonly kind: "updated"; readonly profile: FarmControlProfile }
  | { readonly kind: "conflict"; readonly reason: string };

export type IrrigationStrategyListOptions = {
  readonly cycleId: CropCycleId;
};

export type GatewayAccessListOptions = {
  readonly limit?: number;
  readonly now: string;
};

export type IssueGatewayEnrollmentInput = {
  readonly id: GatewayEnrollmentId;
  readonly farmId: FarmId;
  readonly deviceId: DeviceId;
  readonly tokenDigest: string;
  readonly issuedByActorId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
};

export type GatewayEnrollmentAuthenticationMaterial = {
  readonly enrollmentId: GatewayEnrollmentId;
  readonly farmId: FarmId;
  readonly deviceId: DeviceId;
  readonly tokenDigest: string;
  readonly issuedByActorId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly exchangedAt: string | null;
  readonly exchangedCredentialId: EdgeCredentialId | null;
  readonly revokedAt: string | null;
  readonly revokedByActorId: string | null;
};

export type ExchangeGatewayEnrollmentInput = {
  readonly enrollmentId: GatewayEnrollmentId;
  readonly expectedTokenDigest: string;
  readonly credentialId: EdgeCredentialId;
  readonly credentialDigest: string;
  readonly exchangedAt: string;
};

export type ExchangeGatewayEnrollmentResult =
  | { readonly kind: "exchanged"; readonly credential: EdgeCredentialRecord }
  | { readonly kind: "invalid" };

export type RevokeGatewayEnrollmentInput = {
  readonly farmId: FarmId;
  readonly deviceId: DeviceId;
  readonly enrollmentId: GatewayEnrollmentId;
  readonly revokedAt: string;
  readonly revokedByActorId: string;
};

export type RevokeGatewayEnrollmentResult =
  | { readonly kind: "revoked"; readonly enrollment: GatewayEnrollmentRecord }
  | { readonly kind: "replayed"; readonly enrollment: GatewayEnrollmentRecord }
  | { readonly kind: "not_found" }
  | { readonly kind: "conflict"; readonly reason: string };

export type EdgeCredentialAuthenticationMaterial = {
  readonly credentialId: EdgeCredentialId;
  readonly farmId: FarmId;
  readonly deviceId: DeviceId;
  readonly credentialDigest: string;
  readonly createdFromEnrollmentId: GatewayEnrollmentId;
  readonly createdAt: string;
  readonly revokedAt: string | null;
  readonly revokedByActorId: string | null;
};

export type RevokeEdgeCredentialInput = {
  readonly farmId: FarmId;
  readonly deviceId: DeviceId;
  readonly credentialId: EdgeCredentialId;
  readonly revokedAt: string;
  readonly revokedByActorId: string;
};

export type RevokeEdgeCredentialResult =
  | { readonly kind: "revoked"; readonly credential: EdgeCredentialRecord }
  | { readonly kind: "replayed"; readonly credential: EdgeCredentialRecord }
  | { readonly kind: "not_found" };

export interface SmartFarmStore {
  listFarms(): readonly Farm[];
  getFarm(farmId: FarmId): Farm | null;
  upsertFarm(farm: Farm): void;
  listDevices(farmId: FarmId): readonly Device[];
  getDevice(farmId: FarmId, deviceId: DeviceId): Device | null;
  upsertDevice(device: Device): void;
  listGrowingAreas(farmId: FarmId): readonly GrowingArea[];
  getGrowingArea(farmId: FarmId, areaId: GrowingAreaId): GrowingArea | null;
  upsertGrowingArea(area: GrowingArea): void;
  listCrops(farmId: FarmId): readonly CropRecord[];
  getCrop(farmId: FarmId, cropId: CropId): CropRecord | null;
  createCrop(crop: CropRecord): CreateCropResult;
  updateCrop(crop: CropRecord): UpdateCropResult;
  deleteCrop(farmId: FarmId, cropId: CropId): boolean;
  upsertCrop(crop: CropRecord): void;
  listCropCycles(farmId: FarmId): readonly CropCycleDetail[];
  getCropCycle(farmId: FarmId, cropCycleId: CropCycleId): CropCycleDetail | null;
  createCropCycle(cropCycle: CropCycleDetail): CreateCropCycleResult;
  updateCropCycle(cropCycle: CropCycleDetail): UpdateCropCycleResult;
  listAlarmRules(farmId: FarmId): readonly AlarmRule[];
  upsertAlarmRule(rule: AlarmRule): void;
  listAlarmInstances(
    farmId: FarmId,
    options?: AlarmInstanceListOptions,
  ): readonly AlarmInstance[];
  getAlarmInstance(farmId: FarmId, alarmId: string): AlarmInstance | null;
  acknowledgeAlarm(input: AcknowledgeAlarmInput): AcknowledgeAlarmResult;
  listAuditEvents(farmId: FarmId, options?: AuditEventListOptions): readonly AuditEvent[];
  seedIrrigationStrategy(strategy: IrrigationStrategy): SeedIrrigationStrategyResult;
  listIrrigationStrategies(
    farmId: FarmId,
    cycleId: CropCycleId,
  ): readonly IrrigationStrategy[];
  getIrrigationStrategy(
    farmId: FarmId,
    strategyId: string,
    version: number,
  ): IrrigationStrategy | null;
  createStrategyApplication(
    application: StrategyApplication,
    commands: readonly StrategyApplicationCommandTarget[],
  ): CreateStrategyApplicationResult;
  getStrategyApplication(farmId: FarmId, applicationId: string): StrategyApplication | null;
  putTelemetry(telemetry: Telemetry): PutTelemetryResult;
  latestTelemetry(
    farmId: FarmId,
    deviceId: DeviceId,
    metric: TelemetryMetric,
  ): Telemetry | null;
  recentTelemetry(
    farmId: FarmId,
    deviceId: DeviceId,
    metric: TelemetryMetric,
    limit: number,
  ): readonly Telemetry[];
  createCommand(command: Command, updatedAt: string): CreateCommandResult;
  listCommands(farmId: FarmId, options?: CommandListOptions): readonly CommandProjection[];
  getCommand(commandId: string): CommandProjection | null;
  getFarmControlProfile(farmId: FarmId): FarmControlProfile | null;
  updateFarmControlProfile(profile: FarmControlProfile, expectedRevision: number): UpdateFarmControlProfileResult;
  issueGatewayEnrollment(input: IssueGatewayEnrollmentInput): GatewayEnrollmentRecord;
  listGatewayEnrollments(
    farmId: FarmId,
    deviceId: DeviceId,
    options: GatewayAccessListOptions,
  ): readonly GatewayEnrollmentRecord[];
  getGatewayEnrollmentAuthentication(
    enrollmentId: GatewayEnrollmentId,
  ): GatewayEnrollmentAuthenticationMaterial | null;
  exchangeGatewayEnrollment(
    input: ExchangeGatewayEnrollmentInput,
  ): ExchangeGatewayEnrollmentResult;
  revokeGatewayEnrollment(
    input: RevokeGatewayEnrollmentInput,
  ): RevokeGatewayEnrollmentResult;
  listEdgeCredentials(
    farmId: FarmId,
    deviceId: DeviceId,
    options: GatewayAccessListOptions,
  ): readonly EdgeCredentialRecord[];
  getEdgeCredentialAuthentication(
    credentialId: EdgeCredentialId,
  ): EdgeCredentialAuthenticationMaterial | null;
  revokeEdgeCredential(input: RevokeEdgeCredentialInput): RevokeEdgeCredentialResult;
  nextPendingCommand(farmId: FarmId, deviceId: DeviceId): CommandProjection | null;
  nextPendingStopCommand(farmId: FarmId, deviceId: DeviceId): CommandProjection | null;
  applyAck(ack: CommandAck, updatedAt: string): ApplyAckResult;
}

type StoredTelemetry = {
  readonly fingerprint: string;
  readonly telemetry: Telemetry;
};

type StoredCommand = {
  readonly intentFingerprint: string;
  readonly projection: CommandProjection;
};

type StoredIrrigationStrategy = {
  readonly fingerprint: string;
  readonly strategy: IrrigationStrategy;
};

type StoredStrategyApplication = {
  readonly fingerprint: string;
  readonly application: StrategyApplication;
};

type StoredApplicationCommand = {
  readonly applicationId: string;
};

type StoredGatewayEnrollment = GatewayEnrollmentAuthenticationMaterial;

type StoredEdgeCredential = EdgeCredentialAuthenticationMaterial;

export class InMemorySmartFarmStore implements SmartFarmStore {
  private readonly farmById = new Map<FarmId, Farm>();
  private readonly deviceByScope = new Map<string, Device>();
  private readonly growingAreaByScope = new Map<string, GrowingArea>();
  private readonly cropById = new Map<CropId, CropRecord>();
  private readonly cropCycleByScope = new Map<string, CropCycleDetail>();
  private readonly alarmRuleByScope = new Map<string, AlarmRule>();
  private readonly alarmInstanceByScope = new Map<string, AlarmInstance>();
  private readonly activeAlarmIdByRuleScope = new Map<string, string>();
  private readonly auditEventByScope = new Map<string, AuditEvent>();
  private readonly auditEventIdByAckScope = new Map<string, string>();
  private readonly telemetryById = new Map<string, StoredTelemetry>();
  private readonly latestTelemetryByMetric = new Map<string, Telemetry>();
  private readonly commandById = new Map<string, StoredCommand>();
  private readonly commandIdByIdempotencyKey = new Map<string, string>();
  private readonly farmControlProfileByFarmId = new Map<FarmId, FarmControlProfile>();
  private readonly irrigationStrategyByScope = new Map<string, StoredIrrigationStrategy>();
  private readonly strategyApplicationByScope = new Map<string, StoredStrategyApplication>();
  private readonly strategyApplicationIdByIdempotencyKey = new Map<string, string>();
  private readonly strategyApplicationByCommandId = new Map<string, StoredApplicationCommand>();
  private readonly gatewayEnrollmentById = new Map<GatewayEnrollmentId, StoredGatewayEnrollment>();
  private readonly edgeCredentialById = new Map<EdgeCredentialId, StoredEdgeCredential>();

  listFarms(): readonly Farm[] {
    return [...this.farmById.values()].sort(compareFarms);
  }

  getFarm(farmId: FarmId): Farm | null {
    return this.farmById.get(farmId) ?? null;
  }

  upsertFarm(farm: Farm): void {
    this.farmById.set(farm.id, farm);
  }

  listDevices(farmId: FarmId): readonly Device[] {
    return [...this.deviceByScope.values()]
      .filter((device) => device.farmId === farmId)
      .sort(compareDevices);
  }

  getDevice(farmId: FarmId, deviceId: DeviceId): Device | null {
    return this.deviceByScope.get(deviceScopeKey(farmId, deviceId)) ?? null;
  }

  upsertDevice(device: Device): void {
    this.deviceByScope.set(deviceScopeKey(device.farmId, device.id), device);
  }

  listGrowingAreas(farmId: FarmId): readonly GrowingArea[] {
    return [...this.growingAreaByScope.values()]
      .filter((area) => area.farmId === farmId)
      .sort(compareGrowingAreas);
  }

  getGrowingArea(farmId: FarmId, areaId: GrowingAreaId): GrowingArea | null {
    return this.growingAreaByScope.get(growingAreaScopeKey(farmId, areaId)) ?? null;
  }

  upsertGrowingArea(areaInput: GrowingArea): void {
    const area = GrowingAreaSchema.parse(areaInput);
    if (
      area.primaryDeviceId !== null
      && this.getDevice(area.farmId, area.primaryDeviceId) === null
    ) {
      throw new Error("Growing area primary device must belong to the same farm");
    }

    this.growingAreaByScope.set(growingAreaScopeKey(area.farmId, area.id), area);
  }

  listCrops(farmId: FarmId): readonly CropRecord[] {
    return [...this.cropById.values()]
      .filter((crop) => crop.farmId === farmId)
      .sort(compareCrops);
  }

  getCrop(farmId: FarmId, cropId: CropId): CropRecord | null {
    const crop = this.cropById.get(cropId);
    return crop?.farmId === farmId ? crop : null;
  }

  createCrop(crop: CropRecord): CreateCropResult {
    if (this.cropById.has(crop.id)) {
      return { kind: "conflict", reason: "Crop ID already exists" };
    }

    this.cropById.set(crop.id, crop);
    return { kind: "created", crop };
  }

  updateCrop(crop: CropRecord): UpdateCropResult {
    const existing = this.cropById.get(crop.id);
    if (existing === undefined || existing.farmId !== crop.farmId) {
      return { kind: "not_found" };
    }

    this.cropById.set(crop.id, crop);
    return { kind: "updated", crop };
  }

  deleteCrop(farmId: FarmId, cropId: CropId): boolean {
    const crop = this.cropById.get(cropId);
    if (crop === undefined || crop.farmId !== farmId) {
      return false;
    }

    return this.cropById.delete(cropId);
  }

  upsertCrop(crop: CropRecord): void {
    this.cropById.set(crop.id, crop);
  }

  listCropCycles(farmId: FarmId): readonly CropCycleDetail[] {
    return [...this.cropCycleByScope.values()]
      .filter((cropCycle) => cropCycle.cycle.farmId === farmId)
      .sort(compareCropCycles);
  }

  getCropCycle(farmId: FarmId, cropCycleId: CropCycleId): CropCycleDetail | null {
    return this.cropCycleByScope.get(cropCycleScopeKey(farmId, cropCycleId)) ?? null;
  }

  createCropCycle(cropCycleInput: CropCycleDetail): CreateCropCycleResult {
    const cropCycle = CropCycleDetailSchema.parse(cropCycleInput);

    const scopeKey = cropCycleScopeKey(cropCycle.cycle.farmId, cropCycle.cycle.id);
    if (this.cropCycleByScope.has(scopeKey)) {
      return { kind: "conflict", reason: "Crop cycle ID already exists" };
    }

    const conflict = this.validateCropCycle(cropCycle);
    if (conflict !== null) return conflict;

    this.cropCycleByScope.set(scopeKey, cropCycle);
    return { kind: "created", cropCycle };
  }

  updateCropCycle(cropCycleInput: CropCycleDetail): UpdateCropCycleResult {
    const cropCycle = CropCycleDetailSchema.parse(cropCycleInput);
    const scopeKey = cropCycleScopeKey(cropCycle.cycle.farmId, cropCycle.cycle.id);
    const existing = this.cropCycleByScope.get(scopeKey);
    if (existing === undefined) {
      return { kind: "not_found" };
    }

    const conflict = this.validateCropCycle(cropCycle);
    if (conflict !== null) return conflict;

    this.cropCycleByScope.set(scopeKey, cropCycle);
    return { kind: "updated", cropCycle };
  }

  listAlarmRules(farmId: FarmId): readonly AlarmRule[] {
    return [...this.alarmRuleByScope.values()]
      .filter((rule) => rule.farmId === farmId)
      .sort(compareAlarmRules);
  }

  upsertAlarmRule(ruleInput: AlarmRule): void {
    const rule = parseAlarmRule(ruleInput);
    this.validateAlarmRule(rule);
    this.alarmRuleByScope.set(alarmRuleScopeKey(rule.farmId, rule.id), rule);
  }

  listAlarmInstances(
    farmId: FarmId,
    options: AlarmInstanceListOptions = {},
  ): readonly AlarmInstance[] {
    const limit = Math.max(1, Math.min(options.limit ?? 100, 100));

    return [...this.alarmInstanceByScope.values()]
      .filter((alarm) =>
        alarm.farmId === farmId
        && (options.state === undefined || alarm.state === options.state)
        && (options.cycleId === undefined || alarm.cycleId === options.cycleId),
      )
      .sort(compareAlarmInstances)
      .slice(0, limit);
  }

  getAlarmInstance(farmId: FarmId, alarmId: string): AlarmInstance | null {
    return this.alarmInstanceByScope.get(alarmInstanceScopeKey(farmId, alarmId)) ?? null;
  }

  acknowledgeAlarm(input: AcknowledgeAlarmInput): AcknowledgeAlarmResult {
    const acknowledgement = parseAcknowledgeAlarmInput(input);
    const alarm = this.getAlarmInstance(acknowledgement.farmId, acknowledgement.alarmId);
    if (alarm === null) {
      return { kind: "not_found" };
    }

    const replayScope = alarmAcknowledgementScopeKey(
      acknowledgement.farmId,
      acknowledgement.alarmId,
      acknowledgement.actor.id,
      acknowledgement.idempotencyKey,
    );
    const existingAuditId = this.auditEventIdByAckScope.get(replayScope);

    if (alarm.acknowledgement !== null) {
      if (
        alarm.acknowledgement.actorId !== acknowledgement.actor.id
        || existingAuditId === undefined
      ) {
        return { kind: "conflict", reason: "Alarm already has a different acknowledgement" };
      }

      const auditEvent = this.auditEventByScope.get(
        auditEventScopeKey(acknowledgement.farmId, existingAuditId),
      );
      if (auditEvent === undefined) {
        throw new Error("In-memory alarm acknowledgement audit index is inconsistent");
      }

      return { kind: "replayed", alarm, auditEvent };
    }

    if (existingAuditId !== undefined) {
      throw new Error("In-memory alarm acknowledgement index is inconsistent");
    }

    const acknowledgedAlarm = acknowledgeAlarmInstance(
      alarm,
      acknowledgement.actor.id,
      acknowledgement.acknowledgedAt,
    );
    const auditEventId = createDeterministicEntityId(
      "audit",
      acknowledgement.farmId,
      acknowledgement.alarmId,
      acknowledgement.actor.id,
      acknowledgement.idempotencyKey,
    );
    const auditEvent = buildAlarmAuditEvent(
      acknowledgedAlarm,
      acknowledgement.actor,
      acknowledgement.acknowledgedAt,
      auditEventId,
    );

    this.alarmInstanceByScope.set(
      alarmInstanceScopeKey(acknowledgement.farmId, acknowledgement.alarmId),
      acknowledgedAlarm,
    );
    this.auditEventByScope.set(
      auditEventScopeKey(acknowledgement.farmId, auditEvent.id),
      auditEvent,
    );
    this.auditEventIdByAckScope.set(replayScope, auditEvent.id);
    return { kind: "acknowledged", alarm: acknowledgedAlarm, auditEvent };
  }

  listAuditEvents(
    farmId: FarmId,
    options: AuditEventListOptions = {},
  ): readonly AuditEvent[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const includeUnscoped = options.includeUnscoped ?? false;

    return [...this.auditEventByScope.values()]
      .filter((event) =>
        event.farmId === farmId
        && (
          includeUnscoped
            ? (
              options.cycleId === undefined
              || event.cycleId === null
              || event.cycleId === options.cycleId
            )
            : (
              event.cycleId !== null
              && (options.cycleId === undefined || event.cycleId === options.cycleId)
            )
        ),
      )
      .sort(compareAuditEvents)
      .slice(0, limit);
  }

  seedIrrigationStrategy(strategyInput: IrrigationStrategy): SeedIrrigationStrategyResult {
    const strategy = parseIrrigationStrategy(strategyInput);
    const fingerprint = strategyPayloadFingerprint(strategy);
    const scopeKey = strategyIdentityKey(strategy.farmId, strategy.id, strategy.version);
    const existing = this.irrigationStrategyByScope.get(scopeKey);
    if (existing !== undefined) {
      return existing.fingerprint === fingerprint
        ? { kind: "replayed", strategy: existing.strategy }
        : { kind: "conflict", reason: "Strategy version was reused with different content" };
    }

    this.irrigationStrategyByScope.set(scopeKey, { fingerprint, strategy });
    return { kind: "created", strategy };
  }

  listIrrigationStrategies(
    farmId: FarmId,
    cycleId: CropCycleId,
  ): readonly IrrigationStrategy[] {
    return [...this.irrigationStrategyByScope.values()]
      .map(({ strategy }) => strategy)
      .filter((strategy) =>
        strategy.farmId === farmId
        && strategy.cycleId === cycleId
        && strategy.status === "approved",
      )
      .sort(compareIrrigationStrategies);
  }

  getIrrigationStrategy(
    farmId: FarmId,
    strategyId: string,
    version: number,
  ): IrrigationStrategy | null {
    return this.irrigationStrategyByScope.get(
      strategyIdentityKey(farmId, strategyId, version),
    )?.strategy ?? null;
  }

  createStrategyApplication(
    applicationInput: StrategyApplication,
    commands: readonly StrategyApplicationCommandTarget[],
  ): CreateStrategyApplicationResult {
    const application = parseStrategyApplication(applicationInput);
    const targetValidationError = validateStrategyApplicationCommandTargets(
      application,
      commands,
    );
    if (targetValidationError !== null) {
      return { kind: "conflict", reason: targetValidationError };
    }
    const idempotencyKey = strategyApplicationIdempotencyKey(
      application.farmId,
      application.actor.id,
      application.idempotencyKey,
    );
    const fingerprint = applicationIntentFingerprint({
      cycleId: application.cycleId,
      strategyId: application.strategyId,
      strategyVersion: application.strategyVersion,
      pumpState: application.pumpState,
      ...(application.runDurationSeconds === undefined
        ? {}
        : { runDurationSeconds: application.runDurationSeconds }),
      targets: commands.map((target) => ({ areaId: target.areaId, deviceId: target.deviceId })),
    });

    const existingId = this.strategyApplicationIdByIdempotencyKey.get(idempotencyKey);
    if (existingId !== undefined) {
      const existing = this.strategyApplicationByScope.get(
        strategyApplicationScopeKey(application.farmId, existingId),
      );
      if (existing === undefined) {
        throw new Error("In-memory strategy application idempotency index is inconsistent");
      }

      return existing.fingerprint === fingerprint
        ? { kind: "replayed", application: existing.application }
        : { kind: "conflict", reason: "Idempotency key was reused with different intent" };
    }

    if (this.strategyApplicationByScope.has(
      strategyApplicationScopeKey(application.farmId, application.id),
    )) {
      return { kind: "conflict", reason: "Strategy application ID already exists" };
    }

    for (const target of commands) {
      const commandIdempotency = commandIdempotencyKey(target.command);
      const existingCommandId = this.commandIdByIdempotencyKey.get(commandIdempotency);
      if (existingCommandId !== undefined || this.commandById.has(target.command.id)) {
        return { kind: "conflict", reason: "Strategy application command already exists" };
      }
    }

    const pending = createPendingStrategyApplication({
      id: application.id,
      farmId: application.farmId,
      cycleId: application.cycleId,
      strategy: {
        schemaVersion: "smartfarm.irrigation-strategy.v1",
        id: application.strategyId as IrrigationStrategy["id"],
        version: application.strategyVersion,
        farmId: application.farmId,
        cycleId: application.cycleId,
        name: application.strategyName,
        description: null,
        pumpState: application.pumpState,
        ...(application.runDurationSeconds === undefined
          ? {}
          : { runDurationSeconds: application.runDurationSeconds }),
        status: "approved",
        createdAt: application.createdAt,
        approvedAt: application.createdAt,
      },
      actor: application.actor,
      idempotencyKey: application.idempotencyKey,
      targets: commands,
      createdAt: application.createdAt,
    });

    for (const target of commands) {
      const projection = createPendingCommandProjection(target.command, pending.createdAt);
      this.commandById.set(target.command.id, {
        intentFingerprint: commandIntentFingerprint(target.command),
        projection,
      });
      this.commandIdByIdempotencyKey.set(commandIdempotencyKey(target.command), target.command.id);
      this.strategyApplicationByCommandId.set(
        commandToApplicationScopeKey(target.command.id),
        { applicationId: pending.id },
      );
    }

    this.strategyApplicationByScope.set(
      strategyApplicationScopeKey(pending.farmId, pending.id),
      { fingerprint, application: pending },
    );
    this.strategyApplicationIdByIdempotencyKey.set(idempotencyKey, pending.id);
    return { kind: "created", application: pending };
  }

  getStrategyApplication(farmId: FarmId, applicationId: string): StrategyApplication | null {
    return this.strategyApplicationByScope.get(
      strategyApplicationScopeKey(farmId, applicationId),
    )?.application ?? null;
  }

  putTelemetry(telemetry: Telemetry): PutTelemetryResult {
    const fingerprint = JSON.stringify(telemetry);
    const existingById = this.telemetryById.get(telemetry.id);

    if (existingById !== undefined) {
      return existingById.fingerprint === fingerprint
        ? { kind: "replayed" }
        : { kind: "conflict", reason: "Telemetry ID was reused with different content" };
    }

    const latestKey = telemetryMetricKey(
      telemetry.farmId,
      telemetry.deviceId,
      telemetry.metric,
    );
    const latest = this.latestTelemetryByMetric.get(latestKey);

    if (latest !== undefined) {
      if (telemetry.sequence <= latest.sequence) {
        return { kind: "conflict", reason: "Telemetry sequence did not advance" };
      }

      if (Date.parse(telemetry.observedAt) < Date.parse(latest.observedAt)) {
        return { kind: "conflict", reason: "Telemetry observation time moved backwards" };
      }
    }

    this.telemetryById.set(telemetry.id, { fingerprint, telemetry });
    this.latestTelemetryByMetric.set(latestKey, telemetry);
    this.evaluateAcceptedTelemetry(telemetry);
    return { kind: "accepted" };
  }

  latestTelemetry(
    farmId: FarmId,
    deviceId: DeviceId,
    metric: TelemetryMetric,
  ): Telemetry | null {
    return this.latestTelemetryByMetric.get(
      telemetryMetricKey(farmId, deviceId, metric),
    ) ?? null;
  }

  recentTelemetry(
    farmId: FarmId,
    deviceId: DeviceId,
    metric: TelemetryMetric,
    limit: number,
  ): readonly Telemetry[] {
    return [...this.telemetryById.values()]
      .map(({ telemetry }) => telemetry)
      .filter((telemetry) =>
        telemetry.farmId === farmId
        && telemetry.deviceId === deviceId
        && telemetry.metric === metric,
      )
      .sort(compareTelemetry)
      .slice(-limit);
  }

  createCommand(command: Command, updatedAt: string): CreateCommandResult {
    const intentFingerprint = commandIntentFingerprint(command);
    const idempotencyKey = commandIdempotencyKey(command);
    const existingCommandId = this.commandIdByIdempotencyKey.get(idempotencyKey);

    if (existingCommandId !== undefined) {
      const existing = this.commandById.get(existingCommandId);

      if (existing === undefined) {
        throw new Error("In-memory command idempotency index is inconsistent");
      }

      return existing.intentFingerprint === intentFingerprint
        ? { kind: "replayed", projection: existing.projection }
        : { kind: "conflict", reason: "Idempotency key was reused with different intent" };
    }

    if (this.commandById.has(command.id)) {
      return { kind: "conflict", reason: "Command ID already exists" };
    }

    const projection = createPendingCommandProjection(command, updatedAt);

    this.commandById.set(command.id, { intentFingerprint, projection });
    this.commandIdByIdempotencyKey.set(idempotencyKey, command.id);
    return { kind: "created", projection };
  }

  listCommands(
    farmId: FarmId,
    options: CommandListOptions = {},
  ): readonly CommandProjection[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));

    return [...this.commandById.values()]
      .map(({ projection }) => projection)
      .filter((projection) =>
        projection.command.farmId === farmId
        && (options.deviceId === undefined || projection.command.deviceId === options.deviceId),
      )
      .sort(compareCommandProjections)
      .slice(0, limit);
  }

  getCommand(commandId: string): CommandProjection | null {
    return this.commandById.get(commandId)?.projection ?? null;
  }

  getFarmControlProfile(farmId: FarmId): FarmControlProfile | null {
    return this.farmControlProfileByFarmId.get(farmId) ?? null;
  }

  updateFarmControlProfile(
    profileInput: FarmControlProfile,
    expectedRevision: number,
  ): UpdateFarmControlProfileResult {
    const profile = FarmControlProfileSchema.parse(profileInput);
    const current = this.farmControlProfileByFarmId.get(profile.farmId) ?? null;
    const currentRevision = current?.revision ?? 0;

    if (currentRevision !== expectedRevision) {
      return { kind: "conflict", reason: "Farm control profile revision does not match" };
    }

    if (profile.revision !== currentRevision + 1) {
      return { kind: "conflict", reason: "Farm control profile revision must advance by one" };
    }

    this.farmControlProfileByFarmId.set(profile.farmId, profile);
    return { kind: "updated", profile };
  }

  issueGatewayEnrollment(input: IssueGatewayEnrollmentInput): GatewayEnrollmentRecord {
    const stored: StoredGatewayEnrollment = {
      enrollmentId: input.id,
      farmId: input.farmId,
      deviceId: input.deviceId,
      tokenDigest: input.tokenDigest,
      issuedByActorId: input.issuedByActorId,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      exchangedAt: null,
      exchangedCredentialId: null,
      revokedAt: null,
      revokedByActorId: null,
    };
    this.gatewayEnrollmentById.set(input.id, stored);
    return gatewayEnrollmentRecordFromStored(stored, input.issuedAt);
  }

  listGatewayEnrollments(
    farmId: FarmId,
    deviceId: DeviceId,
    options: GatewayAccessListOptions,
  ): readonly GatewayEnrollmentRecord[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    return [...this.gatewayEnrollmentById.values()]
      .filter((enrollment) => enrollment.farmId === farmId && enrollment.deviceId === deviceId)
      .sort((left, right) =>
        Date.parse(right.issuedAt) - Date.parse(left.issuedAt)
        || left.enrollmentId.localeCompare(right.enrollmentId))
      .slice(0, limit)
      .map((enrollment) => gatewayEnrollmentRecordFromStored(enrollment, options.now));
  }

  getGatewayEnrollmentAuthentication(
    enrollmentId: GatewayEnrollmentId,
  ): GatewayEnrollmentAuthenticationMaterial | null {
    return this.gatewayEnrollmentById.get(enrollmentId) ?? null;
  }

  exchangeGatewayEnrollment(
    input: ExchangeGatewayEnrollmentInput,
  ): ExchangeGatewayEnrollmentResult {
    const current = this.gatewayEnrollmentById.get(input.enrollmentId);
    if (
      current === undefined
      || current.tokenDigest !== input.expectedTokenDigest
      || current.exchangedAt !== null
      || current.revokedAt !== null
      || Date.parse(current.expiresAt) <= Date.parse(input.exchangedAt)
    ) {
      return { kind: "invalid" };
    }

    const exchanged: StoredGatewayEnrollment = {
      ...current,
      exchangedAt: input.exchangedAt,
      exchangedCredentialId: input.credentialId,
    };
    const credential: StoredEdgeCredential = {
      credentialId: input.credentialId,
      farmId: current.farmId,
      deviceId: current.deviceId,
      credentialDigest: input.credentialDigest,
      createdFromEnrollmentId: current.enrollmentId,
      createdAt: input.exchangedAt,
      revokedAt: null,
      revokedByActorId: null,
    };

    this.gatewayEnrollmentById.set(input.enrollmentId, exchanged);
    this.edgeCredentialById.set(input.credentialId, credential);
    return {
      kind: "exchanged",
      credential: edgeCredentialRecordFromStored(credential),
    };
  }

  revokeGatewayEnrollment(
    input: RevokeGatewayEnrollmentInput,
  ): RevokeGatewayEnrollmentResult {
    const current = this.gatewayEnrollmentById.get(input.enrollmentId);
    if (
      current === undefined
      || current.farmId !== input.farmId
      || current.deviceId !== input.deviceId
    ) {
      return { kind: "not_found" };
    }
    if (current.revokedAt !== null) {
      return {
        kind: "replayed",
        enrollment: gatewayEnrollmentRecordFromStored(current, input.revokedAt),
      };
    }
    if (current.exchangedAt !== null || current.exchangedCredentialId !== null) {
      return {
        kind: "conflict",
        reason: "Gateway enrollment has already been exchanged",
      };
    }

    const revoked: StoredGatewayEnrollment = {
      ...current,
      revokedAt: input.revokedAt,
      revokedByActorId: input.revokedByActorId,
    };
    this.gatewayEnrollmentById.set(input.enrollmentId, revoked);
    return {
      kind: "revoked",
      enrollment: gatewayEnrollmentRecordFromStored(revoked, input.revokedAt),
    };
  }

  listEdgeCredentials(
    farmId: FarmId,
    deviceId: DeviceId,
    options: GatewayAccessListOptions,
  ): readonly EdgeCredentialRecord[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    return [...this.edgeCredentialById.values()]
      .filter((credential) => credential.farmId === farmId && credential.deviceId === deviceId)
      .sort((left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt)
        || left.credentialId.localeCompare(right.credentialId))
      .slice(0, limit)
      .map((credential) => edgeCredentialRecordFromStored(credential));
  }

  getEdgeCredentialAuthentication(
    credentialId: EdgeCredentialId,
  ): EdgeCredentialAuthenticationMaterial | null {
    return this.edgeCredentialById.get(credentialId) ?? null;
  }

  revokeEdgeCredential(input: RevokeEdgeCredentialInput): RevokeEdgeCredentialResult {
    const current = this.edgeCredentialById.get(input.credentialId);
    if (
      current === undefined
      || current.farmId !== input.farmId
      || current.deviceId !== input.deviceId
    ) {
      return { kind: "not_found" };
    }
    if (current.revokedAt !== null) {
      return {
        kind: "replayed",
        credential: edgeCredentialRecordFromStored(current),
      };
    }

    const revoked: StoredEdgeCredential = {
      ...current,
      revokedAt: input.revokedAt,
      revokedByActorId: input.revokedByActorId,
    };
    this.edgeCredentialById.set(input.credentialId, revoked);
    return {
      kind: "revoked",
      credential: edgeCredentialRecordFromStored(revoked),
    };
  }

  nextPendingCommand(farmId: FarmId, deviceId: DeviceId): CommandProjection | null {
    let candidate: CommandProjection | null = null;

    for (const { projection } of this.commandById.values()) {
      if (!isPendingProjectionForDevice(projection, farmId, deviceId)) {
        continue;
      }

      if (candidate === null || comparePendingCommandOrder(projection, candidate) < 0) {
        candidate = projection;
      }
    }

    return candidate;
  }

  nextPendingStopCommand(farmId: FarmId, deviceId: DeviceId): CommandProjection | null {
    let candidate: CommandProjection | null = null;

    for (const { projection } of this.commandById.values()) {
      if (!isPendingStopProjectionForDevice(projection, farmId, deviceId)) {
        continue;
      }

      if (candidate === null || comparePendingCommandOrder(projection, candidate) < 0) {
        candidate = projection;
      }
    }

    return candidate;
  }

  applyAck(ack: CommandAck, updatedAt: string): ApplyAckResult {
    const existing = this.commandById.get(ack.commandId);

    if (existing === undefined) {
      return { kind: "not_found" };
    }

    if (isExactCommandAckReplay(existing.projection, ack)) {
      return { kind: "replayed", projection: existing.projection };
    }
    const manualStopConflict = validateManualStopAckCause(
      existing.projection.command,
      ack,
      (commandId) => this.getCommand(commandId),
    );
    if (manualStopConflict !== null) {
      return { kind: "conflict", reason: manualStopConflict };
    }

    const result = applyAckToProjection(existing.projection, ack, updatedAt);

    if (result.kind === "applied") {
      const nextProjection = result.projection;
      this.commandById.set(existing.projection.command.id, {
        intentFingerprint: existing.intentFingerprint,
        projection: nextProjection,
      });
      this.applyAckToStrategyApplication(nextProjection, ack, updatedAt);
    }
    return result;
  }

  private validateCropCycle(
    cropCycle: CropCycleDetail,
  ): Extract<UpdateCropCycleResult, { kind: "conflict" }> | null {
    for (const areaId of cropCycle.areaIds) {
      const area = this.getGrowingArea(cropCycle.cycle.farmId, areaId);
      if (area === null) {
        return { kind: "conflict", reason: "Growing area must belong to the same farm" };
      }
    }

    if (cropCycle.cycle.status !== "active") return null;

    for (const existing of this.cropCycleByScope.values()) {
      if (
        existing.cycle.id !== cropCycle.cycle.id
        && existing.cycle.farmId === cropCycle.cycle.farmId
        && existing.cycle.status === "active"
        && existing.areaIds.some((areaId) => cropCycle.areaIds.includes(areaId))
      ) {
        return {
          kind: "conflict",
          reason: "Area already belongs to another active crop cycle",
        };
      }
    }

    return null;
  }

  private validateAlarmRule(rule: AlarmRule): void {
    if (this.getDevice(rule.farmId, rule.deviceId) === null) {
      throw new Error("Alarm rule device must belong to the same farm");
    }

    const area = this.getGrowingArea(rule.farmId, rule.areaId);
    if (area === null) {
      throw new Error("Alarm rule area must belong to the same farm");
    }
    if (area.primaryDeviceId !== rule.deviceId) {
      throw new Error("Alarm rule area primary device must match the target device");
    }

    const cycle = this.getCropCycle(rule.farmId, rule.cycleId);
    if (cycle === null) {
      throw new Error("Alarm rule cycle must belong to the same farm");
    }
    if (!cycle.areaIds.includes(rule.areaId)) {
      throw new Error("Alarm rule area must be assigned to the target crop cycle");
    }
  }

  private evaluateAcceptedTelemetry(telemetry: Telemetry): void {
    const rules = this.listAlarmRules(telemetry.farmId)
      .filter((rule) =>
        rule.deviceId === telemetry.deviceId
        && rule.metric === telemetry.metric,
      );

    for (const rule of rules) {
      const ruleScope = alarmRuleScopeKey(rule.farmId, rule.id);
      const activeAlarmId = this.activeAlarmIdByRuleScope.get(ruleScope);
      const activeAlarm = activeAlarmId === undefined
        ? null
        : this.alarmInstanceByScope.get(alarmInstanceScopeKey(rule.farmId, activeAlarmId)) ?? null;

      if (!this.isAlarmRuleEvaluable(rule)) {
        if (activeAlarm !== null) {
          const cleared = clearAlarmInstance(activeAlarm, telemetry);
          this.alarmInstanceByScope.set(alarmInstanceScopeKey(rule.farmId, cleared.id), cleared);
          this.activeAlarmIdByRuleScope.delete(ruleScope);
        }
        continue;
      }

      if (isTelemetryBreached(rule, telemetry)) {
        const next = activeAlarm === null
          ? openAlarmInstance(rule, telemetry)
          : updateAlarmInstance(activeAlarm, telemetry);
        this.alarmInstanceByScope.set(alarmInstanceScopeKey(rule.farmId, next.id), next);
        this.activeAlarmIdByRuleScope.set(ruleScope, next.id);
        continue;
      }

      if (activeAlarm !== null) {
        const cleared = clearAlarmInstance(activeAlarm, telemetry);
        this.alarmInstanceByScope.set(alarmInstanceScopeKey(rule.farmId, cleared.id), cleared);
        this.activeAlarmIdByRuleScope.delete(ruleScope);
      }
    }
  }

  private isAlarmRuleEvaluable(rule: AlarmRule): boolean {
    if (!rule.enabled) return false;

    const cycle = this.getCropCycle(rule.farmId, rule.cycleId);
    return cycle !== null && cycle.cycle.status === "active";
  }

  private applyAckToStrategyApplication(
    projection: CommandProjection,
    ack: CommandAck,
    updatedAt: string,
  ): void {
    const mapping = this.strategyApplicationByCommandId.get(
      commandToApplicationScopeKey(ack.commandId),
    );
    if (mapping === undefined) {
      const directAudit = buildDirectCommandCompletedAuditEvent({
        command: projection.command,
        ack,
        occurredAt: updatedAt,
      });
      this.auditEventByScope.set(
        auditEventScopeKey(directAudit.farmId, directAudit.id),
        directAudit,
      );
      return;
    }

    const existing = this.strategyApplicationByScope.get(
      strategyApplicationScopeKey(projection.command.farmId, mapping.applicationId),
    );
    if (existing === undefined) {
      throw new Error("In-memory strategy application command index is inconsistent");
    }

    const next = applyAckToStrategyApplicationProjection(existing.application, ack, updatedAt);
    const currentTarget = next.targets.find((target) => target.commandId === ack.commandId);
    if (currentTarget === undefined) {
      throw new Error("In-memory strategy application target mapping is inconsistent");
    }

    const commandAudit = buildCommandCompletedAuditEvent({
      application: next,
      target: currentTarget,
      ack,
      occurredAt: updatedAt,
    });
    this.auditEventByScope.set(
      auditEventScopeKey(commandAudit.farmId, commandAudit.id),
      commandAudit,
    );

    if (existing.application.status === "pending" && next.status !== "pending") {
      const strategyAudit = buildStrategyAppliedAuditEvent(next);
      this.auditEventByScope.set(
        auditEventScopeKey(strategyAudit.farmId, strategyAudit.id),
        strategyAudit,
      );
    }

    this.strategyApplicationByScope.set(
      strategyApplicationScopeKey(next.farmId, next.id),
      { fingerprint: existing.fingerprint, application: next },
    );
  }
}

export function createPendingCommandProjection(
  command: Command,
  updatedAt: string,
): CommandProjection {
  return CommandProjectionSchema.parse({
    schemaVersion: "smartfarm.command-projection.v1",
    command,
    status: "pending",
    ack: null,
    updatedAt,
  });
}

export function applyAckToProjection(
  projection: CommandProjection,
  ack: CommandAck,
  updatedAt: string,
): Exclude<ApplyAckResult, { readonly kind: "not_found" }> {
  const { command } = projection;

  if (ack.farmId !== command.farmId || ack.deviceId !== command.deviceId) {
    return { kind: "conflict", reason: "Acknowledgement scope does not match command" };
  }
  if (!isCommandAckCompatible(command, ack)) {
    return { kind: "conflict", reason: "Acknowledgement result does not match command" };
  }
  if (Date.parse(ack.processedAt) < Date.parse(command.issuedAt)) {
    return { kind: "conflict", reason: "Acknowledgement predates command issue time" };
  }
  if (projection.ack !== null) {
    return isExactCommandAckReplay(projection, ack)
      ? { kind: "replayed", projection }
      : { kind: "conflict", reason: "Command already has a different terminal acknowledgement" };
  }

  const status = ack.status === "acknowledged"
    ? "acknowledged"
    : ack.status === "timed_out"
      ? "timed_out"
      : "failed";
  return {
    kind: "applied",
    projection: CommandProjectionSchema.parse({
      ...projection,
      status,
      ack,
      updatedAt,
    }),
  };
}

function telemetryMetricKey(
  farmId: FarmId,
  deviceId: DeviceId,
  metric: TelemetryMetric,
): string {
  return `${farmId}\u0000${deviceId}\u0000${metric}`;
}

function commandIdempotencyKey(command: Command): string {
  return `${command.farmId}\u0000${command.actor.id}\u0000${command.idempotencyKey}`;
}

function deviceScopeKey(farmId: FarmId, deviceId: DeviceId): string {
  return `${farmId}\u0000${deviceId}`;
}

function growingAreaScopeKey(farmId: FarmId, areaId: GrowingAreaId): string {
  return `${farmId}\u0000${areaId}`;
}

function cropCycleScopeKey(farmId: FarmId, cropCycleId: CropCycleId): string {
  return `${farmId}\u0000${cropCycleId}`;
}

function auditEventScopeKey(farmId: FarmId, auditEventId: string): string {
  return `${farmId}\u0000${auditEventId}`;
}

function alarmAcknowledgementScopeKey(
  farmId: FarmId,
  alarmId: string,
  actorId: string,
  idempotencyKey: string,
): string {
  return `${farmId}\u0000${alarmId}\u0000${actorId}\u0000${idempotencyKey}`;
}

export function commandIntentFingerprint(command: Command): string {
  return JSON.stringify({
    actor: command.actor,
    deviceId: command.deviceId,
    farmId: command.farmId,
    idempotencyKey: command.idempotencyKey,
    payload: command.payload,
  });
}

export function isStopCommand(command: Command): boolean {
  return command.schemaVersion === "smartfarm.command.v1"
    && command.payload.action === "set_pump_state"
    && command.payload.state === "off";
}

export function isManualStopActivationCommand(command: Command): boolean {
  return command.schemaVersion === "smartfarm.command.v2"
    || (
      command.schemaVersion === "smartfarm.command.v1"
      && command.payload.action === "set_pump_state"
      && command.payload.state === "on"
    );
}

export function isExactCommandAckReplay(
  projection: CommandProjection,
  ack: CommandAck,
): boolean {
  return projection.ack !== null && JSON.stringify(projection.ack) === JSON.stringify(ack);
}

export function validateManualStopAckCause(
  activationCommand: Command,
  ack: CommandAck,
  getCommand: (commandId: string) => CommandProjection | null,
): string | null {
  const manualStopAck = getManualStopAckFields(ack);
  if (manualStopAck === null) {
    return null;
  }

  if (!isManualStopActivationCommand(activationCommand)) {
    return "Manual stop acknowledgement requires an activation command";
  }

  const stopProjection = getCommand(manualStopAck.causedByCommandId);
  if (stopProjection === null) {
    return "Manual stop acknowledgement cause command was not found";
  }

  const stopCommand = stopProjection.command;
  if (
    stopCommand.farmId !== activationCommand.farmId
    || stopCommand.deviceId !== activationCommand.deviceId
  ) {
    return "Manual stop acknowledgement cause command scope does not match activation command";
  }
  if (!isStopCommand(stopCommand)) {
    return "Manual stop acknowledgement cause command must be a V1 stop command";
  }
  if (
    stopProjection.status !== "acknowledged"
    || stopProjection.ack?.status !== "acknowledged"
    || stopProjection.ack.result?.pumpState !== "off"
  ) {
    return "Manual stop acknowledgement cause command has no final-off acknowledgement";
  }
  if (Date.parse(stopCommand.issuedAt) < Date.parse(activationCommand.issuedAt)) {
    return "Manual stop acknowledgement cause command predates activation command";
  }
  if (Date.parse(ack.processedAt) < Date.parse(stopCommand.issuedAt)) {
    return "Manual stop acknowledgement predates stop command issue time";
  }

  return null;
}

function getManualStopAckFields(
  ack: CommandAck,
): { readonly causedByCommandId: string } | null {
  const candidate = ack as Record<string, unknown>;
  return candidate.schemaVersion === "smartfarm.command-ack.v2"
    && candidate.reasonCode === "manual_stop"
    && typeof candidate.causedByCommandId === "string"
    && candidate.causedByCommandId.trim() !== ""
    ? { causedByCommandId: candidate.causedByCommandId }
    : null;
}

function isPendingProjectionForDevice(
  projection: CommandProjection,
  farmId: FarmId,
  deviceId: DeviceId,
): boolean {
  return projection.status === "pending"
    && projection.command.farmId === farmId
    && projection.command.deviceId === deviceId;
}

function isPendingStopProjectionForDevice(
  projection: CommandProjection,
  farmId: FarmId,
  deviceId: DeviceId,
): boolean {
  return isPendingProjectionForDevice(projection, farmId, deviceId)
    && isStopCommand(projection.command);
}

function comparePendingCommandOrder(left: CommandProjection, right: CommandProjection): number {
  return left.command.issuedAt.localeCompare(right.command.issuedAt)
    || left.command.id.localeCompare(right.command.id);
}

function gatewayEnrollmentRecordFromStored(
  enrollment: StoredGatewayEnrollment,
  now: string,
): GatewayEnrollmentRecord {
  return GatewayEnrollmentRecordSchema.parse({
    schemaVersion: "smartfarm.gateway-enrollment-record.v1",
    id: enrollment.enrollmentId,
    farmId: enrollment.farmId,
    deviceId: enrollment.deviceId,
    status: enrollment.revokedAt !== null
      ? "revoked"
      : enrollment.exchangedAt !== null
        ? "exchanged"
        : Date.parse(enrollment.expiresAt) <= Date.parse(now)
          ? "expired"
          : "pending",
    issuedByActorId: enrollment.issuedByActorId,
    issuedAt: enrollment.issuedAt,
    expiresAt: enrollment.expiresAt,
    exchangedAt: enrollment.exchangedAt,
    exchangedCredentialId: enrollment.exchangedCredentialId,
    revokedAt: enrollment.revokedAt,
    revokedByActorId: enrollment.revokedByActorId,
  });
}

function edgeCredentialRecordFromStored(
  credential: StoredEdgeCredential,
): EdgeCredentialRecord {
  return EdgeCredentialRecordSchema.parse({
    schemaVersion: "smartfarm.edge-credential-record.v1",
    id: credential.credentialId,
    farmId: credential.farmId,
    deviceId: credential.deviceId,
    status: credential.revokedAt === null ? "active" : "revoked",
    createdFromEnrollmentId: credential.createdFromEnrollmentId,
    createdAt: credential.createdAt,
    revokedAt: credential.revokedAt,
    revokedByActorId: credential.revokedByActorId,
  });
}

function compareFarms(left: Farm, right: Farm): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function compareDevices(left: Device, right: Device): number {
  return left.id.localeCompare(right.id);
}

function compareCrops(left: CropRecord, right: CropRecord): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function compareGrowingAreas(left: GrowingArea, right: GrowingArea): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function compareCropCycles(left: CropCycleDetail, right: CropCycleDetail): number {
  return left.cycle.createdAt.localeCompare(right.cycle.createdAt)
    || left.cycle.id.localeCompare(right.cycle.id);
}

function compareTelemetry(left: Telemetry, right: Telemetry): number {
  return left.sequence - right.sequence
    || left.observedAt.localeCompare(right.observedAt)
    || left.id.localeCompare(right.id);
}

function compareCommandProjections(left: CommandProjection, right: CommandProjection): number {
  return right.updatedAt.localeCompare(left.updatedAt)
    || right.command.issuedAt.localeCompare(left.command.issuedAt)
    || left.command.id.localeCompare(right.command.id);
}
