import { DatabaseSync } from "node:sqlite";
import {
  CommandAckSchema,
  CommandIdSchema,
  CommandProjectionSchema,
  CommandSchema,
  DeviceIdSchema,
  FarmIdSchema,
  IsoDateTimeSchema,
  isCommandAckCompatible,
  isPumpStopCommand,
  type Command,
  type CommandAck,
  type CommandId,
  type CommandProjection,
  type DeviceId,
  type FarmId,
} from "@smartfarm-os/contracts";

export const EDGE_EXECUTION_SQLITE_SCHEMA_VERSION = 1;

export type EdgeExecutionState = "received" | "executing" | "terminal";
export type EdgeAckDeliveryState = "none" | "pending" | "delivered";

export type EdgeExecutionRecord = {
  readonly command: Command;
  readonly state: EdgeExecutionState;
  readonly receivedAt: string;
  readonly executingAt: string | null;
  readonly terminalAt: string | null;
  readonly ack: CommandAck | null;
  readonly ackDelivery: EdgeAckDeliveryState;
  readonly ackDeliveredAt: string | null;
  readonly deliveredProjection: CommandProjection | null;
  readonly updatedAt: string;
};

export type EdgeExecutionConflictReason =
  | "command_identity_conflict"
  | "idempotency_conflict"
  | "invalid_transition"
  | "ack_mismatch"
  | "projection_mismatch";

export type AcceptCommandResult =
  | { readonly kind: "accepted"; readonly record: EdgeExecutionRecord }
  | { readonly kind: "replayed"; readonly record: EdgeExecutionRecord }
  | {
    readonly kind: "conflict";
    readonly reason: Extract<
      EdgeExecutionConflictReason,
      "command_identity_conflict" | "idempotency_conflict"
    >;
    readonly existingCommandId: CommandId;
  };

export type ExecutionTransitionResult =
  | { readonly kind: "updated"; readonly record: EdgeExecutionRecord }
  | { readonly kind: "replayed"; readonly record: EdgeExecutionRecord }
  | { readonly kind: "not_found" }
  | {
    readonly kind: "conflict";
    readonly reason: Extract<
      EdgeExecutionConflictReason,
      "invalid_transition" | "ack_mismatch" | "projection_mismatch"
    >;
    readonly record: EdgeExecutionRecord;
  };

export interface EdgeExecutionRepository {
  accept(command: Command, receivedAt: string): AcceptCommandResult;
  markExecuting(commandId: CommandId | string, at: string): ExecutionTransitionResult;
  completeAndEnqueueAck(
    commandId: CommandId | string,
    ack: CommandAck,
    at: string,
  ): ExecutionTransitionResult;
  nextPendingAck(
    farmId: FarmId | string,
    deviceId: DeviceId | string,
  ): EdgeExecutionRecord | null;
  nextAmbiguousExecution(
    farmId: FarmId | string,
    deviceId: DeviceId | string,
  ): EdgeExecutionRecord | null;
  latestAcknowledgedPumpStop(
    farmId: FarmId | string,
    deviceId: DeviceId | string,
  ): EdgeExecutionRecord | null;
  markAckDelivered(
    commandId: CommandId | string,
    ack: CommandAck,
    projection: CommandProjection,
    at: string,
  ): ExecutionTransitionResult;
  get(commandId: CommandId | string): EdgeExecutionRecord | null;
  close(): void;
}

export class InMemoryEdgeExecutionRepository implements EdgeExecutionRepository {
  private readonly records = new Map<CommandId, EdgeExecutionRecord>();
  private readonly commandIdByIdempotencyScope = new Map<string, CommandId>();
  private closed = false;

