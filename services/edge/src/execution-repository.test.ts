import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { type TestContext } from "node:test";
import {
  CommandAckSchema,
  CommandProjectionSchema,
  CommandSchema,
  type Command,
  type CommandAck,
  type CommandProjection,
} from "@smartfarm-os/contracts";
import {
  EDGE_EXECUTION_SQLITE_SCHEMA_VERSION,
  InMemoryEdgeExecutionRepository,
  SqliteEdgeExecutionRepository,
  type EdgeExecutionRepository,
} from "./execution-repository.js";

const receivedAt = "2026-08-09T00:00:01.000Z";
const executingAt = "2026-08-09T00:00:02.000Z";
const processedAt = "2026-08-09T00:00:03.000Z";
const deliveredAt = "2026-08-09T00:00:04.000Z";

type RepositoryKind = "in-memory" | "sqlite";

function createCommand(overrides: Record<string, unknown> = {}): Command {
  return CommandSchema.parse({
    schemaVersion: "smartfarm.command.v1",
    id: "command:edge-journal-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    payload: { action: "set_pump_state", state: "on" },
    actor: { type: "user", id: "user:operator" },
    idempotencyKey: "edge-journal-key-000001",
    issuedAt: "2026-08-09T00:00:00.000Z",
    expiresAt: "2026-08-09T00:01:00.000Z",
    ...overrides,
  });
}

function createAcknowledgedAck(command: Command): CommandAck {
  const finalState = command.schemaVersion === "smartfarm.command.v2"
    ? "off"
    : command.payload.state;
  return CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: command.id,
    farmId: command.farmId,
    deviceId: command.deviceId,
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: finalState },
    processedAt,
  });
}

function createFailureAck(
  command: Command,
  status: "rejected" | "failed" | "timed_out" = "timed_out",
): CommandAck {
  return CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: command.id,
    farmId: command.farmId,
    deviceId: command.deviceId,
    status,
    reasonCode: status === "timed_out"
      ? "expired"
      : status === "rejected"
        ? "scope_mismatch"
        : "execution_failed",
    result: null,
    processedAt,
  });
}

function createProjection(
  command: Command,
  ack: CommandAck,
): CommandProjection {
  return CommandProjectionSchema.parse({
    schemaVersion: "smartfarm.command-projection.v1",
    command,
    status: ack.status === "acknowledged"
      ? "acknowledged"
      : ack.status === "timed_out"
        ? "timed_out"
        : "failed",
    ack,
    updatedAt: processedAt,
  });
}

async function createRepository(
  kind: RepositoryKind,
  t: TestContext,
): Promise<EdgeExecutionRepository> {
  if (kind === "in-memory") {
    const repository = new InMemoryEdgeExecutionRepository();
    t.after(() => repository.close());
    return repository;
  }

  const directory = await mkdtemp(join(tmpdir(), "smartfarm-edge-journal-test-"));
  const repository = new SqliteEdgeExecutionRepository({
    path: join(directory, "edge.sqlite"),
  });
  t.after(async () => {
    repository.close();
    await rm(directory, { recursive: true, force: true });
  });
  return repository;
}

