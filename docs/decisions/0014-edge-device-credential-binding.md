# Decision 0014: Edge Credential Binding to Farm-device Pairs

- Status: accepted for the local HTTP Edge boundary
- Date: 2026-08-09
- Owner: SmartFarmOS maintainers

## Context

The injected authentication boundary originally authorized an Edge principal
only by role and farm. A credential allowed for one device could therefore ask
for another device's pending command in the same farm or submit an ACK that
matched that other command's body. The store correctly validated command
farm/device identity, but it could not prove that the calling Edge represented
that device. A forged terminal ACK could also create false command and strategy
audit evidence.

Device IDs are scoped by farm, so independent `farmIds` and `deviceIds` lists
would create an unsafe cross-product for a multi-farm Edge.

## Decision

`AuthPrincipal` is a role-discriminated internal boundary. User and admin
principals retain `id`, `role`, and `farmIds`. Every Edge principal additionally
requires a non-empty, duplicate-free list of exact scopes:

```text
deviceScopes: [{ farmId, deviceId }, ...]
```

The authentication adapter's runtime result is untrusted. The central API
rejects missing, malformed, duplicate, invalid, or cross-farm device scopes and
rejects `deviceScopes` on a user/admin principal. After parsing the request
contract and before reading or mutating the store, the API requires an exact
scope match for all Edge device paths:

1. telemetry submission;
2. normal pending-command pull;
3. software-stop pending-command pull;
4. terminal ACK submission.

The public HTTP request and response shapes do not change. A production identity
adapter must derive the scope from an authenticated credential; it must never
copy a client-selected device header into the principal.

The local demo creates a separate random, process-local Edge key for each
simulator device. The key itself maps to one exact Edge principal and is used by
only that device's `CentralApiClient`. Keys are not returned by the runtime,
written to disk, logged, or included in browser assets. The existing shared demo
key authenticates only user/admin requests; asking for `role=edge` with it is
rejected.

## Consequences

- One Edge credential cannot read or acknowledge another same-farm device's
  command unless that exact pair was explicitly included by the trusted adapter.
- Unauthorized telemetry, normal pull, stop pull, and ACK attempts fail with
  `403` before store access. Invalid authentication context fails closed with a
  sanitized `500`; missing or unrecognized credentials remain `401`.
- Audit actor remains the immutable command actor. Its integrity now also
  depends on a terminal ACK supplied by an Edge credential bound to the target
  device.
- Existing authentication adapters must add exact device scopes for Edge
  principals. This is an intentional internal security-boundary change, not a
  new HTTP API version.
- A gateway may own more than one device, but every pair must be listed
  explicitly. Multi-gateway leases and active-active ownership remain separate.

## Alternatives considered

- **Keep farm-only Edge authorization.** Rejected because a compromised device
  credential would control every command result in the farm.
- **Use a farm list plus a device list.** Rejected because it authorizes the
  cross-product rather than exact pairs.
- **Trust `deviceId` from a request header.** Rejected because the caller could
  choose another identity.
- **Use one shared local-demo key and select a mapped principal ID.** Rejected
  because anyone holding that key could select a known sibling Edge ID.
- **Add a device field to Command/ACK wire objects only.** Rejected because those
  fields already exist and do not authenticate the caller that supplies them.

## Verification boundary

The slice must prove:

1. same-farm other-device telemetry, normal pull, stop pull, and ACK return
   `403` and do not mutate command or audit state;
2. malformed or missing Edge scopes fail closed;
3. valid multi-device scopes still work without a farm/device cross-product;
4. shared demo credentials cannot request the Edge role;
5. internal per-device keys keep both demo gateways working over real HTTP;
6. API, Edge, persistence, local-demo, and browser regressions remain green.

## Explicit non-claims

This does not implement OIDC, certificate enrollment, key rotation, MQTT client
certificates, secure hardware storage, revocation, command leases, or a
production listening deployment. Those remain pilot/release gates.

## References

- [Decision 0003](./0003-central-api-boundary.md)
- [Decision 0004](./0004-edge-http-gateway.md)
- [Decision 0013](./0013-unscoped-direct-command-audit.md)
- [HTTP V1 contract](../contracts/http-v1.md)
