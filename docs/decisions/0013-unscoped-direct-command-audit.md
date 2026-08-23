# Decision 0013: Unscoped Direct-command Audit

- Status: accepted for the simulator-backed contest slice
- Date: 2026-08-09
- Owner: SmartFarmOS maintainers

## Context

Crop-cycle irrigation commands already emit deterministic
`command.completed` audit events through their strategy application. A direct
operator pump command used the same validated command and ACK lifecycle but
appeared only in command history. That left the farm audit view unable to show
who requested a manual `on` or `off` action and how it ended.

Direct control is farm/device scoped, not necessarily associated with one crop
cycle. Assigning it to the currently selected PWA cycle would create a false
relationship. Making `cycleId` nullable in the existing V1 object would break
the strict wire contract.

## Decision

Keep `smartfarm.audit-event.v1` unchanged for cycle-scoped alarm and strategy
events. Add `smartfarm.audit-event.v2` only for an unscoped direct
`command.completed` event:

- `cycleId` is exactly `null`;
- `action` is exactly `command.completed`;
- `targetType` is exactly `command`;
- the actor and target come from the immutable command;
- typed details snapshot the direct source, device, requested action, terminal
  status, reason, resulting pump state, and manual-stop cause when present.

The canonical `AuditEvent` reader accepts V1 and V2. The existing audit-list
route adds optional `includeUnscoped`; it defaults to `false`. Without that
explicit opt-in, a response excludes V2 rows even when no cycle filter is
provided. With `includeUnscoped=true`, a cycle-filtered request returns both
that cycle's V1 rows and farm-level V2 rows. This keeps existing strict clients
from receiving an unknown event version accidentally.

When the central store accepts the first terminal ACK, it checks whether the
command belongs to a strategy application. Strategy commands retain their
existing V1 crop-cycle audit only. Every other direct command receives one
deterministic V2 event in the same in-memory operation or SQLite transaction as
the command projection update. Exact ACK replay and conflicting ACKs emit no
new event.

Decision 0014 additionally requires the ACK caller's authenticated Edge scope
to contain the exact command farm/device pair before this transaction begins.

SQLite schema 6 makes only `audit_events.cycle_id` nullable. Existing rows and
the list index are preserved through a transactional table rebuild. The
composite crop-cycle foreign key still validates every non-null cycle ID.

## Consequences

- Farmers can see manual pump completion beside the selected cycle's audit
  trail without pretending the action belonged to that cycle.
- Command-history and audit evidence remain separate: history shows lifecycle
  projections; audit is the immutable actor/action/result record.
- The API endpoint, status codes, V1 event shape, and default query result stay
  compatible. Only an opt-in reader receives V2.
- Older binaries reject schema 6 by design. Downgrade requires exporting or
  deleting unscoped V2 rows and rebuilding the audit table as schema 5; there
  is no automatic lossy rollback.
- The table rebuild takes a write lock. It is acceptable for the small local
  contest SQLite database; a production migration must measure row count and
  schedule a maintenance or online-copy strategy.

## Alternatives considered

- **Attach the manual command to the selected crop cycle.** Rejected because UI
  selection is not an authoritative domain relationship.
- **Make V1 `cycleId` nullable.** Rejected because it changes an existing strict
  contract in place.
- **Store a synthetic crop-cycle ID.** Rejected because it defeats the foreign
  key and misrepresents farm-wide control.
- **Use command history only.** Rejected because it does not give the audit view
  a consistent actor/action/result record.
- **Emit both V1 strategy and V2 direct audits for every command.** Rejected
  because one ACK would appear twice and the unscoped event would discard known
  crop-cycle context.

## Verification boundary

The slice must prove:

1. V1 objects still parse exactly and V2 accepts only unscoped command events;
2. old/default audit queries never receive V2;
3. explicit opt-in returns matching cycle V1 plus farm-level V2 events;
4. direct success and failure each create one deterministic V2 event;
5. exact ACK replay, conflict, and strategy commands create no duplicate V2;
6. farm isolation and SQLite restart preserve the event;
7. a real browser shows the manual action as `농장 공통 제어` with a readable
   requested and final state.

## References

- [Decision 0012](./0012-device-local-manual-stop-priority.md)
- [Decision 0014](./0014-edge-device-credential-binding.md)
- [HTTP V1 contract](../contracts/http-v1.md)
- [Contract V1](../contracts/v1.md)