for (const kind of ["in-memory", "sqlite"] as const) {
  test(`${kind}: accepts exact command replay and rejects a changed command body`, async (t) => {
    const repository = await createRepository(kind, t);
    const command = createCommand();

    const accepted = repository.accept(command, receivedAt);
    const replayed = repository.accept(command, receivedAt);
    const identityConflict = repository.accept(createCommand({
      payload: { action: "set_pump_state", state: "off" },
    }), receivedAt);

    assert.equal(accepted.kind, "accepted");
    assert.equal(replayed.kind, "replayed");
    assert.equal(identityConflict.kind, "conflict");
    assert.equal(
      identityConflict.kind === "conflict" ? identityConflict.reason : null,
      "command_identity_conflict",
    );
    assert.equal(repository.get(command.id)?.state, "received");
  });

  test(`${kind}: matches central farm-actor idempotency scope without device`, async (t) => {
    const repository = await createRepository(kind, t);
    const first = createCommand();
    assert.equal(repository.accept(first, receivedAt).kind, "accepted");

    const crossDeviceConflict = repository.accept(createCommand({
      id: "command:edge-journal-000002",
      deviceId: "device:bed-2",
    }), receivedAt);
    const differentActor = repository.accept(createCommand({
      id: "command:edge-journal-000003",
      deviceId: "device:bed-2",
      actor: { type: "user", id: "user:other" },
    }), receivedAt);
    const differentFarm = repository.accept(createCommand({
      id: "command:edge-journal-000004",
      farmId: "farm:other",
      deviceId: "device:bed-3",
    }), receivedAt);

    assert.equal(crossDeviceConflict.kind, "conflict");
    assert.equal(
      crossDeviceConflict.kind === "conflict" ? crossDeviceConflict.reason : null,
      "idempotency_conflict",
    );
    assert.equal(differentActor.kind, "accepted");
    assert.equal(differentFarm.kind, "accepted");
  });

  test(`${kind}: preserves monotonic execution and terminal ACK transitions`, async (t) => {
    const repository = await createRepository(kind, t);
    const command = createCommand();
    const ack = createAcknowledgedAck(command);

    repository.accept(command, receivedAt);
    const executing = repository.markExecuting(command.id, executingAt);
    const executingReplay = repository.markExecuting(command.id, executingAt);
    const ambiguous = repository.nextAmbiguousExecution(command.farmId, command.deviceId);
    const terminal = repository.completeAndEnqueueAck(command.id, ack, processedAt);
    const terminalReplay = repository.completeAndEnqueueAck(command.id, ack, processedAt);
    const invalidRestart = repository.markExecuting(command.id, deliveredAt);

    assert.equal(executing.kind, "updated");
    assert.equal(executingReplay.kind, "replayed");
    assert.equal(ambiguous?.command.id, command.id);
    assert.equal(terminal.kind, "updated");
    assert.equal(terminalReplay.kind, "replayed");
    assert.equal(invalidRestart.kind, "conflict");
    assert.equal(repository.get(command.id)?.ack?.processedAt, processedAt);
    assert.deepEqual(repository.get(command.id)?.ack, ack);
  });

  test(`${kind}: persists the latest physically acknowledged pump stop as a restart-safe fence`, async (t) => {
    const repository = await createRepository(kind, t);
    const olderStop = createCommand({
      id: "command:edge-stop-000001",
      payload: { action: "set_pump_state", state: "off" },
      idempotencyKey: "edge-stop-key-000001",
      issuedAt: "2026-08-09T00:00:00.100Z",
    });
    const failedStop = createCommand({
      id: "command:edge-stop-000002",
      payload: { action: "set_pump_state", state: "off" },
      idempotencyKey: "edge-stop-key-000002",
      issuedAt: "2026-08-09T00:00:00.200Z",
    });
    const latestStop = createCommand({
      id: "command:edge-stop-000003",
      payload: { action: "set_pump_state", state: "off" },
      idempotencyKey: "edge-stop-key-000003",
      issuedAt: "2026-08-09T00:00:00.300Z",
    });

    for (const stop of [olderStop, failedStop, latestStop]) {
      repository.accept(stop, receivedAt);
      repository.markExecuting(stop.id, executingAt);
    }
    repository.completeAndEnqueueAck(olderStop.id, createAcknowledgedAck(olderStop), processedAt);
    repository.completeAndEnqueueAck(failedStop.id, createFailureAck(failedStop, "failed"), processedAt);
    repository.completeAndEnqueueAck(latestStop.id, createAcknowledgedAck(latestStop), processedAt);

    assert.equal(
      repository.latestAcknowledgedPumpStop("farm:demo", "device:bed-1")?.command.id,
      latestStop.id,
    );
    assert.equal(repository.latestAcknowledgedPumpStop("farm:demo", "device:bed-2"), null);
  });

  test(`${kind}: permits only non-acknowledged received-to-terminal decisions`, async (t) => {
    const repository = await createRepository(kind, t);
    const expired = createCommand({
      id: "command:edge-journal-expired",
      idempotencyKey: "edge-journal-expired-key",
    });
    const unexecutedSuccess = createCommand({
      id: "command:edge-journal-unexecuted",
      idempotencyKey: "edge-journal-unexecuted-key",
    });
    repository.accept(expired, receivedAt);
    repository.accept(unexecutedSuccess, receivedAt);

    const timedOut = repository.completeAndEnqueueAck(
      expired.id,
      createFailureAck(expired),
      processedAt,
    );
    const invalidSuccess = repository.completeAndEnqueueAck(
      unexecutedSuccess.id,
      createAcknowledgedAck(unexecutedSuccess),
      processedAt,
    );

    assert.equal(timedOut.kind, "updated");
    assert.equal(repository.get(expired.id)?.executingAt, null);
    assert.equal(invalidSuccess.kind, "conflict");
    assert.equal(
      invalidSuccess.kind === "conflict" ? invalidSuccess.reason : null,
      "invalid_transition",
    );
  });

  test(`${kind}: delivers only an exact pending ACK and matching projection`, async (t) => {
    const repository = await createRepository(kind, t);
    const command = createCommand();
    const ack = createAcknowledgedAck(command);
    const projection = createProjection(command, ack);
    repository.accept(command, receivedAt);
    repository.markExecuting(command.id, executingAt);
    repository.completeAndEnqueueAck(command.id, ack, processedAt);

    const pending = repository.nextPendingAck(command.farmId, command.deviceId);
    const unrelatedCommand = createCommand({
      id: "command:edge-journal-unrelated",
      idempotencyKey: "edge-journal-unrelated-key",
    });
    const mismatchedProjection = createProjection(unrelatedCommand, ack);
    const mismatch = repository.markAckDelivered(
      command.id,
      ack,
      mismatchedProjection,
      deliveredAt,
    );
    const delivered = repository.markAckDelivered(
      command.id,
      ack,
      projection,
      deliveredAt,
    );
    const replayProjection = CommandProjectionSchema.parse({
      ...projection,
      updatedAt: "2026-08-09T00:00:05.000Z",
    });
    const replayed = repository.markAckDelivered(
      command.id,
      ack,
      replayProjection,
      "2026-08-09T00:00:05.000Z",
    );

    assert.equal(pending?.command.id, command.id);
    assert.deepEqual(pending?.ack, ack);
    assert.equal(mismatch.kind, "conflict");
    assert.equal(
      mismatch.kind === "conflict" ? mismatch.reason : null,
      "projection_mismatch",
    );
    assert.equal(delivered.kind, "updated");
    assert.equal(replayed.kind, "replayed");
    assert.equal(repository.nextPendingAck(command.farmId, command.deviceId), null);
    assert.deepEqual(repository.get(command.id)?.deliveredProjection, projection);
  });
}

