import assert from "node:assert/strict";
import test from "node:test";
import {
  ApplyIrrigationStrategyRequestSchema,
  IrrigationStrategyIdSchema,
  IrrigationStrategyListQuerySchema,
  IrrigationStrategyListResponseSchema,
  IrrigationStrategyPathParamsSchema,
  IrrigationStrategySchema,
  StrategyApplicationIdSchema,
  StrategyApplicationPathParamsSchema,
  StrategyApplicationResponseSchema,
  StrategyApplicationSchema,
  StrategyApplicationTargetSchema,
} from "./index.js";

const createdAt = "2026-08-09T00:00:00.000Z";
const updatedAt = "2026-08-09T00:01:00.000Z";

type TargetStatus = "pending" | "acknowledged" | "failed" | "timed_out";
type ApplicationStatus = "pending" | "succeeded" | "partial" | "failed";

function validStrategyInput() {
  return {
    schemaVersion: "smartfarm.irrigation-strategy.v1",
    id: "strategy:morning-watering",
    version: 3,
    farmId: "farm:demo",
    cycleId: "cycle:basil-week-31",
    name: "Morning watering",
    description: "Apply irrigation before the daytime temperature rise.",
    pumpState: "on",
    status: "approved",
    createdAt,
    approvedAt: "2026-08-09T00:00:30.000Z",
  } as const;
}

function validTargetInput(index: number, status: TargetStatus) {
  const failure = status === "failed" || status === "timed_out";

  return {
    schemaVersion: "smartfarm.strategy-application-target.v1" as const,
    areaId: `area:bed-${index}`,
    deviceId: `device:bed-${index}`,
    commandId: `command:strategy-${index}`,
    status,
    reasonCode: failure ? (status === "timed_out" ? "expired" : "execution_failed") : null,
    resultingPumpState: status === "acknowledged" ? "on" : null,
    updatedAt,
  } as const;
}

function validApplicationInput(
  targetStatuses: readonly TargetStatus[],
  status: ApplicationStatus,
) {
  return {
    schemaVersion: "smartfarm.strategy-application.v1",
    id: "strategy-application:morning-watering-1",
    farmId: "farm:demo",
    cycleId: "cycle:basil-week-31",
    strategyId: "strategy:morning-watering",
    strategyVersion: 3,
    strategyName: "Morning watering",
    pumpState: "on",
    actor: { type: "user", id: "user:operator" },
    idempotencyKey: "apply-morning-watering-1",
    targets: targetStatuses.map((targetStatus, index) =>
      validTargetInput(index + 1, targetStatus),
    ),
    status,
    createdAt,
    updatedAt,
  } as const;
}

test("accepts branded irrigation identifiers and strict strategy wires", () => {
  const strategy = IrrigationStrategySchema.parse({
    ...validStrategyInput(),
    name: "  Morning watering  ",
  });
  const unknownStrategyField = IrrigationStrategySchema.safeParse({
    ...validStrategyInput(),
    mutable: true,
  });
  const unknownTargetField = StrategyApplicationTargetSchema.safeParse({
    ...validTargetInput(1, "pending"),
    retryCount: 0,
  });
  const unknownApplicationField = StrategyApplicationSchema.safeParse({
    ...validApplicationInput(["pending"], "pending"),
    internalState: "queued",
  });

  assert.equal(strategy.name, "Morning watering");
  assert.equal(IrrigationStrategyIdSchema.safeParse(strategy.id).success, true);
  assert.equal(
    StrategyApplicationIdSchema.safeParse(
      "strategy-application:morning-watering-1",
    ).success,
    true,
  );
  assert.equal(IrrigationStrategyIdSchema.safeParse("strategy:Morning").success, false);
  assert.equal(
    StrategyApplicationIdSchema.safeParse("application:morning-watering-1").success,
    false,
  );
  assert.equal(unknownStrategyField.success, false);
  assert.equal(unknownTargetField.success, false);
  assert.equal(unknownApplicationField.success, false);
});

