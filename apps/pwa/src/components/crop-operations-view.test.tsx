import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AlarmInstanceSchema,
  CommandProjectionSchema,
  CropCycleDetailSchema,
  DeviceSchema,
  FarmSchema,
  GrowingAreaSchema,
  IrrigationStrategySchema,
  LatestTelemetryResponseSchema,
  StrategyApplicationSchema,
  TelemetrySchema,
  type Telemetry,
} from "@smartfarm-os/contracts";
import {
  createEmptyAreaTelemetryComparisonState,
  createEmptyIrrigationStrategyViewState,
  type AreaTelemetryComparisonState,
  type CommandHistoryViewState,
  type IrrigationStrategyViewState,
} from "./page-state";
import { CropOperationsView } from "./crop-operations-view";

const farm = FarmSchema.parse({
  schemaVersion: "smartfarm.farm.v1",
  id: "farm:demo",
  name: "대회 데모 농장",
  timezone: "Asia/Seoul",
  createdAt: "2026-08-09T00:00:00.000Z",
});

const devices = [
  DeviceSchema.parse({
    schemaVersion: "smartfarm.device.v1",
    id: "device:bed-1",
    farmId: "farm:demo",
    name: "베드 1 컨트롤러",
    kind: "hybrid",
    capabilities: ["temperature", "humidity", "illuminance", "water_level", "pump", "timed_pump"],
    status: "online",
    lastSeenAt: "2026-08-09T00:00:00.000Z",
  }),
  DeviceSchema.parse({
    schemaVersion: "smartfarm.device.v1",
    id: "device:bed-2",
    farmId: "farm:demo",
    name: "베드 2 컨트롤러",
    kind: "hybrid",
    capabilities: ["temperature", "humidity", "illuminance", "water_level", "pump", "timed_pump"],
    status: "degraded",
    lastSeenAt: "2026-08-09T00:00:00.000Z",
  }),
  DeviceSchema.parse({
    schemaVersion: "smartfarm.device.v1",
    id: "device:other",
    farmId: "farm:demo",
    name: "기타 장치",
    kind: "hybrid",
    capabilities: ["pump"],
    status: "online",
    lastSeenAt: "2026-08-09T00:00:00.000Z",
  }),
];

const areas = [
  GrowingAreaSchema.parse({
    schemaVersion: "smartfarm.growing-area.v1",
    id: "area:greenhouse-a",
    farmId: "farm:demo",
    name: "온실 A",
    kind: "greenhouse",
    primaryDeviceId: "device:bed-1",
    status: "active",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:05:00.000Z",
  }),
  GrowingAreaSchema.parse({
    schemaVersion: "smartfarm.growing-area.v1",
    id: "area:greenhouse-b",
    farmId: "farm:demo",
    name: "온실 B",
    kind: "greenhouse",
    primaryDeviceId: "device:bed-2",
    status: "active",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:05:00.000Z",
  }),
  GrowingAreaSchema.parse({
    schemaVersion: "smartfarm.growing-area.v1",
    id: "area:greenhouse-c",
    farmId: "farm:demo",
    name: "온실 C",
    kind: "greenhouse",
    primaryDeviceId: "device:other",
    status: "inactive",
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:05:00.000Z",
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
    areaIds: ["area:greenhouse-a", "area:greenhouse-b"],
  }),
  CropCycleDetailSchema.parse({
    schemaVersion: "smartfarm.crop-cycle-detail.v1",
    cycle: {
      schemaVersion: "smartfarm.crop-cycle.v1",
      id: "cycle:lettuce-2026-08",
      farmId: "farm:demo",
      name: "8월 상추",
      cropName: "상추",
      variety: "청치마",
      status: "planned",
      startedAt: null,
      plannedEndAt: "2026-09-10T00:00:00.000Z",
      createdAt: "2026-08-02T00:00:00.000Z",
      updatedAt: "2026-08-09T00:05:00.000Z",
    },
    areaIds: ["area:greenhouse-c"],
  }),
];