test("SQLite persists ambiguous execution, ACK outbox, and delivery across restarts", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-edge-journal-restart-"));
  const path = join(directory, "edge.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const ambiguousCommand = createCommand();
  const terminalCommand = createCommand({
    id: "command:edge-journal-terminal",
    idempotencyKey: "edge-journal-terminal-key",
  });
  const terminalAck = createFailureAck(terminalCommand);
  const stopCommand = createCommand({
    id: "command:edge-journal-stop",
    payload: { action: "set_pump_state", state: "off" },
    actor: { type: "user", id: "user:stop-operator" },
    idempotencyKey: "edge-journal-stop-key",
  });
  const stopAck = createAcknowledgedAck(stopCommand);
  const stopProjection = createProjection(stopCommand, stopAck);

  const first = new SqliteEdgeExecutionRepository({ path });
  first.accept(ambiguousCommand, receivedAt);
  first.markExecuting(ambiguousCommand.id, executingAt);
  first.accept(terminalCommand, receivedAt);
  first.completeAndEnqueueAck(terminalCommand.id, terminalAck, processedAt);
  first.accept(stopCommand, receivedAt);
  first.markExecuting(stopCommand.id, executingAt);
  first.completeAndEnqueueAck(stopCommand.id, stopAck, processedAt);
  first.markAckDelivered(stopCommand.id, stopAck, stopProjection, deliveredAt);
  first.close();

  const second = new SqliteEdgeExecutionRepository({ path });
  assert.equal(
    second.nextAmbiguousExecution("farm:demo", "device:bed-1")?.command.id,
    ambiguousCommand.id,
  );
  assert.deepEqual(
    second.nextPendingAck("farm:demo", "device:bed-1")?.ack,
    terminalAck,
  );
  assert.equal(
    second.latestAcknowledgedPumpStop("farm:demo", "device:bed-1")?.command.id,
    stopCommand.id,
  );
  const durableIdempotencyConflict = second.accept(createCommand({
    id: "command:edge-journal-cross-restart-conflict",
    deviceId: "device:bed-2",
  }), deliveredAt);
  assert.equal(durableIdempotencyConflict.kind, "conflict");
  assert.equal(
    durableIdempotencyConflict.kind === "conflict"
      ? durableIdempotencyConflict.reason
      : null,
    "idempotency_conflict",
  );
  const projection = createProjection(terminalCommand, terminalAck);
  assert.equal(
    second.markAckDelivered(terminalCommand.id, terminalAck, projection, deliveredAt).kind,
    "updated",
  );
  second.close();
  second.close();

  const third = new SqliteEdgeExecutionRepository({ path });
  assert.equal(third.get(ambiguousCommand.id)?.state, "executing");
  assert.equal(third.get(terminalCommand.id)?.ackDelivery, "delivered");
  assert.deepEqual(third.get(terminalCommand.id)?.deliveredProjection, projection);
  assert.equal(
    third.latestAcknowledgedPumpStop("farm:demo", "device:bed-1")?.command.id,
    stopCommand.id,
  );
  assert.equal(third.nextPendingAck("farm:demo", "device:bed-1"), null);
  third.close();
});