test("enforces irrigation strategy approval timestamp invariants", () => {
  const draft = {
    ...validStrategyInput(),
    status: "draft" as const,
    approvedAt: null,
  };
  const approved = validStrategyInput();
  const retiredWithoutApproval = {
    ...validStrategyInput(),
    status: "retired" as const,
    approvedAt: null,
  };
  const retiredWithApproval = {
    ...validStrategyInput(),
    status: "retired" as const,
  };

  assert.equal(IrrigationStrategySchema.safeParse(draft).success, true);
  assert.equal(IrrigationStrategySchema.safeParse(approved).success, true);
  assert.equal(IrrigationStrategySchema.safeParse(retiredWithoutApproval).success, true);
  assert.equal(IrrigationStrategySchema.safeParse(retiredWithApproval).success, true);
  assert.equal(
    IrrigationStrategySchema.safeParse({
      ...draft,
      approvedAt: "2026-08-09T00:00:30.000Z",
    }).success,
    false,
  );
  assert.equal(
    IrrigationStrategySchema.safeParse({ ...approved, approvedAt: null }).success,
    false,
  );
});

test("accepts optional bounded pump run durations only for on strategies", () => {
  const legacyStrategy = IrrigationStrategySchema.parse(validStrategyInput());
  const timedStrategy = IrrigationStrategySchema.parse({
    ...validStrategyInput(),
    runDurationSeconds: 45,
  });
  const legacyApplication = StrategyApplicationSchema.parse(
    validApplicationInput(["pending"], "pending"),
  );
  const timedApplication = StrategyApplicationSchema.parse({
    ...validApplicationInput(["pending"], "pending"),
    runDurationSeconds: 45,
  });

  assert.equal(legacyStrategy.runDurationSeconds, undefined);
  assert.equal(legacyApplication.runDurationSeconds, undefined);
  assert.equal(timedStrategy.runDurationSeconds, 45);
  assert.equal(timedApplication.runDurationSeconds, 45);

  for (const runDurationSeconds of [1, 300]) {
    assert.equal(
      IrrigationStrategySchema.safeParse({
        ...validStrategyInput(),
        runDurationSeconds,
      }).success,
      true,
    );
    assert.equal(
      StrategyApplicationSchema.safeParse({
        ...validApplicationInput(["pending"], "pending"),
        runDurationSeconds,
      }).success,
      true,
    );
  }

  for (const runDurationSeconds of [0, 301, 1.5]) {
    assert.equal(
      IrrigationStrategySchema.safeParse({
        ...validStrategyInput(),
        runDurationSeconds,
      }).success,
      false,
    );
    assert.equal(
      StrategyApplicationSchema.safeParse({
        ...validApplicationInput(["pending"], "pending"),
        runDurationSeconds,
      }).success,
      false,
    );
  }

  assert.equal(
    IrrigationStrategySchema.safeParse({
      ...validStrategyInput(),
      pumpState: "off",
      runDurationSeconds: 45,
    }).success,
    false,
  );
  assert.equal(
    StrategyApplicationSchema.safeParse({
      ...validApplicationInput(["pending"], "pending"),
      pumpState: "off",
      runDurationSeconds: 45,
    }).success,
    false,
  );
});

test("enforces each strategy application target lifecycle invariant", () => {
  for (const status of ["pending", "acknowledged", "failed", "timed_out"] as const) {
    assert.equal(StrategyApplicationTargetSchema.safeParse(validTargetInput(1, status)).success, true);
  }

  assert.equal(
    StrategyApplicationTargetSchema.safeParse({
      ...validTargetInput(1, "pending"),
      reasonCode: "execution_failed",
    }).success,
    false,
  );
  assert.equal(
    StrategyApplicationTargetSchema.safeParse({
      ...validTargetInput(1, "pending"),
      resultingPumpState: "on",
    }).success,
    false,
  );
  assert.equal(
    StrategyApplicationTargetSchema.safeParse({
      ...validTargetInput(1, "acknowledged"),
      reasonCode: "execution_failed",
    }).success,
    false,
  );
  assert.equal(
    StrategyApplicationTargetSchema.safeParse({
      ...validTargetInput(1, "acknowledged"),
      resultingPumpState: null,
    }).success,
    false,
  );
  assert.equal(
    StrategyApplicationTargetSchema.safeParse({
      ...validTargetInput(1, "failed"),
      reasonCode: null,
    }).success,
    false,
  );
  assert.equal(
    StrategyApplicationTargetSchema.safeParse({
      ...validTargetInput(1, "timed_out"),
      resultingPumpState: "on",
    }).success,
    false,
  );
});

