# Module SDK

`@smartfarm-os/module-sdk` defines the versioned, runtime-validated boundary
between the SmartFarmOS platform shell and reviewed built-in modules.

The first platform version loads code modules from an explicit build-time
registry. Farmer-imported templates are data only and are not executable
module packages. The template contract and persisted Workbench configuration
belong to the later M2/M3 milestones.

The `./builtins` export contains the canonical manifests for the six current
user modules. PWA and API entrypoints bind behavior to those manifests without
letting a module access SQLite, MQTT, or credentials directly.