test("SQLite refuses a future execution-journal schema version", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-edge-journal-version-"));
  const path = join(directory, "edge.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const database = new DatabaseSync(path);
  database.exec(`PRAGMA user_version = ${EDGE_EXECUTION_SQLITE_SCHEMA_VERSION + 1}`);
  database.close();

  assert.throws(
    () => new SqliteEdgeExecutionRepository({ path }),
    /Unsupported Edge execution SQLite schema version/,
  );
});

test("SQLite refuses a corrupt persisted command before serving records", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-edge-journal-corrupt-"));
  const path = join(directory, "edge.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const repository = new SqliteEdgeExecutionRepository({ path });
  repository.accept(createCommand(), receivedAt);
  repository.close();

  const database = new DatabaseSync(path);
  database.prepare(
    "UPDATE edge_executions SET command_json = ? WHERE command_id = ?",
  ).run("{}", createCommand().id);
  database.close();

  assert.throws(
    () => new SqliteEdgeExecutionRepository({ path }),
    /Invalid input|Stored Edge execution scope/,
  );
});

test("SQLite validates options and close is idempotent", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-edge-journal-options-"));
  const path = join(directory, "edge.sqlite");
  t.after(() => rm(directory, { recursive: true, force: true }));

  assert.throws(
    () => new SqliteEdgeExecutionRepository({ path, busyTimeoutMs: 0 }),
    /busy timeout must be a positive integer/,
  );
  const repository = new SqliteEdgeExecutionRepository({ path });
  repository.close();
  repository.close();
});
