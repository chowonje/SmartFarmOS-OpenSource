import assert from "node:assert/strict";
import test from "node:test";
import {
  CommandAckSchema,
  CommandAckReasonCodeSchema,
  CommandAckV1ReasonCodeSchema,
  CommandAckV1Schema,
  CommandAckV2Schema,
  CommandListQuerySchema,
  CommandListResponseSchema,
  CommandProjectionSchema,
  CommandSchema,
  CropCycleDetailSchema,
  CropRecordSchema,
  CropResponseSchema,
  CreatePumpCommandRequestSchema,
  DeviceSchema,
  FarmSchema,
  GatewayEnrollmentPathParamsSchema,
  RevokeGatewayEnrollmentResponseSchema,
  GrowingAreaSchema,
  MAX_COMMAND_TTL_MS,
  PatchCropCycleRequestSchema,
  PatchCropRequestSchema,
  TelemetrySchema,
  TimedPumpCommandSchema,
  TimedPumpRunPayloadSchema,
  commandExpectedFinalPumpState,
  commandRequestedPumpState,
  isCommandAckCompatible,
  isPumpStopCommand,
} from "./index.js";

const issuedAt = "2026-07-17T00:00:00.000Z";

function validCommandInput() {
  return {
    schemaVersion: "smartfarm.command.v1",
    id: "command:pump-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    payload: { action: "set_pump_state", state: "on" },
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "demo-pump-000001",
    issuedAt,
    expiresAt: "2026-07-17T00:01:00.000Z",
  } as const;
}

function validTimedPumpCommandInput() {
  return {
    schemaVersion: "smartfarm.command.v2",
    id: "command:pump-timed-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    payload: { action: "run_pump_for", durationSeconds: 45 },
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "demo-pump-timed-000001",
    issuedAt,
    expiresAt: "2026-07-17T00:01:00.000Z",
  } as const;
}

test("accepts strict farm and device objects", () => {
  const farm = FarmSchema.parse({
    schemaVersion: "smartfarm.farm.v1",
    id: "farm:demo",
    name: "Contest Demo Farm",
    timezone: "Asia/Seoul",
    createdAt: issuedAt,
  });
  const device = DeviceSchema.parse({
    schemaVersion: "smartfarm.device.v1",
    id: "device:bed-1",
    farmId: farm.id,
    name: "Bed 1 Controller",
    kind: "hybrid",
    capabilities: ["temperature", "pump"],
    status: "online",
    lastSeenAt: issuedAt,
  });

  assert.equal(farm.id, "farm:demo");
  assert.equal(device.farmId, farm.id);
  assert.equal(device.capabilities.length, 2);
});

test("accepts strict gateway enrollment revocation boundary payloads", () => {
  const params = GatewayEnrollmentPathParamsSchema.parse({
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    enrollmentId: "gateway-enrollment:demo-enroll",
  });
  const response = RevokeGatewayEnrollmentResponseSchema.parse({
    schemaVersion: "smartfarm.revoke-gateway-enrollment-response.v1",
    enrollment: {
      schemaVersion: "smartfarm.gateway-enrollment-record.v1",
      id: params.enrollmentId,
      farmId: params.farmId,
      deviceId: params.deviceId,
      status: "revoked",
      issuedByActorId: "admin:demo",
      issuedAt: issuedAt,
      expiresAt: "2026-07-17T00:10:00.000Z",
      exchangedAt: null,
      exchangedCredentialId: null,
      revokedAt: "2026-07-17T00:05:00.000Z",
      revokedByActorId: "admin:demo",
    },
  });

  assert.equal(response.enrollment.id, params.enrollmentId);
  assert.equal(response.enrollment.status, "revoked");
});

test("rejects gateway enrollment revocation payloads with extra fields", () => {
  assert.equal(
    GatewayEnrollmentPathParamsSchema.safeParse({
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      enrollmentId: "gateway-enrollment:demo-enroll",
      tokenDigest: "must-not-cross-boundary",
    }).success,
    false,
  );
  assert.equal(
    RevokeGatewayEnrollmentResponseSchema.safeParse({
      schemaVersion: "smartfarm.revoke-gateway-enrollment-response.v1",
      enrollment: {
        schemaVersion: "smartfarm.gateway-enrollment-record.v1",
        id: "gateway-enrollment:demo-enroll",
        farmId: "farm:demo",
        deviceId: "device:bed-1",
        status: "revoked",
        issuedByActorId: "admin:demo",
        issuedAt: issuedAt,
        expiresAt: "2026-07-17T00:10:00.000Z",
        exchangedAt: null,
        exchangedCredentialId: null,
        revokedAt: "2026-07-17T00:05:00.000Z",
        revokedByActorId: "admin:demo",
        enrollmentToken: "must-not-leak",
      },
    }).success,
    false,
  );
});

