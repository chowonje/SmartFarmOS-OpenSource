import { describe, expect, it } from "vitest";
import {
  AuditEventSchema,
  CropCycleDetailSchema,
  DeviceSchema,
} from "@smartfarm-os/contracts";
import {
  getAuditActionLabel,
  getAuditCycleName,
  getAuditDetailsLabel,
  getAuditScopeFieldLabel,
} from "./alarm-presenters";

const devices = [
  DeviceSchema.parse({
    schemaVersion: "smartfarm.device.v1",
    id: "device:bed-1",
    farmId: "farm:demo",
    name: "베드 1 컨트롤러",
    kind: "hybrid",
    capabilities: ["temperature", "humidity", "illuminance", "water_level", "pump"],
    status: "online",
    lastSeenAt: "2026-08-09T00:00:00.000Z",
  }),
];

const cropCycles = [
  CropCycleDetailSchema.parse({
    schemaVersion: "smartfarm.crop-cycle-detail.v1",
    cycle: {
      schemaVersion: "smartfarm.crop-cycle.v1",
      id: "cycle:basil-2026-08",
      farmId: "farm:demo",
      name: "8월 바질",
      cropName: "바질",
      variety: "스위트 바질",
      status: "active",
      startedAt: "2026-08-01T00:00:00.000Z",
      plannedEndAt: "2026-08-31T00:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-09T00:05:00.000Z",
    },
    areaIds: ["area:greenhouse-a"],
  }),
];

describe("alarm-presenters audit formatting", () => {
  it("renders farm-wide direct control audits with user-facing labels", () => {
    const directAudit = AuditEventSchema.parse({
      schemaVersion: "smartfarm.audit-event.v2",
      id: "audit:direct-command-completed-0001",
      farmId: "farm:demo",
      cycleId: null,
      actor: { type: "user", id: "user:demo" },
      action: "command.completed",
      targetType: "command",
      targetId: "command:pump-000001",
      result: "success",
      occurredAt: "2026-08-09T00:26:00.000Z",
      details: {
        source: "direct",
        deviceId: "device:bed-1",
        requestedAction: "set_pump_state",
        requestedPumpState: "off",
        status: "acknowledged",
        reasonCode: null,
        resultingPumpState: "off",
      },
    });

    expect(getAuditActionLabel(directAudit)).toBe("수동 제어 완료");
    expect(getAuditCycleName(directAudit, cropCycles)).toBe("농장 공통 제어");
    expect(getAuditScopeFieldLabel(directAudit)).toBe("적용 범위");
    expect(getAuditDetailsLabel(directAudit, devices)).toBe(
      "수동 펌프 끄기 · 장치 베드 1 컨트롤러 · 최종 상태 정지",
    );
  });

  it("renders failure reasons for direct control audits", () => {
    const directAudit = AuditEventSchema.parse({
      schemaVersion: "smartfarm.audit-event.v2",
      id: "audit:direct-command-completed-0002",
      farmId: "farm:demo",
      cycleId: null,
      actor: { type: "user", id: "user:demo" },
      action: "command.completed",
      targetType: "command",
      targetId: "command:pump-000002",
      result: "failure",
      occurredAt: "2026-08-09T00:27:00.000Z",
      details: {
        source: "direct",
        deviceId: "device:bed-1",
        requestedAction: "set_pump_state",
        requestedPumpState: "on",
        status: "failed",
        reasonCode: "execution_failed",
        resultingPumpState: null,
      },
    });

    expect(getAuditDetailsLabel(directAudit, devices)).toBe(
      "수동 펌프 켜기 · 장치 베드 1 컨트롤러 · 실패 이유 실행 실패",
    );
  });

  it("renders timeout reasons for direct control audits", () => {
    const directAudit = AuditEventSchema.parse({
      schemaVersion: "smartfarm.audit-event.v2",
      id: "audit:direct-command-completed-0003",
      farmId: "farm:demo",
      cycleId: null,
      actor: { type: "user", id: "user:demo" },
      action: "command.completed",
      targetType: "command",
      targetId: "command:pump-000003",
      result: "failure",
      occurredAt: "2026-08-09T00:28:00.000Z",
      details: {
        source: "direct",
        deviceId: "device:bed-1",
        requestedAction: "set_pump_state",
        requestedPumpState: "on",
        status: "timed_out",
        reasonCode: "expired",
        resultingPumpState: null,
      },
    });

    expect(getAuditDetailsLabel(directAudit, devices)).toBe(
      "수동 펌프 켜기 · 장치 베드 1 컨트롤러 · 실패 이유 만료됨",
    );
  });
});
