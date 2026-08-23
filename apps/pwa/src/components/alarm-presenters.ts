import type {
  AlarmComparison,
  AlarmInstance,
  AlarmSeverity,
  AuditEvent,
  CommandAckReasonCode,
  CommandAckStatus,
  CropCycleDetail,
  Device,
  GrowingArea,
  PumpState,
  TelemetryMetric,
} from "@smartfarm-os/contracts";

type ScopeCatalog = {
  readonly devices: readonly Device[];
  readonly areas: readonly GrowingArea[];
  readonly cropCycles: readonly CropCycleDetail[];
};

export function getAlarmStateLabel(alarm: AlarmInstance): string {
  return alarm.state === "cleared" ? "해제" : "활성";
}

export function getAlarmSeverityLabel(alarm: AlarmInstance): string {
  return formatAlarmSeverityLabel(alarm.severity);
}

export function getAlarmComparisonLabel(alarm: AlarmInstance): string {
  return formatAlarmComparisonLabel(alarm.comparison);
}

export function getAlarmMetricLabel(alarm: AlarmInstance): string {
  return formatAlarmMetricLabel(alarm.metric);
}

export function getAlarmThresholdLabel(alarm: AlarmInstance): string {
  return `${formatNumericValue(alarm.threshold)} ${metricUnitLabel(alarm.metric)}`.trim();
}

export function getAlarmObservedValueLabel(alarm: AlarmInstance): string {
  return `${formatNumericValue(alarm.lastValue)} ${metricUnitLabel(alarm.metric)}`.trim();
}

export function getAlarmAcknowledgementLabel(alarm: AlarmInstance): string {
  return alarm.acknowledgement === null ? "미확인" : "확인됨";
}

export function resolveAlarmCycleName(
  alarm: AlarmInstance,
  cropCycles: readonly CropCycleDetail[],
): string {
  return cropCycles.find((cycle) => cycle.cycle.id === alarm.cycleId)?.cycle.name ?? alarm.cycleId;
}

export function resolveAlarmAreaName(
  alarm: AlarmInstance,
  areas: readonly GrowingArea[],
): string {
  return areas.find((area) => area.id === alarm.areaId)?.name ?? alarm.areaId;
}

export function resolveAlarmDeviceName(
  alarm: AlarmInstance,
  devices: readonly Device[],
): string {
  return devices.find((device) => device.id === alarm.deviceId)?.name ?? alarm.deviceId;
}

export function describeAlarmScope(alarm: AlarmInstance, catalog: ScopeCatalog): string {
  return [
    resolveAlarmCycleName(alarm, catalog.cropCycles),
    resolveAlarmAreaName(alarm, catalog.areas),
    resolveAlarmDeviceName(alarm, catalog.devices),
  ].join(" / ");
}

export function compareAlarmPriority(left: AlarmInstance, right: AlarmInstance): number {
  const severityDiff = severityRank(right.severity) - severityRank(left.severity);
  if (severityDiff !== 0) return severityDiff;
  return Date.parse(right.lastObservedAt) - Date.parse(left.lastObservedAt);
}

export function getAuditActionLabel(event: AuditEvent): string {
  if (isDirectCommandAudit(event)) {
    return "수동 제어 완료";
  }

  switch (event.action) {
    case "alarm.acknowledged":
      return "알람 확인";
    case "strategy.applied":
      return "전략 적용";
    case "command.completed":
      return "명령 완료";
  }
}

export function getAuditResultLabel(event: AuditEvent): string {
  return event.result === "success" ? "성공" : "실패";
}

export function getAuditActorLabel(event: AuditEvent): string {
  return event.actor.type === "user" ? event.actor.id : `시스템 ${event.actor.id}`;
}

export function getAuditCycleName(
  event: AuditEvent,
  cropCycles: readonly CropCycleDetail[],
): string {
  if (event.cycleId === null) {
    return "농장 공통 제어";
  }

  return cropCycles.find((cycle) => cycle.cycle.id === event.cycleId)?.cycle.name ?? event.cycleId;
}

export function getAuditScopeFieldLabel(event: AuditEvent): string {
  return event.cycleId === null ? "적용 범위" : "재배 주기";
}