test("rejects duplicate device capabilities and unknown fields", () => {
  const duplicate = DeviceSchema.safeParse({
    schemaVersion: "smartfarm.device.v1",
    id: "device:bed-1",
    farmId: "farm:demo",
    name: "Bed 1 Controller",
    kind: "hybrid",
    capabilities: ["temperature", "temperature"],
    status: "online",
    lastSeenAt: issuedAt,
  });
  const unknown = FarmSchema.safeParse({
    schemaVersion: "smartfarm.farm.v1",
    id: "farm:demo",
    name: "Contest Demo Farm",
    timezone: "Asia/Seoul",
    createdAt: issuedAt,
    internalCredential: "must-not-cross-boundary",
  });

  assert.equal(duplicate.success, false);
  assert.equal(unknown.success, false);
});

test("accepts timed pump support only as an explicitly advertised capability", () => {
  const persistentPump = DeviceSchema.parse({
    schemaVersion: "smartfarm.device.v1",
    id: "device:persistent-pump",
    farmId: "farm:demo",
    name: "Persistent Pump Controller",
    kind: "controller",
    capabilities: ["pump"],
    status: "online",
    lastSeenAt: issuedAt,
  });
  const timedPump = DeviceSchema.parse({
    ...persistentPump,
    id: "device:timed-pump",
    name: "Timed Pump Controller",
    capabilities: ["pump", "timed_pump"],
  });

  assert.deepEqual(persistentPump.capabilities, ["pump"]);
  assert.deepEqual(timedPump.capabilities, ["pump", "timed_pump"]);
});

test("enforces telemetry metric, unit, and range", () => {
  const valid = TelemetrySchema.parse({
    schemaVersion: "smartfarm.telemetry.v1",
    id: "telemetry:bed-1-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    metric: "temperature",
    value: 24.5,
    unit: "celsius",
    sequence: 1,
    observedAt: issuedAt,
  });
  const wrongUnit = TelemetrySchema.safeParse({ ...valid, unit: "percent" });
  const outOfRange = TelemetrySchema.safeParse({ ...valid, value: 150 });

  assert.equal(valid.value, 24.5);
  assert.equal(wrongUnit.success, false);
  assert.equal(outOfRange.success, false);
});

test("enforces command expiry order and maximum lifetime", () => {
  const valid = CommandSchema.parse(validCommandInput());
  const reversed = CommandSchema.safeParse({ ...valid, expiresAt: valid.issuedAt });
  const tooLong = CommandSchema.safeParse({
    ...valid,
    expiresAt: new Date(Date.parse(valid.issuedAt) + MAX_COMMAND_TTL_MS + 1).toISOString(),
  });

  assert.equal(valid.schemaVersion, "smartfarm.command.v1");
  assert.equal(
    valid.schemaVersion === "smartfarm.command.v1" ? valid.payload.state : null,
    "on",
  );
  assert.equal(reversed.success, false);
  assert.equal(tooLong.success, false);
});

