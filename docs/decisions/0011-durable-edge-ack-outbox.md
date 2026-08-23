# Decision 0011: Durable Edge Execution Journal and ACK Outbox

- Status: accepted for the simulator-backed pilot slice
- Date: 2026-08-09
- Owner: SmartFarmOS maintainers

## Context

The central API keeps a command pending until it accepts a terminal
acknowledgement. Previously the Edge called the device and then posted that ACK
without first storing either result. If the device completed but the ACK request
failed, the central API returned the same pending command on the next poll. A
restarted Edge and simulator could then repeat an immediate command or start a
timed irrigation interval again from the beginning.

The next reliability step must prevent that known duplicate path without
claiming physical exactly-once execution. It must preserve the existing public
`Command`, `CommandAck`, and HTTP contracts, work without an external service,
and fail closed when a restart leaves device state unknown.

## Decision

Add an internal `EdgeExecutionRepository` with in-memory and SQLite
implementations. The local demo selects a separate versioned Edge SQLite file;
the API and Edge databases never share `PRAGMA user_version` or tables.

Each accepted command keeps its normalized command body, central idempotency
scope (`farmId + actor.id + idempotencyKey`), timestamps, and one monotonic
state:

```text
received -> executing -> terminal (ACK pending) -> terminal (ACK delivered)
        \-> terminal (pre-execution rejection or timeout)
```

The gateway follows this order for each configured farm/device:

1. resend the oldest stored pending ACK before pulling new work;
2. stop with `recovery_required` if a prior record is still `executing`;
3. validate and durably accept a newly pulled command;
4. commit `executing` immediately before calling the device adapter;
5. give the device executor a terminal-ACK sink; the simulator invokes it after
   reaching its final state but before its execution promise resolves, and the
   sink stores the ACK plus outbox state in one transaction;
6. post the exact stored ACK, including its original `processedAt`;
7. mark it delivered only when the returned projection contains the same
   command, ACK, and lifecycle result.

Concurrent calls through one gateway instance share one processing slot. An
exact command replay reuses its stored record. Reuse of a command ID with a
different body, or reuse of the central idempotency scope with a different
command, fails without calling the device.

This decision assumes one logical Edge owner per device, or workers sharing the
same local repository. It does not introduce a public delivery lease.

## Consequences

- A terminal result committed through the executor sink survives an ACK network
  failure and Edge restart. The Edge resends the saved ACK without calling the
  actuator again. The gateway also uses that stored result if the executor
  unwinds after publishing it.
- A crash after the durable `executing` transition but before a terminal ACK is
  deliberately not retried. The device may already have acted, so the gateway
  reports reconciliation required instead of extending irrigation.
- The public command and HTTP wire formats do not change.
- The local demo creates `<api-db-path>.edge.sqlite` and closes it separately.
  Startup and usability resume require both primary files to exist together or
  both to be absent, so stale Edge state cannot attach to a fresh central DB.
  Usability sessions treat both files as one session boundary.
- The Edge database starts at internal schema version 1. It has no existing
  data backfill and creates its table and indexes only during startup. A newer
  unknown version or invalid stored JSON is rejected before device execution.

## Migration and rollback

This is a new companion database, not a migration of the central API database.
Schema creation runs before command polling, so it does not lock a live command
table or require downtime for a backfill.

Rollback consists of stopping the Edge, retaining the companion database for
audit/recovery, and running an earlier build without selecting the SQLite
repository. Deleting the file is not an automatic rollback because it can
discard a terminal ACK that the central API has not yet received.

## Alternatives considered

- **Retry the device command after ACK failure.** The simulator can deduplicate
  inside one process, but that memory disappears on restart and cannot prove
  that a physical actuator did not run twice.
- **Generate a fresh ACK after restart.** A changed time or result conflicts
  with a terminal ACK already accepted by the central API and loses the original
  device evidence.
- **Add a central command lease now.** A lease is required for active-active
  gateways, but it still cannot provide physical exactly-once behavior without
  durable device idempotency or state reconciliation. That is a later public
  protocol decision.
- **Build a farm-wide software emergency-stop UI first.** Still rejected: a
  multi-device fan-out can finish only partially and would look like a
  certified safety control without physical enforcement. Decision 0012 adds a
  narrower device-local simulator stop path and explicitly does not call it an
  emergency stop.

## Verification boundary

The slice must prove:

1. terminal ACK storage happens before central submission;
2. upload failure keeps the exact ACK pending;
3. the simulator publishes its terminal ACK to the durable sink before its
   execution promise resolves;
4. process restart resends that ACK before pulling new work and does not call
   the device again;
5. an `executing` restart record blocks automatic re-execution;
6. exact replay, changed command identity, and central idempotency-scope
   conflicts are deterministic in memory and SQLite;
7. a mismatched successful projection cannot mark an ACK delivered;
8. SQLite reopen preserves state, while corrupt rows and future schema versions
   fail closed;
9. different devices can continue independently through separate gateway
   processing slots;
10. the complete local demo and browser path remain green with the persistent
   repository selected.

## Explicit non-claims

This decision does not provide:

- durable telemetry buffering;
- MQTT transport or topic ownership;
- a multi-host command claim/lease;
- physical exactly-once execution;
- device-state query or resume for a command interrupted mid-execution;
- recovery when a physical adapter actuates but crashes before it can publish a
  terminal result to the Edge sink;
- an electrical/hydraulic interlock, certified emergency stop, or hardwired
  manual override. Decision 0012 adds software stop priority only for the
  simulator-backed single-device path.

A production adapter still needs durable `command.id` idempotency, local
fail-safe behavior, state reconciliation, single-owner or leased delivery, and
physical failure tests.
