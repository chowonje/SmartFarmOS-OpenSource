# Decision 0010: Device-local Timed Irrigation Command

- Status: accepted for the simulator-backed pilot slice
- Date: 2026-08-09
- Owner: SmartFarmOS maintainers

## Context

The contest strategy currently sends one immediate `set_pump_state: on`
command and correctly warns that it has no automatic stop. Reinterpreting the
command TTL as a run duration would be incorrect: TTL is only the deadline for
starting a command. Scheduling a later `off` command in the central API would
also make the stop depend on central-to-Edge connectivity at the due time.

The first improvement must preserve the existing V1 command, fail closed at
the device boundary, remain testable without hardware, and avoid claiming a
physical interlock.

## Decision

Add an additive `smartfarm.command.v2` action:

```json
{
  "action": "run_pump_for",
  "durationSeconds": 5
}
```

The action is accepted only for a device that declares the `timed_pump`
capability. The device executor owns the timer, turns the pump off in its local
failure path, and returns the existing terminal acknowledgement only after the
final state is `off`. The Edge and central store reject an acknowledged result
whose final state does not match the command.

Existing `smartfarm.command.v1` `set_pump_state` messages retain their exact
meaning and wire shape. Approved irrigation strategy/application snapshots may
add the optional bounded `runDurationSeconds` field; records without it remain
valid and continue to use V1 behavior.

The local demo keeps the original untimed strategy version as compatibility
evidence and seeds a newer timed version as the default participant path.

## Consequences

- Existing V1 producers and stored objects remain valid.
- Strategy application remains one target to one terminal command, so no new
  SQLite table or migration is required for the optional JSON snapshot.
- Edge execution can remain pending for the requested duration, and the PWA
  follow window must scale up to the bounded five-minute duration.
- A production adapter cannot advertise `timed_pump` until it owns a durable
  local timer and passes restart, manual-stop, and physical failure tests.
- Decision 0011 now persists a final ACK before upload and replays it after an
  Edge restart. It deliberately does not resume or repeat a command left in the
  pre-ACK `executing` state.

## Alternatives considered: central scheduled stop

A persisted central run with separate start and stop commands offers better
workflow observability, but it cannot guarantee an on-time stop while the Edge
or device is disconnected. It also changes one strategy target from one
terminal command into a multi-command state machine. That remains useful for
future scheduling and overdue escalation, but it is not the first safety
primitive.

The device-local command keeps the stop independent of a later cloud request.
It also makes the hardware requirement explicit: a production adapter must
prove that its controller implements the timer locally before advertising
`timed_pump`.

## Verification boundary

The simulator-backed slice must prove:

1. V1 commands still parse and behave unchanged.
2. A V2 run is `on` during its injected timer and acknowledges only after
   returning to `off`.
3. Exact in-flight replays share one execution; conflicts do not start another
   run, and actor-scoped idempotency matches the central store.
4. Timer failure returns the simulator to `off` and produces a failed result.
5. Edge and central acknowledgement validation reject a false final `on`.
6. Strategy state stays pending until the timed run ends, then persists the
   final `off` result and audit evidence.
7. The PWA shows the requested duration and the simulator/physical-safety
   boundary, and a browser smoke observes pending-to-final-off behavior.
8. One device's timed execution does not block another device's command poll.
9. Decision 0012's independent software-stop lane interrupts the simulator
   before the timer completes, records causal failure rather than false timed
   success, and prevents older queued activation commands from restarting it.

## Explicit non-claims

This decision does not prove:

- a physical electrical or hydraulic interlock;
- moisture-feedback or volume-based closed-loop control;
- that a production device stayed on for the full interval;
- durable in-flight device-state recovery inside an unimplemented physical
  adapter (only completed-result ACK delivery is journaled by Decision 0011);
- protection from out-of-band actuator changes or physical manual overrides.

Production hardware must default to `off`, implement and persist its own timer,
support emergency/manual stop, and pass field failure tests before it may
declare the `timed_pump` capability.