  accept(commandInput: Command, receivedAtInput: string): AcceptCommandResult {
    this.assertOpen();
    const command = CommandSchema.parse(commandInput);
    const receivedAt = parseTimestamp(receivedAtInput);
    const existing = this.records.get(command.id);

    if (existing !== undefined) {
      return commandJson(existing.command) === commandJson(command)
        ? { kind: "replayed", record: cloneRecord(existing) }
        : {
          kind: "conflict",
          reason: "command_identity_conflict",
          existingCommandId: existing.command.id,
        };
    }

    const scope = commandIdempotencyScope(command);
    const existingCommandId = this.commandIdByIdempotencyScope.get(scope);
    if (existingCommandId !== undefined) {
      return {
        kind: "conflict",
        reason: "idempotency_conflict",
        existingCommandId,
      };
    }

    const record = createReceivedRecord(command, receivedAt);
    this.records.set(command.id, record);
    this.commandIdByIdempotencyScope.set(scope, command.id);
    return { kind: "accepted", record: cloneRecord(record) };
  }

  markExecuting(
    commandIdInput: CommandId | string,
    atInput: string,
  ): ExecutionTransitionResult {
    this.assertOpen();
    const commandId = CommandIdSchema.parse(commandIdInput);
    const at = parseTimestamp(atInput);
    const existing = this.records.get(commandId);
    if (existing === undefined) return { kind: "not_found" };

    if (existing.state === "executing") {
      return { kind: "replayed", record: cloneRecord(existing) };
    }
    if (existing.state !== "received" || isBefore(at, existing.receivedAt)) {
      return transitionConflict("invalid_transition", existing);
    }

    const next = parseRecord({
      ...existing,
      state: "executing",
      executingAt: at,
      updatedAt: at,
    });
    this.records.set(commandId, next);
    return { kind: "updated", record: cloneRecord(next) };
  }

  completeAndEnqueueAck(
    commandIdInput: CommandId | string,
    ackInput: CommandAck,
    atInput: string,
  ): ExecutionTransitionResult {
    this.assertOpen();
    const commandId = CommandIdSchema.parse(commandIdInput);
    const ack = CommandAckSchema.parse(ackInput);
    const at = parseTimestamp(atInput);
    const existing = this.records.get(commandId);
    if (existing === undefined) return { kind: "not_found" };

    const completed = completeRecord(existing, ack, at);
    if (completed.kind !== "updated") return completed;

    this.records.set(commandId, completed.record);
    return { kind: "updated", record: cloneRecord(completed.record) };
  }

  nextPendingAck(
    farmIdInput: FarmId | string,
    deviceIdInput: DeviceId | string,
  ): EdgeExecutionRecord | null {
    this.assertOpen();
    const farmId = FarmIdSchema.parse(farmIdInput);
    const deviceId = DeviceIdSchema.parse(deviceIdInput);
    const record = [...this.records.values()]
      .filter((candidate) =>
        candidate.command.farmId === farmId
        && candidate.command.deviceId === deviceId
        && candidate.state === "terminal"
        && candidate.ackDelivery === "pending",
      )
      .sort(comparePendingAcks)[0];
    return record === undefined ? null : cloneRecord(record);
  }

  nextAmbiguousExecution(
    farmIdInput: FarmId | string,
    deviceIdInput: DeviceId | string,
  ): EdgeExecutionRecord | null {
    this.assertOpen();
    const farmId = FarmIdSchema.parse(farmIdInput);
    const deviceId = DeviceIdSchema.parse(deviceIdInput);
    const record = [...this.records.values()]
      .filter((candidate) =>
        candidate.command.farmId === farmId
        && candidate.command.deviceId === deviceId
        && candidate.state === "executing",
      )
      .sort(compareAmbiguousExecutions)[0];
    return record === undefined ? null : cloneRecord(record);
  }

  latestAcknowledgedPumpStop(
    farmIdInput: FarmId | string,
    deviceIdInput: DeviceId | string,
  ): EdgeExecutionRecord | null {
    this.assertOpen();
    const farmId = FarmIdSchema.parse(farmIdInput);
    const deviceId = DeviceIdSchema.parse(deviceIdInput);
    const record = [...this.records.values()]
      .filter((candidate) =>
        candidate.command.farmId === farmId
        && candidate.command.deviceId === deviceId
        && isAcknowledgedPumpStop(candidate),
      )
      .sort(comparePumpStops)[0];
    return record === undefined ? null : cloneRecord(record);
  }

