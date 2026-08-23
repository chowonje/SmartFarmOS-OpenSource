import assert from "node:assert/strict";
import test from "node:test";
import {
  FarmControlProfileResponseSchema,
  FarmControlProfileSchema,
  PutFarmControlProfileRequestSchema,
} from "./index.js";

test("accepts strict farm control profiles and profile responses", () => {
  const profile = FarmControlProfileSchema.parse({
    schemaVersion: "smartfarm.farm-control-profile.v1",
    farmId: "farm:demo",
    revision: 3,
    widgets: [{
      schemaVersion: "smartfarm.farm-control-widget.v1",
      kind: "pump_control",
      deviceId: "device:bed-1",
      label: "Bed 1 Pump",
      showStart: true,
    }],
    updatedAt: "2026-07-17T00:00:00.000Z",
  });
  const response = FarmControlProfileResponseSchema.parse({
    schemaVersion: "smartfarm.farm-control-profile-response.v1",
    controlProfile: profile,
  });

  assert.equal(response.controlProfile.revision, 3);
  assert.equal(response.controlProfile.widgets[0]?.label, "Bed 1 Pump");
});

test("rejects duplicate farm control widgets and unknown fields", () => {
  const duplicate = PutFarmControlProfileRequestSchema.safeParse({
    expectedRevision: 0,
    widgets: [
      {
        schemaVersion: "smartfarm.farm-control-widget.v1",
        kind: "pump_control",
        deviceId: "device:bed-1",
        label: "Bed 1 Pump",
        showStart: true,
      },
      {
        schemaVersion: "smartfarm.farm-control-widget.v1",
        kind: "pump_control",
        deviceId: "device:bed-1",
        label: "Bed 1 Pump Duplicate",
        showStart: false,
      },
    ],
  });
  const unknown = PutFarmControlProfileRequestSchema.safeParse({
    expectedRevision: 0,
    widgets: [{
      schemaVersion: "smartfarm.farm-control-widget.v1",
      kind: "pump_control",
      deviceId: "device:bed-1",
      label: "Bed 1 Pump",
      showStart: true,
      showStop: false,
    }],
  });

  assert.equal(duplicate.success, false);
  assert.equal(unknown.success, false);
});

test("rejects an expected revision that cannot be incremented safely", () => {
  const exhausted = PutFarmControlProfileRequestSchema.safeParse({
    expectedRevision: 2_147_483_647,
    widgets: [],
  });

  assert.equal(exhausted.success, false);
});
