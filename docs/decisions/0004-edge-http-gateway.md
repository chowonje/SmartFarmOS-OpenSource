# 0004: Edge Gateway HTTP transport boundary

- Status: accepted for the first vertical slice
- Date: 2026-07-17

## Context

The central API can accept telemetry and command acknowledgements, but the first
slice still needs a process boundary that represents a Raspberry Pi or another
farm-side gateway. The legacy implementation mixes device access, transport,
and application behavior, which makes command safety and integration tests hard
to isolate.

## Decision

Add a TypeScript Edge Gateway package with two explicit ports:

- `CentralApiPort` forwards telemetry, pulls one pending command, and submits a
  terminal acknowledgement over the versioned HTTP API;
- `DeviceCommandExecutor` isolates physical-device or simulator execution.

The HTTP executor accepts only origin-relative paths, blocks redirects, uses a
bounded timeout, limits response bodies, and runtime-validates every response.
The gateway rejects expired or out-of-scope commands before device execution.
Device exceptions and malformed acknowledgements become a terminal
`execution_failed` acknowledgement.

## Consequences

- The simulator can prove the same boundary that a future Raspberry Pi adapter
  will implement.
- The first end-to-end path is testable over a real loopback TCP socket without
  requiring hardware.
- The API change is additive: existing telemetry, command-create, command-read,
  and acknowledgement endpoints keep their fields and status codes. A new
  edge-only `GET /v1/farms/:farmId/edge/commands/next` endpoint returns `200`
  with `smartfarm.pending-command.v1` or `204` when idle.
- This does not claim that MQTT, durable offline buffering, production identity,
  TLS deployment, or physical GPIO behavior is complete. Those remain separate
  verified milestones.

Decision 0014 later binds every central Edge request to an exact farm/device
credential scope and gives each local simulator gateway a separate internal
key. Production credential enrollment and rotation remain out of scope.
