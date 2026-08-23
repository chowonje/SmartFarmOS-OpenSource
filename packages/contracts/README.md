# Shared Contracts

This package owns the runtime Zod schemas and inferred TypeScript types for
farms/devices, growing areas and crop cycles, telemetry, alarms/audit,
irrigation strategies/applications, commands, and acknowledgements.

`CommandSchema` accepts the unchanged V1 immediate pump-state wire and the
additive V2 device-local timed-pump wire. Timed capability is explicit, run
duration is bounded to `1..300` seconds, and a successful V2 acknowledgement
must report final `off`.

It is the only canonical message contract for the PWA, central API, Edge Gateway, and device simulator. See `docs/contracts/v1.md` for compatibility rules and legacy migration notes.

## Commands

```bash
npm run build --workspace=@smartfarm-os/contracts
npm run typecheck --workspace=@smartfarm-os/contracts
npm run test --workspace=@smartfarm-os/contracts
```
