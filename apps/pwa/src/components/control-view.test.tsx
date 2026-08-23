import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CommandProjectionSchema,
  DeviceSchema,
  FarmControlProfileSchema,
  FarmSchema,
} from "@smartfarm-os/contracts";
import type { CommandViewState } from "./page-state";
import {
  ControlView,
  createControlProfileDraft,
  isControlProfileEnableDisabled,
  MAX_FARM_CONTROL_WIDGETS,
} from "./control-view";

const farm = FarmSchema.parse({
  schemaVersion: "smartfarm.farm.v1",
  id: "farm:demo",
  name: "대회 데모 농장",
  timezone: "Asia/Seoul",
  createdAt: "2026-08-09T00:00:00.000Z",
});

const device = DeviceSchema.parse({
  schemaVersion: "smartfarm.device.v1",
  id: "device:bed-1",
  farmId: "farm:demo",
  name: "베드 1 컨트롤러",
  kind: "hybrid",
  capabilities: ["pump"],
  status: "online",
  lastSeenAt: "2026-08-09T00:00:00.000Z",
});

const offProjection = CommandProjectionSchema.parse({
  schemaVersion: "smartfarm.command-projection.v1",
  command: {
    schemaVersion: "smartfarm.command.v1",
    id: "command:pump-off",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    payload: { action: "set_pump_state", state: "off" },
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "pwa-pump-off",
    issuedAt: "2026-08-09T00:00:00.000Z",
    expiresAt: "2026-08-09T00:01:00.000Z",
  },
  status: "acknowledged",
  ack: {
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: "command:pump-off",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: "off" },
    processedAt: "2026-08-09T00:00:01.000Z",
  },
  updatedAt: "2026-08-09T00:00:01.000Z",
});

const controlProfile = FarmControlProfileSchema.parse({
  schemaVersion: "smartfarm.farm-control-profile.v1",
  farmId: "farm:demo",
  revision: 1,
  widgets: [{
    schemaVersion: "smartfarm.farm-control-widget.v1",
    kind: "pump_control",
    deviceId: "device:bed-1",
    label: "육묘동 급수",
    showStart: false,
  }],
  updatedAt: "2026-08-10T00:00:00.000Z",
});

const controlProfileState = {
  profile: controlProfile,
  loading: false,
  refreshing: false,
  saving: false,
  error: null,
  notice: null,
} as const;

describe("ControlView", () => {
  it("keeps software stop available even when the last visible pump state is off", () => {
    const html = renderToStaticMarkup(
      <ControlView
        farm={farm}
        device={device}
        devices={[device]}
        online={true}
        command={{
          projection: offProjection,
          requestedState: null,
          busy: false,
          error: null,
        }}
        controlProfile={controlProfileState}
        onSelectDevice={() => {}}
        onRequestPumpState={() => {}}
        onRefreshControlProfile={() => {}}
        onSaveControlProfile={async () => true}
      />,
    );

    expect(html).toContain("즉시 정지 (소프트웨어)");
    expect(html).toContain("물리 비상정지 버튼이나 안전 인터록을 대체하지 않습니다.");
    expect(html).toContain('aria-describedby="software-stop-note"');
    expect(html).not.toMatch(/data-testid="pump-off"[^>]*disabled=""/);
  });

  it("disables software stop while a request is in flight or no device is selected", () => {
    const busyState: CommandViewState = {
      projection: null,
      requestedState: "off",
      busy: true,
      error: null,
    };
    const busyHtml = renderToStaticMarkup(
      <ControlView
        farm={farm}
        device={device}
        devices={[device]}
        online={true}
        command={busyState}
        controlProfile={controlProfileState}
        onSelectDevice={() => {}}
        onRequestPumpState={() => {}}
        onRefreshControlProfile={() => {}}
        onSaveControlProfile={async () => true}
      />,
    );
    expect(busyHtml).toMatch(/data-testid="pump-off"[^>]*disabled=""/);

    const missingDeviceHtml = renderToStaticMarkup(
      <ControlView
        farm={farm}
        device={null}
        devices={[device]}
        online={true}
        command={{
          projection: null,
          requestedState: null,
          busy: false,
          error: null,
        }}
        controlProfile={controlProfileState}
        onSelectDevice={() => {}}
        onRequestPumpState={() => {}}
        onRefreshControlProfile={() => {}}
        onSaveControlProfile={async () => true}
      />,
    );
    expect(missingDeviceHtml).toMatch(/data-testid="pump-off"[^>]*disabled=""/);
  });

  it("uses the farm-specific label while keeping stop visible when start is hidden", () => {
    const html = renderToStaticMarkup(
      <ControlView
        farm={farm}
        device={device}
        devices={[device]}
        online={true}
        command={{ projection: offProjection, requestedState: null, busy: false, error: null }}
        controlProfile={controlProfileState}
        onSelectDevice={() => {}}
        onRequestPumpState={() => {}}
        onRefreshControlProfile={() => {}}
        onSaveControlProfile={async () => true}
      />,
    );

    expect(html).toContain("육묘동 급수");
    expect(html).toContain("농장별 개인화");
    expect(html).toContain("소프트웨어 정지");
    expect(html).toContain("숨길 수 없습니다");
    expect(html).not.toContain('data-testid="pump-on"');
  });

  it("creates an editable draft only for pump-capable devices", () => {
    const sensor = DeviceSchema.parse({
      ...device,
      id: "device:sensor-only",
      name: "온도 센서",
      kind: "sensor",
      capabilities: ["temperature"],
    });

    expect(createControlProfileDraft([device, sensor], controlProfile)).toEqual([
      {
        deviceId: device.id,
        enabled: true,
        label: "육묘동 급수",
        showStart: false,
      },
    ]);
  });

  it("prevents adding a seventeenth control card while preserving enabled rows", () => {
    expect(isControlProfileEnableDisabled(false, MAX_FARM_CONTROL_WIDGETS)).toBe(true);
    expect(isControlProfileEnableDisabled(false, MAX_FARM_CONTROL_WIDGETS - 1)).toBe(false);
    expect(isControlProfileEnableDisabled(true, MAX_FARM_CONTROL_WIDGETS)).toBe(false);
  });
});