const activeAlarms = [
  AlarmInstanceSchema.parse({
    schemaVersion: "smartfarm.alarm-instance.v1",
    id: "alarm:bed-1-temperature",
    farmId: "farm:demo",
    ruleId: "alarm-rule:bed-1-temperature",
    cycleId: "cycle:basil-2026-08",
    areaId: "area:greenhouse-a",
    deviceId: "device:bed-1",
    ruleName: "온실 A 온도 상한",
    metric: "temperature",
    comparison: "above",
    threshold: 28,
    severity: "critical",
    state: "active",
    triggerTelemetryId: "telemetry:bed-1-000011",
    lastTelemetryId: "telemetry:bed-1-000013",
    openedAt: "2026-08-09T00:10:00.000Z",
    lastObservedAt: "2026-08-09T00:15:00.000Z",
    lastValue: 31.4,
    clearedAt: null,
    acknowledgement: null,
    updatedAt: "2026-08-09T00:15:00.000Z",
  }),
  AlarmInstanceSchema.parse({
    schemaVersion: "smartfarm.alarm-instance.v1",
    id: "alarm:bed-2-low-water",
    farmId: "farm:demo",
    ruleId: "alarm-rule:bed-2-low-water",
    cycleId: "cycle:basil-2026-08",
    areaId: "area:greenhouse-b",
    deviceId: "device:bed-2",
    ruleName: "온실 B 저수위",
    metric: "water_level",
    comparison: "below",
    threshold: 52,
    severity: "critical",
    state: "active",
    triggerTelemetryId: "telemetry:bed-2-water-000011",
    lastTelemetryId: "telemetry:bed-2-water-000013",
    openedAt: "2026-08-09T00:11:00.000Z",
    lastObservedAt: "2026-08-09T00:16:00.000Z",
    lastValue: 49,
    clearedAt: null,
    acknowledgement: null,
    updatedAt: "2026-08-09T00:16:00.000Z",
  }),
];