  markAckDelivered(
    commandIdInput: CommandId | string,
    ackInput: CommandAck,
    projectionInput: CommandProjection,
    atInput: string,
  ): ExecutionTransitionResult {
    this.assertOpen();
    const commandId = CommandIdSchema.parse(commandIdInput);
    const ack = CommandAckSchema.parse(ackInput);
    const projection = CommandProjectionSchema.parse(projectionInput);
    const at = parseTimestamp(atInput);
    const existing = this.records.get(commandId);
    if (existing === undefined) return { kind: "not_found" };

    const delivered = deliverRecord(existing, ack, projection, at);
    if (delivered.kind !== "updated") return delivered;

    this.records.set(commandId, delivered.record);
    return { kind: "updated", record: cloneRecord(delivered.record) };
  }

  get(commandIdInput: CommandId | string): EdgeExecutionRecord | null {
    this.assertOpen();
    const commandId = CommandIdSchema.parse(commandIdInput);
    const record = this.records.get(commandId);
    return record === undefined ? null : cloneRecord(record);
  }

  close(): void {
    this.closed = true;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Edge execution repository is closed");
  }
}

export type SqliteEdgeExecutionRepositoryOptions = {
  readonly path: string;
  readonly busyTimeoutMs?: number;
};

type ExecutionRow = {
  readonly command_id: string;
  readonly farm_id: string;
  readonly device_id: string;
  readonly actor_id: string;
  readonly idempotency_key: string;
  readonly command_json: string;
  readonly state: string;
  readonly received_at: string;
  readonly executing_at: string | null;
  readonly terminal_at: string | null;
  readonly ack_json: string | null;
  readonly ack_delivery: string;
  readonly ack_delivered_at: string | null;
  readonly projection_json: string | null;
  readonly updated_at: string;
};

type CommandIdRow = {
  readonly command_id: string;
};

const EXECUTION_COLUMNS = `
  command_id, farm_id, device_id, actor_id, idempotency_key,
  command_json, state, received_at, executing_at, terminal_at,
  ack_json, ack_delivery, ack_delivered_at, projection_json, updated_at
`;

export class SqliteEdgeExecutionRepository implements EdgeExecutionRepository {
  private readonly database: DatabaseSync;
  private closed = false;