test("derives all four strategy application aggregate states", () => {
  const cases = [
    { targets: ["acknowledged", "pending"], status: "pending" },
    { targets: ["acknowledged", "acknowledged"], status: "succeeded" },
    { targets: ["failed", "timed_out"], status: "failed" },
    { targets: ["acknowledged", "failed"], status: "partial" },
  ] as const;

  for (const aggregateCase of cases) {
    const application = StrategyApplicationSchema.parse(
      validApplicationInput(aggregateCase.targets, aggregateCase.status),
    );
    const mismatchedStatus = aggregateCase.status === "pending" ? "failed" : "pending";

    assert.equal(application.status, aggregateCase.status);
    assert.equal(
      StrategyApplicationSchema.safeParse({
        ...validApplicationInput(aggregateCase.targets, aggregateCase.status),
        status: mismatchedStatus,
      }).success,
      false,
    );
  }
});

test("rejects duplicate strategy application target area, device, and command IDs", () => {
  const application = validApplicationInput(
    ["acknowledged", "acknowledged"],
    "succeeded",
  );
  const [firstTarget, secondTarget] = application.targets;

  assert.ok(firstTarget);
  assert.ok(secondTarget);
  assert.equal(
    StrategyApplicationSchema.safeParse({
      ...application,
      targets: [firstTarget, { ...secondTarget, areaId: firstTarget.areaId }],
    }).success,
    false,
  );
  assert.equal(
    StrategyApplicationSchema.safeParse({
      ...application,
      targets: [firstTarget, { ...secondTarget, deviceId: firstTarget.deviceId }],
    }).success,
    false,
  );
  assert.equal(
    StrategyApplicationSchema.safeParse({
      ...application,
      targets: [firstTarget, { ...secondTarget, commandId: firstTarget.commandId }],
    }).success,
    false,
  );
});

test("validates required strict irrigation strategy list queries and bounded responses", () => {
  const query = IrrigationStrategyListQuerySchema.parse({
    cycleId: "cycle:basil-week-31",
  });
  const response = IrrigationStrategyListResponseSchema.parse({
    schemaVersion: "smartfarm.irrigation-strategy-list.v1",
    irrigationStrategies: [validStrategyInput()],
  });

  assert.equal(query.cycleId, "cycle:basil-week-31");
  assert.equal(response.irrigationStrategies.length, 1);
  assert.equal(IrrigationStrategyListQuerySchema.safeParse({}).success, false);
  assert.equal(
    IrrigationStrategyListQuerySchema.safeParse({
      cycleId: "cycle:basil-week-31",
      limit: 20,
    }).success,
    false,
  );
  assert.equal(
    IrrigationStrategyListResponseSchema.safeParse({
      schemaVersion: "smartfarm.irrigation-strategy-list.v1",
      irrigationStrategies: Array.from({ length: 101 }, validStrategyInput),
    }).success,
    false,
  );
  assert.equal(
    IrrigationStrategyListResponseSchema.safeParse({
      schemaVersion: "smartfarm.irrigation-strategy-list.v1",
      irrigationStrategies: [validStrategyInput()],
      nextCursor: null,
    }).success,
    false,
  );
});

