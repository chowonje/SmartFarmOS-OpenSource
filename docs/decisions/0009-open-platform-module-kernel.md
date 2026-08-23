# Decision 0009: Reviewed Open Platform Module Kernel

- Status: implemented locally
- Date: 2026-07-19

## Context

The PWA previously owned a fixed route list, navigation list, overview quick
links, and a route-rendering conditional. The central API registered every
domain route directly in one application factory. Existing crop, control,
weather/location, and environment behavior worked, but adding or disabling a
feature required editing several unrelated host files.

SmartFarmOS is an open-source smart-farm operations platform, not a Linux
distribution. Its first extension boundary must make reviewed capabilities
replaceable without allowing an imported file to execute arbitrary code.

## Decision

- `@smartfarm-os/module-sdk` owns `ModuleManifestV1`, permission declarations,
  registry configuration, runtime validation, and the four canonical built-in
  manifests.
- Built-in code remains a compile-time reviewed allowlist. PWA `web` behavior
  and API `server` route registrars bind to a shared manifest ID.
- The PWA derives module navigation, hash routes, and overview cards from the
  active registry. `overview` remains a platform-shell route.
- The API registers crop, control, weather/location, and environment server
  entrypoints from the same active registry. Platform health and farm/device
  catalog routes remain core services shared by all modules.
- API modules receive an injected `SmartFarmStore` boundary. They do not open
  SQLite, connect to MQTT, or read credentials directly.
- Existing HTTP paths and response contracts remain unchanged. An optional
  `moduleConfiguration` input on `buildApi` is additive and composition-only.
- Farmer-imported JSON/YAML templates, persisted farm configuration, and the
  Workbench UI are not part of M1. They must be data-only and are implemented
  in M2/M3 against this registry contract.

## Consequences

- A reviewed configuration can disable or reorder a module without editing
  navigation or route conditionals.
- Duplicate module IDs, page routes, home-card IDs, unknown configured modules,
  unsupported platform versions, and undeclared implementation permissions
  fail before the application starts.
- Current user behavior is preserved while the host/module dependency
  direction becomes explicit.
- Third-party runtime package installation and executable template imports
  remain deliberately unsupported.
- The pre-M1 duplicate `services/api/src/app 2.ts` is retained as the
  non-runtime `docs/archive/api-app-pre-module-kernel.ts.txt` reference so the
  old registrar is not silently compiled beside the active module entrypoints.