  constructor(options: SqliteEdgeExecutionRepositoryOptions) {
    if (options.path.trim() === "") {
      throw new Error("Edge execution SQLite path cannot be empty");
    }
    const busyTimeoutMs = options.busyTimeoutMs ?? 5_000;
    if (!Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs <= 0) {
      throw new Error("Edge execution SQLite busy timeout must be a positive integer");
    }

    this.database = new DatabaseSync(options.path);
    try {
      this.database.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = ${busyTimeoutMs};
      `);
      this.migrate();
      this.validateStoredRows();
    } catch (error) {
      this.database.close();
      this.closed = true;
      throw error;
    }
  }

  accept(commandInput: Command, receivedAtInput: string): AcceptCommandResult {
    this.assertOpen();
    const command = CommandSchema.parse(commandInput);
    const receivedAt = parseTimestamp(receivedAtInput);
    const serializedCommand = commandJson(command);

    return this.transaction(() => {
      const existing = this.readRecord(command.id);
      if (existing !== null) {
        return commandJson(existing.command) === serializedCommand
          ? { kind: "replayed", record: existing }
          : {
            kind: "conflict",
            reason: "command_identity_conflict",
            existingCommandId: existing.command.id,
          };
      }

      const existingScope = this.database.prepare(`
        SELECT command_id
        FROM edge_executions
        WHERE farm_id = ? AND actor_id = ? AND idempotency_key = ?
      `).get(
        command.farmId,
        command.actor.id,
        command.idempotencyKey,
      ) as CommandIdRow | undefined;
      if (existingScope !== undefined) {
        return {
          kind: "conflict",
          reason: "idempotency_conflict",
          existingCommandId: CommandIdSchema.parse(existingScope.command_id),
        };
      }

      this.database.prepare(`
        INSERT INTO edge_executions (
          command_id, farm_id, device_id, actor_id, idempotency_key,
          command_json, state, received_at, executing_at, terminal_at,
          ack_json, ack_delivery, ack_delivered_at, projection_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'received', ?, NULL, NULL, NULL, 'none', NULL, NULL, ?)
      `).run(
        command.id,
        command.farmId,
        command.deviceId,
        command.actor.id,
        command.idempotencyKey,
        serializedCommand,
        receivedAt,
        receivedAt,
      );

      const record = this.readRecord(command.id);
      if (record === null) throw new Error("Edge execution insert was not durable");
      return { kind: "accepted", record };
    });
  }

  markExecuting(
    commandIdInput: CommandId | string,
    atInput: string,
  ): ExecutionTransitionResult {
    this.assertOpen();
    const commandId = CommandIdSchema.parse(commandIdInput);
    const at = parseTimestamp(atInput);

    return this.transaction(() => {
      const existing = this.readRecord(commandId);
      if (existing === null) return { kind: "not_found" };
      if (existing.state === "executing") {
        return { kind: "replayed", record: existing };
      }
      if (existing.state !== "received" || isBefore(at, existing.receivedAt)) {
        return transitionConflict("invalid_transition", existing);
      }

      this.database.prepare(`
        UPDATE edge_executions
        SET state = 'executing', executing_at = ?, updated_at = ?
        WHERE command_id = ?
      `).run(at, at, commandId);
      return { kind: "updated", record: this.requireRecord(commandId) };
    });
  }

  completeAndEnqueueAck(
    commandIdInput: CommandId | string,
    ackInput: CommandAck,
    atInput: string,
  ): ExecutionTransitionResult {
    this.assertOpen();
    const commandId = CommandIdSchema.parse(commandIdInput);
    const ack = CommandAckSchema.parse(ackInput);
    const at = parseTimestamp(atInput);

    return this.transaction(() => {
      const existing = this.readRecord(commandId);
      if (existing === null) return { kind: "not_found" };
      const completed = completeRecord(existing, ack, at);
      if (completed.kind !== "updated") return completed;

      this.database.prepare(`
        UPDATE edge_executions
        SET state = 'terminal', terminal_at = ?, ack_json = ?,
            ack_delivery = 'pending', updated_at = ?
        WHERE command_id = ?
      `).run(at, ackJson(ack), at, commandId);
      return { kind: "updated", record: this.requireRecord(commandId) };
    });
  }

  nextPendingAck(
    farmIdInput: FarmId | string,
    deviceIdInput: DeviceId | string,
  ): EdgeExecutionRecord | null {
    this.assertOpen();
    const farmId = FarmIdSchema.parse(farmIdInput);
    const deviceId = DeviceIdSchema.parse(deviceIdInput);
    const row = this.database.prepare(`
      SELECT ${EXECUTION_COLUMNS}
      FROM edge_executions
      WHERE farm_id = ? AND device_id = ?
        AND state = 'terminal' AND ack_delivery = 'pending'
      ORDER BY terminal_at ASC, command_id ASC
      LIMIT 1
    `).get(farmId, deviceId) as ExecutionRow | undefined;
    return row === undefined ? null : parseStoredRow(row);
  }

  nextAmbiguousExecution(
    farmIdInput: FarmId | string,
    deviceIdInput: DeviceId | string,
  ): EdgeExecutionRecord | null {
    this.assertOpen();
    const farmId = FarmIdSchema.parse(farmIdInput);
    const deviceId = DeviceIdSchema.parse(deviceIdInput);
    const row = this.database.prepare(`
      SELECT ${EXECUTION_COLUMNS}
      FROM edge_executions
      WHERE farm_id = ? AND device_id = ? AND state = 'executing'
      ORDER BY executing_at ASC, command_id ASC
      LIMIT 1
    `).get(farmId, deviceId) as ExecutionRow | undefined;
    return row === undefined ? null : parseStoredRow(row);
  }

  latestAcknowledgedPumpStop(
    farmIdInput: FarmId | string,
    deviceIdInput: DeviceId | string,
  ): EdgeExecutionRecord | null {
    this.assertOpen();
    const farmId = FarmIdSchema.parse(farmIdInput);
    const deviceId = DeviceIdSchema.parse(deviceIdInput);
    const rows = this.database.prepare(`
      SELECT ${EXECUTION_COLUMNS}
      FROM edge_executions
      WHERE farm_id = ? AND device_id = ? AND state = 'terminal'
      ORDER BY terminal_at DESC, command_id DESC
    `).all(farmId, deviceId) as ExecutionRow[];
    return rows
      .map((row) => parseStoredRow(row))
      .filter(isAcknowledgedPumpStop)
      .sort(comparePumpStops)[0] ?? null;
  }

  markAckDelivered(
    commandIdInput: CommandId | string,
    ackInput: CommandAck,
    projectionInput: CommandProjection,
    atInput: string,
  ): ExecutionTransitionResult {
    this.assertOpen();
    const commandId = CommandIdSchema.parse(commandIdInput);
    const ack = CommandAckSchema.parse(ackInput);
    const projection = CommandProjectionSchema.parse(projectionInput);
    const at = parseTimestamp(atInput);

    return this.transaction(() => {
      const existing = this.readRecord(commandId);
      if (existing === null) return { kind: "not_found" };
      const delivered = deliverRecord(existing, ack, projection, at);
      if (delivered.kind !== "updated") return delivered;

      this.database.prepare(`
        UPDATE edge_executions
        SET ack_delivery = 'delivered', ack_delivered_at = ?,
            projection_json = ?, updated_at = ?
        WHERE command_id = ?
      `).run(at, projectionJson(projection), at, commandId);
      return { kind: "updated", record: this.requireRecord(commandId) };
    });
  }

  get(commandIdInput: CommandId | string): EdgeExecutionRecord | null {
    this.assertOpen();
    return this.readRecord(CommandIdSchema.parse(commandIdInput));
  }

  close(): void {
    if (this.closed) return;
    this.database.close();
    this.closed = true;
  }

  private migrate(): void {
    const versionRow = this.database.prepare("PRAGMA user_version").get() as
      | { readonly user_version: number }
      | undefined;
    const version = versionRow?.user_version ?? 0;
    if (version === EDGE_EXECUTION_SQLITE_SCHEMA_VERSION) return;
    if (version !== 0) {
      throw new Error(
        `Unsupported Edge execution SQLite schema version: ${version}`,
      );
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.exec(`
        CREATE TABLE edge_executions (
          command_id TEXT PRIMARY KEY,
          farm_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          actor_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          command_json TEXT NOT NULL,
          state TEXT NOT NULL CHECK (state IN ('received', 'executing', 'terminal')),
          received_at TEXT NOT NULL,
          executing_at TEXT,
          terminal_at TEXT,
          ack_json TEXT,
          ack_delivery TEXT NOT NULL CHECK (ack_delivery IN ('none', 'pending', 'delivered')),
          ack_delivered_at TEXT,
          projection_json TEXT,
          updated_at TEXT NOT NULL,
          UNIQUE (farm_id, actor_id, idempotency_key),
          CHECK (
            (
              state = 'received'
              AND executing_at IS NULL AND terminal_at IS NULL AND ack_json IS NULL
              AND ack_delivery = 'none'
              AND ack_delivered_at IS NULL AND projection_json IS NULL
            ) OR (
              state = 'executing'
              AND executing_at IS NOT NULL AND terminal_at IS NULL AND ack_json IS NULL
              AND ack_delivery = 'none'
              AND ack_delivered_at IS NULL AND projection_json IS NULL
            ) OR (
              state = 'terminal'
              AND terminal_at IS NOT NULL AND ack_json IS NOT NULL
              AND (
                (
                  ack_delivery = 'pending'
                  AND ack_delivered_at IS NULL AND projection_json IS NULL
                ) OR (
                  ack_delivery = 'delivered'
                  AND ack_delivered_at IS NOT NULL AND projection_json IS NOT NULL
                )
              )
            )
          )
        ) STRICT;

        CREATE INDEX edge_executions_pending_ack_idx
          ON edge_executions (
            farm_id, device_id, ack_delivery, terminal_at ASC, command_id ASC
          );

        CREATE INDEX edge_executions_ambiguous_idx
          ON edge_executions (
            farm_id, device_id, state, executing_at ASC, command_id ASC
          );

        PRAGMA user_version = ${EDGE_EXECUTION_SQLITE_SCHEMA_VERSION};
      `);
      this.database.exec("COMMIT");
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }

  private validateStoredRows(): void {
    const rows = this.database.prepare(`
      SELECT ${EXECUTION_COLUMNS}
      FROM edge_executions
      ORDER BY command_id ASC
    `).all() as ExecutionRow[];
    for (const row of rows) parseStoredRow(row);
  }

  private readRecord(commandId: CommandId): EdgeExecutionRecord | null {
    const row = this.database.prepare(`
      SELECT ${EXECUTION_COLUMNS}
      FROM edge_executions
      WHERE command_id = ?
    `).get(commandId) as ExecutionRow | undefined;
    return row === undefined ? null : parseStoredRow(row);
  }

  private requireRecord(commandId: CommandId): EdgeExecutionRecord {
    const record = this.readRecord(commandId);
    if (record === null) throw new Error("Stored Edge execution disappeared");
    return record;
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
        // Preserve the original transaction error.
      }
      throw error;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Edge execution repository is closed");
  }
}

function createReceivedRecord(command: Command, receivedAt: string): EdgeExecutionRecord {
  return parseRecord({
    command,
    state: "received",
    receivedAt,
    executingAt: null,
    terminalAt: null,
    ack: null,
    ackDelivery: "none",
    ackDeliveredAt: null,
    deliveredProjection: null,
    updatedAt: receivedAt,
  });
}

function completeRecord(
  existing: EdgeExecutionRecord,
  ack: CommandAck,
  at: string,
): ExecutionTransitionResult {
  if (existing.state === "terminal") {
    return existing.ack !== null && ackJson(existing.ack) === ackJson(ack)
      ? { kind: "replayed", record: cloneRecord(existing) }
      : transitionConflict("ack_mismatch", existing);
  }
  if (
    (existing.state === "received" && ack.status === "acknowledged")
    || !isCommandAckCompatible(existing.command, ack)
    || Date.parse(ack.processedAt) < Date.parse(existing.command.issuedAt)
    || isBefore(at, existing.updatedAt)
  ) {
    return transitionConflict(
      isCommandAckCompatible(existing.command, ack)
        ? "invalid_transition"
        : "ack_mismatch",
      existing,
    );
  }

  return {
    kind: "updated",
    record: parseRecord({
      ...existing,
      state: "terminal",
      terminalAt: at,
      ack,
      ackDelivery: "pending",
      updatedAt: at,
    }),
  };
}

function deliverRecord(
  existing: EdgeExecutionRecord,
  ack: CommandAck,
  projection: CommandProjection,
  at: string,
): ExecutionTransitionResult {
  if (existing.state !== "terminal" || existing.ack === null) {
    return transitionConflict("invalid_transition", existing);
  }
  if (ackJson(existing.ack) !== ackJson(ack)) {
    return transitionConflict("ack_mismatch", existing);
  }
  if (!projectionMatches(existing, ack, projection)) {
    return transitionConflict("projection_mismatch", existing);
  }
  if (existing.ackDelivery === "delivered") {
    return { kind: "replayed", record: cloneRecord(existing) };
  }
  if (existing.ackDelivery !== "pending" || isBefore(at, existing.updatedAt)) {
    return transitionConflict("invalid_transition", existing);
  }

  return {
    kind: "updated",
    record: parseRecord({
      ...existing,
      ackDelivery: "delivered",
      ackDeliveredAt: at,
      deliveredProjection: projection,
      updatedAt: at,
    }),
  };
}

function projectionMatches(
  record: EdgeExecutionRecord,
  ack: CommandAck,
  projection: CommandProjection,
): boolean {
  return commandJson(projection.command) === commandJson(record.command)
    && projection.ack !== null
    && ackJson(projection.ack) === ackJson(ack)
    && projection.status === projectionStatusForAck(ack);
}

function projectionStatusForAck(ack: CommandAck): CommandProjection["status"] {
  if (ack.status === "acknowledged") return "acknowledged";
  if (ack.status === "timed_out") return "timed_out";
  return "failed";
}

function parseStoredRow(row: ExecutionRow): EdgeExecutionRecord {
  const command = CommandSchema.parse(parseJson(row.command_json, "command"));
  const ack = row.ack_json === null
    ? null
    : CommandAckSchema.parse(parseJson(row.ack_json, "acknowledgement"));
  const projection = row.projection_json === null
    ? null
    : CommandProjectionSchema.parse(parseJson(row.projection_json, "projection"));

  if (
    command.id !== row.command_id
    || command.farmId !== row.farm_id
    || command.deviceId !== row.device_id
    || command.actor.id !== row.actor_id
    || command.idempotencyKey !== row.idempotency_key
  ) {
    throw new Error("Stored Edge execution scope does not match its command");
  }

  return parseRecord({
    command,
    state: parseExecutionState(row.state),
    receivedAt: row.received_at,
    executingAt: row.executing_at,
    terminalAt: row.terminal_at,
    ack,
    ackDelivery: parseAckDeliveryState(row.ack_delivery),
    ackDeliveredAt: row.ack_delivered_at,
    deliveredProjection: projection,
    updatedAt: row.updated_at,
  });
}

function parseRecord(input: EdgeExecutionRecord): EdgeExecutionRecord {
  const record: EdgeExecutionRecord = {
    command: CommandSchema.parse(input.command),
    state: parseExecutionState(input.state),
    receivedAt: parseTimestamp(input.receivedAt),
    executingAt: input.executingAt === null ? null : parseTimestamp(input.executingAt),
    terminalAt: input.terminalAt === null ? null : parseTimestamp(input.terminalAt),
    ack: input.ack === null ? null : CommandAckSchema.parse(input.ack),
    ackDelivery: parseAckDeliveryState(input.ackDelivery),
    ackDeliveredAt: input.ackDeliveredAt === null
      ? null
      : parseTimestamp(input.ackDeliveredAt),
    deliveredProjection: input.deliveredProjection === null
      ? null
      : CommandProjectionSchema.parse(input.deliveredProjection),
    updatedAt: parseTimestamp(input.updatedAt),
  };

  validateRecordInvariants(record);
  return record;
}

function validateRecordInvariants(record: EdgeExecutionRecord): void {
  if (isBefore(record.updatedAt, record.receivedAt)) {
    throw new Error("Stored Edge execution update predates receipt");
  }

  if (record.state === "received") {
    if (
      record.executingAt !== null || record.terminalAt !== null || record.ack !== null
      || record.ackDelivery !== "none" || record.ackDeliveredAt !== null
      || record.deliveredProjection !== null || record.updatedAt !== record.receivedAt
    ) {
      throw new Error("Stored received Edge execution has terminal fields");
    }
    return;
  }

  if (record.state === "executing") {
    if (
      record.executingAt === null || record.terminalAt !== null || record.ack !== null
      || record.ackDelivery !== "none" || record.ackDeliveredAt !== null
      || record.deliveredProjection !== null
      || isBefore(record.executingAt, record.receivedAt)
      || record.updatedAt !== record.executingAt
    ) {
      throw new Error("Stored executing Edge execution has invalid fields");
    }
    return;
  }

  if (
    record.terminalAt === null || record.ack === null
    || record.ackDelivery === "none"
    || isBefore(record.terminalAt, record.executingAt ?? record.receivedAt)
    || !isCommandAckCompatible(record.command, record.ack)
    || Date.parse(record.ack.processedAt) < Date.parse(record.command.issuedAt)
  ) {
    throw new Error("Stored terminal Edge execution is invalid");
  }
  if (record.executingAt === null && record.ack.status === "acknowledged") {
    throw new Error("Stored acknowledged execution was never marked executing");
  }

  if (record.ackDelivery === "pending") {
    if (
      record.ackDeliveredAt !== null || record.deliveredProjection !== null
      || record.updatedAt !== record.terminalAt
    ) {
      throw new Error("Stored pending Edge acknowledgement has delivery fields");
    }
    return;
  }

  if (
    record.ackDeliveredAt === null || record.deliveredProjection === null
    || isBefore(record.ackDeliveredAt, record.terminalAt)
    || record.updatedAt !== record.ackDeliveredAt
    || !projectionMatches(record, record.ack, record.deliveredProjection)
  ) {
    throw new Error("Stored delivered Edge acknowledgement is invalid");
  }
}

function cloneRecord(record: EdgeExecutionRecord): EdgeExecutionRecord {
  return parseRecord(record);
}

function parseExecutionState(value: string): EdgeExecutionState {
  if (value === "received" || value === "executing" || value === "terminal") {
    return value;
  }
  throw new Error("Stored Edge execution state is invalid");
}

function parseAckDeliveryState(value: string): EdgeAckDeliveryState {
  if (value === "none" || value === "pending" || value === "delivered") return value;
  throw new Error("Stored Edge acknowledgement delivery state is invalid");
}

function parseTimestamp(value: string): string {
  return IsoDateTimeSchema.parse(value);
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`Stored Edge ${label} JSON is invalid`);
  }
}

function commandIdempotencyScope(command: Command): string {
  return `${command.farmId}\u0000${command.actor.id}\u0000${command.idempotencyKey}`;
}

function commandJson(command: Command): string {
  return JSON.stringify(CommandSchema.parse(command));
}

function ackJson(ack: CommandAck): string {
  return JSON.stringify(CommandAckSchema.parse(ack));
}

function projectionJson(projection: CommandProjection): string {
  return JSON.stringify(CommandProjectionSchema.parse(projection));
}

function isBefore(left: string, right: string): boolean {
  return Date.parse(left) < Date.parse(right);
}

function comparePendingAcks(
  left: EdgeExecutionRecord,
  right: EdgeExecutionRecord,
): number {
  return (left.terminalAt ?? "").localeCompare(right.terminalAt ?? "")
    || left.command.id.localeCompare(right.command.id);
}

function compareAmbiguousExecutions(
  left: EdgeExecutionRecord,
  right: EdgeExecutionRecord,
): number {
  return (left.executingAt ?? "").localeCompare(right.executingAt ?? "")
    || left.command.id.localeCompare(right.command.id);
}

function isAcknowledgedPumpStop(record: EdgeExecutionRecord): boolean {
  return record.state === "terminal"
    && isPumpStopCommand(record.command)
    && record.ack?.status === "acknowledged"
    && record.ack.result?.pumpState === "off";
}

function comparePumpStops(
  left: EdgeExecutionRecord,
  right: EdgeExecutionRecord,
): number {
  return right.command.issuedAt.localeCompare(left.command.issuedAt)
    || right.command.id.localeCompare(left.command.id);
}

function transitionConflict(
  reason: Extract<
    EdgeExecutionConflictReason,
    "invalid_transition" | "ack_mismatch" | "projection_mismatch"
  >,
  record: EdgeExecutionRecord,
): ExecutionTransitionResult {
  return { kind: "conflict", reason, record: cloneRecord(record) };
}