test("validates bounded unique strict irrigation strategy apply requests", () => {
  const request = ApplyIrrigationStrategyRequestSchema.parse({
    cycleId: "cycle:basil-week-31",
    strategyVersion: 3,
    areaIds: ["area:bed-1", "area:bed-2"],
    idempotencyKey: "  apply-morning-watering-1  ",
  });

  assert.equal(request.idempotencyKey, "apply-morning-watering-1");
  assert.equal(request.areaIds.length, 2);
  assert.equal(
    ApplyIrrigationStrategyRequestSchema.safeParse({
      cycleId: "cycle:basil-week-31",
      strategyVersion: 0,
      areaIds: ["area:bed-1"],
      idempotencyKey: "apply-001",
    }).success,
    false,
  );
  assert.equal(
    ApplyIrrigationStrategyRequestSchema.safeParse({
      cycleId: "cycle:basil-week-31",
      strategyVersion: 10_000,
      areaIds: ["area:bed-1"],
      idempotencyKey: "apply-001",
    }).success,
    false,
  );
  assert.equal(
    ApplyIrrigationStrategyRequestSchema.safeParse({
      cycleId: "cycle:basil-week-31",
      strategyVersion: 3,
      areaIds: [],
      idempotencyKey: "apply-001",
    }).success,
    false,
  );
  assert.equal(
    ApplyIrrigationStrategyRequestSchema.safeParse({
      cycleId: "cycle:basil-week-31",
      strategyVersion: 3,
      areaIds: Array.from({ length: 21 }, (_, index) => `area:bed-${index + 1}`),
      idempotencyKey: "apply-001",
    }).success,
    false,
  );
  assert.equal(
    ApplyIrrigationStrategyRequestSchema.safeParse({
      cycleId: "cycle:basil-week-31",
      strategyVersion: 3,
      areaIds: ["area:bed-1", "area:bed-1"],
      idempotencyKey: "apply-001",
    }).success,
    false,
  );
  assert.equal(
    ApplyIrrigationStrategyRequestSchema.safeParse({
      cycleId: "cycle:basil-week-31",
      strategyVersion: 3,
      areaIds: ["area:bed-1"],
      idempotencyKey: "short",
    }).success,
    false,
  );
  assert.equal(
    ApplyIrrigationStrategyRequestSchema.safeParse({
      cycleId: "cycle:basil-week-31",
      strategyVersion: 3,
      areaIds: ["area:bed-1"],
      idempotencyKey: "a".repeat(129),
    }).success,
    false,
  );
  assert.equal(
    ApplyIrrigationStrategyRequestSchema.safeParse({
      cycleId: "cycle:basil-week-31",
      strategyVersion: 3,
      areaIds: ["area:bed-1"],
      idempotencyKey: "apply-001",
      force: true,
    }).success,
    false,
  );
});

test("validates strict strategy application responses and path parameters", () => {
  const application = validApplicationInput(["pending"], "pending");
  const response = StrategyApplicationResponseSchema.parse({
    schemaVersion: "smartfarm.strategy-application-response.v1",
    strategyApplication: application,
  });
  const strategyPath = IrrigationStrategyPathParamsSchema.parse({
    farmId: "farm:demo",
    strategyId: "strategy:morning-watering",
  });
  const applicationPath = StrategyApplicationPathParamsSchema.parse({
    farmId: "farm:demo",
    applicationId: "strategy-application:morning-watering-1",
  });

  assert.equal(response.strategyApplication.status, "pending");
  assert.equal(strategyPath.strategyId, "strategy:morning-watering");
  assert.equal(
    applicationPath.applicationId,
    "strategy-application:morning-watering-1",
  );
  assert.equal(
    StrategyApplicationResponseSchema.safeParse({
      schemaVersion: "smartfarm.strategy-application-response.v1",
      strategyApplication: application,
      replayed: false,
    }).success,
    false,
  );
  assert.equal(
    IrrigationStrategyPathParamsSchema.safeParse({
      farmId: "farm:demo",
      strategyId: "application:morning-watering",
    }).success,
    false,
  );
  assert.equal(
    IrrigationStrategyPathParamsSchema.safeParse({
      farmId: "farm:demo",
      strategyId: "strategy:morning-watering",
      applicationId: "strategy-application:morning-watering-1",
    }).success,
    false,
  );
  assert.equal(
    StrategyApplicationPathParamsSchema.safeParse({
      farmId: "farm:demo",
      applicationId: "strategy:morning-watering",
    }).success,
    false,
  );
  assert.equal(
    StrategyApplicationPathParamsSchema.safeParse({
      farmId: "farm:demo",
      applicationId: "strategy-application:morning-watering-1",
      strategyId: "strategy:morning-watering",
    }).success,
    false,
  );
});