test("accepts strict bounded timed-pump v2 commands without changing v1", () => {
  const v1 = CommandSchema.parse(validCommandInput());
  const v2 = CommandSchema.parse(validTimedPumpCommandInput());
  const directV2 = TimedPumpCommandSchema.parse(validTimedPumpCommandInput());

  assert.equal(v1.schemaVersion, "smartfarm.command.v1");
  assert.equal(v2.schemaVersion, "smartfarm.command.v2");
  assert.equal(directV2.payload.durationSeconds, 45);
  assert.equal(
    TimedPumpRunPayloadSchema.safeParse({
      action: "run_pump_for",
      durationSeconds: 1,
    }).success,
    true,
  );
  assert.equal(
    TimedPumpRunPayloadSchema.safeParse({
      action: "run_pump_for",
      durationSeconds: 300,
    }).success,
    true,
  );

  for (const durationSeconds of [0, 301, 1.5]) {
    assert.equal(
      TimedPumpRunPayloadSchema.safeParse({
        action: "run_pump_for",
        durationSeconds,
      }).success,
      false,
    );
  }

  assert.equal(
    TimedPumpRunPayloadSchema.safeParse({
      action: "run_pump_for",
      durationSeconds: 45,
      state: "on",
    }).success,
    false,
  );
  assert.equal(
    CommandSchema.safeParse({
      ...validCommandInput(),
      payload: { action: "run_pump_for", durationSeconds: 45 },
    }).success,
    false,
  );
  assert.equal(
    CommandSchema.safeParse({
      ...validTimedPumpCommandInput(),
      payload: { action: "set_pump_state", state: "on" },
    }).success,
    false,
  );
  assert.equal(
    TimedPumpCommandSchema.safeParse({
      ...validTimedPumpCommandInput(),
      expiresAt: issuedAt,
    }).success,
    false,
  );
  assert.equal(
    TimedPumpCommandSchema.safeParse({
      ...validTimedPumpCommandInput(),
      expiresAt: new Date(
        Date.parse(issuedAt) + MAX_COMMAND_TTL_MS + 1,
      ).toISOString(),
    }).success,
    false,
  );
});

test("derives timed-pump states and validates compatible acknowledgements", () => {
  const persistentOn = CommandSchema.parse(validCommandInput());
  const timed = CommandSchema.parse(validTimedPumpCommandInput());
  const timedAck = CommandAckV1Schema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: timed.id,
    farmId: timed.farmId,
    deviceId: timed.deviceId,
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: "off" },
    processedAt: "2026-07-17T00:00:46.000Z",
  });

  assert.equal(commandRequestedPumpState(persistentOn), "on");
  assert.equal(commandExpectedFinalPumpState(persistentOn), "on");
  assert.equal(commandRequestedPumpState(timed), "on");
  assert.equal(commandExpectedFinalPumpState(timed), "off");
  assert.equal(isCommandAckCompatible(timed, timedAck), true);
  assert.equal(
    isCommandAckCompatible(timed, { ...timedAck, commandId: persistentOn.id }),
    false,
  );
  assert.equal(
    isCommandAckCompatible(
      timed,
      CommandAckSchema.parse({ ...timedAck, farmId: "farm:other" }),
    ),
    false,
  );
  assert.equal(
    isCommandAckCompatible(
      timed,
      CommandAckSchema.parse({ ...timedAck, deviceId: "device:bed-2" }),
    ),
    false,
  );
  assert.equal(
    isCommandAckCompatible(timed, {
      ...timedAck,
      result: { pumpState: "on" },
    }),
    false,
  );
  assert.equal(
    isCommandAckCompatible(timed, {
      ...timedAck,
      status: "failed",
      reasonCode: "execution_failed",
      result: null,
    }),
    true,
  );
});

test("classifies only V1 set-pump-state off as a pump stop command", () => {
  const persistentOn = CommandSchema.parse(validCommandInput());
  const persistentOff = CommandSchema.parse({
    ...validCommandInput(),
    payload: { action: "set_pump_state", state: "off" },
  });
  const timed = CommandSchema.parse(validTimedPumpCommandInput());

  assert.equal(isPumpStopCommand(persistentOn), false);
  assert.equal(isPumpStopCommand(persistentOff), true);
  assert.equal(isPumpStopCommand(timed), false);
});

test("preserves ACK v1 while accepting strict manual-stop ACK v2", () => {
  const timed = CommandSchema.parse(validTimedPumpCommandInput());
  const v1Input = {
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: timed.id,
    farmId: timed.farmId,
    deviceId: timed.deviceId,
    status: "failed",
    reasonCode: "execution_failed",
    result: null,
    processedAt: "2026-07-17T00:00:10.000Z",
  } as const;
  const v2Input = {
    schemaVersion: "smartfarm.command-ack.v2",
    commandId: timed.id,
    farmId: timed.farmId,
    deviceId: timed.deviceId,
    status: "failed",
    reasonCode: "manual_stop",
    result: null,
    causedByCommandId: "command:manual-stop-000001",
    processedAt: "2026-07-17T00:00:10.000Z",
  } as const;

  const directV1 = CommandAckV1Schema.parse(v1Input);
  const canonicalV1 = CommandAckSchema.parse(v1Input);
  const directV2 = CommandAckV2Schema.parse(v2Input);
  const canonicalV2 = CommandAckSchema.parse(v2Input);

  assert.deepEqual(canonicalV1, directV1);
  assert.deepEqual(canonicalV2, directV2);
  assert.equal(CommandAckReasonCodeSchema.parse("manual_stop"), "manual_stop");
  assert.equal(CommandAckV1ReasonCodeSchema.safeParse("manual_stop").success, false);
  assert.equal(
    CommandAckSchema.safeParse({
      ...v1Input,
      reasonCode: "manual_stop",
    }).success,
    false,
  );
  assert.equal(
    CommandAckSchema.safeParse({
      ...v1Input,
      causedByCommandId: "command:manual-stop-000001",
    }).success,
    false,
  );
});

