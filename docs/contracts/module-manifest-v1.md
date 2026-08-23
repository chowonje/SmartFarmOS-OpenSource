# Module Manifest V1

`ModuleManifestV1` is the reviewed build-time contract between the SmartFarmOS
platform shell and a built-in module. The runtime schema is exported by
`@smartfarm-os/module-sdk`.

## Manifest fields

| Field | Rule |
| --- | --- |
| `schemaVersion` | Literal `smartfarm.module-manifest.v1` |
| `id` | Stable namespaced identifier such as `smartfarm.farm-control` |
| `version` | Three-part semantic version |
| `platformApiVersion` | Literal `1`; unsupported versions fail startup |
| `permissions` | Unique values from the platform permission vocabulary |
| `pages` | Unique hash routes with label, order, and optional test ID |
| `homeCards` | Unique cards whose route belongs to the same module |
| `configSchema` | Data-only configuration field declaration; currently empty for built-ins |
| `subscriptions` | Unique declared event names; dispatch is a later milestone |

The current permission vocabulary is `farm.read`, `device.read`, `area.read`,
`crop.read/write`, `cycle.read/write`, `journal.read/write`, `alarm.read`,
`alarm.acknowledge`, `audit.read`, `telemetry.read`, `weather.read`,
`location.read`, `device.command`, `strategy.read`, `strategy.apply`,
`layout.write`, and `automation.write`.

## Static registry

`createStaticModuleRegistry` accepts reviewed contributions and an optional
`ModuleRegistryConfigurationV1` containing module ID, enabled state, and order.
It validates all manifests and ensures each implementation's required
permissions were declared. Unknown modules and duplicate IDs, routes, or cards
are rejected.

The current reviewed registry has six built-ins:

1. `smartfarm.crop-operations` → `#operations`
2. `smartfarm.alarm-center` → `#alarms`
3. `smartfarm.crop-journal` → `#crops`
4. `smartfarm.farm-control` → `#control`
5. `smartfarm.weather-location` → `#weather`
6. `smartfarm.farm-environment` → `#environment`

The crop-operations built-in declares `telemetry.read`, `device.command`,
`strategy.read`, and `strategy.apply` because it renders bounded area histories,
existing command results, and approved strategy applications. A registry
contribution that consumes one of those capabilities without its manifest
permission fails startup validation.

## Trust boundary

- A code module is imported by the PWA/API build and reviewed with normal source.
- A future farmer template can configure only installed modules and cannot
  contain JavaScript, shell, SQL, credentials, or a new module entrypoint.
- A module may use injected platform services but cannot connect directly to
  SQLite, MQTT, or privileged providers.

## Compatibility report

M1 removed no HTTP endpoint, request field, response field, status code, or
existing hash route. The later crop-operations and alarm-center modules add
their own area/cycle/alarm/audit routes and `#operations`/`#alarms` pages
without changing existing contracts.
`buildApi.moduleConfiguration` is an optional additive composition input.
Disabling a module intentionally removes its registered server routes and PWA
pages and therefore must be an explicit host decision.
