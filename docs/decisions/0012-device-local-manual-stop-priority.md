# Decision 0012: Device-local Software Stop Priority

- Status: accepted for the simulator-backed pilot slice
- Date: 2026-08-09
- Owner: SmartFarmOS maintainers

## Context

An ordinary `set_pump_state: off` command used the same oldest-first queue as
every other command. While a device-local timed irrigation command was running,
the Edge awaited that command's terminal result and did not poll the same
device again. A later `off` therefore arrived only after the timer had already
ended. A stop-looking button without an enforceable path would be misleading.

The change must preserve existing Command V1/V2 writers, keep the completed-ACK
outbox guarantee from Decision 0011, survive an Edge restart, and remain honest
about the lack of physical interlocks and real-device proof.

## Decision

Every existing Command V1 `set_pump_state: off` is a device-local software stop
request. The central API exposes the same pending command through an additional
edge-only pull route:

```text
GET /v1/farms/:farmId/edge/commands/next-stop?deviceId=:deviceId
```

The Edge polls that route through an execution lane independent from normal
command processing. The stop lane may run while a timed command is waiting, but
it still validates farm/device scope, issue time, expiry, command shape, journal
identity, and the returned ACK. The simulator turns the pump `off`, terminates
the active timed run, and acknowledges the stop only after observing final
`off`.

The interrupted activation receives additive `smartfarm.command-ack.v2`:

```json
{
  "status": "failed",
  "reasonCode": "manual_stop",
  "result": null,
  "causedByCommandId": "command:the-off-request"
}
```

An activation that had not started but predates a locally acknowledged stop is
rejected with the same causal ACK and `status: rejected`. The Edge derives this
durable stop fence from its execution journal. Commands issued after the stop
remain eligible. The central store accepts the causal ACK only when the cause
exists, is a same-farm/same-device V1 `off`, and was issued no earlier than the
activation. The Edge submits and durably marks the stop command's final-`off`
ACK before it submits the interrupted activation's causal ACK; the central
store rejects `manual_stop` while the cause is still pending or failed.

The immutable stop command records actor, intent, time, and idempotency. Its
acknowledged final-`off` projection plus the interrupted command's causal ACK
forms the generic command history. When the interrupted command belongs to a
crop-cycle strategy application, `command.completed` audit details also include
`manualStopCommandId`.

Decision 0013 subsequently adds one unscoped AuditEvent V2 for the terminal
direct stop command itself. It does not attach that manual action to the crop
cycle selected in the browser.

## Consequences

- Existing Command V1/V2 payloads and the Command ACK V1 wire remain valid.
- ACK readers must accept the additive ACK V2 union and display
  `manual_stop` distinctly from device execution failure.
- The local demo runs normal and stop polling independently for each device.
- The stop fence prevents older queued activation commands from turning the
  pump back on after a confirmed stop, including after an Edge restart.
- The SQLite Edge query currently scans terminal records to derive the newest
  stop fence. A production-scale journal should add an indexed stop-fence
  projection or compacted device state.
- A command left at `executing` without a terminal ACK remains ambiguous and is
  not automatically replayed.

## Alternatives considered

- **Queue a normal `off` behind the timed command.** Rejected because it does
  not interrupt the timer.
- **Add only a stop button.** Rejected because UI without an enforcement path
  creates a false safety claim.
- **Create a farm-wide emergency-stop fan-out.** Deferred because partial
  multi-device completion and physical enforcement need a separate public
  protocol and field evidence.
- **Cancel older commands centrally without Edge evidence.** Rejected because
  the central API cannot distinguish a queued command from an already actuated
  command in the current protocol.

## Verification boundary

The simulator-backed slice proves:

1. a stop is pulled while a timed command is still running;
2. the stop reaches final `off` without waiting for the original timer;
3. the timed command ends once as `failed/manual_stop` with the stop command ID;
4. old activation commands are rejected behind a persisted stop fence;
5. new post-stop commands remain eligible;
6. both terminal ACKs use the durable Edge journal/outbox and exact replay;
7. central causal validation rejects missing, older, cross-scope, non-stop, or
   non-final-off cause commands;
8. strategy result, command history, and crop-cycle audit retain the causal
   evidence.

## Explicit non-claims

This is not an electrical or hydraulic emergency stop, certified safety
function, physical interlock, hardwired manual override, multi-gateway lease,
or proof that real hardware reached `off`. A production adapter still needs a
local fail-safe, durable device idempotency, state feedback/reconciliation,
out-of-band protection, and physical failure testing.

## References

- [Decision 0010](./0010-device-local-timed-irrigation.md)
- [Decision 0011](./0011-durable-edge-ack-outbox.md)
- [Decision 0013](./0013-unscoped-direct-command-audit.md)
- [HTTP V1 contract](../contracts/http-v1.md)
