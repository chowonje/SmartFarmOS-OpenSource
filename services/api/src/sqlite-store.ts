import { DatabaseSync } from "node:sqlite";
import {
  AlarmInstanceSchema,
  AlarmRuleSchema,
  AuditEventSchema,
  type EdgeCredentialId,
  type EdgeCredentialRecord,
  EdgeCredentialRecordSchema,
  CropCycleDetailSchema,
  CommandProjectionSchema,
  CropRecordSchema,
  DeviceSchema,
  FarmSchema,
  type GatewayEnrollmentId,
  type GatewayEnrollmentRecord,
  GatewayEnrollmentRecordSchema,
  GrowingAreaSchema,
  IrrigationStrategySchema,
  StrategyApplicationSchema,
  TelemetrySchema,
  type AlarmInstance,
  type AlarmRule,
  type AuditEvent,
  type Command,
  type CommandAck,
  type CommandActor,
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
  FarmControlProfileSchema,
  type GrowingAreaId,
  type GrowingArea,
  type IrrigationStrategy,
  type StrategyApplication,
  type Telemetry,
  type TelemetryMetric,
} from "@smartfarm-os/contracts";
import {
  acknowledgeAlarmInstance,
  alarmRuleScopeKey,
  buildAlarmAuditEvent,
  clearAlarmInstance,
  createDeterministicEntityId,
  isTelemetryBreached,
  openAlarmInstance,
  parseAcknowledgeAlarmInput,
  updateAlarmInstance,
  type AlarmInstanceListOptions,
  type AuditEventListOptions,
  type AcknowledgeAlarmInput,
  type AcknowledgeAlarmResult,
} from "./alarm-center.js";
import { buildDirectCommandCompletedAuditEvent } from "./command-audit.js";
import {
  applyAckToStrategyApplication as applyAckToStrategyApplicationProjection,
  applicationIntentFingerprint,
  buildCommandCompletedAuditEvent,
  buildStrategyAppliedAuditEvent,
  commandToApplicationScopeKey,
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
import {
  applyAckToProjection,
  commandIntentFingerprint,
  createPendingCommandProjection,
  isExactCommandAckReplay,
  isStopCommand,
  type ApplyAckResult,
  type CommandListOptions,
  type CreateCropCycleResult,
  type CreateCropResult,
  type CreateCommandResult,
  type EdgeCredentialAuthenticationMaterial,
  type ExchangeGatewayEnrollmentInput,
  type ExchangeGatewayEnrollmentResult,
  type GatewayAccessListOptions,
  type GatewayEnrollmentAuthenticationMaterial,
  type IssueGatewayEnrollmentInput,
  type PutTelemetryResult,
  type RevokeEdgeCredentialInput,
  type RevokeEdgeCredentialResult,
  type RevokeGatewayEnrollmentInput,
  type RevokeGatewayEnrollmentResult,
  type SmartFarmStore,
  type UpdateFarmControlProfileResult,
  type UpdateCropCycleResult,
  type UpdateCropResult,
  validateManualStopAckCause,
} from "./store.js";

export const SQLITE_SCHEMA_VERSION = 8;

export type SqliteSmartFarmStoreOptions = {
  readonly path: string;
  readonly busyTimeoutMs?: number;
};

type JsonRow = {
  readonly payload_json: string;
};

type CommandRow = {
  readonly intent_fingerprint: string;
  readonly projection_json: string;
};

type IdRow = {
  readonly id: string;
};

type AreaAssignmentRow = {
  readonly area_id: string;
};

type AlarmInstanceRow = {
  readonly payload_json: string;
  readonly acknowledgement_actor_id: string | null;
  readonly acknowledgement_idempotency_key: string | null;
  readonly acknowledgement_audit_event_id: string | null;
};

type StrategyRow = {
  readonly payload_json: string;
};

type StrategyApplicationRow = {
  readonly fingerprint: string;
  readonly payload_json: string;
};

type StrategyApplicationCommandRow = {
  readonly application_id: string;
};

type FarmControlProfileRow = {
  readonly revision: number;
  readonly updated_at: string;
  readonly payload_json: string;
};

type GatewayEnrollmentRow = {
  readonly id: string;
  readonly farm_id: string;
  readonly device_id: string;
  readonly token_digest: string;
  readonly issued_by_actor_id: string;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly exchanged_at: string | null;
  readonly exchanged_credential_id: string | null;
  readonly revoked_at: string | null;
  readonly revoked_by_actor_id: string | null;
};

type EdgeCredentialRow = {
  readonly id: string;
  readonly farm_id: string;
  readonly device_id: string;
  readonly credential_digest: string;
  readonly created_from_enrollment_id: string;
  readonly created_at: string;
  readonly revoked_at: string | null;
  readonly revoked_by_actor_id: string | null;
};

export class SqliteSmartFarmStore implements SmartFarmStore {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(options: SqliteSmartFarmStoreOptions) {
    if (options.path.trim() === "") {
      throw new Error("SQLite database path cannot be empty");
    }
    const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs <= 0) {
      throw new Error("SQLite busy timeout must be a positive integer");
    }

    this.database = new DatabaseSync(options.path);
    try {
      this.database.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = ${busyTimeoutMs};
      `);
      this.migrate();
    } catch (error) {
      this.database.close();
      this.closed = true;
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  listFarms(): readonly Farm[] {
    const rows = this.database.prepare(`
      SELECT payload_json
      FROM farms
      ORDER BY created_at ASC, id ASC
    `).all() as JsonRow[];

    return rows.map((row) => parseStoredFarm(row.payload_json));
  }

  getFarm(farmId: FarmId): Farm | null {
    const row = this.database.prepare(
      "SELECT payload_json FROM farms WHERE id = ?",
    ).get(farmId) as JsonRow | undefined;

    return row === undefined ? null : parseStoredFarm(row.payload_json);
  }

  upsertFarm(farmInput: Farm): void {
    const farm = FarmSchema.parse(farmInput);

    this.database.prepare(`
      INSERT INTO farms (id, name, created_at, payload_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        created_at = excluded.created_at,
        payload_json = excluded.payload_json
    `).run(
      farm.id,
      farm.name,
      farm.createdAt,
      JSON.stringify(farm),
    );
  }

  listDevices(farmId: FarmId): readonly Device[] {
    const rows = this.database.prepare(`
      SELECT payload_json
      FROM devices
      WHERE farm_id = ?
      ORDER BY id ASC
    `).all(farmId) as JsonRow[];

    return rows.map((row) => parseStoredDevice(row.payload_json));
  }

  getDevice(farmId: FarmId, deviceId: DeviceId): Device | null {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM devices
      WHERE farm_id = ? AND id = ?
    `).get(farmId, deviceId) as JsonRow | undefined;

    return row === undefined ? null : parseStoredDevice(row.payload_json);
  }

  upsertDevice(deviceInput: Device): void {
    const device = DeviceSchema.parse(deviceInput);

    this.database.prepare(`
      INSERT INTO devices (
        farm_id, id, name, kind, status, last_seen_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(farm_id, id) DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        status = excluded.status,
        last_seen_at = excluded.last_seen_at,
        payload_json = excluded.payload_json
    `).run(
      device.farmId,
      device.id,
      device.name,
      device.kind,
      device.status,
      device.lastSeenAt,
      JSON.stringify(device),
    );
  }

  listGrowingAreas(farmId: FarmId): readonly GrowingArea[] {
    const rows = this.database.prepare(`
      SELECT payload_json
      FROM growing_areas
      WHERE farm_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(farmId) as JsonRow[];

    return rows.map((row) => parseStoredGrowingArea(row.payload_json));
  }

  getGrowingArea(farmId: FarmId, areaId: GrowingAreaId): GrowingArea | null {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM growing_areas
      WHERE farm_id = ? AND id = ?
    `).get(farmId, areaId) as JsonRow | undefined;

    return row === undefined ? null : parseStoredGrowingArea(row.payload_json);
  }

  upsertGrowingArea(areaInput: GrowingArea): void {
    const area = GrowingAreaSchema.parse(areaInput);
    if (
      area.primaryDeviceId !== null
      && this.getDevice(area.farmId, area.primaryDeviceId) === null
    ) {
      throw new Error("Growing area primary device must belong to the same farm");
    }

    this.database.prepare(`
      INSERT INTO growing_areas (
        farm_id, id, name, kind, primary_device_id, status, created_at, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(farm_id, id) DO UPDATE SET
        name = excluded.name,
        kind = excluded.kind,
        primary_device_id = excluded.primary_device_id,
        status = excluded.status,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(
      area.farmId,
      area.id,
      area.name,
      area.kind,
      area.primaryDeviceId,
      area.status,
      area.createdAt,
      area.updatedAt,
      JSON.stringify(area),
    );
  }

  listCrops(farmId: FarmId): readonly CropRecord[] {
    const rows = this.database.prepare(`
      SELECT payload_json
      FROM crops
      WHERE farm_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(farmId) as JsonRow[];

    return rows.map((row) => parseStoredCrop(row.payload_json));
  }

  getCrop(farmId: FarmId, cropId: CropId): CropRecord | null {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM crops
      WHERE farm_id = ? AND id = ?
    `).get(farmId, cropId) as JsonRow | undefined;

    return row === undefined ? null : parseStoredCrop(row.payload_json);
  }

  createCrop(cropInput: CropRecord): CreateCropResult {
    const crop = CropRecordSchema.parse(cropInput);

    return this.transaction(() => {
      const existing = this.database.prepare(
        "SELECT id FROM crops WHERE id = ?",
      ).get(crop.id) as IdRow | undefined;
      if (existing !== undefined) {
        return { kind: "conflict", reason: "Crop ID already exists" };
      }

      this.insertOrReplaceCrop(crop);
      return { kind: "created", crop };
    });
  }

  updateCrop(cropInput: CropRecord): UpdateCropResult {
    const crop = CropRecordSchema.parse(cropInput);

    return this.transaction(() => {
      const existing = this.database.prepare(`
        SELECT id
        FROM crops
        WHERE farm_id = ? AND id = ?
      `).get(crop.farmId, crop.id) as IdRow | undefined;
      if (existing === undefined) {
        return { kind: "not_found" };
      }

      this.insertOrReplaceCrop(crop);
      return { kind: "updated", crop };
    });
  }

  deleteCrop(farmId: FarmId, cropId: CropId): boolean {
    const result = this.database.prepare(`
      DELETE FROM crops
      WHERE farm_id = ? AND id = ?
    `).run(farmId, cropId);

    return result.changes > 0;
  }

  upsertCrop(cropInput: CropRecord): void {
    const crop = CropRecordSchema.parse(cropInput);
    this.insertOrReplaceCrop(crop);
  }

  listCropCycles(farmId: FarmId): readonly CropCycleDetail[] {
    const rows = this.database.prepare(`
      SELECT payload_json
      FROM crop_cycles
      WHERE farm_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(farmId) as JsonRow[];

    return rows.map((row) => this.readCropCycleDetail(parseStoredCropCycle(row.payload_json)));
  }

  getCropCycle(farmId: FarmId, cropCycleId: CropCycleId): CropCycleDetail | null {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM crop_cycles
      WHERE farm_id = ? AND id = ?
    `).get(farmId, cropCycleId) as JsonRow | undefined;

    return row === undefined ? null : this.readCropCycleDetail(parseStoredCropCycle(row.payload_json));
  }

  createCropCycle(cropCycleInput: CropCycleDetail): CreateCropCycleResult {
    const cropCycle = CropCycleDetailSchema.parse(cropCycleInput);

    return this.transaction(() => {
      const existing = this.database.prepare(
        "SELECT id FROM crop_cycles WHERE farm_id = ? AND id = ?",
      ).get(cropCycle.cycle.farmId, cropCycle.cycle.id) as IdRow | undefined;
      if (existing !== undefined) {
        return { kind: "conflict", reason: "Crop cycle ID already exists" };
      }
      const validation = this.validateCropCycle(cropCycle);
      if (validation !== null) return validation;

      this.insertOrReplaceCropCycle(cropCycle);
      return { kind: "created", cropCycle };
    });
  }

  updateCropCycle(cropCycleInput: CropCycleDetail): UpdateCropCycleResult {
    const cropCycle = CropCycleDetailSchema.parse(cropCycleInput);

    return this.transaction(() => {
      const existing = this.database.prepare(`
        SELECT id
        FROM crop_cycles
        WHERE farm_id = ? AND id = ?
      `).get(cropCycle.cycle.farmId, cropCycle.cycle.id) as IdRow | undefined;
      if (existing === undefined) {
        return { kind: "not_found" };
      }
      const validation = this.validateCropCycle(cropCycle);
      if (validation !== null) return validation;

      this.insertOrReplaceCropCycle(cropCycle);
      return { kind: "updated", cropCycle };
    });
  }

  listAlarmRules(farmId: FarmId): readonly AlarmRule[] {
    const rows = this.database.prepare(`
      SELECT payload_json
      FROM alarm_rules
      WHERE farm_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(farmId) as JsonRow[];

    return rows.map((row) => parseStoredAlarmRule(row.payload_json));
  }

  upsertAlarmRule(ruleInput: AlarmRule): void {
    const rule = AlarmRuleSchema.parse(ruleInput);
    this.validateAlarmRule(rule);
    this.insertOrReplaceAlarmRule(rule);
  }

  listAlarmInstances(
    farmId: FarmId,
    options: AlarmInstanceListOptions = {},
  ): readonly AlarmInstance[] {
    const limit = Math.max(1, Math.min(options.limit ?? 100, 100));
    const parameters: Array<string | number> = [farmId];
    let sql = `
      SELECT payload_json
      FROM alarm_instances
      WHERE farm_id = ?
    `;

    if (options.state !== undefined) {
      sql += " AND state = ?";
      parameters.push(options.state);
    }
    if (options.cycleId !== undefined) {
      sql += " AND cycle_id = ?";
      parameters.push(options.cycleId);
    }

    sql += `
      ORDER BY
        CASE state WHEN 'active' THEN 0 ELSE 1 END ASC,
        last_observed_at DESC,
        updated_at DESC,
        id ASC
      LIMIT ?
    `;
    parameters.push(limit);

    const rows = this.database.prepare(sql).all(...parameters) as JsonRow[];
    return rows.map((row) => parseStoredAlarmInstance(row.payload_json));
  }

  getAlarmInstance(farmId: FarmId, alarmId: string): AlarmInstance | null {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM alarm_instances
      WHERE farm_id = ? AND id = ?
    `).get(farmId, alarmId) as JsonRow | undefined;

    return row === undefined ? null : parseStoredAlarmInstance(row.payload_json);
  }

  acknowledgeAlarm(input: AcknowledgeAlarmInput): AcknowledgeAlarmResult {
    const acknowledgement = parseAcknowledgeAlarmInput(input);

    return this.transaction(() => {
      const row = this.database.prepare(`
        SELECT
          payload_json,
          acknowledgement_actor_id,
          acknowledgement_idempotency_key,
          acknowledgement_audit_event_id
        FROM alarm_instances
        WHERE farm_id = ? AND id = ?
      `).get(acknowledgement.farmId, acknowledgement.alarmId) as AlarmInstanceRow | undefined;
      if (row === undefined) {
        return { kind: "not_found" };
      }

      const alarm = parseStoredAlarmInstance(row.payload_json);
      if (alarm.acknowledgement !== null) {
        if (
          row.acknowledgement_actor_id !== acknowledgement.actor.id
          || row.acknowledgement_idempotency_key !== acknowledgement.idempotencyKey
          || row.acknowledgement_audit_event_id === null
        ) {
          return { kind: "conflict", reason: "Alarm already has a different acknowledgement" };
        }

        const auditRow = this.database.prepare(`
          SELECT payload_json
          FROM audit_events
          WHERE farm_id = ? AND id = ?
        `).get(
          acknowledgement.farmId,
          row.acknowledgement_audit_event_id,
        ) as JsonRow | undefined;
        if (auditRow === undefined) {
          throw new Error("Stored alarm acknowledgement audit reference is inconsistent");
        }

        return {
          kind: "replayed",
          alarm,
          auditEvent: parseStoredAuditEvent(auditRow.payload_json),
        };
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

      this.insertOrReplaceAlarmInstance(
        acknowledgedAlarm,
        acknowledgement.idempotencyKey,
        auditEvent.id,
      );
      this.insertAuditEvent(auditEvent);
      return { kind: "acknowledged", alarm: acknowledgedAlarm, auditEvent };
    });
  }

  listAuditEvents(
    farmId: FarmId,
    options: AuditEventListOptions = {},
  ): readonly AuditEvent[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const parameters: Array<string | number> = [farmId];
    const includeUnscoped = options.includeUnscoped ?? false;
    let sql = `
      SELECT payload_json
      FROM audit_events
      WHERE farm_id = ?
    `;

    if (!includeUnscoped) {
      sql += " AND cycle_id IS NOT NULL";
    }

    if (options.cycleId !== undefined) {
      sql += includeUnscoped
        ? " AND (cycle_id = ? OR cycle_id IS NULL)"
        : " AND cycle_id = ?";
      parameters.push(options.cycleId);
    }

    sql += `
      ORDER BY occurred_at DESC, id ASC
      LIMIT ?
    `;
    parameters.push(limit);

    const rows = this.database.prepare(sql).all(...parameters) as JsonRow[];
    return rows.map((row) => parseStoredAuditEvent(row.payload_json));
  }

  seedIrrigationStrategy(strategyInput: IrrigationStrategy): SeedIrrigationStrategyResult {
    const strategy = parseIrrigationStrategy(strategyInput);
    const payload = JSON.stringify(strategy);

    return this.transaction(() => {
      const existing = this.database.prepare(`
        SELECT payload_json
        FROM irrigation_strategies
        WHERE farm_id = ? AND id = ? AND version = ?
      `).get(strategy.farmId, strategy.id, strategy.version) as StrategyRow | undefined;
      if (existing !== undefined) {
        return existing.payload_json === payload
          ? { kind: "replayed", strategy: parseStoredIrrigationStrategy(existing.payload_json) }
          : { kind: "conflict", reason: "Strategy version was reused with different content" };
      }

      this.insertIrrigationStrategy(strategy);
      return { kind: "created", strategy };
    });
  }

  listIrrigationStrategies(
    farmId: FarmId,
    cycleId: CropCycleId,
  ): readonly IrrigationStrategy[] {
    const rows = this.database.prepare(`
      SELECT payload_json
      FROM irrigation_strategies
      WHERE farm_id = ? AND cycle_id = ? AND status = 'approved'
      ORDER BY created_at DESC, id ASC, version ASC
    `).all(farmId, cycleId) as StrategyRow[];

    return rows.map((row) => parseStoredIrrigationStrategy(row.payload_json));
  }

  getIrrigationStrategy(
    farmId: FarmId,
    strategyId: string,
    version: number,
  ): IrrigationStrategy | null {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM irrigation_strategies
      WHERE farm_id = ? AND id = ? AND version = ?
    `).get(farmId, strategyId, version) as StrategyRow | undefined;

    return row === undefined ? null : parseStoredIrrigationStrategy(row.payload_json);
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

    return this.transaction(() => {
      const existing = this.database.prepare(`
        SELECT fingerprint, payload_json
        FROM strategy_applications
        WHERE farm_id = ? AND actor_id = ? AND idempotency_key = ?
      `).get(
        application.farmId,
        application.actor.id,
        application.idempotencyKey,
      ) as StrategyApplicationRow | undefined;
      if (existing !== undefined) {
        const stored = parseStoredStrategyApplication(existing.payload_json);
        return existing.fingerprint === fingerprint
          ? { kind: "replayed", application: stored }
          : { kind: "conflict", reason: "Idempotency key was reused with different intent" };
      }

      const existingById = this.database.prepare(`
        SELECT id
        FROM strategy_applications
        WHERE farm_id = ? AND id = ?
      `).get(application.farmId, application.id) as IdRow | undefined;
      if (existingById !== undefined) {
        return { kind: "conflict", reason: "Strategy application ID already exists" };
      }

      for (const target of commands) {
        const existingCommandIdempotency = this.database.prepare(`
          SELECT id
          FROM commands
          WHERE farm_id = ? AND actor_id = ? AND idempotency_key = ?
        `).get(
          target.command.farmId,
          target.command.actor.id,
          target.command.idempotencyKey,
        ) as IdRow | undefined;
        if (existingCommandIdempotency !== undefined) {
          return { kind: "conflict", reason: "Strategy application command already exists" };
        }
        const existingCommandId = this.database.prepare(`
          SELECT id
          FROM commands
          WHERE id = ?
        `).get(target.command.id) as IdRow | undefined;
        if (existingCommandId !== undefined) {
          return { kind: "conflict", reason: "Strategy application command already exists" };
        }
      }

      for (const target of commands) {
        const projection = createPendingCommandProjection(target.command, application.createdAt);
        this.database.prepare(`
          INSERT INTO commands (
            id, farm_id, device_id, actor_id, idempotency_key,
            intent_fingerprint, issued_at, status, projection_json, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          target.command.id,
          target.command.farmId,
          target.command.deviceId,
          target.command.actor.id,
          target.command.idempotencyKey,
          commandIntentFingerprint(target.command),
          target.command.issuedAt,
          projection.status,
          JSON.stringify(projection),
          projection.updatedAt,
        );
      }

      this.insertStrategyApplication(application, fingerprint);
      const insertMapping = this.database.prepare(`
        INSERT INTO strategy_application_commands (
          farm_id, application_id, area_id, device_id, command_id
        ) VALUES (?, ?, ?, ?, ?)
      `);
      for (const target of commands) {
        insertMapping.run(
          application.farmId,
          application.id,
          target.areaId,
          target.deviceId,
          target.command.id,
        );
      }

      return { kind: "created", application };
    });
  }

  getStrategyApplication(farmId: FarmId, applicationId: string): StrategyApplication | null {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM strategy_applications
      WHERE farm_id = ? AND id = ?
    `).get(farmId, applicationId) as StrategyRow | undefined;

    return row === undefined ? null : parseStoredStrategyApplication(row.payload_json);
  }

  putTelemetry(telemetryInput: Telemetry): PutTelemetryResult {
    const telemetry = TelemetrySchema.parse(telemetryInput);
    const payload = JSON.stringify(telemetry);

    return this.transaction(() => {
      const existing = this.database.prepare(
        "SELECT payload_json FROM telemetry WHERE id = ?",
      ).get(telemetry.id) as JsonRow | undefined;

      if (existing !== undefined) {
        return existing.payload_json === payload
          ? { kind: "replayed" }
          : { kind: "conflict", reason: "Telemetry ID was reused with different content" };
      }

      const latestRow = this.database.prepare(`
        SELECT payload_json
        FROM telemetry
        WHERE farm_id = ? AND device_id = ? AND metric = ?
        ORDER BY sequence DESC, observed_at DESC, id DESC
        LIMIT 1
      `).get(telemetry.farmId, telemetry.deviceId, telemetry.metric) as JsonRow | undefined;

      if (latestRow !== undefined) {
        const latest = parseStoredTelemetry(latestRow.payload_json);
        if (telemetry.sequence <= latest.sequence) {
          return { kind: "conflict", reason: "Telemetry sequence did not advance" };
        }
        if (Date.parse(telemetry.observedAt) < Date.parse(latest.observedAt)) {
          return { kind: "conflict", reason: "Telemetry observation time moved backwards" };
        }
      }

      this.database.prepare(`
        INSERT INTO telemetry (
          id, farm_id, device_id, metric, sequence, observed_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        telemetry.id,
        telemetry.farmId,
        telemetry.deviceId,
        telemetry.metric,
        telemetry.sequence,
        telemetry.observedAt,
        payload,
      );
      this.evaluateAcceptedTelemetry(telemetry);
      return { kind: "accepted" };
    });
  }

  latestTelemetry(
    farmId: FarmId,
    deviceId: DeviceId,
    metric: TelemetryMetric,
  ): Telemetry | null {
    const row = this.database.prepare(`
      SELECT payload_json
      FROM telemetry
      WHERE farm_id = ? AND device_id = ? AND metric = ?
      ORDER BY sequence DESC, observed_at DESC, id DESC
      LIMIT 1
    `).get(farmId, deviceId, metric) as JsonRow | undefined;

    return row === undefined ? null : parseStoredTelemetry(row.payload_json);
  }

  recentTelemetry(
    farmId: FarmId,
    deviceId: DeviceId,
    metric: TelemetryMetric,
    limit: number,
  ): readonly Telemetry[] {
    const rows = this.database.prepare(`
      SELECT payload_json
      FROM telemetry
      WHERE farm_id = ? AND device_id = ? AND metric = ?
      ORDER BY sequence DESC, observed_at DESC, id DESC
      LIMIT ?
    `).all(farmId, deviceId, metric, limit) as JsonRow[];

    return rows.map((row) => parseStoredTelemetry(row.payload_json)).reverse();
  }

  createCommand(command: Command, updatedAt: string): CreateCommandResult {
    const intentFingerprint = commandIntentFingerprint(command);

    return this.transaction(() => {
      const existingByKey = this.database.prepare(`
        SELECT intent_fingerprint, projection_json
        FROM commands
        WHERE farm_id = ? AND actor_id = ? AND idempotency_key = ?
      `).get(
        command.farmId,
        command.actor.id,
        command.idempotencyKey,
      ) as CommandRow | undefined;

      if (existingByKey !== undefined) {
        const projection = parseStoredProjection(existingByKey.projection_json);
        return existingByKey.intent_fingerprint === intentFingerprint
          ? { kind: "replayed", projection }
          : { kind: "conflict", reason: "Idempotency key was reused with different intent" };
      }

      const existingById = this.database.prepare(
        "SELECT id FROM commands WHERE id = ?",
      ).get(command.id);
      if (existingById !== undefined) {
        return { kind: "conflict", reason: "Command ID already exists" };
      }

      const projection = createPendingCommandProjection(command, updatedAt);
      this.database.prepare(`
        INSERT INTO commands (
          id, farm_id, device_id, actor_id, idempotency_key,
          intent_fingerprint, issued_at, status, projection_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        command.id,
        command.farmId,
        command.deviceId,
        command.actor.id,
        command.idempotencyKey,
        intentFingerprint,
        command.issuedAt,
        projection.status,
        JSON.stringify(projection),
        projection.updatedAt,
      );
      return { kind: "created", projection };
    });
  }

  listCommands(
    farmId: FarmId,
    options: CommandListOptions = {},
  ): readonly CommandProjection[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const parameters: Array<string | number> = [farmId];
    let sql = `
      SELECT projection_json
      FROM commands
      WHERE farm_id = ?
    `;

    if (options.deviceId !== undefined) {
      sql += " AND device_id = ?";
      parameters.push(options.deviceId);
    }

    sql += `
      ORDER BY updated_at DESC, issued_at DESC, id ASC
      LIMIT ?
    `;
    parameters.push(limit);

    const rows = this.database.prepare(sql).all(...parameters) as Pick<CommandRow, "projection_json">[];
    return rows.map((row) => parseStoredProjection(row.projection_json));
  }

  getCommand(commandId: string): CommandProjection | null {
    const row = this.database.prepare(
      "SELECT projection_json FROM commands WHERE id = ?",
    ).get(commandId) as Pick<CommandRow, "projection_json"> | undefined;

    return row === undefined ? null : parseStoredProjection(row.projection_json);
  }

  getFarmControlProfile(farmId: FarmId): FarmControlProfile | null {
    const row = this.database.prepare(`
      SELECT revision, updated_at, payload_json
      FROM farm_control_profiles
      WHERE farm_id = ?
    `).get(farmId) as FarmControlProfileRow | undefined;

    return row === undefined ? null : parseStoredFarmControlProfile(row.payload_json);
  }

  updateFarmControlProfile(
    profileInput: FarmControlProfile,
    expectedRevision: number,
  ): UpdateFarmControlProfileResult {
    const profile = FarmControlProfileSchema.parse(profileInput);

    return this.transaction(() => {
      const current = this.database.prepare(`
        SELECT revision, updated_at, payload_json
        FROM farm_control_profiles
        WHERE farm_id = ?
      `).get(profile.farmId) as FarmControlProfileRow | undefined;
      const currentRevision = current?.revision ?? 0;

      if (currentRevision !== expectedRevision) {
        return { kind: "conflict", reason: "Farm control profile revision does not match" };
      }

      if (profile.revision !== currentRevision + 1) {
        return { kind: "conflict", reason: "Farm control profile revision must advance by one" };
      }

      this.database.prepare(`
        INSERT INTO farm_control_profiles (
          farm_id, revision, updated_at, payload_json
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(farm_id) DO UPDATE SET
          revision = excluded.revision,
          updated_at = excluded.updated_at,
          payload_json = excluded.payload_json
      `).run(
        profile.farmId,
        profile.revision,
        profile.updatedAt,
        JSON.stringify(profile),
      );

      return { kind: "updated", profile };
    });
  }

  issueGatewayEnrollment(input: IssueGatewayEnrollmentInput): GatewayEnrollmentRecord {
    return this.transaction(() => {
      this.database.prepare(`
        INSERT INTO gateway_enrollments (
          id, farm_id, device_id, token_digest, issued_by_actor_id,
          issued_at, expires_at, exchanged_at, exchanged_credential_id,
          revoked_at, revoked_by_actor_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
      `).run(
        input.id,
        input.farmId,
        input.deviceId,
        input.tokenDigest,
        input.issuedByActorId,
        input.issuedAt,
        input.expiresAt,
      );

      return GatewayEnrollmentRecordSchema.parse({
        schemaVersion: "smartfarm.gateway-enrollment-record.v1",
        id: input.id,
        farmId: input.farmId,
        deviceId: input.deviceId,
        status: "pending",
        issuedByActorId: input.issuedByActorId,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        exchangedAt: null,
        exchangedCredentialId: null,
        revokedAt: null,
        revokedByActorId: null,
      });
    });
  }

  listGatewayEnrollments(
    farmId: FarmId,
    deviceId: DeviceId,
    options: GatewayAccessListOptions,
  ): readonly GatewayEnrollmentRecord[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const rows = this.database.prepare(`
      SELECT
        id,
        farm_id,
        device_id,
        token_digest,
        issued_by_actor_id,
        issued_at,
        expires_at,
        exchanged_at,
        exchanged_credential_id,
        revoked_at,
        revoked_by_actor_id
      FROM gateway_enrollments
      WHERE farm_id = ? AND device_id = ?
      ORDER BY issued_at DESC, id ASC
      LIMIT ?
    `).all(farmId, deviceId, limit) as GatewayEnrollmentRow[];

    return rows.map((row) => gatewayEnrollmentRecordFromRow(row, options.now));
  }

  getGatewayEnrollmentAuthentication(
    enrollmentId: GatewayEnrollmentId,
  ): GatewayEnrollmentAuthenticationMaterial | null {
    const row = this.database.prepare(`
      SELECT
        id,
        farm_id,
        device_id,
        token_digest,
        issued_by_actor_id,
        issued_at,
        expires_at,
        exchanged_at,
        exchanged_credential_id,
        revoked_at,
        revoked_by_actor_id
      FROM gateway_enrollments
      WHERE id = ?
    `).get(enrollmentId) as GatewayEnrollmentRow | undefined;

    return row === undefined ? null : gatewayEnrollmentAuthenticationFromRow(row);
  }

  exchangeGatewayEnrollment(
    input: ExchangeGatewayEnrollmentInput,
  ): ExchangeGatewayEnrollmentResult {
    return this.transaction(() => {
      const enrollmentUpdate = this.database.prepare(`
        UPDATE gateway_enrollments
        SET exchanged_at = ?, exchanged_credential_id = ?
        WHERE id = ?
          AND token_digest = ?
          AND exchanged_at IS NULL
          AND revoked_at IS NULL
          AND expires_at > ?
      `).run(
        input.exchangedAt,
        input.credentialId,
        input.enrollmentId,
        input.expectedTokenDigest,
        input.exchangedAt,
      );
      if (enrollmentUpdate.changes === 0) {
        return { kind: "invalid" };
      }

      const enrollment = this.database.prepare(`
        SELECT farm_id, device_id
        FROM gateway_enrollments
        WHERE id = ?
      `).get(input.enrollmentId) as
        | { readonly farm_id: string; readonly device_id: string }
        | undefined;
      if (enrollment === undefined) {
        throw new Error("Gateway enrollment exchange lost its source row");
      }

      this.database.prepare(`
        INSERT INTO edge_credentials (
          id, farm_id, device_id, credential_digest, created_from_enrollment_id,
          created_at, revoked_at, revoked_by_actor_id
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)
      `).run(
        input.credentialId,
        enrollment.farm_id,
        enrollment.device_id,
        input.credentialDigest,
        input.enrollmentId,
        input.exchangedAt,
      );

      return {
        kind: "exchanged",
        credential: EdgeCredentialRecordSchema.parse({
          schemaVersion: "smartfarm.edge-credential-record.v1",
          id: input.credentialId,
          farmId: enrollment.farm_id,
          deviceId: enrollment.device_id,
          status: "active",
          createdFromEnrollmentId: input.enrollmentId,
          createdAt: input.exchangedAt,
          revokedAt: null,
          revokedByActorId: null,
        }),
      };
    });
  }

  revokeGatewayEnrollment(
    input: RevokeGatewayEnrollmentInput,
  ): RevokeGatewayEnrollmentResult {
    return this.transaction(() => {
      const row = this.database.prepare(`
        SELECT
          id,
          farm_id,
          device_id,
          token_digest,
          issued_by_actor_id,
          issued_at,
          expires_at,
          exchanged_at,
          exchanged_credential_id,
          revoked_at,
          revoked_by_actor_id
        FROM gateway_enrollments
        WHERE id = ? AND farm_id = ? AND device_id = ?
      `).get(
        input.enrollmentId,
        input.farmId,
        input.deviceId,
      ) as GatewayEnrollmentRow | undefined;

      if (row === undefined) {
        return { kind: "not_found" };
      }
      if (row.revoked_at !== null) {
        return {
          kind: "replayed",
          enrollment: gatewayEnrollmentRecordFromRow(row, input.revokedAt),
        };
      }
      if (row.exchanged_at !== null || row.exchanged_credential_id !== null) {
        return {
          kind: "conflict",
          reason: "Gateway enrollment has already been exchanged",
        };
      }

      this.database.prepare(`
        UPDATE gateway_enrollments
        SET revoked_at = ?, revoked_by_actor_id = ?
        WHERE id = ? AND farm_id = ? AND device_id = ?
      `).run(
        input.revokedAt,
        input.revokedByActorId,
        input.enrollmentId,
        input.farmId,
        input.deviceId,
      );

      return {
        kind: "revoked",
        enrollment: GatewayEnrollmentRecordSchema.parse({
          schemaVersion: "smartfarm.gateway-enrollment-record.v1",
          id: row.id,
          farmId: row.farm_id,
          deviceId: row.device_id,
          status: "revoked",
          issuedByActorId: row.issued_by_actor_id,
          issuedAt: row.issued_at,
          expiresAt: row.expires_at,
          exchangedAt: null,
          exchangedCredentialId: null,
          revokedAt: input.revokedAt,
          revokedByActorId: input.revokedByActorId,
        }),
      };
    });
  }

  listEdgeCredentials(
    farmId: FarmId,
    deviceId: DeviceId,
    options: GatewayAccessListOptions,
  ): readonly EdgeCredentialRecord[] {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 100));
    const rows = this.database.prepare(`
      SELECT
        id,
        farm_id,
        device_id,
        credential_digest,
        created_from_enrollment_id,
        created_at,
        revoked_at,
        revoked_by_actor_id
      FROM edge_credentials
      WHERE farm_id = ? AND device_id = ?
      ORDER BY created_at DESC, id ASC
      LIMIT ?
    `).all(farmId, deviceId, limit) as EdgeCredentialRow[];

    return rows.map(parseEdgeCredentialRow);
  }

  getEdgeCredentialAuthentication(
    credentialId: EdgeCredentialId,
  ): EdgeCredentialAuthenticationMaterial | null {
    const row = this.database.prepare(`
      SELECT
        id,
        farm_id,
        device_id,
        credential_digest,
        created_from_enrollment_id,
        created_at,
        revoked_at,
        revoked_by_actor_id
      FROM edge_credentials
      WHERE id = ?
    `).get(credentialId) as EdgeCredentialRow | undefined;

    return row === undefined ? null : edgeCredentialAuthenticationFromRow(row);
  }

  revokeEdgeCredential(input: RevokeEdgeCredentialInput): RevokeEdgeCredentialResult {
    return this.transaction(() => {
      const row = this.database.prepare(`
        SELECT
          id,
          farm_id,
          device_id,
          credential_digest,
          created_from_enrollment_id,
          created_at,
          revoked_at,
          revoked_by_actor_id
        FROM edge_credentials
        WHERE id = ? AND farm_id = ? AND device_id = ?
      `).get(
        input.credentialId,
        input.farmId,
        input.deviceId,
      ) as EdgeCredentialRow | undefined;

      if (row === undefined) {
        return { kind: "not_found" };
      }
      if (row.revoked_at !== null) {
        return {
          kind: "replayed",
          credential: parseEdgeCredentialRow(row),
        };
      }

      this.database.prepare(`
        UPDATE edge_credentials
        SET revoked_at = ?, revoked_by_actor_id = ?
        WHERE id = ? AND farm_id = ? AND device_id = ?
      `).run(
        input.revokedAt,
        input.revokedByActorId,
        input.credentialId,
        input.farmId,
        input.deviceId,
      );

      return {
        kind: "revoked",
        credential: EdgeCredentialRecordSchema.parse({
          schemaVersion: "smartfarm.edge-credential-record.v1",
          id: input.credentialId,
          farmId: input.farmId,
          deviceId: input.deviceId,
          status: "revoked",
          createdFromEnrollmentId: row.created_from_enrollment_id,
          createdAt: row.created_at,
          revokedAt: input.revokedAt,
          revokedByActorId: input.revokedByActorId,
        }),
      };
    });
  }

  nextPendingCommand(farmId: FarmId, deviceId: DeviceId): CommandProjection | null {
    const row = this.database.prepare(`
      SELECT projection_json
      FROM commands
      WHERE farm_id = ? AND device_id = ? AND status = 'pending'
      ORDER BY issued_at ASC, id ASC
      LIMIT 1
    `).get(farmId, deviceId) as Pick<CommandRow, "projection_json"> | undefined;

    return row === undefined ? null : parseStoredProjection(row.projection_json);
  }

  nextPendingStopCommand(farmId: FarmId, deviceId: DeviceId): CommandProjection | null {
    const row = this.database.prepare(`
      SELECT projection_json
      FROM commands
      WHERE farm_id = ? AND device_id = ? AND status = 'pending'
        AND json_extract(projection_json, '$.command.schemaVersion') = 'smartfarm.command.v1'
        AND json_extract(projection_json, '$.command.payload.action') = 'set_pump_state'
        AND json_extract(projection_json, '$.command.payload.state') = 'off'
      ORDER BY issued_at ASC, id ASC
      LIMIT 1
    `).get(farmId, deviceId) as Pick<CommandRow, "projection_json"> | undefined;

    return row === undefined ? null : parseStoredProjection(row.projection_json);
  }

  applyAck(ack: CommandAck, updatedAt: string): ApplyAckResult {
    return this.transaction(() => {
      const row = this.database.prepare(`
        SELECT intent_fingerprint, projection_json
        FROM commands
        WHERE id = ?
      `).get(ack.commandId) as CommandRow | undefined;
      if (row === undefined) return { kind: "not_found" };

      const current = parseStoredProjection(row.projection_json);
      if (isExactCommandAckReplay(current, ack)) {
        return { kind: "replayed", projection: current };
      }
      const manualStopConflict = validateManualStopAckCause(
        current.command,
        ack,
        (commandId) => {
          const commandRow = this.database.prepare(`
            SELECT projection_json
            FROM commands
            WHERE id = ?
          `).get(commandId) as Pick<CommandRow, "projection_json"> | undefined;
          return commandRow === undefined
            ? null
            : parseStoredProjection(commandRow.projection_json);
        },
      );
      if (manualStopConflict !== null) {
        return { kind: "conflict", reason: manualStopConflict };
      }
      const result = applyAckToProjection(current, ack, updatedAt);
      if (result.kind !== "applied") return result;

      const nextProjection = result.projection;
      this.database.prepare(`
        UPDATE commands
        SET status = ?, projection_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        nextProjection.status,
        JSON.stringify(nextProjection),
        nextProjection.updatedAt,
        nextProjection.command.id,
      );

      const applicationMapping = this.database.prepare(`
        SELECT application_id
        FROM strategy_application_commands
        WHERE command_id = ?
      `).get(ack.commandId) as StrategyApplicationCommandRow | undefined;
      if (applicationMapping !== undefined) {
        const applicationRow = this.database.prepare(`
          SELECT fingerprint, payload_json
          FROM strategy_applications
          WHERE farm_id = ? AND id = ?
        `).get(
          nextProjection.command.farmId,
          applicationMapping.application_id,
        ) as StrategyApplicationRow | undefined;
        if (applicationRow === undefined) {
          throw new Error("Stored strategy application command mapping is inconsistent");
        }

        const currentApplication = parseStoredStrategyApplication(applicationRow.payload_json);
        const nextApplication = applyAckToStrategyApplicationProjection(
          currentApplication,
          ack,
          updatedAt,
        );
        this.updateStrategyApplication(nextApplication, applicationRow.fingerprint);

        const target = nextApplication.targets.find((entry) => entry.commandId === ack.commandId);
        if (target === undefined) {
          throw new Error("Stored strategy application target mapping is inconsistent");
        }

        this.insertAuditEvent(buildCommandCompletedAuditEvent({
          application: nextApplication,
          target,
          ack,
          occurredAt: updatedAt,
        }));

        if (currentApplication.status === "pending" && nextApplication.status !== "pending") {
          this.insertAuditEvent(buildStrategyAppliedAuditEvent(nextApplication));
        }
      } else {
        this.insertAuditEvent(buildDirectCommandCompletedAuditEvent({
          command: nextProjection.command,
          ack,
          occurredAt: updatedAt,
        }));
      }
      return result;
    });
  }

  private migrate(): void {
    const versionRow = this.database.prepare("PRAGMA user_version").get() as
      | { readonly user_version: number }
      | undefined;
    const version = versionRow?.user_version ?? 0;
    if (version === SQLITE_SCHEMA_VERSION) return;
    if (version < 0 || version > SQLITE_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported SQLite schema version: expected ${SQLITE_SCHEMA_VERSION}`,
      );
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (version === 0) {
        this.database.exec(`
          CREATE TABLE telemetry (
            id TEXT PRIMARY KEY,
            farm_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            metric TEXT NOT NULL,
            sequence INTEGER NOT NULL CHECK (sequence >= 0),
            observed_at TEXT NOT NULL,
            payload_json TEXT NOT NULL
          ) STRICT;

          CREATE INDEX telemetry_latest_idx
            ON telemetry (farm_id, device_id, metric, sequence DESC, observed_at DESC, id DESC);

          CREATE TABLE commands (
            id TEXT PRIMARY KEY,
            farm_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            actor_id TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            intent_fingerprint TEXT NOT NULL,
            issued_at TEXT NOT NULL,
            status TEXT NOT NULL CHECK (
              status IN ('pending', 'acknowledged', 'failed', 'timed_out')
            ),
            projection_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE (farm_id, actor_id, idempotency_key)
          ) STRICT;

          CREATE INDEX commands_pending_idx
            ON commands (farm_id, device_id, status, issued_at ASC, id ASC);
        `);
      }

      if (version <= 1) {
        this.database.exec(`
          CREATE TABLE farms (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            payload_json TEXT NOT NULL
          ) STRICT;

          CREATE INDEX farms_created_idx
            ON farms (created_at ASC, id ASC);

          CREATE TABLE devices (
            farm_id TEXT NOT NULL,
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            status TEXT NOT NULL,
            last_seen_at TEXT,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (farm_id, id)
          ) STRICT;

          CREATE INDEX devices_farm_idx
            ON devices (farm_id ASC, id ASC);

          CREATE TABLE crops (
            id TEXT PRIMARY KEY,
            farm_id TEXT NOT NULL,
            device_id TEXT,
            name TEXT NOT NULL,
            health_status TEXT NOT NULL,
            manager_name TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL
          ) STRICT;

          CREATE INDEX crops_farm_created_idx
            ON crops (farm_id ASC, created_at ASC, id ASC);
        `);
      }

      if (version <= 2) {
        this.database.exec(`
          CREATE TABLE growing_areas (
            farm_id TEXT NOT NULL,
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            primary_device_id TEXT,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (farm_id, id),
            FOREIGN KEY (farm_id) REFERENCES farms (id) ON DELETE CASCADE,
            FOREIGN KEY (farm_id, primary_device_id) REFERENCES devices (farm_id, id)
          ) STRICT;

          CREATE INDEX growing_areas_farm_created_idx
            ON growing_areas (farm_id ASC, created_at ASC, id ASC);

          CREATE TABLE crop_cycles (
            farm_id TEXT NOT NULL,
            id TEXT NOT NULL,
            name TEXT NOT NULL,
            crop_name TEXT NOT NULL,
            variety TEXT,
            status TEXT NOT NULL,
            started_at TEXT,
            planned_end_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (farm_id, id),
            FOREIGN KEY (farm_id) REFERENCES farms (id) ON DELETE CASCADE
          ) STRICT;

          CREATE INDEX crop_cycles_farm_created_idx
            ON crop_cycles (farm_id ASC, created_at ASC, id ASC);

          CREATE TABLE crop_cycle_areas (
            crop_cycle_id TEXT NOT NULL,
            farm_id TEXT NOT NULL,
            area_id TEXT NOT NULL,
            PRIMARY KEY (farm_id, crop_cycle_id, area_id),
            FOREIGN KEY (farm_id, crop_cycle_id) REFERENCES crop_cycles (farm_id, id) ON DELETE CASCADE,
            FOREIGN KEY (farm_id, area_id) REFERENCES growing_areas (farm_id, id) ON DELETE CASCADE
          ) STRICT;

          CREATE INDEX crop_cycle_areas_active_lookup_idx
            ON crop_cycle_areas (farm_id ASC, area_id ASC, crop_cycle_id ASC);
        `);
      }

      if (version <= 3) {
        this.database.exec(`
          CREATE TABLE alarm_rules (
            farm_id TEXT NOT NULL,
            id TEXT NOT NULL,
            cycle_id TEXT NOT NULL,
            area_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            name TEXT NOT NULL,
            metric TEXT NOT NULL,
            comparison TEXT NOT NULL CHECK (comparison IN ('above', 'below')),
            threshold REAL NOT NULL,
            severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
            enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (farm_id, id),
            FOREIGN KEY (farm_id, cycle_id) REFERENCES crop_cycles (farm_id, id) ON DELETE CASCADE,
            FOREIGN KEY (farm_id, area_id) REFERENCES growing_areas (farm_id, id) ON DELETE CASCADE,
            FOREIGN KEY (farm_id, device_id) REFERENCES devices (farm_id, id) ON DELETE CASCADE
          ) STRICT;

          CREATE INDEX alarm_rules_farm_created_idx
            ON alarm_rules (farm_id ASC, created_at ASC, id ASC);

          CREATE INDEX alarm_rules_match_idx
            ON alarm_rules (farm_id ASC, device_id ASC, metric ASC, enabled ASC, id ASC);

          CREATE TABLE alarm_instances (
            farm_id TEXT NOT NULL,
            id TEXT NOT NULL,
            rule_id TEXT NOT NULL,
            cycle_id TEXT NOT NULL,
            area_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            rule_name TEXT NOT NULL,
            metric TEXT NOT NULL,
            comparison TEXT NOT NULL CHECK (comparison IN ('above', 'below')),
            threshold REAL NOT NULL,
            severity TEXT NOT NULL CHECK (severity IN ('warning', 'critical')),
            state TEXT NOT NULL CHECK (state IN ('active', 'cleared')),
            trigger_telemetry_id TEXT NOT NULL,
            last_telemetry_id TEXT NOT NULL,
            opened_at TEXT NOT NULL,
            last_observed_at TEXT NOT NULL,
            last_value REAL NOT NULL,
            cleared_at TEXT,
            acknowledgement_actor_id TEXT,
            acknowledgement_at TEXT,
            acknowledgement_idempotency_key TEXT,
            acknowledgement_audit_event_id TEXT,
            updated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (farm_id, id),
            FOREIGN KEY (farm_id, rule_id) REFERENCES alarm_rules (farm_id, id) ON DELETE CASCADE,
            FOREIGN KEY (farm_id, cycle_id) REFERENCES crop_cycles (farm_id, id) ON DELETE CASCADE,
            FOREIGN KEY (farm_id, area_id) REFERENCES growing_areas (farm_id, id) ON DELETE CASCADE,
            FOREIGN KEY (farm_id, device_id) REFERENCES devices (farm_id, id) ON DELETE CASCADE
          ) STRICT;

          CREATE UNIQUE INDEX alarm_instances_active_rule_idx
            ON alarm_instances (farm_id, rule_id)
            WHERE state = 'active';

          CREATE INDEX alarm_instances_list_idx
            ON alarm_instances (
              farm_id ASC,
              state ASC,
              cycle_id ASC,
              last_observed_at DESC,
              updated_at DESC,
              id ASC
            );

          CREATE TABLE audit_events (
            farm_id TEXT NOT NULL,
            id TEXT NOT NULL,
            cycle_id TEXT,
            action TEXT NOT NULL CHECK (
              action IN ('alarm.acknowledged', 'strategy.applied', 'command.completed')
            ),
            target_type TEXT NOT NULL CHECK (
              target_type IN ('alarm', 'strategy_application', 'command')
            ),
            target_id TEXT NOT NULL,
            result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
            occurred_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (farm_id, id),
            FOREIGN KEY (farm_id, cycle_id) REFERENCES crop_cycles (farm_id, id) ON DELETE CASCADE
          ) STRICT;

          CREATE INDEX audit_events_list_idx
            ON audit_events (farm_id ASC, cycle_id ASC, occurred_at DESC, id ASC);
        `);
      }

      if (version === 4) {
        this.database.exec(`
          DROP INDEX audit_events_list_idx;
          ALTER TABLE audit_events RENAME TO audit_events_v4;

          CREATE TABLE audit_events (
            farm_id TEXT NOT NULL,
            id TEXT NOT NULL,
            cycle_id TEXT,
            action TEXT NOT NULL CHECK (
              action IN ('alarm.acknowledged', 'strategy.applied', 'command.completed')
            ),
            target_type TEXT NOT NULL CHECK (
              target_type IN ('alarm', 'strategy_application', 'command')
            ),
            target_id TEXT NOT NULL,
            result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
            occurred_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (farm_id, id),
            FOREIGN KEY (farm_id, cycle_id) REFERENCES crop_cycles (farm_id, id) ON DELETE CASCADE
          ) STRICT;

          INSERT INTO audit_events (
            farm_id, id, cycle_id, action, target_type, target_id,
            result, occurred_at, payload_json
          )
          SELECT
            farm_id, id, cycle_id, action, target_type, target_id,
            result, occurred_at, payload_json
          FROM audit_events_v4;

          DROP TABLE audit_events_v4;

          CREATE INDEX audit_events_list_idx
            ON audit_events (farm_id ASC, cycle_id ASC, occurred_at DESC, id ASC);
        `);
      }

      if (version <= 4) {
        this.database.exec(`
          CREATE TABLE irrigation_strategies (
            farm_id TEXT NOT NULL,
            id TEXT NOT NULL,
            version INTEGER NOT NULL,
            cycle_id TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'retired')),
            created_at TEXT NOT NULL,
            approved_at TEXT,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (farm_id, id, version),
            FOREIGN KEY (farm_id, cycle_id) REFERENCES crop_cycles (farm_id, id) ON DELETE CASCADE
          ) STRICT;

          CREATE INDEX irrigation_strategies_cycle_idx
            ON irrigation_strategies (farm_id ASC, cycle_id ASC, status ASC, created_at DESC, id ASC, version ASC);

          CREATE TABLE strategy_applications (
            farm_id TEXT NOT NULL,
            id TEXT NOT NULL,
            cycle_id TEXT NOT NULL,
            strategy_id TEXT NOT NULL,
            strategy_version INTEGER NOT NULL,
            actor_id TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            fingerprint TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'partial', 'failed')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (farm_id, id),
            UNIQUE (farm_id, actor_id, idempotency_key),
            FOREIGN KEY (farm_id, cycle_id) REFERENCES crop_cycles (farm_id, id) ON DELETE CASCADE,
            FOREIGN KEY (farm_id, strategy_id, strategy_version)
              REFERENCES irrigation_strategies (farm_id, id, version) ON DELETE RESTRICT
          ) STRICT;

          CREATE INDEX strategy_applications_cycle_idx
            ON strategy_applications (farm_id ASC, cycle_id ASC, status ASC, updated_at DESC, id ASC);

          CREATE TABLE strategy_application_commands (
            farm_id TEXT NOT NULL,
            application_id TEXT NOT NULL,
            area_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            command_id TEXT NOT NULL,
            PRIMARY KEY (farm_id, application_id, area_id, device_id),
            UNIQUE (command_id),
            FOREIGN KEY (farm_id, application_id)
              REFERENCES strategy_applications (farm_id, id) ON DELETE CASCADE,
            FOREIGN KEY (farm_id, area_id)
              REFERENCES growing_areas (farm_id, id) ON DELETE CASCADE,
            FOREIGN KEY (farm_id, device_id)
              REFERENCES devices (farm_id, id) ON DELETE CASCADE,
            FOREIGN KEY (command_id)
              REFERENCES commands (id) ON DELETE CASCADE
          ) STRICT;

          CREATE INDEX strategy_application_commands_command_idx
            ON strategy_application_commands (command_id ASC, farm_id ASC, application_id ASC);
        `);
      }

      if (version === 5) {
        // Schema 6 introduces unscoped direct-command audits with cycle_id = NULL,
        // so this table rebuild is forward-only unless those rows are discarded.
        this.database.exec(`
          DROP INDEX audit_events_list_idx;
          ALTER TABLE audit_events RENAME TO audit_events_v5;

          CREATE TABLE audit_events (
            farm_id TEXT NOT NULL,
            id TEXT NOT NULL,
            cycle_id TEXT,
            action TEXT NOT NULL CHECK (
              action IN ('alarm.acknowledged', 'strategy.applied', 'command.completed')
            ),
            target_type TEXT NOT NULL CHECK (
              target_type IN ('alarm', 'strategy_application', 'command')
            ),
            target_id TEXT NOT NULL,
            result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
            occurred_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            PRIMARY KEY (farm_id, id),
            FOREIGN KEY (farm_id, cycle_id) REFERENCES crop_cycles (farm_id, id) ON DELETE CASCADE
          ) STRICT;

          INSERT INTO audit_events (
            farm_id, id, cycle_id, action, target_type, target_id,
            result, occurred_at, payload_json
          )
          SELECT
            farm_id, id, cycle_id, action, target_type, target_id,
            result, occurred_at, payload_json
          FROM audit_events_v5;

          DROP TABLE audit_events_v5;

          CREATE INDEX audit_events_list_idx
            ON audit_events (farm_id ASC, cycle_id ASC, occurred_at DESC, id ASC);
        `);
      }

      if (version <= 6) {
        this.database.exec(`
          CREATE TABLE farm_control_profiles (
            farm_id TEXT NOT NULL PRIMARY KEY,
            revision INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            FOREIGN KEY (farm_id) REFERENCES farms (id) ON DELETE CASCADE
          ) STRICT;
        `);
      }

      if (version <= 7) {
        this.database.exec(`
          CREATE TABLE gateway_enrollments (
            id TEXT PRIMARY KEY,
            farm_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            token_digest TEXT NOT NULL,
            issued_by_actor_id TEXT NOT NULL,
            issued_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            exchanged_at TEXT,
            exchanged_credential_id TEXT,
            revoked_at TEXT,
            revoked_by_actor_id TEXT,
            FOREIGN KEY (farm_id, device_id)
              REFERENCES devices (farm_id, id) ON DELETE CASCADE
          ) STRICT;

          CREATE INDEX gateway_enrollments_device_idx
            ON gateway_enrollments (farm_id ASC, device_id ASC, issued_at DESC, id ASC);

          CREATE TABLE edge_credentials (
            id TEXT PRIMARY KEY,
            farm_id TEXT NOT NULL,
            device_id TEXT NOT NULL,
            credential_digest TEXT NOT NULL,
            created_from_enrollment_id TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            revoked_at TEXT,
            revoked_by_actor_id TEXT,
            FOREIGN KEY (farm_id, device_id)
              REFERENCES devices (farm_id, id) ON DELETE CASCADE,
            FOREIGN KEY (created_from_enrollment_id)
              REFERENCES gateway_enrollments (id) ON DELETE RESTRICT
          ) STRICT;

          CREATE INDEX edge_credentials_device_idx
            ON edge_credentials (farm_id ASC, device_id ASC, created_at DESC, id ASC);
        `);
      }

      this.database.exec(`PRAGMA user_version = ${SQLITE_SCHEMA_VERSION}`);
      this.database.exec("COMMIT");
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the original migration error.
      }
      throw error;
    }
  }

  private transaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the original operation error.
      }
      throw error;
    }
  }

  private insertOrReplaceCrop(crop: CropRecord): void {
    this.database.prepare(`
      INSERT INTO crops (
        id, farm_id, device_id, name, health_status, manager_name,
        created_at, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        farm_id = excluded.farm_id,
        device_id = excluded.device_id,
        name = excluded.name,
        health_status = excluded.health_status,
        manager_name = excluded.manager_name,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(
      crop.id,
      crop.farmId,
      crop.deviceId,
      crop.name,
      crop.healthStatus,
      crop.managerName,
      crop.createdAt,
      crop.updatedAt,
      JSON.stringify(crop),
    );
  }

  private insertOrReplaceCropCycle(cropCycle: CropCycleDetail): void {
    this.database.prepare(`
      INSERT INTO crop_cycles (
        id, farm_id, name, crop_name, variety, status,
        started_at, planned_end_at, created_at, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(farm_id, id) DO UPDATE SET
        name = excluded.name,
        crop_name = excluded.crop_name,
        variety = excluded.variety,
        status = excluded.status,
        started_at = excluded.started_at,
        planned_end_at = excluded.planned_end_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(
      cropCycle.cycle.id,
      cropCycle.cycle.farmId,
      cropCycle.cycle.name,
      cropCycle.cycle.cropName,
      cropCycle.cycle.variety,
      cropCycle.cycle.status,
      cropCycle.cycle.startedAt,
      cropCycle.cycle.plannedEndAt,
      cropCycle.cycle.createdAt,
      cropCycle.cycle.updatedAt,
      JSON.stringify(cropCycle.cycle),
    );

    this.database.prepare(
      "DELETE FROM crop_cycle_areas WHERE farm_id = ? AND crop_cycle_id = ?",
    ).run(cropCycle.cycle.farmId, cropCycle.cycle.id);

    const insertAssignment = this.database.prepare(`
      INSERT INTO crop_cycle_areas (crop_cycle_id, farm_id, area_id)
      VALUES (?, ?, ?)
    `);
    for (const areaId of cropCycle.areaIds) {
      insertAssignment.run(cropCycle.cycle.id, cropCycle.cycle.farmId, areaId);
    }
  }

  private insertOrReplaceAlarmRule(rule: AlarmRule): void {
    this.database.prepare(`
      INSERT INTO alarm_rules (
        farm_id, id, cycle_id, area_id, device_id, name,
        metric, comparison, threshold, severity, enabled,
        created_at, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(farm_id, id) DO UPDATE SET
        cycle_id = excluded.cycle_id,
        area_id = excluded.area_id,
        device_id = excluded.device_id,
        name = excluded.name,
        metric = excluded.metric,
        comparison = excluded.comparison,
        threshold = excluded.threshold,
        severity = excluded.severity,
        enabled = excluded.enabled,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(
      rule.farmId,
      rule.id,
      rule.cycleId,
      rule.areaId,
      rule.deviceId,
      rule.name,
      rule.metric,
      rule.comparison,
      rule.threshold,
      rule.severity,
      rule.enabled ? 1 : 0,
      rule.createdAt,
      rule.updatedAt,
      JSON.stringify(rule),
    );
  }

  private insertOrReplaceAlarmInstance(
    alarm: AlarmInstance,
    acknowledgementIdempotencyKey: string | null,
    acknowledgementAuditEventId: string | null,
  ): void {
    this.database.prepare(`
      INSERT INTO alarm_instances (
        farm_id, id, rule_id, cycle_id, area_id, device_id, rule_name,
        metric, comparison, threshold, severity, state,
        trigger_telemetry_id, last_telemetry_id, opened_at, last_observed_at,
        last_value, cleared_at, acknowledgement_actor_id, acknowledgement_at,
        acknowledgement_idempotency_key, acknowledgement_audit_event_id,
        updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(farm_id, id) DO UPDATE SET
        rule_id = excluded.rule_id,
        cycle_id = excluded.cycle_id,
        area_id = excluded.area_id,
        device_id = excluded.device_id,
        rule_name = excluded.rule_name,
        metric = excluded.metric,
        comparison = excluded.comparison,
        threshold = excluded.threshold,
        severity = excluded.severity,
        state = excluded.state,
        trigger_telemetry_id = excluded.trigger_telemetry_id,
        last_telemetry_id = excluded.last_telemetry_id,
        opened_at = excluded.opened_at,
        last_observed_at = excluded.last_observed_at,
        last_value = excluded.last_value,
        cleared_at = excluded.cleared_at,
        acknowledgement_actor_id = excluded.acknowledgement_actor_id,
        acknowledgement_at = excluded.acknowledgement_at,
        acknowledgement_idempotency_key = excluded.acknowledgement_idempotency_key,
        acknowledgement_audit_event_id = excluded.acknowledgement_audit_event_id,
        updated_at = excluded.updated_at,
        payload_json = excluded.payload_json
    `).run(
      alarm.farmId,
      alarm.id,
      alarm.ruleId,
      alarm.cycleId,
      alarm.areaId,
      alarm.deviceId,
      alarm.ruleName,
      alarm.metric,
      alarm.comparison,
      alarm.threshold,
      alarm.severity,
      alarm.state,
      alarm.triggerTelemetryId,
      alarm.lastTelemetryId,
      alarm.openedAt,
      alarm.lastObservedAt,
      alarm.lastValue,
      alarm.clearedAt,
      alarm.acknowledgement?.actorId ?? null,
      alarm.acknowledgement?.acknowledgedAt ?? null,
      acknowledgementIdempotencyKey,
      acknowledgementAuditEventId,
      alarm.updatedAt,
      JSON.stringify(alarm),
    );
  }

  private insertAuditEvent(auditEvent: AuditEvent): void {
    this.database.prepare(`
      INSERT INTO audit_events (
        farm_id, id, cycle_id, action, target_type, target_id,
        result, occurred_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      auditEvent.farmId,
      auditEvent.id,
      auditEvent.cycleId,
      auditEvent.action,
      auditEvent.targetType,
      auditEvent.targetId,
      auditEvent.result,
      auditEvent.occurredAt,
      JSON.stringify(auditEvent),
    );
  }

  private insertIrrigationStrategy(strategy: IrrigationStrategy): void {
    this.database.prepare(`
      INSERT INTO irrigation_strategies (
        farm_id, id, version, cycle_id, status, created_at, approved_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      strategy.farmId,
      strategy.id,
      strategy.version,
      strategy.cycleId,
      strategy.status,
      strategy.createdAt,
      strategy.approvedAt,
      JSON.stringify(strategy),
    );
  }

  private insertStrategyApplication(
    application: StrategyApplication,
    fingerprint: string,
  ): void {
    this.database.prepare(`
      INSERT INTO strategy_applications (
        farm_id, id, cycle_id, strategy_id, strategy_version, actor_id,
        idempotency_key, fingerprint, status, created_at, updated_at, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      application.farmId,
      application.id,
      application.cycleId,
      application.strategyId,
      application.strategyVersion,
      application.actor.id,
      application.idempotencyKey,
      fingerprint,
      application.status,
      application.createdAt,
      application.updatedAt,
      JSON.stringify(application),
    );
  }

  private updateStrategyApplication(
    application: StrategyApplication,
    fingerprint: string,
  ): void {
    this.database.prepare(`
      UPDATE strategy_applications
      SET status = ?, updated_at = ?, fingerprint = ?, payload_json = ?
      WHERE farm_id = ? AND id = ?
    `).run(
      application.status,
      application.updatedAt,
      fingerprint,
      JSON.stringify(application),
      application.farmId,
      application.id,
    );
  }

  private validateCropCycle(
    cropCycle: CropCycleDetail,
  ): Extract<UpdateCropCycleResult, { kind: "conflict" }> | null {
    const knownAreas = this.database.prepare(`
      SELECT id
      FROM growing_areas
      WHERE farm_id = ? AND id = ?
    `);

    for (const areaId of cropCycle.areaIds) {
      const area = knownAreas.get(cropCycle.cycle.farmId, areaId) as IdRow | undefined;
      if (area === undefined) {
        return { kind: "conflict", reason: "Growing area must belong to the same farm" };
      }
    }

    if (cropCycle.cycle.status !== "active") return null;

    const query = this.database.prepare(`
      SELECT crop_cycle_areas.area_id
      FROM crop_cycle_areas
      INNER JOIN crop_cycles
        ON crop_cycles.farm_id = crop_cycle_areas.farm_id
        AND crop_cycles.id = crop_cycle_areas.crop_cycle_id
      WHERE crop_cycle_areas.farm_id = ?
        AND crop_cycle_areas.area_id = ?
        AND crop_cycles.status = 'active'
        AND crop_cycles.id != ?
      LIMIT 1
    `);

    for (const areaId of cropCycle.areaIds) {
      const conflict = query.get(
        cropCycle.cycle.farmId,
        areaId,
        cropCycle.cycle.id,
      ) as AreaAssignmentRow | undefined;
      if (conflict !== undefined) {
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
    const rules = this.database.prepare(`
      SELECT payload_json
      FROM alarm_rules
      WHERE farm_id = ? AND device_id = ? AND metric = ?
      ORDER BY created_at ASC, id ASC
    `).all(telemetry.farmId, telemetry.deviceId, telemetry.metric) as JsonRow[];

    for (const row of rules) {
      const rule = parseStoredAlarmRule(row.payload_json);
      const active = this.database.prepare(`
        SELECT
          payload_json,
          acknowledgement_actor_id,
          acknowledgement_idempotency_key,
          acknowledgement_audit_event_id
        FROM alarm_instances
        WHERE farm_id = ? AND rule_id = ? AND state = 'active'
        LIMIT 1
      `).get(rule.farmId, rule.id) as AlarmInstanceRow | undefined;

      if (!this.isAlarmRuleEvaluable(rule)) {
        if (active !== undefined) {
          const cleared = clearAlarmInstance(parseStoredAlarmInstance(active.payload_json), telemetry);
          this.insertOrReplaceAlarmInstance(
            cleared,
            active.acknowledgement_idempotency_key,
            active.acknowledgement_audit_event_id,
          );
        }
        continue;
      }

      if (isTelemetryBreached(rule, telemetry)) {
        const next = active === undefined
          ? openAlarmInstance(rule, telemetry)
          : updateAlarmInstance(parseStoredAlarmInstance(active.payload_json), telemetry);
        this.insertOrReplaceAlarmInstance(
          next,
          active?.acknowledgement_idempotency_key ?? null,
          active?.acknowledgement_audit_event_id ?? null,
        );
        continue;
      }

      if (active !== undefined) {
        const cleared = clearAlarmInstance(parseStoredAlarmInstance(active.payload_json), telemetry);
        this.insertOrReplaceAlarmInstance(
          cleared,
          active.acknowledgement_idempotency_key,
          active.acknowledgement_audit_event_id,
        );
      }
    }
  }

  private isAlarmRuleEvaluable(rule: AlarmRule): boolean {
    if (!rule.enabled) return false;

    const cycle = this.database.prepare(`
      SELECT status
      FROM crop_cycles
      WHERE farm_id = ? AND id = ?
      LIMIT 1
    `).get(rule.farmId, rule.cycleId) as { readonly status: string } | undefined;

    return cycle?.status === "active";
  }

  private readCropCycleDetail(cycle: CropCycleDetail["cycle"]): CropCycleDetail {
    const rows = this.database.prepare(`
      SELECT area_id
      FROM crop_cycle_areas
      WHERE farm_id = ? AND crop_cycle_id = ?
      ORDER BY area_id ASC
    `).all(cycle.farmId, cycle.id) as AreaAssignmentRow[];

    return CropCycleDetailSchema.parse({
      schemaVersion: "smartfarm.crop-cycle-detail.v1",
      cycle,
      areaIds: rows.map((row) => row.area_id as GrowingAreaId),
    });
  }
}

function parseStoredTelemetry(value: string): Telemetry {
  return parseStoredJson(TelemetrySchema, value, "telemetry");
}

function parseStoredProjection(value: string): CommandProjection {
  return parseStoredJson(CommandProjectionSchema, value, "command projection");
}

function parseStoredIrrigationStrategy(value: string): IrrigationStrategy {
  return parseStoredJson(IrrigationStrategySchema, value, "irrigation strategy");
}

function parseStoredStrategyApplication(value: string): StrategyApplication {
  return parseStoredJson(StrategyApplicationSchema, value, "strategy application");
}

function parseStoredAlarmRule(value: string): AlarmRule {
  return parseStoredJson(AlarmRuleSchema, value, "alarm rule");
}

function parseStoredAlarmInstance(value: string): AlarmInstance {
  return parseStoredJson(AlarmInstanceSchema, value, "alarm instance");
}

function parseStoredAuditEvent(value: string): AuditEvent {
  return parseStoredJson(AuditEventSchema, value, "audit event");
}

function parseStoredFarm(value: string): Farm {
  return parseStoredJson(FarmSchema, value, "farm");
}

function parseStoredFarmControlProfile(value: string): FarmControlProfile {
  return parseStoredJson(FarmControlProfileSchema, value, "farm control profile");
}

function parseStoredDevice(value: string): Device {
  return parseStoredJson(DeviceSchema, value, "device");
}

function parseStoredCrop(value: string): CropRecord {
  return parseStoredJson(CropRecordSchema, value, "crop");
}

function parseStoredGrowingArea(value: string): GrowingArea {
  return parseStoredJson(GrowingAreaSchema, value, "growing area");
}

function parseStoredCropCycle(value: string): CropCycleDetail["cycle"] {
  return parseStoredJson(CropCycleDetailSchema.shape.cycle, value, "crop cycle");
}

function gatewayEnrollmentAuthenticationFromRow(
  row: GatewayEnrollmentRow,
): GatewayEnrollmentAuthenticationMaterial {
  return {
    enrollmentId: row.id as GatewayEnrollmentId,
    farmId: row.farm_id as FarmId,
    deviceId: row.device_id as DeviceId,
    tokenDigest: row.token_digest,
    issuedByActorId: row.issued_by_actor_id,
    issuedAt: row.issued_at,
    expiresAt: row.expires_at,
    exchangedAt: row.exchanged_at,
    exchangedCredentialId: row.exchanged_credential_id as EdgeCredentialId | null,
    revokedAt: row.revoked_at,
    revokedByActorId: row.revoked_by_actor_id,
  };
}

function gatewayEnrollmentRecordFromRow(
  row: GatewayEnrollmentRow,
  now: string,
): GatewayEnrollmentRecord {
  const material = gatewayEnrollmentAuthenticationFromRow(row);
  return GatewayEnrollmentRecordSchema.parse({
    schemaVersion: "smartfarm.gateway-enrollment-record.v1",
    id: material.enrollmentId,
    farmId: material.farmId,
    deviceId: material.deviceId,
    status: material.revokedAt !== null
      ? "revoked"
      : material.exchangedAt !== null
        ? "exchanged"
        : Date.parse(material.expiresAt) <= Date.parse(now)
          ? "expired"
          : "pending",
    issuedByActorId: material.issuedByActorId,
    issuedAt: material.issuedAt,
    expiresAt: material.expiresAt,
    exchangedAt: material.exchangedAt,
    exchangedCredentialId: material.exchangedCredentialId,
    revokedAt: material.revokedAt,
    revokedByActorId: material.revokedByActorId,
  });
}

function edgeCredentialAuthenticationFromRow(
  row: EdgeCredentialRow,
): EdgeCredentialAuthenticationMaterial {
  return {
    credentialId: row.id as EdgeCredentialId,
    farmId: row.farm_id as FarmId,
    deviceId: row.device_id as DeviceId,
    credentialDigest: row.credential_digest,
    createdFromEnrollmentId: row.created_from_enrollment_id as GatewayEnrollmentId,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    revokedByActorId: row.revoked_by_actor_id,
  };
}

function parseEdgeCredentialRow(row: EdgeCredentialRow): EdgeCredentialRecord {
  const material = edgeCredentialAuthenticationFromRow(row);
  return EdgeCredentialRecordSchema.parse({
    schemaVersion: "smartfarm.edge-credential-record.v1",
    id: material.credentialId,
    farmId: material.farmId,
    deviceId: material.deviceId,
    status: material.revokedAt === null ? "active" : "revoked",
    createdFromEnrollmentId: material.createdFromEnrollmentId,
    createdAt: material.createdAt,
    revokedAt: material.revokedAt,
    revokedByActorId: material.revokedByActorId,
  });
}

function parseStoredJson<T>(
  schema: { readonly safeParse: (input: unknown) => { success: true; data: T } | { success: false } },
  value: string,
  label: string,
): T {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch {
    throw new Error(`Stored SQLite ${label} is not valid JSON`);
  }

  const parsed = schema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error(`Stored SQLite ${label} violates the runtime contract`);
  }
  return parsed.data;
}