describe("CropOperationsView", () => {
  it("renders two area comparison cards with eight metrics, eight sparklines, and filtered command rows", () => {
    const html = renderToStaticMarkup(
      <CropOperationsView
        farm={farm}
        devices={devices}
        areas={areas}
        cropCycles={cropCycles}
        activeAlarms={activeAlarms}
        areaComparison={buildAreaComparisonState()}
        irrigation={buildIrrigationState()}
        commandHistory={buildCommandHistory()}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        loading={false}
        refreshing={false}
        error={null}
        online={true}
        nowMs={Date.parse("2026-08-09T00:00:20.000Z")}
        selectedCycleId="cycle:basil-2026-08"
        onSelectCycle={() => {}}
        onSelectIrrigationStrategy={() => {}}
        onToggleIrrigationArea={() => {}}
        onConfirmIrrigationApplication={() => {}}
        onApplyIrrigationStrategy={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(countOccurrences(html, 'data-testid="operations-comparison-area"')).toBe(2);
    expect(countOccurrences(html, 'data-testid="operations-comparison-metric-')).toBe(8);
    expect(countOccurrences(html, 'data-testid="operations-comparison-value"')).toBe(8);
    expect(countOccurrences(html, 'class="telemetry-chart comparison-sparkline"')).toBe(8);
    expect(countOccurrences(html, 'data-testid="operations-command-row"')).toBe(2);
    expect(html).toContain("제어 완료");
    expect(html).toContain("제어 실패");
    expect(html).toContain("실행 실패");
    expect(html).toContain("31.4 °C");
    expect(html).toContain("70 %");
    expect(html).not.toContain("기타 장치");
    expect(html).toContain('data-testid="operations-irrigation"');
    expect(html).toContain('data-testid="irrigation-safety-note"');
    expect(countOccurrences(html, 'data-testid="irrigation-area-option"')).toBe(2);
  });

  it("renders manual stop language and linked stop request in command history and target results", () => {
    const commandHistory: CommandHistoryViewState = {
      loading: false,
      refreshing: false,
      error: null,
      items: [
        CommandProjectionSchema.parse({
          schemaVersion: "smartfarm.command-projection.v1",
          command: {
            schemaVersion: "smartfarm.command.v2",
            id: "command:strategy-b",
            farmId: "farm:demo",
            deviceId: "device:bed-2",
            payload: { action: "run_pump_for", durationSeconds: 5 },
            actor: { type: "user", id: "user:demo" },
            idempotencyKey: "pwa-strategy-b",
            issuedAt: "2026-08-09T00:09:00.000Z",
            expiresAt: "2026-08-09T00:10:00.000Z",
          },
          status: "failed",
          ack: {
            schemaVersion: "smartfarm.command-ack.v2",
            commandId: "command:strategy-b",
            farmId: "farm:demo",
            deviceId: "device:bed-2",
            status: "failed",
            reasonCode: "manual_stop",
            result: null,
            causedByCommandId: "command:manual-stop-000001",
            processedAt: "2026-08-09T00:09:03.000Z",
          },
          updatedAt: "2026-08-09T00:09:03.000Z",
        }),
        ...buildCommandHistory().items,
      ],
    };
    const irrigation = {
      ...buildIrrigationState("partial", 5),
      application: StrategyApplicationSchema.parse({
        ...buildIrrigationState("partial", 5).application!,
        targets: [
          buildIrrigationState("partial", 5).application!.targets[0]!,
          {
            ...buildIrrigationState("partial", 5).application!.targets[1]!,
            commandId: "command:strategy-b",
            reasonCode: "manual_stop",
          },
        ],
      }),
    };

    const html = renderToStaticMarkup(
      <CropOperationsView
        farm={farm}
        devices={devices}
        areas={areas}
        cropCycles={cropCycles}
        activeAlarms={activeAlarms}
        areaComparison={buildAreaComparisonState()}
        irrigation={irrigation}
        commandHistory={commandHistory}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        loading={false}
        refreshing={false}
        error={null}
        online={true}
        nowMs={Date.parse("2026-08-09T00:00:20.000Z")}
        selectedCycleId="cycle:basil-2026-08"
        onSelectCycle={() => {}}
        onSelectIrrigationStrategy={() => {}}
        onToggleIrrigationArea={() => {}}
        onConfirmIrrigationApplication={() => {}}
        onApplyIrrigationStrategy={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(html).toContain("사용자 즉시 정지");
    expect(html).toContain("사용자 즉시 정지로 중단");
    expect(html).toContain("연결된 정지 요청 manual-stop-000001");
    expect(html).toContain("즉시 정지 연결");
    expect(html).toContain("사용자 정지로 조기 종료");
  });

  it("renders stale, offline, empty, and error text explicitly", () => {
    const base = buildAreaComparisonState();
    const comparison: AreaTelemetryComparisonState = {
      ...base,
      items: [
        {
          ...base.items[0]!,
          metrics: {
            ...base.items[0]!.metrics,
            temperature: metricState("temperature", {
              latestAt: "2026-08-09T00:00:00.000Z",
              latestValue: 24.5,
              points: [24.5],
            }),
            humidity: metricState("humidity", {
              latestAt: null,
              latestValue: null,
              points: [],
            }),
            illuminance: metricState("illuminance", {
              latestAt: null,
              latestValue: null,
              points: [],
              loading: true,
            }),
            water_level: metricState("water_level", {
              latestAt: null,
              latestValue: null,
              points: [],
              error: "센서 응답이 없습니다.",
            }),
          },
        },
        ...base.items.slice(1),
      ],
    };

    const renderComparison = (online: boolean) => renderToStaticMarkup(
      <CropOperationsView
        farm={farm}
        devices={devices}
        areas={areas}
        cropCycles={cropCycles}
        activeAlarms={activeAlarms}
        areaComparison={comparison}
        irrigation={buildIrrigationState()}
        commandHistory={{
          items: [],
          loading: false,
          refreshing: false,
          error: "명령 이력을 가져오지 못했습니다.",
        }}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        loading={false}
        refreshing={false}
        error={null}
        online={online}
        nowMs={Date.parse("2026-08-09T00:00:25.000Z")}
        selectedCycleId="cycle:basil-2026-08"
        onSelectCycle={() => {}}
        onSelectIrrigationStrategy={() => {}}
        onToggleIrrigationArea={() => {}}
        onConfirmIrrigationApplication={() => {}}
        onApplyIrrigationStrategy={() => {}}
        onRefresh={() => {}}
      />,
    );
    const onlineHtml = renderComparison(true);
    const html = renderComparison(false);

    expect(onlineHtml).toContain("20초 경과");
    expect(html).toContain("오프라인 · 마지막 값");
    expect(html).toContain("값 없음");
    expect(html).toContain("불러오는 중");
    expect(html).toContain("센서 응답이 없습니다.");
    expect(html).toContain("오프라인 상태로 마지막 비교 값을 표시합니다.");
    expect(html).toContain("명령 이력을 가져오지 못했습니다.");
    expect(html).toContain("오프라인 상태에서는 관수 전략을 적용할 수 없습니다.");
    expect(html).toContain('data-testid="operations-comparison-value">--<');
  });

  it("renders empty states when no cycle comparison or command history is available", () => {
    const html = renderToStaticMarkup(
      <CropOperationsView
        farm={farm}
        devices={devices}
        areas={areas}
        cropCycles={cropCycles}
        activeAlarms={[]}
        areaComparison={createEmptyAreaTelemetryComparisonState()}
        irrigation={createEmptyIrrigationStrategyViewState()}
        commandHistory={{
          items: [],
          loading: false,
          refreshing: false,
          error: null,
        }}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        loading={false}
        refreshing={false}
        error={null}
        online={true}
        nowMs={Date.parse("2026-08-09T00:00:20.000Z")}
        selectedCycleId="cycle:basil-2026-08"
        onSelectCycle={() => {}}
        onSelectIrrigationStrategy={() => {}}
        onToggleIrrigationArea={() => {}}
        onConfirmIrrigationApplication={() => {}}
        onApplyIrrigationStrategy={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(html).toContain("비교할 대표 장치가 없습니다.");
    expect(html).toContain("표시할 제어 이력이 없습니다.");
    expect(html).toContain("표시할 관수 전략이 없습니다.");
  });

  it("renders irrigation disabled states for offline and planned cycles", () => {
    const planned = renderToStaticMarkup(
      <CropOperationsView
        farm={farm}
        devices={devices}
        areas={areas}
        cropCycles={cropCycles}
        activeAlarms={[]}
        areaComparison={buildAreaComparisonState()}
        irrigation={buildIrrigationState()}
        commandHistory={buildCommandHistory()}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        loading={false}
        refreshing={false}
        error={null}
        online={true}
        nowMs={Date.parse("2026-08-09T00:00:20.000Z")}
        selectedCycleId="cycle:lettuce-2026-08"
        onSelectCycle={() => {}}
        onSelectIrrigationStrategy={() => {}}
        onToggleIrrigationArea={() => {}}
        onConfirmIrrigationApplication={() => {}}
        onApplyIrrigationStrategy={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(planned).toContain("운영 중인 재배 주기에서만 적용할 수 있습니다.");

    const offline = renderToStaticMarkup(
      <CropOperationsView
        farm={farm}
        devices={devices}
        areas={areas}
        cropCycles={cropCycles}
        activeAlarms={[]}
        areaComparison={buildAreaComparisonState()}
        irrigation={buildIrrigationState()}
        commandHistory={buildCommandHistory()}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        loading={false}
        refreshing={false}
        error={null}
        online={false}
        nowMs={Date.parse("2026-08-09T00:00:20.000Z")}
        selectedCycleId="cycle:basil-2026-08"
        onSelectCycle={() => {}}
        onSelectIrrigationStrategy={() => {}}
        onToggleIrrigationArea={() => {}}
        onConfirmIrrigationApplication={() => {}}
        onApplyIrrigationStrategy={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(offline).toContain("오프라인");
    expect(offline).toContain("irrigation-apply");
  });

  it("renders irrigation application pending, succeeded, and partial target results", () => {
    const pending = renderToStaticMarkup(
      <CropOperationsView
        farm={farm}
        devices={devices}
        areas={areas}
        cropCycles={cropCycles}
        activeAlarms={[]}
        areaComparison={buildAreaComparisonState()}
        irrigation={buildIrrigationState("pending")}
        commandHistory={buildCommandHistory()}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        loading={false}
        refreshing={false}
        error={null}
        online={true}
        nowMs={Date.parse("2026-08-09T00:00:20.000Z")}
        selectedCycleId="cycle:basil-2026-08"
        onSelectCycle={() => {}}
        onSelectIrrigationStrategy={() => {}}
        onToggleIrrigationArea={() => {}}
        onConfirmIrrigationApplication={() => {}}
        onApplyIrrigationStrategy={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(pending).toContain("적용 중");
    expect(countOccurrences(pending, 'data-testid="irrigation-target-result"')).toBe(2);

    const succeeded = renderToStaticMarkup(
      <CropOperationsView
        farm={farm}
        devices={devices}
        areas={areas}
        cropCycles={cropCycles}
        activeAlarms={[]}
        areaComparison={buildAreaComparisonState()}
        irrigation={buildIrrigationState("succeeded")}
        commandHistory={buildCommandHistory()}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        loading={false}
        refreshing={false}
        error={null}
        online={true}
        nowMs={Date.parse("2026-08-09T00:00:20.000Z")}
        selectedCycleId="cycle:basil-2026-08"
        onSelectCycle={() => {}}
        onSelectIrrigationStrategy={() => {}}
        onToggleIrrigationArea={() => {}}
        onConfirmIrrigationApplication={() => {}}
        onApplyIrrigationStrategy={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(succeeded).toContain("적용 완료");

    const partial = renderToStaticMarkup(
      <CropOperationsView
        farm={farm}
        devices={devices}
        areas={areas}
        cropCycles={cropCycles}
        activeAlarms={[]}
        areaComparison={buildAreaComparisonState()}
        irrigation={buildIrrigationState("partial")}
        commandHistory={buildCommandHistory()}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        loading={false}
        refreshing={false}
        error={null}
        online={true}
        nowMs={Date.parse("2026-08-09T00:00:20.000Z")}
        selectedCycleId="cycle:basil-2026-08"
        onSelectCycle={() => {}}
        onSelectIrrigationStrategy={() => {}}
        onToggleIrrigationArea={() => {}}
        onConfirmIrrigationApplication={() => {}}
        onApplyIrrigationStrategy={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(partial).toContain("일부 실패");
    expect(partial).toContain("실행 실패");
  });

  it("keeps an accepted pending application visible and blocks duplicate apply after poll failure", () => {
    const interrupted = renderToStaticMarkup(
      <CropOperationsView
        farm={farm}
        devices={devices}
        areas={areas}
        cropCycles={cropCycles}
        activeAlarms={[]}
        areaComparison={buildAreaComparisonState()}
        irrigation={{
          ...buildIrrigationState("pending"),
          applying: false,
          applicationError: "적용 요청은 접수되었지만 상태 확인이 중단되었습니다.",
        }}
        commandHistory={buildCommandHistory()}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        loading={false}
        refreshing={false}
        error={null}
        online={true}
        nowMs={Date.parse("2026-08-09T00:00:20.000Z")}
        selectedCycleId="cycle:basil-2026-08"
        onSelectCycle={() => {}}
        onSelectIrrigationStrategy={() => {}}
        onToggleIrrigationArea={() => {}}
        onConfirmIrrigationApplication={() => {}}
        onApplyIrrigationStrategy={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(interrupted).toContain("적용 요청은 접수되었지만 상태 확인이 중단되었습니다.");
    expect(interrupted).toContain("결과 확인 대기");
    expect(interrupted).toContain("장치 응답 대기");
    expect(interrupted).toMatch(/data-testid="irrigation-strategy-select" disabled=""/);
    expect(interrupted).toMatch(/disabled="" checked="" value="area:greenhouse-a"/);
    expect(interrupted).toMatch(/disabled="" checked="" value="area:greenhouse-b"/);
    expect(interrupted).toMatch(/data-testid="irrigation-apply" disabled=""/);
    expect(interrupted).toMatch(/data-testid="irrigation-application-status"[\s\S]*?<strong>적용 중<\/strong>/);
  });

  it("disables strategy apply when a selected representative device loses pump eligibility", () => {
    const deviceWithoutPump = DeviceSchema.parse({
      ...devices[0],
      capabilities: ["temperature"],
    });
    const ineligible = renderToStaticMarkup(
      <CropOperationsView
        farm={farm}
        devices={[deviceWithoutPump, ...devices.slice(1)]}
        areas={areas}
        cropCycles={cropCycles}
        activeAlarms={[]}
        areaComparison={buildAreaComparisonState()}
        irrigation={{
          ...buildIrrigationState(),
          selectedAreaIds: [areas[0]!.id],
        }}
        commandHistory={buildCommandHistory()}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        loading={false}
        refreshing={false}
        error={null}
        online={true}
        nowMs={Date.parse("2026-08-09T00:00:20.000Z")}
        selectedCycleId="cycle:basil-2026-08"
        onSelectCycle={() => {}}
        onSelectIrrigationStrategy={() => {}}
        onToggleIrrigationArea={() => {}}
        onConfirmIrrigationApplication={() => {}}
        onApplyIrrigationStrategy={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(ineligible).toContain("펌프 미지원 장치");
    expect(ineligible).toMatch(/data-testid="irrigation-apply" disabled=""/);
  });

  it("requires explicit target confirmation, shows low-water evidence, and blocks immediate repeat", () => {
    const renderIrrigation = (
      state: IrrigationStrategyViewState,
      alarms = activeAlarms,
    ) => renderToStaticMarkup(
      <CropOperationsView
        farm={farm}
        devices={devices}
        areas={areas}
        cropCycles={cropCycles}
        activeAlarms={alarms}
        areaComparison={buildAreaComparisonState()}
        irrigation={state}
        commandHistory={buildCommandHistory()}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        loading={false}
        refreshing={false}
        error={null}
        online={true}
        nowMs={Date.parse("2026-08-09T00:00:20.000Z")}
        selectedCycleId="cycle:basil-2026-08"
        onSelectCycle={() => {}}
        onSelectIrrigationStrategy={() => {}}
        onToggleIrrigationArea={() => {}}
        onConfirmIrrigationApplication={() => {}}
        onApplyIrrigationStrategy={() => {}}
        onRefresh={() => {}}
      />,
    );

    const wrongTarget = renderIrrigation({
      ...buildIrrigationState(),
      selectedAreaIds: [areas[0]!.id],
      applicationConfirmed: false,
    });
    expect(wrongTarget).toContain("관수 검토 근거: 현재 저수위 알람");
    expect(wrongTarget).toContain("온실 A은(는) 최근 저수위 알람 대상이 아닙니다.");
    expect(wrongTarget).toMatch(/data-testid="irrigation-apply" disabled=""/);

    const confirmedTarget = renderIrrigation({
      ...buildIrrigationState(),
      selectedAreaIds: [areas[1]!.id],
      applicationConfirmed: true,
    });
    expect(confirmedTarget).toContain("온실 B 선택과 펌프 켜기에 자동 정지가 없음");
    expect(confirmedTarget).not.toMatch(/data-testid="irrigation-apply" disabled=""/);

    const completedWithoutReconfirmation = renderIrrigation({
      ...buildIrrigationState("succeeded"),
      selectedAreaIds: [areas[1]!.id],
      applicationConfirmed: false,
    });
    expect(completedWithoutReconfirmation).toContain("적용 완료");
    expect(completedWithoutReconfirmation).toMatch(/data-testid="irrigation-apply" disabled=""/);
  });

  it("shows the timed-device boundary and final off evidence", () => {
    const state = {
      ...buildIrrigationState("succeeded", 5),
      selectedAreaIds: [areas[1]!.id],
      applicationConfirmed: true,
    };
    const timed = renderToStaticMarkup(
      <CropOperationsView
        farm={farm}
        devices={devices}
        areas={areas}
        cropCycles={cropCycles}
        activeAlarms={activeAlarms}
        areaComparison={buildAreaComparisonState()}
        irrigation={state}
        commandHistory={buildCommandHistory()}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        loading={false}
        refreshing={false}
        error={null}
        online={true}
        nowMs={Date.parse("2026-08-09T00:00:20.000Z")}
        selectedCycleId="cycle:basil-2026-08"
        onSelectCycle={() => {}}
        onSelectIrrigationStrategy={() => {}}
        onToggleIrrigationArea={() => {}}
        onConfirmIrrigationApplication={() => {}}
        onApplyIrrigationStrategy={() => {}}
        onRefresh={() => {}}
      />,
    );

    expect(timed).toContain("5초 후 장치 로컬 종료");
    expect(timed).toContain("물리 인터록, 실장비 검증");
    expect(timed).toContain("온실 B 선택과 5초 시간제 실행과 물리 인터록 미검증");
    expect(timed).toContain("5초 설정 · 최종 off 확인");

    const devicesWithoutTimedPump = devices.map((device) => device.id !== "device:bed-2"
      ? device
      : DeviceSchema.parse({
        ...device,
        capabilities: device.capabilities.filter((capability) => capability !== "timed_pump"),
      }));
    const unsupported = renderToStaticMarkup(
      <CropOperationsView
        farm={farm}
        devices={devicesWithoutTimedPump}
        areas={areas}
        cropCycles={cropCycles}
        activeAlarms={activeAlarms}
        areaComparison={buildAreaComparisonState()}
        irrigation={{ ...buildIrrigationState(null, 5), selectedAreaIds: [areas[1]!.id] }}
        commandHistory={buildCommandHistory()}
        alarmsLoading={false}
        alarmsRefreshing={false}
        alarmsError={null}
        loading={false}
        refreshing={false}
        error={null}
        online={true}
        nowMs={Date.parse("2026-08-09T00:00:20.000Z")}
        selectedCycleId="cycle:basil-2026-08"
        onSelectCycle={() => {}}
        onSelectIrrigationStrategy={() => {}}
        onToggleIrrigationArea={() => {}}
        onConfirmIrrigationApplication={() => {}}
        onApplyIrrigationStrategy={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(unsupported).toContain("장치 로컬 시간제 종료 미지원");
    expect(unsupported).toMatch(/data-testid="irrigation-apply" disabled=""/);
  });
});

function buildAreaComparisonState(): AreaTelemetryComparisonState {
  return {
    loading: false,
    refreshing: false,
    error: null,
    items: [
      {
        areaId: areas[0]!.id,
        areaName: "온실 A",
        areaKind: "greenhouse",
        areaStatus: "active",
        deviceId: devices[0]!.id,
        deviceName: "베드 1 컨트롤러",
        deviceStatus: "online",
        metrics: {
          temperature: metricState("temperature", { latestAt: "2026-08-09T00:00:10.000Z", latestValue: 31.4, points: [29.8, 30.6, 31.4] }),
          humidity: metricState("humidity", { latestAt: "2026-08-09T00:00:12.000Z", latestValue: 70, points: [68, 69, 70] }),
          illuminance: metricState("illuminance", { latestAt: "2026-08-09T00:00:14.000Z", latestValue: 1450, points: [1200, 1320, 1450] }),
          water_level: metricState("water_level", { latestAt: "2026-08-09T00:00:15.000Z", latestValue: 54, points: [52, 53, 54] }),
        },
      },
      {
        areaId: areas[1]!.id,
        areaName: "온실 B",
        areaKind: "greenhouse",
        areaStatus: "active",
        deviceId: devices[1]!.id,
        deviceName: "베드 2 컨트롤러",
        deviceStatus: "degraded",
        metrics: {
          temperature: metricState("temperature", { latestAt: "2026-08-09T00:00:11.000Z", latestValue: 26.1, points: [25.4, 25.8, 26.1] }),
          humidity: metricState("humidity", { latestAt: "2026-08-09T00:00:13.000Z", latestValue: 61.2, points: [60.1, 60.8, 61.2] }),
          illuminance: metricState("illuminance", { latestAt: "2026-08-09T00:00:16.000Z", latestValue: 980, points: [910, 950, 980] }),
          water_level: metricState("water_level", { latestAt: "2026-08-09T00:00:17.000Z", latestValue: 49, points: [48, 48.5, 49] }),
        },
      },
      {
        areaId: areas[2]!.id,
        areaName: "온실 C",
        areaKind: "greenhouse",
        areaStatus: "inactive",
        deviceId: devices[2]!.id,
        deviceName: "기타 장치",
        deviceStatus: "online",
        metrics: {
          temperature: metricState("temperature", { latestAt: "2026-08-09T00:00:10.000Z", latestValue: 20, points: [20] }),
          humidity: metricState("humidity", { latestAt: "2026-08-09T00:00:10.000Z", latestValue: 50, points: [50] }),
          illuminance: metricState("illuminance", { latestAt: "2026-08-09T00:00:10.000Z", latestValue: 500, points: [500] }),
          water_level: metricState("water_level", { latestAt: "2026-08-09T00:00:10.000Z", latestValue: 40, points: [40] }),
        },
      },
    ],
  };
}

function buildCommandHistory(): CommandHistoryViewState {
  return {
    loading: false,
    refreshing: false,
    error: null,
    items: [
      CommandProjectionSchema.parse({
        schemaVersion: "smartfarm.command-projection.v1",
        command: {
          schemaVersion: "smartfarm.command.v1",
          id: "command:pump-a",
          farmId: "farm:demo",
          deviceId: "device:bed-1",
          payload: { action: "set_pump_state", state: "on" },
          actor: { type: "user", id: "user:demo" },
          idempotencyKey: "pwa-pump-a",
          issuedAt: "2026-08-09T00:00:00.000Z",
          expiresAt: "2026-08-09T00:01:00.000Z",
        },
        status: "acknowledged",
        ack: {
          schemaVersion: "smartfarm.command-ack.v1",
          commandId: "command:pump-a",
          farmId: "farm:demo",
          deviceId: "device:bed-1",
          status: "acknowledged",
          reasonCode: null,
          result: { pumpState: "on" },
          processedAt: "2026-08-09T00:00:10.000Z",
        },
        updatedAt: "2026-08-09T00:00:10.000Z",
      }),
      CommandProjectionSchema.parse({
        schemaVersion: "smartfarm.command-projection.v1",
        command: {
          schemaVersion: "smartfarm.command.v1",
          id: "command:pump-ignore",
          farmId: "farm:demo",
          deviceId: "device:other",
          payload: { action: "set_pump_state", state: "off" },
          actor: { type: "user", id: "user:demo" },
          idempotencyKey: "pwa-pump-ignore",
          issuedAt: "2026-08-09T00:02:00.000Z",
          expiresAt: "2026-08-09T00:03:00.000Z",
        },
        status: "pending",
        ack: null,
        updatedAt: "2026-08-09T00:02:00.000Z",
      }),
      CommandProjectionSchema.parse({
        schemaVersion: "smartfarm.command-projection.v1",
        command: {
          schemaVersion: "smartfarm.command.v1",
          id: "command:pump-b",
          farmId: "farm:demo",
          deviceId: "device:bed-2",
          payload: { action: "set_pump_state", state: "off" },
          actor: { type: "user", id: "user:demo" },
          idempotencyKey: "pwa-pump-b",
          issuedAt: "2026-08-09T00:03:00.000Z",
          expiresAt: "2026-08-09T00:04:00.000Z",
        },
        status: "failed",
        ack: {
          schemaVersion: "smartfarm.command-ack.v1",
          commandId: "command:pump-b",
          farmId: "farm:demo",
          deviceId: "device:bed-2",
          status: "failed",
          reasonCode: "execution_failed",
          result: null,
          processedAt: "2026-08-09T00:03:10.000Z",
        },
        updatedAt: "2026-08-09T00:03:10.000Z",
      }),
    ],
  };
}

function buildIrrigationState(
  applicationStatus: "pending" | "succeeded" | "partial" | null = null,
  runDurationSeconds?: number,
): IrrigationStrategyViewState {
  const strategies = [
    IrrigationStrategySchema.parse({
      schemaVersion: "smartfarm.irrigation-strategy.v1",
      id: "strategy:morning-basil",
      version: 2,
      farmId: "farm:demo",
      cycleId: "cycle:basil-2026-08",
      name: "아침 급수",
      description: "기온 상승 전 대표 장치 급수를 시작합니다.",
      pumpState: "on",
      ...(runDurationSeconds === undefined ? {} : { runDurationSeconds }),
      status: "approved",
      createdAt: "2026-08-08T23:00:00.000Z",
      approvedAt: "2026-08-08T23:30:00.000Z",
    }),
    IrrigationStrategySchema.parse({
      schemaVersion: "smartfarm.irrigation-strategy.v1",
      id: "strategy:night-lettuce",
      version: 1,
      farmId: "farm:demo",
      cycleId: "cycle:lettuce-2026-08",
      name: "야간 급수",
      description: "상추 주기 야간 전략",
      pumpState: "off",
      status: "approved",
      createdAt: "2026-08-08T20:00:00.000Z",
      approvedAt: "2026-08-08T21:00:00.000Z",
    }),
  ] as const;
  const application = applicationStatus === null
    ? null
    : StrategyApplicationSchema.parse({
      schemaVersion: "smartfarm.strategy-application.v1",
      id: "strategy-application:morning-basil-1",
      farmId: "farm:demo",
      cycleId: "cycle:basil-2026-08",
      strategyId: "strategy:morning-basil",
      strategyVersion: 2,
      strategyName: "아침 급수",
      pumpState: "on",
      ...(runDurationSeconds === undefined ? {} : { runDurationSeconds }),
      actor: { type: "user", id: "user:demo" },
      idempotencyKey: "pwa-strategy-apply-0001",
      targets: [
        {
          schemaVersion: "smartfarm.strategy-application-target.v1",
          areaId: areas[0]!.id,
          deviceId: devices[0]!.id,
          commandId: "command:strategy-a",
          status: applicationStatus === "succeeded" || applicationStatus === "partial"
            ? "acknowledged"
            : "pending",
          reasonCode: null,
          resultingPumpState: applicationStatus === "succeeded" || applicationStatus === "partial"
            ? runDurationSeconds === undefined ? "on" : "off"
            : null,
          updatedAt: "2026-08-09T00:10:00.000Z",
        },
        {
          schemaVersion: "smartfarm.strategy-application-target.v1",
          areaId: areas[1]!.id,
          deviceId: devices[1]!.id,
          commandId: "command:strategy-b",
          status: applicationStatus === "partial"
            ? "failed"
            : applicationStatus === "succeeded"
              ? "acknowledged"
              : "pending",
          reasonCode: applicationStatus === "partial" ? "execution_failed" : null,
          resultingPumpState: applicationStatus === "succeeded"
            ? runDurationSeconds === undefined ? "on" : "off"
            : null,
          updatedAt: "2026-08-09T00:10:10.000Z",
        },
      ],
      status: applicationStatus,
      createdAt: "2026-08-09T00:09:00.000Z",
      updatedAt: "2026-08-09T00:10:10.000Z",
    });

  return {
    loading: false,
    refreshing: false,
    error: null,
    items: strategies,
    selectedStrategyId: strategies[0]!.id,
    selectedStrategyVersion: 2,
    selectedAreaIds: [areas[0]!.id, areas[1]!.id],
    applicationConfirmed: true,
    application,
    applying: applicationStatus === "pending",
    applicationError: null,
  };
}

function metricState(metric: "temperature" | "humidity" | "illuminance" | "water_level", input: {
  latestAt: string | null;
  latestValue: number | null;
  points: readonly number[];
  loading?: boolean;
  refreshing?: boolean;
  cached?: boolean;
  error?: string | null;
}) {
  const metricSlug = metric.replaceAll("_", "-");
  const unit = metric === "temperature"
    ? "celsius"
    : metric === "illuminance"
      ? "lux"
      : "percent";
  const deviceId = metric === "temperature" || metric === "humidity"
    ? "device:bed-1"
    : "device:bed-2";
  return {
    latest: input.latestAt === null || input.latestValue === null ? null : LatestTelemetryResponseSchema.parse({
      schemaVersion: "smartfarm.latest-telemetry.v1",
      telemetry: {
        schemaVersion: "smartfarm.telemetry.v1",
        id: `telemetry:${metricSlug}-latest`,
        farmId: "farm:demo",
        deviceId,
        metric,
        value: input.latestValue,
        unit,
        sequence: 1,
        observedAt: input.latestAt,
      },
    }),
    points: input.points.map((value, index) => point(metric, value, index, deviceId)),
    loading: input.loading ?? false,
    refreshing: input.refreshing ?? false,
    cached: input.cached ?? false,
    error: input.error ?? null,
  };
}

function point(
  metric: "temperature" | "humidity" | "illuminance" | "water_level",
  value: number,
  index: number,
  deviceId: string,
): Telemetry {
  const metricSlug = metric.replaceAll("_", "-");
  const unit = metric === "temperature"
    ? "celsius"
    : metric === "illuminance"
      ? "lux"
      : "percent";
  return TelemetrySchema.parse({
    schemaVersion: "smartfarm.telemetry.v1",
    id: `telemetry:${metricSlug}-${index}`,
    farmId: "farm:demo",
    deviceId,
    metric,
    value,
    unit,
    sequence: index + 1,
    observedAt: `2026-08-09T00:00:${10 + index}.000Z`,
  });
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}