export function getAuditTargetLabel(event: AuditEvent): string {
  switch (event.targetType) {
    case "alarm":
      return `알람 ${event.targetId}`;
    case "strategy_application":
      return `전략 적용 ${event.targetId}`;
    case "command":
      return `명령 ${event.targetId}`;
  }
}

export function getAuditDetailsLabel(
  event: AuditEvent,
  devices: readonly Device[],
): string {
  if (isDirectCommandAudit(event)) {
    return formatDirectCommandAuditDetails(event, devices);
  }

  const entries = Object.entries(event.details).slice(0, 3).map(([key, value]) => `${key}: ${String(value)}`);
  return entries[0] ?? "추가 정보 없음";
}

export function formatAlarmMetricLabel(metric: TelemetryMetric): string {
  switch (metric) {
    case "temperature":
      return "온도";
    case "humidity":
      return "습도";
    case "illuminance":
      return "조도";
    case "water_level":
      return "수위";
  }
}

export function formatAlarmComparisonLabel(comparison: AlarmComparison): string {
  switch (comparison) {
    case "above":
      return "초과";
    case "below":
      return "미만";
  }
}

export function formatAlarmSeverityLabel(severity: AlarmSeverity): string {
  switch (severity) {
    case "warning":
      return "주의";
    case "critical":
      return "치명";
  }
}

function severityRank(severity: AlarmSeverity): number {
  switch (severity) {
    case "critical":
      return 2;
    case "warning":
      return 1;
  }
}

function metricUnitLabel(metric: TelemetryMetric): string {
  switch (metric) {
    case "temperature":
      return "°C";
    case "humidity":
    case "water_level":
      return "%";
    case "illuminance":
      return "lux";
  }
}

function formatNumericValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function isDirectCommandAudit(
  event: AuditEvent,
): event is Extract<AuditEvent, { schemaVersion: "smartfarm.audit-event.v2" }> {
  return event.schemaVersion === "smartfarm.audit-event.v2";
}

function formatDirectCommandAuditDetails(
  event: Extract<AuditEvent, { schemaVersion: "smartfarm.audit-event.v2" }>,
  devices: readonly Device[],
): string {
  const commandLabel = event.details.requestedAction === "run_pump_for"
    ? `수동 펌프 ${event.details.runDurationSeconds}초 실행`
    : `수동 펌프 ${event.details.requestedPumpState === "on" ? "켜기" : "끄기"}`;
  const deviceLabel = resolveDeviceName(event.details.deviceId, devices);

  if (event.result === "success") {
    return [
      commandLabel,
      `장치 ${deviceLabel}`,
      `최종 상태 ${pumpStateLabel(event.details.resultingPumpState)}`,
    ].join(" · ");
  }

  return [
    commandLabel,
    `장치 ${deviceLabel}`,
    `실패 이유 ${commandFailureLabel(event.details.status, event.details.reasonCode)}`,
  ].join(" · ");
}

function resolveDeviceName(deviceId: string, devices: readonly Device[]): string {
  return devices.find((device) => device.id === deviceId)?.name ?? deviceId;
}

function pumpStateLabel(state: PumpState | null): string {
  switch (state) {
    case "on":
      return "작동 중";
    case "off":
      return "정지";
    case null:
      return "확인 전";
  }
}

function commandFailureLabel(
  status: CommandAckStatus,
  reasonCode: CommandAckReasonCode | null,
): string {
  if (reasonCode !== null) {
    return commandReasonCodeLabel(reasonCode);
  }

  switch (status) {
    case "failed":
      return "실행 실패";
    case "rejected":
      return "요청 거부";
    case "timed_out":
      return "시간 초과";
    case "acknowledged":
      return "상태 확인 필요";
  }
}

function commandReasonCodeLabel(reasonCode: CommandAckReasonCode): string {
  switch (reasonCode) {
    case "scope_mismatch":
      return "범위 불일치";
    case "expired":
      return "만료됨";
    case "idempotency_conflict":
      return "중복 충돌";
    case "execution_failed":
      return "실행 실패";
    case "invalid_command":
      return "유효하지 않은 명령";
    case "manual_stop":
      return "사용자 즉시 정지";
  }
}