test("bounds ACK v2 to a distinct manual-stop cause and pump activation commands", () => {
  const persistentOn = CommandSchema.parse(validCommandInput());
  const persistentOff = CommandSchema.parse({
    ...validCommandInput(),
    payload: { action: "set_pump_state", state: "off" },
  });
  const timed = CommandSchema.parse(validTimedPumpCommandInput());
  const valid = CommandAckV2Schema.parse({
    schemaVersion: "smartfarm.command-ack.v2",
    commandId: timed.id,
    farmId: timed.farmId,
    deviceId: timed.deviceId,
    status: "failed",
    reasonCode: "manual_stop",
    result: null,
    causedByCommandId: "command:manual-stop-000001",
    processedAt: "2026-07-17T00:00:10.000Z",
  });
  const rejectedBeforeExecution = CommandAckV2Schema.parse({
    ...valid,
    status: "rejected",
  });

  assert.equal(isCommandAckCompatible(timed, valid), true);
  assert.equal(isCommandAckCompatible(persistentOn, CommandAckV2Schema.parse({
    ...valid,
    commandId: persistentOn.id,
  })), true);
  assert.equal(isCommandAckCompatible(persistentOff, CommandAckV2Schema.parse({
    ...valid,
    commandId: persistentOff.id,
  })), false);
  assert.equal(rejectedBeforeExecution.status, "rejected");
  assert.equal(
    isCommandAckCompatible(timed, CommandAckV2Schema.parse({
      ...valid,
      farmId: "farm:other",
    })),
    false,
  );

  for (const invalid of [
    { ...valid, status: "acknowledged" },
    { ...valid, status: "timed_out" },
    { ...valid, reasonCode: "execution_failed" },
    { ...valid, result: { pumpState: "off" } },
    { ...valid, causedByCommandId: valid.commandId },
    { ...valid, unexpected: true },
  ]) {
    assert.equal(CommandAckV2Schema.safeParse(invalid).success, false);
  }

  const { causedByCommandId: _omitted, ...withoutCause } = valid;
  assert.equal(CommandAckV2Schema.safeParse(withoutCause).success, false);
});

test("enforces acknowledgement status, result, and reason invariants", () => {
  const accepted = CommandAckSchema.parse({
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: "command:pump-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: "on" },
    processedAt: "2026-07-17T00:00:01.000Z",
  });
  const impossible = CommandAckSchema.safeParse({
    ...accepted,
    status: "rejected",
    reasonCode: null,
  });

  assert.equal(accepted.result?.pumpState, "on");
  assert.equal(impossible.success, false);
});

test("defaults command request TTL and validates projection lifecycle", () => {
  const request = CreatePumpCommandRequestSchema.parse({
    deviceId: "device:bed-1",
    state: "on",
    idempotencyKey: "demo-pump-000001",
  });
  const command = CommandSchema.parse(validCommandInput());
  const pending = CommandProjectionSchema.parse({
    schemaVersion: "smartfarm.command-projection.v1",
    command,
    status: "pending",
    ack: null,
    updatedAt: issuedAt,
  });
  const impossible = CommandProjectionSchema.safeParse({
    ...pending,
    status: "acknowledged",
  });

  assert.equal(request.ttlSeconds, 60);
  assert.equal(impossible.success, false);
});

