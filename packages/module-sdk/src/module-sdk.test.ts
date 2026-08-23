import assert from "node:assert/strict";
import test from "node:test";
import {
  createStaticModuleRegistry,
  defineModuleManifest,
  ModuleManifestV1Schema,
  type ModuleManifestV1,
} from "./index.js";
import {
  ALARM_CENTER_MODULE_MANIFEST,
  BUILT_IN_MODULE_MANIFESTS,
  CROP_OPERATIONS_MODULE_MANIFEST,
  CROP_JOURNAL_MODULE_MANIFEST,
  FARM_CONTROL_MODULE_MANIFEST,
} from "./builtins.js";

test("validates all reviewed built-in module manifests", () => {
  const parsed = BUILT_IN_MODULE_MANIFESTS.map((manifest) =>
    ModuleManifestV1Schema.parse(manifest));

  assert.deepEqual(
    parsed.map((manifest) => manifest.id),
    [
      "smartfarm.crop-operations",
      "smartfarm.alarm-center",
      "smartfarm.crop-journal",
      "smartfarm.farm-control",
      "smartfarm.weather-location",
      "smartfarm.farm-environment",
    ],
  );

  assert.deepEqual(CROP_OPERATIONS_MODULE_MANIFEST.permissions, [
    "farm.read",
    "device.read",
    "area.read",
    "cycle.read",
    "cycle.write",
    "strategy.read",
    "strategy.apply",
    "telemetry.read",
    "device.command",
  ]);
  assert.deepEqual(FARM_CONTROL_MODULE_MANIFEST.permissions, [
    "farm.read",
    "device.read",
    "device.command",
    "layout.write",
  ]);
});

test("orders, disables, and resolves static modules from reviewed configuration", () => {
  const registry = createStaticModuleRegistry([
    contribution(CROP_OPERATIONS_MODULE_MANIFEST),
    contribution(ALARM_CENTER_MODULE_MANIFEST),
    contribution(CROP_JOURNAL_MODULE_MANIFEST),
    contribution(FARM_CONTROL_MODULE_MANIFEST),
  ], {
    schemaVersion: "smartfarm.module-registry-configuration.v1",
    modules: [
      { moduleId: "smartfarm.crop-operations", enabled: true, order: 1 },
      { moduleId: "smartfarm.alarm-center", enabled: true, order: 3 },
      { moduleId: "smartfarm.crop-journal", enabled: false, order: 10 },
      { moduleId: "smartfarm.farm-control", enabled: true, order: 5 },
    ],
  });

  assert.deepEqual(registry.modules.map((module) => module.manifest.id), [
    "smartfarm.crop-operations",
    "smartfarm.alarm-center",
    "smartfarm.farm-control",
  ]);
  assert.equal(registry.findByRoute("operations")?.manifest.id, "smartfarm.crop-operations");
  assert.equal(registry.findByRoute("alarms")?.manifest.id, "smartfarm.alarm-center");
  assert.equal(registry.findByRoute("control")?.manifest.id, "smartfarm.farm-control");
  assert.equal(registry.findByRoute("crops"), null);
});

test("rejects an implementation that uses an undeclared permission", () => {
  assert.throws(() => createStaticModuleRegistry([{
    manifest: CROP_JOURNAL_MODULE_MANIFEST,
    requiredPermissions: ["device.command"],
    implementation: "crop",
  }]), /uses undeclared permission 'device\.command'/);
});

test("rejects duplicate routes and configuration for unknown modules", () => {
  const duplicateRoute = defineModuleManifest({
    ...FARM_CONTROL_MODULE_MANIFEST,
    id: "smartfarm.other-control",
  });

  assert.throws(() => createStaticModuleRegistry([
    contribution(FARM_CONTROL_MODULE_MANIFEST),
    contribution(duplicateRoute),
  ]), /Duplicate page route 'control'/);

  assert.throws(() => createStaticModuleRegistry([
    contribution(FARM_CONTROL_MODULE_MANIFEST),
  ], {
    schemaVersion: "smartfarm.module-registry-configuration.v1",
    modules: [{ moduleId: "smartfarm.missing", enabled: true, order: 1 }],
  }), /references unknown module 'smartfarm\.missing'/);
});

test("rejects unknown fields and unsupported platform API versions", () => {
  assert.equal(ModuleManifestV1Schema.safeParse({
    ...CROP_JOURNAL_MODULE_MANIFEST,
    platformApiVersion: "2",
  }).success, false);
  assert.equal(ModuleManifestV1Schema.safeParse({
    ...CROP_JOURNAL_MODULE_MANIFEST,
    executable: "rm -rf /",
  }).success, false);
});

function contribution(manifest: ModuleManifestV1) {
  return {
    manifest,
    requiredPermissions: manifest.permissions,
    implementation: manifest.id,
  } as const;
}