test("defaults, coerces, and bounds strict command-list queries", () => {
  const defaults = CommandListQuerySchema.parse({});
  const filtered = CommandListQuerySchema.parse({
    deviceId: "device:bed-1",
    limit: "25",
  });

  assert.equal(defaults.limit, 50);
  assert.equal(filtered.deviceId, "device:bed-1");
  assert.equal(filtered.limit, 25);
  assert.equal(CommandListQuerySchema.safeParse({ limit: 0 }).success, false);
  assert.equal(CommandListQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(CommandListQuerySchema.safeParse({ limit: 1.5 }).success, false);
  assert.equal(CommandListQuerySchema.safeParse({ unknown: true }).success, false);
});

test("validates strict bounded command-list responses", () => {
  const command = CommandSchema.parse(validCommandInput());
  const projection = CommandProjectionSchema.parse({
    schemaVersion: "smartfarm.command-projection.v1",
    command,
    status: "pending",
    ack: null,
    updatedAt: issuedAt,
  });
  const response = CommandListResponseSchema.parse({
    schemaVersion: "smartfarm.command-list.v1",
    commands: [projection],
  });
  const invalidProjection = CommandListResponseSchema.safeParse({
    schemaVersion: "smartfarm.command-list.v1",
    commands: [{ ...projection, status: "acknowledged" }],
  });
  const tooMany = CommandListResponseSchema.safeParse({
    schemaVersion: "smartfarm.command-list.v1",
    commands: Array.from({ length: 101 }, () => projection),
  });
  const unknown = CommandListResponseSchema.safeParse({
    schemaVersion: "smartfarm.command-list.v1",
    commands: [projection],
    nextCursor: null,
  });

  assert.equal(response.commands[0]?.command.id, command.id);
  assert.equal(invalidProjection.success, false);
  assert.equal(tooMany.success, false);
  assert.equal(unknown.success, false);
});

test("accepts strict normalized crop records and responses", () => {
  const crop = CropRecordSchema.parse({
    schemaVersion: "smartfarm.crop.v1",
    id: "crop:basil-bed-1",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    name: "Basil",
    healthStatus: "good",
    managerName: "Manager Kim",
    notes: "Healthy leaves and steady growth.",
    createdAt: issuedAt,
    updatedAt: issuedAt,
  });
  const response = CropResponseSchema.parse({
    schemaVersion: "smartfarm.crop-response.v1",
    crop,
  });

  assert.equal(response.crop.id, "crop:basil-bed-1");
  assert.equal(response.crop.healthStatus, "good");
});

test("rejects empty crop patches and unknown crop fields", () => {
  const emptyPatch = PatchCropRequestSchema.safeParse({});
  const unknownField = CropRecordSchema.safeParse({
    schemaVersion: "smartfarm.crop.v1",
    id: "crop:basil-bed-1",
    farmId: "farm:demo",
    deviceId: null,
    name: "Basil",
    healthStatus: "good",
    managerName: null,
    notes: null,
    createdAt: issuedAt,
    updatedAt: issuedAt,
    crop_name: "legacy",
  });

  assert.equal(emptyPatch.success, false);
  assert.equal(unknownField.success, false);
});

test("accepts growing areas and crop-cycle details with unique area assignments", () => {
  const area = GrowingAreaSchema.parse({
    schemaVersion: "smartfarm.growing-area.v1",
    id: "area:east-bed",
    farmId: "farm:demo",
    name: "East Bed",
    kind: "bed",
    primaryDeviceId: "device:bed-1",
    status: "active",
    createdAt: issuedAt,
    updatedAt: issuedAt,
  });
  const cycle = CropCycleDetailSchema.parse({
    schemaVersion: "smartfarm.crop-cycle-detail.v1",
    cycle: {
      schemaVersion: "smartfarm.crop-cycle.v1",
      id: "cycle:basil-week-31",
      farmId: "farm:demo",
      name: "Basil Week 31",
      cropName: "Basil",
      variety: "Sweet Basil",
      status: "active",
      startedAt: issuedAt,
      plannedEndAt: "2026-08-14T00:00:00.000Z",
      createdAt: issuedAt,
      updatedAt: issuedAt,
    },
    areaIds: [area.id],
  });
  const duplicateAreas = CropCycleDetailSchema.safeParse({
    ...cycle,
    areaIds: [area.id, area.id],
  });
  const emptyPatch = PatchCropCycleRequestSchema.safeParse({});

  assert.equal(cycle.areaIds[0], area.id);
  assert.equal(duplicateAreas.success, false);
  assert.equal(emptyPatch.success, false);
});
