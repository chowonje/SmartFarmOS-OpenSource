import {
  commandRequestedPumpState,
  type AlarmInstance,
  type CommandProjection,
  type CropCycleDetail,
  type Device,
  type Farm,
  type GrowingArea,
  type StrategyApplicationTarget,
  type Telemetry,
  type TelemetryMetric,
} from "@smartfarm-os/contracts";
import {
  commandStatusLabel,
  formatDateTime,
  pumpStateLabel,
} from "../dashboard-model";
import {
  compareAlarmPriority,
  getAlarmAcknowledgementLabel,
  getAlarmComparisonLabel,
  getAlarmMetricLabel,
  getAlarmObservedValueLabel,
  getAlarmSeverityLabel,
  getAlarmThresholdLabel,
  resolveAlarmAreaName,
  resolveAlarmDeviceName,
} from "./alarm-presenters";
import {
  ENVIRONMENT_TELEMETRY_METRICS,
  isIrrigationTargetEligible,
  type AreaTelemetryComparisonState,
  type AreaTelemetryMetricState,
  type CommandHistoryViewState,
  type IrrigationStrategyViewState,
} from "./page-state";

const STALE_THRESHOLD_MS = 20_000;

type CropOperationsViewProps = {
  readonly farm: Farm | null;
  readonly devices: readonly Device[];
  readonly areas: readonly GrowingArea[];
  readonly cropCycles: readonly CropCycleDetail[];
  readonly activeAlarms: readonly AlarmInstance[];
  readonly areaComparison: AreaTelemetryComparisonState;
  readonly irrigation: IrrigationStrategyViewState;
  readonly commandHistory: CommandHistoryViewState;
  readonly alarmsLoading: boolean;
  readonly alarmsRefreshing: boolean;
  readonly alarmsError: string | null;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly error: string | null;
  readonly online: boolean;
  readonly nowMs?: number;
  readonly selectedCycleId: string | null;
  readonly onSelectCycle: (cycleId: string | null) => void;
  readonly onSelectIrrigationStrategy: (
    id: IrrigationStrategyViewState["selectedStrategyId"],
    version: number | null,
  ) => void;
  readonly onToggleIrrigationArea: (areaId: GrowingArea["id"], selected: boolean) => void;
  readonly onConfirmIrrigationApplication: (confirmed: boolean) => void;
  readonly onApplyIrrigationStrategy: () => void;
  readonly onRefresh: () => void;
};

export function CropOperationsView({
  farm,
  devices,
  areas,
  cropCycles,
  activeAlarms,
  areaComparison,
  irrigation,
  commandHistory,
  alarmsLoading,
  alarmsRefreshing,
  alarmsError,
  loading,
  refreshing,
  error,
  online,
  nowMs = Date.now(),
  selectedCycleId,
  onSelectCycle,
  onSelectIrrigationStrategy,
  onToggleIrrigationArea,
  onConfirmIrrigationApplication,
  onApplyIrrigationStrategy,
  onRefresh,
}: CropOperationsViewProps) {
  const selectedCycle = cropCycles.find((detail) => detail.cycle.id === selectedCycleId)
    ?? cropCycles[0]
    ?? null;
  const areasById = new Map(areas.map((area) => [area.id, area]));
  const assignedAreas = selectedCycle === null
    ? []
    : selectedCycle.areaIds
      .map((areaId) => areasById.get(areaId) ?? null)
      .filter((area): area is GrowingArea => area !== null);
  const comparisonItems = selectedCycleId === null
    ? []
    : areaComparison.items.filter((item) => assignedAreas.some((area) => area.id === item.areaId));
  const assignedDeviceIds = new Set(
    assignedAreas.flatMap((area) => area.primaryDeviceId === null ? [] : [area.primaryDeviceId]),
  );
  const filteredCommands = selectedCycleId === null || selectedCycle === null
    ? []
    : commandHistory.items.filter((projection) => assignedDeviceIds.has(projection.command.deviceId));
  const selectedCycleActiveAlarms = selectedCycle === null || selectedCycleId === null
    ? []
    : [...activeAlarms]
      .filter((alarm) => alarm.cycleId === selectedCycle.cycle.id && alarm.state !== "cleared")
      .sort(compareAlarmPriority);
  const leadingAlarm = selectedCycleActiveAlarms[0] ?? null;
  const cycleStrategies = selectedCycleId === null
    ? []
    : irrigation.items.filter((strategy) => strategy.cycleId === selectedCycleId);
  const selectedStrategy = cycleStrategies.find((strategy) => (
    strategy.id === irrigation.selectedStrategyId
    && strategy.version === irrigation.selectedStrategyVersion
  )) ?? null;
  const latestLowWaterAlarmByArea = new Map<GrowingArea["id"], AlarmInstance>();
  if (selectedCycle !== null) {
    const lowWaterAlarms = [...activeAlarms]
      .filter((alarm) => (
        alarm.cycleId === selectedCycle.cycle.id
        && alarm.metric === "water_level"
        && alarm.comparison === "below"
      ))
      .sort((left, right) => Date.parse(right.lastObservedAt) - Date.parse(left.lastObservedAt));
    for (const alarm of lowWaterAlarms) {
      if (!latestLowWaterAlarmByArea.has(alarm.areaId)) {
        latestLowWaterAlarmByArea.set(alarm.areaId, alarm);
      }
    }
  }
  const irrigationTargets = assignedAreas.map((area) => {
    const device = area.primaryDeviceId === null
      ? null
      : devices.find((candidate) => candidate.id === area.primaryDeviceId) ?? null;
    const hasPump = device?.capabilities.includes("pump") ?? false;
    const hasTimedPump = device?.capabilities.includes("timed_pump") ?? false;
    const needsTimedPump = selectedStrategy?.runDurationSeconds !== undefined;
    const eligible = isIrrigationTargetEligible(area, device)
      && (!needsTimedPump || hasTimedPump);
    const reason = area.status !== "active"
      ? "비활성 구역"
      : device === null
        ? "대표 장치 없음"
        : !hasPump
          ? "펌프 미지원 장치"
          : needsTimedPump && !hasTimedPump
            ? "장치 로컬 시간제 종료 미지원"
          : null;
    const comparisonItem = comparisonItems.find((item) => item.areaId === area.id) ?? null;
    return {
      area,
      device,
      eligible,
      reason,
      latestWaterTelemetry: comparisonItem?.metrics.water_level.latest?.telemetry ?? null,
      lowWaterAlarm: latestLowWaterAlarmByArea.get(area.id) ?? null,
    };
  });
  const selectedAreaIdSet = new Set(irrigation.selectedAreaIds);
  const irrigationControlsLocked = irrigation.applying
    || irrigation.application?.status === "pending";
  const eligibleAreaIdSet = new Set(
    irrigationTargets.filter((target) => target.eligible).map((target) => target.area.id),
  );
  const canConfirmIrrigation = online
    && !irrigation.applying
    && irrigation.application?.status !== "pending"
    && selectedCycle?.cycle.status === "active"
    && selectedStrategy !== null
    && selectedStrategy.status === "approved"
    && irrigation.selectedAreaIds.length > 0
    && irrigation.selectedAreaIds.every((areaId) => eligibleAreaIdSet.has(areaId));
  const canApplyIrrigation = canConfirmIrrigation && irrigation.applicationConfirmed;
  const selectedTargetNames = irrigationTargets
    .filter((target) => selectedAreaIdSet.has(target.area.id))
    .map((target) => target.area.name);
  const selectedOutsideLowWaterEvidence = latestLowWaterAlarmByArea.size === 0
    ? []
    : irrigationTargets
      .filter((target) => (
        selectedAreaIdSet.has(target.area.id)
        && !latestLowWaterAlarmByArea.has(target.area.id)
      ))
      .map((target) => target.area.name);
  const applicationTargets = irrigation.application?.targets
    .filter((target) => assignedAreas.some((area) => area.id === target.areaId))
    ?? [];

  return (
    <section className="page-shell" aria-labelledby="operations-title">
      <header className="page-header">
        <div>
          <p className="section-label">작물 운영</p>
          <h1 id="operations-title">재배 주기와 구역 배치</h1>
          <p className="page-copy">
            선택한 농장의 재배 주기를 기준으로 구역별 환경 비교와 최근 제어 이력을 함께 확인합니다.
          </p>
        </div>
        <button
          className="text-button"
          type="button"
          onClick={onRefresh}
          disabled={farm === null || loading || refreshing}
        >
          {refreshing ? "동기화 중" : "새로고침"}
        </button>
      </header>

      <section className="panel-block" aria-labelledby="operations-cycle-title">
        <div className="panel-row">
          <div>
            <p className="section-label">운영 범위</p>
            <h2 id="operations-cycle-title">{farm?.name ?? "농장 선택 대기"}</h2>
          </div>
          {selectedCycle !== null && (
            <span className={`status-chip operations-status operations-status-${selectedCycle.cycle.status}`}>
              {cropCycleStatusLabel(selectedCycle.cycle.status)}
            </span>
          )}
        </div>

        {farm === null ? (
          <div className="empty-state">
            <strong>먼저 농장을 선택하세요.</strong>
            <span>농장을 선택하면 재배 주기와 연결된 구역을 바로 확인할 수 있습니다.</span>
          </div>
        ) : loading ? (
          <div className="loading-state" role="status">작물 운영 범위를 불러오는 중입니다.</div>
        ) : error !== null && cropCycles.length === 0 ? (
          <p className="inline-error" role="alert">{error}</p>
        ) : cropCycles.length === 0 ? (
          <div className="empty-state">
            <strong>등록된 재배 주기가 없습니다.</strong>
            <span>이 단계에서는 목록과 배치 상태만 보여줍니다.</span>
          </div>
        ) : (
          <div className="operations-selector">
            <label className="field-stack" htmlFor="operations-cycle-select">
              <span>재배 주기</span>
              <select
                id="operations-cycle-select"
                data-testid="operations-cycle-select"
                value={selectedCycle?.cycle.id ?? ""}
                onChange={(event) => onSelectCycle(event.target.value || null)}
              >
                {cropCycles.map((detail) => (
                  <option key={detail.cycle.id} value={detail.cycle.id}>
                    {detail.cycle.name}
                  </option>
                ))}
              </select>
            </label>

            {selectedCycle !== null && (
              <dl className="fact-list operations-cycle-facts">
                <div>
                  <dt>작물</dt>
                  <dd>{selectedCycle.cycle.cropName}</dd>
                </div>
                <div>
                  <dt>품종</dt>
                  <dd>{selectedCycle.cycle.variety ?? "미지정"}</dd>
                </div>
                <div>
                  <dt>시작일</dt>
                  <dd>{selectedCycle.cycle.startedAt === null ? "미정" : formatDateTime(selectedCycle.cycle.startedAt)}</dd>
                </div>
                <div>
                  <dt>예정 종료</dt>
                  <dd>{selectedCycle.cycle.plannedEndAt === null ? "미정" : formatDateTime(selectedCycle.cycle.plannedEndAt)}</dd>
                </div>
              </dl>
            )}
            {error !== null && <p className="inline-error" role="alert">{error}</p>}
          </div>
        )}
      </section>

      <section className="panel-block trend-panel" aria-labelledby="operations-comparison-title">
        <div className="panel-row">
          <div>
            <p className="section-label">환경 비교</p>
            <h2 id="operations-comparison-title">대표 장치별 비교</h2>
            <p className="muted-copy">
              배정된 각 구역의 대표 장치에서 온도, 습도, 조도, 수위를 같은 기준으로 비교합니다.
            </p>
          </div>
          <span className="count-pill">{comparisonItems.length}개 구역</span>
        </div>

        {farm === null ? (
          <div className="empty-state">
            <strong>농장을 선택하면 구역 비교가 표시됩니다.</strong>
            <span>대표 장치가 있는 배정 구역만 나란히 비교합니다.</span>
          </div>
        ) : selectedCycleId === null || selectedCycle === null ? (
          <div className="empty-state">
            <strong>재배 주기를 선택하세요.</strong>
            <span>선택한 재배 주기의 대표 장치를 기준으로 비교를 시작합니다.</span>
          </div>
        ) : areaComparison.loading ? (
          <div className="loading-state" role="status">구역 비교 데이터를 불러오는 중입니다.</div>
        ) : areaComparison.error !== null && comparisonItems.length === 0 ? (
          <p className="inline-error" role="alert">{areaComparison.error}</p>
        ) : comparisonItems.length === 0 ? (
          <div className="empty-state">
            <strong>비교할 대표 장치가 없습니다.</strong>
            <span>배정된 구역에 대표 장치가 연결되면 이곳에서 나란히 비교할 수 있습니다.</span>
          </div>
        ) : (
          <>
            <div className="operations-area-grid">
              {comparisonItems.map((comparisonItem) => (
                <article
                  key={`${comparisonItem.areaId}-${comparisonItem.deviceId}`}
                  className="operations-area-card"
                  data-testid="operations-comparison-area"
                >
                  <div className="operations-area-header">
                    <div>
                      <h3>{comparisonItem.areaName}</h3>
                      <p>{comparisonItem.deviceName}</p>
                    </div>
                    <span className={`status-chip operations-status operations-status-${comparisonItem.areaStatus}`}>
                      {growingAreaStatusLabel(comparisonItem.areaStatus)}
                    </span>
                  </div>

                  <div className="alarm-list">
                    {ENVIRONMENT_TELEMETRY_METRICS.map((metric) => (
                      <MetricComparisonRow
                        key={`${comparisonItem.areaId}-${metric}`}
                        metric={metric}
                        state={comparisonItem.metrics[metric]}
                        online={online}
                        nowMs={nowMs}
                      />
                    ))}
                  </div>
                </article>
              ))}
            </div>
            {areaComparison.error !== null && (
              <p className="inline-error" role="alert">{areaComparison.error}</p>
            )}
            {areaComparison.refreshing && <p className="notice">구역 비교 값을 다시 확인하고 있습니다.</p>}
            {!online && <p className="notice">오프라인 상태로 마지막 비교 값을 표시합니다.</p>}
          </>
        )}
      </section>

      <section className="panel-block" aria-labelledby="operations-irrigation-title" data-testid="operations-irrigation">
        <div className="panel-row">
          <div>
            <p className="section-label">관수 전략</p>
            <h2 id="operations-irrigation-title">대표 장치 일괄 적용</h2>
            <p className="muted-copy">
              선택한 재배 주기의 활성 구역에 승인된 관수 전략을 대표 장치 기준으로 적용합니다.
            </p>
          </div>
          <span className="count-pill">{irrigation.selectedAreaIds.length}개 대상</span>
        </div>

        {farm === null ? (
          <div className="empty-state">
            <strong>농장을 선택하면 관수 전략을 적용할 수 있습니다.</strong>
            <span>활성 재배 주기와 대표 장치가 준비된 구역만 대상이 됩니다.</span>
          </div>
        ) : selectedCycleId === null || selectedCycle === null ? (
          <div className="empty-state">
            <strong>재배 주기를 선택하세요.</strong>
            <span>선택한 재배 주기의 승인 전략과 대상 구역을 보여줍니다.</span>
          </div>
        ) : irrigation.loading ? (
          <div className="loading-state" role="status">관수 전략을 불러오는 중입니다.</div>
        ) : irrigation.error !== null && cycleStrategies.length === 0 ? (
          <p className="inline-error" role="alert">{irrigation.error}</p>
        ) : cycleStrategies.length === 0 ? (
          <div className="empty-state">
            <strong>표시할 관수 전략이 없습니다.</strong>
            <span>선택한 재배 주기에 전략이 준비되면 이곳에 표시됩니다.</span>
          </div>
        ) : (
          <div className="operations-selector">
            <label className="field-stack" htmlFor="irrigation-strategy-select">
              <span>승인 전략</span>
              <select
                id="irrigation-strategy-select"
                data-testid="irrigation-strategy-select"
                disabled={irrigationControlsLocked}
                value={selectedStrategy === null ? "" : `${selectedStrategy.id}@${selectedStrategy.version}`}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (nextValue === "") {
                    onSelectIrrigationStrategy(null, null);
                    return;
                  }
                  const [id, version] = nextValue.split("@");
                  onSelectIrrigationStrategy(
                    id as IrrigationStrategyViewState["selectedStrategyId"],
                    Number(version),
                  );
                }}
              >
                <option value="">전략 선택</option>
                {cycleStrategies.map((strategy) => (
                  <option key={`${strategy.id}@${strategy.version}`} value={`${strategy.id}@${strategy.version}`}>
                    {strategy.name} v{strategy.version}
                  </option>
                ))}
              </select>
            </label>

            {selectedStrategy !== null && (
              <dl className="fact-list operations-cycle-facts">
                <div>
                  <dt>전략</dt>
                  <dd>{selectedStrategy.name} v{selectedStrategy.version}</dd>
                </div>
                <div>
                  <dt>펌프 동작</dt>
                  <dd>{selectedStrategy.pumpState === "on" ? "펌프 켜기" : "펌프 끄기"}</dd>
                </div>
                <div>
                  <dt>시간제 종료</dt>
                  <dd>{selectedStrategy.runDurationSeconds === undefined
                    ? "없음"
                    : `${selectedStrategy.runDurationSeconds}초 후 장치 로컬 종료`}</dd>
                </div>
                <div>
                  <dt>설명</dt>
                  <dd>{selectedStrategy.description ?? "설명 없음"}</dd>
                </div>
              </dl>
            )}

            {selectedStrategy?.pumpState === "on" && (
              <p className="notice" data-testid="irrigation-safety-note">
                {selectedStrategy.runDurationSeconds === undefined
                  ? "주의: 이 호환성 전략은 펌프 켜기 명령만 보냅니다. 자동 정지, 지속 시간 제어, 폐루프 안전 제어를 의미하지 않습니다."
                  : `시뮬레이터 장치가 ${selectedStrategy.runDurationSeconds}초 뒤 로컬 타이머로 정지하고 최종 off 뒤에만 완료됩니다. 물리 인터록, 실장비 검증, 폐루프 안전 제어를 의미하지 않습니다.`}
              </p>
            )}

            {!online && (
              <p className="notice">오프라인 상태에서는 관수 전략을 적용할 수 없습니다.</p>
            )}

            {selectedCycle.cycle.status !== "active" && (
              <p className="notice">운영 중인 재배 주기에서만 적용할 수 있습니다.</p>
            )}

            {irrigation.error !== null && cycleStrategies.length > 0 && (
              <p className="inline-error" role="alert">{irrigation.error}</p>
            )}

            <div className="alarm-list">
              {irrigationTargets.map(({
                area,
                device,
                eligible,
                reason,
                latestWaterTelemetry,
                lowWaterAlarm,
              }) => (
                <label
                  key={area.id}
                  className="sensor-row"
                  data-testid="irrigation-area-option"
                >
                  <div>
                    <strong>{area.name}</strong>
                    <span>{device?.name ?? "대표 장치 없음"}</span>
                    <span>{eligible ? "적용 가능" : reason ?? "적용 불가"}</span>
                    <span data-testid="irrigation-target-evidence">
                      {formatIrrigationTargetEvidence(lowWaterAlarm, latestWaterTelemetry)}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    value={area.id}
                    checked={selectedAreaIdSet.has(area.id)}
                    disabled={!eligible || irrigationControlsLocked}
                    onChange={(event) => onToggleIrrigationArea(area.id, event.target.checked)}
                  />
                </label>
              ))}
            </div>

            <label
              className="sensor-row irrigation-confirmation"
              data-testid="irrigation-application-confirmation"
            >
              <div>
                <strong>적용 전 확인</strong>
                <span>
                  {resolveIrrigationConfirmationCopy(
                    selectedTargetNames,
                    selectedOutsideLowWaterEvidence,
                    selectedStrategy?.pumpState ?? null,
                    selectedStrategy?.runDurationSeconds,
                  )}
                </span>
              </div>
              <input
                type="checkbox"
                checked={irrigation.applicationConfirmed}
                disabled={!canConfirmIrrigation}
                onChange={(event) => onConfirmIrrigationApplication(event.target.checked)}
              />
            </label>

            <button
              className="primary-control"
              type="button"
              data-testid="irrigation-apply"
              disabled={!canApplyIrrigation}
              onClick={onApplyIrrigationStrategy}
            >
              {irrigation.application?.status === "pending"
                ? irrigation.applying ? "적용 결과 확인 중" : "결과 확인 대기"
                : irrigation.applying ? "적용 요청 중" : "전략 적용"}
            </button>

            <div className="command-result" data-testid="irrigation-application-status">
              <div>
                <span className="result-label">적용 상태</span>
                <strong>{resolveApplicationStatusLabel(irrigation)}</strong>
              </div>
              {!online && <span className="requested-state">오프라인</span>}
            </div>

            {irrigation.applicationError !== null && (
              <p className="inline-error" role="alert">{irrigation.applicationError}</p>
            )}

            {applicationTargets.length > 0 && (
            <div className="operations-area-grid">
              {applicationTargets.map((target) => (
                <IrrigationTargetResultCard
                  key={target.commandId}
                  target={target}
                  area={assignedAreas.find((area) => area.id === target.areaId) ?? null}
                  device={devices.find((device) => device.id === target.deviceId) ?? null}
                  relatedProjection={commandHistory.items.find((projection) => projection.command.id === target.commandId) ?? null}
                  runDurationSeconds={irrigation.application?.runDurationSeconds}
                />
              ))}
            </div>
            )}
          </div>
        )}
      </section>

      <section className="panel-block" aria-labelledby="operations-command-history-title">
        <div className="panel-row">
          <div>
            <p className="section-label">최근 제어</p>
            <h2 id="operations-command-history-title">대표 장치 명령 이력</h2>
            <p className="muted-copy">
              현재 재배 주기에 연결된 대표 장치의 급수 명령과 처리 결과를 같은 순서로 보여줍니다.
            </p>
          </div>
          <span className="count-pill">{filteredCommands.length}건</span>
        </div>

        <div className="alarm-list" data-testid="operations-command-history">
          {farm === null ? (
            <div className="empty-state">
              <strong>농장을 선택하면 제어 이력이 표시됩니다.</strong>
              <span>같은 농장의 대표 장치 명령만 묶어서 보여줍니다.</span>
            </div>
          ) : selectedCycleId === null || selectedCycle === null ? (
            <div className="empty-state">
              <strong>재배 주기를 선택하세요.</strong>
              <span>선택한 재배 주기에 연결된 대표 장치 명령만 표시합니다.</span>
            </div>
          ) : commandHistory.loading ? (
            <div className="loading-state" role="status">명령 이력을 불러오는 중입니다.</div>
          ) : commandHistory.error !== null && filteredCommands.length === 0 ? (
            <p className="inline-error" role="alert">{commandHistory.error}</p>
          ) : filteredCommands.length === 0 ? (
            <div className="empty-state">
              <strong>표시할 제어 이력이 없습니다.</strong>
              <span>대표 장치에 명령이 기록되면 이곳에 최근 처리 결과가 나타납니다.</span>
            </div>
          ) : (
            <>
              {filteredCommands.map((projection) => (
                <CommandHistoryRow
                  key={projection.command.id}
                  projection={projection}
                  areaName={assignedAreas.find((area) => area.primaryDeviceId === projection.command.deviceId)?.name ?? "대표 구역 미상"}
                  deviceName={devices.find((device) => device.id === projection.command.deviceId)?.name ?? projection.command.deviceId}
                />
              ))}
              {commandHistory.error !== null && (
                <p className="inline-error" role="alert">{commandHistory.error}</p>
              )}
              {commandHistory.refreshing && <p className="notice">최근 명령 이력을 다시 확인하고 있습니다.</p>}
              {!online && <p className="notice">오프라인 상태로 마지막 명령 이력을 표시합니다.</p>}
            </>
          )}
        </div>
      </section>

      <section className="panel-block" aria-labelledby="operations-areas-title">
        <div className="panel-row">
          <div>
            <p className="section-label">배정된 구역</p>
            <h2 id="operations-areas-title">구역 카드</h2>
          </div>
          <span className="count-pill">{assignedAreas.length}개</span>
        </div>

        {farm !== null && !loading && error === null && cropCycles.length > 0 && assignedAreas.length === 0 ? (
          <div className="empty-state">
            <strong>배정된 구역이 없습니다.</strong>
            <span>선택한 재배 주기에 연결된 구역이 아직 없습니다.</span>
          </div>
        ) : (
          <div className="operations-area-grid">
            {assignedAreas.map((area) => {
              const device = area.primaryDeviceId === null
                ? null
                : devices.find((candidate) => candidate.id === area.primaryDeviceId) ?? null;

              return (
                <article
                  key={area.id}
                  className="operations-area-card"
                  data-testid="operations-area-card"
                >
                  <div className="operations-area-header">
                    <div>
                      <h3>{area.name}</h3>
                      <p>{growingAreaKindLabel(area.kind)}</p>
                    </div>
                    <span className={`status-chip operations-status operations-status-${area.status}`}>
                      {growingAreaStatusLabel(area.status)}
                    </span>
                  </div>

                  <dl className="fact-list operations-area-facts">
                    <div>
                      <dt>대표 장치</dt>
                      <dd>{device?.name ?? "연결 없음"}</dd>
                    </div>
                    <div>
                      <dt>장치 상태</dt>
                      <dd>{device === null ? "미연결" : deviceStatusLabel(device.status)}</dd>
                    </div>
                    <div>
                      <dt>최근 변경</dt>
                      <dd>{formatDateTime(area.updatedAt)}</dd>
                    </div>
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel-block" aria-labelledby="operations-alarm-title">
        <div className="panel-row">
          <div>
            <p className="section-label">알람 요약</p>
            <h2 id="operations-alarm-title">현재 운영 경보</h2>
          </div>
          <span className="count-pill">{selectedCycleActiveAlarms.length}건</span>
        </div>

        {farm === null ? (
          <div className="empty-state">
            <strong>농장을 선택하면 알람 요약을 확인할 수 있습니다.</strong>
            <span>현재 범위의 활성 알람과 확인 상태를 함께 보여줍니다.</span>
          </div>
        ) : alarmsLoading ? (
          <div className="loading-state" role="status">알람 요약을 불러오는 중입니다.</div>
        ) : alarmsError !== null && leadingAlarm === null ? (
          <p className="inline-error" role="alert">{alarmsError}</p>
        ) : leadingAlarm === null ? (
          <div className="empty-state">
            <strong>현재 운영 범위에 활성 알람이 없습니다.</strong>
            <span>기준을 벗어난 환경 지표가 감지되면 이곳에 표시됩니다.</span>
          </div>
        ) : (
          <>
            <article className="operations-area-card" data-testid="operations-alarm-summary">
              <div className="operations-area-header">
                <div>
                  <h3>{resolveAlarmAreaName(leadingAlarm, areas)}</h3>
                  <p>{resolveAlarmDeviceName(leadingAlarm, devices)}</p>
                </div>
                <span className="status-chip">{getAlarmSeverityLabel(leadingAlarm)}</span>
              </div>

              <dl className="fact-list operations-area-facts">
                <div>
                  <dt>지표</dt>
                  <dd>{getAlarmMetricLabel(leadingAlarm)}</dd>
                </div>
                <div>
                  <dt>비교</dt>
                  <dd>{getAlarmComparisonLabel(leadingAlarm)}</dd>
                </div>
                <div>
                  <dt>기준값</dt>
                  <dd>{getAlarmThresholdLabel(leadingAlarm)}</dd>
                </div>
                <div>
                  <dt>관측값</dt>
                  <dd>{getAlarmObservedValueLabel(leadingAlarm)}</dd>
                </div>
                <div>
                  <dt>상태</dt>
                  <dd>{leadingAlarm.state === "cleared" ? "해제" : "활성"}</dd>
                </div>
                <div>
                  <dt>확인</dt>
                  <dd>{getAlarmAcknowledgementLabel(leadingAlarm)}</dd>
                </div>
                <div>
                  <dt>최근 관측</dt>
                  <dd>{formatDateTime(leadingAlarm.lastObservedAt)}</dd>
                </div>
                <div>
                  <dt>동기화 상태</dt>
                  <dd>{alarmsRefreshing ? "새로고침 중" : "최신"}</dd>
                </div>
              </dl>
            </article>
            {alarmsError !== null && <p className="inline-error" role="alert">{alarmsError}</p>}
          </>
        )}
      </section>
    </section>
  );
}

function MetricComparisonRow({
  metric,
  state,
  online,
  nowMs,
}: {
  readonly metric: TelemetryMetric;
  readonly state: AreaTelemetryMetricState;
  readonly online: boolean;
  readonly nowMs: number;
}) {
  const latest = state.latest?.telemetry ?? null;

  return (
    <div className="trend-card" data-testid={`operations-comparison-metric-${metric}`}>
      <div className="trend-card-header">
        <div>
          <h3>{metricLabel(metric)}</h3>
          <span data-testid="operations-comparison-value">
            {latest === null ? "--" : formatMetricValue(metric, latest.value)}
          </span>
        </div>
        <span data-testid={`operations-comparison-freshness-${metric}`}>
          {resolveFreshnessLabel(state, online, nowMs)}
        </span>
      </div>

      {state.points.length > 0 ? (
        <>
          <svg
            className="telemetry-chart comparison-sparkline"
            viewBox="0 0 160 56"
            role="img"
            aria-label={`${metricLabel(metric)} 최근 추세`}
          >
            <polyline className="trend-line" points={createSparklinePoints(state.points)} />
          </svg>
          <div className="trend-stats">
            <span>{state.points.length}개 이력</span>
            <span>{latest === null ? "시각 정보 없음" : formatDateTime(latest.observedAt)}</span>
          </div>
        </>
      ) : (
        <div className="trend-empty">
          {state.loading ? "불러오는 중입니다." : state.error !== null ? "오류가 발생했습니다." : "아직 비교 이력이 없습니다."}
        </div>
      )}

      {state.error !== null && <p className="inline-error" role="alert">{state.error}</p>}
      {latest === null && !state.loading && state.error === null && (
        <div className="reading-meta">
          <span>아직 수집된 값이 없습니다.</span>
        </div>
      )}
      {latest !== null && (
        <div className="reading-meta">
          <span>{formatDateTime(latest.observedAt)}</span>
          {state.refreshing && <span>업데이트 중</span>}
        </div>
      )}
    </div>
  );
}

function CommandHistoryRow({
  projection,
  areaName,
  deviceName,
}: {
  readonly projection: CommandProjection;
  readonly areaName: string;
  readonly deviceName: string;
}) {
  return (
    <article className="crop-row" data-testid="operations-command-row">
      <div className="crop-row-header">
        <strong>{areaName}</strong>
        <span className={`status-chip operations-status operations-status-${projection.status}`}>
          {commandStatusLabel(projection.status)}
        </span>
      </div>
      <div className="crop-row-meta">
        <span>장치 {deviceName}</span>
        <span>요청 {pumpStateLabel(commandRequestedPumpState(projection.command))}</span>
        {projection.command.schemaVersion === "smartfarm.command.v2" && (
          <span>{projection.command.payload.durationSeconds}초 설정 · {projection.ack?.schemaVersion === "smartfarm.command-ack.v2"
            ? "사용자 정지로 조기 종료"
            : "최종 off 확인"}</span>
        )}
        <span>발행 {formatDateTime(projection.command.issuedAt)}</span>
        <span>결과 {formatDateTime(projection.ack?.processedAt ?? projection.updatedAt)}</span>
        {projection.ack?.reasonCode !== null && projection.ack?.reasonCode !== undefined && (
          <span>사유 {reasonCodeLabel(projection.ack.reasonCode)}</span>
        )}
        {projection.ack?.schemaVersion === "smartfarm.command-ack.v2" && (
          <span>{formatManualStopLink(projection.ack.causedByCommandId)}</span>
        )}
      </div>
    </article>
  );
}

function IrrigationTargetResultCard({
  target,
  area,
  device,
  relatedProjection,
  runDurationSeconds,
}: {
  readonly target: StrategyApplicationTarget;
  readonly area: GrowingArea | null;
  readonly device: Device | null;
  readonly relatedProjection: CommandProjection | null;
  readonly runDurationSeconds: number | undefined;
}) {
  const interruptionLink = relatedProjection?.ack?.schemaVersion === "smartfarm.command-ack.v2"
    ? formatManualStopLink(relatedProjection.ack.causedByCommandId)
    : null;
  return (
    <article className="operations-area-card" data-testid="irrigation-target-result">
      <div className="operations-area-header">
        <div>
          <h3>{area?.name ?? target.areaId}</h3>
          <p>{device?.name ?? target.deviceId}</p>
        </div>
        <span className={`status-chip operations-status operations-status-${target.status}`}>
          {commandStatusLabel(target.status)}
        </span>
      </div>
      <dl className="fact-list operations-area-facts">
        <div>
          <dt>장치 결과</dt>
          <dd>{target.resultingPumpState === null ? "확인 전" : pumpStateLabel(target.resultingPumpState)}</dd>
        </div>
        <div>
          <dt>갱신 시각</dt>
          <dd>{formatDateTime(target.updatedAt)}</dd>
        </div>
        {runDurationSeconds !== undefined && (
          <div>
            <dt>시간제 실행</dt>
            <dd>{runDurationSeconds}초 설정 · {target.reasonCode === "manual_stop"
              ? "사용자 정지로 조기 종료"
              : "최종 off 확인"}</dd>
          </div>
        )}
        <div>
          <dt>사유</dt>
          <dd>{target.status === "pending"
            ? "장치 응답 대기"
            : target.reasonCode === null
              ? "정상 처리"
              : reasonCodeLabel(target.reasonCode)}</dd>
        </div>
        {interruptionLink !== null && (
          <div>
            <dt>즉시 정지 연결</dt>
            <dd>{interruptionLink}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}

function resolveFreshnessLabel(
  state: AreaTelemetryMetricState,
  online: boolean,
  nowMs: number,
): string {
  const latest = state.latest?.telemetry ?? null;
  if (latest === null) {
    if (!online && (state.cached || state.points.length > 0)) return "오프라인";
    if (state.loading) return "불러오는 중";
    if (state.error !== null) return "오류";
    return "값 없음";
  }
  if (!online) return state.cached ? "오프라인 · 저장된 값" : "오프라인 · 마지막 값";
  if (state.cached) return "저장된 값";
  if (nowMs - Date.parse(latest.observedAt) > STALE_THRESHOLD_MS) return "20초 경과";
  return "최신";
}

function createSparklinePoints(points: readonly Telemetry[]): string {
  if (points.length === 1) {
    const y = normalizeSparklineValue(points.map((point) => point.value), points[0]?.value ?? 0);
    return `12,${y.toFixed(1)} 148,${y.toFixed(1)}`;
  }

  return points.map((point, index) => {
    const x = 12 + (136 * index) / Math.max(1, points.length - 1);
    const y = normalizeSparklineValue(points.map((item) => item.value), point.value);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function normalizeSparklineValue(values: readonly number[], value: number): number {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) return 28;
  const ratio = (value - minimum) / (maximum - minimum);
  return 44 - ratio * 32;
}

function formatMetricValue(metric: TelemetryMetric, value: number): string {
  const suffix = metric === "temperature"
    ? "°C"
    : metric === "illuminance"
      ? "lux"
      : "%";
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${suffix}`;
}

function formatIrrigationTargetEvidence(
  lowWaterAlarm: AlarmInstance | null,
  latestWaterTelemetry: Telemetry | null,
): string {
  if (lowWaterAlarm !== null) {
    const alarmState = lowWaterAlarm.state === "cleared" ? "최근 저수위 알람(해제)" : "현재 저수위 알람";
    return `관수 검토 근거: ${alarmState} · ${formatMetricValue("water_level", lowWaterAlarm.lastValue)} / 기준 ${formatMetricValue("water_level", lowWaterAlarm.threshold)} 미만 · ${formatDateTime(lowWaterAlarm.lastObservedAt)}`;
  }
  if (latestWaterTelemetry !== null) {
    return `관수 검토 근거: 최근 수위 ${formatMetricValue("water_level", latestWaterTelemetry.value)} · ${formatDateTime(latestWaterTelemetry.observedAt)}`;
  }
  return "관수 검토 근거: 수위 정보 없음";
}

function resolveIrrigationConfirmationCopy(
  selectedTargetNames: readonly string[],
  selectedOutsideLowWaterEvidence: readonly string[],
  pumpState: "on" | "off" | null,
  runDurationSeconds: number | undefined,
): string {
  if (selectedTargetNames.length === 0) {
    return "적용할 구역을 먼저 선택하세요.";
  }
  const targetLabel = selectedTargetNames.join(", ");
  const actionLabel = pumpState !== "on"
    ? "펌프 끄기"
    : runDurationSeconds === undefined
      ? "펌프 켜기에 자동 정지가 없음"
      : `${runDurationSeconds}초 시간제 실행과 물리 인터록 미검증`;
  if (selectedOutsideLowWaterEvidence.length > 0) {
    return `${selectedOutsideLowWaterEvidence.join(", ")}은(는) 최근 저수위 알람 대상이 아닙니다. ${targetLabel} 선택과 ${actionLabel}을 확인해야 적용할 수 있습니다.`;
  }
  return `${targetLabel} 선택과 ${actionLabel}을 확인해야 적용할 수 있습니다.`;
}

function metricLabel(metric: TelemetryMetric): string {
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

function cropCycleStatusLabel(status: CropCycleDetail["cycle"]["status"]): string {
  switch (status) {
    case "planned":
      return "계획";
    case "active":
      return "운영 중";
    case "completed":
      return "종료";
  }
}

function growingAreaKindLabel(kind: GrowingArea["kind"]): string {
  switch (kind) {
    case "greenhouse":
      return "온실";
    case "bed":
      return "베드";
    case "tank":
      return "탱크";
  }
}

function growingAreaStatusLabel(status: GrowingArea["status"]): string {
  switch (status) {
    case "active":
      return "가동";
    case "inactive":
      return "비활성";
  }
}

function deviceStatusLabel(status: Device["status"]): string {
  switch (status) {
    case "online":
      return "온라인";
    case "offline":
      return "오프라인";
    case "degraded":
      return "불안정";
  }
}

function reasonCodeLabel(reasonCode: NonNullable<CommandProjection["ack"]>["reasonCode"]): string {
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
    case null:
      return "사유 없음";
  }
}

function formatManualStopLink(causedByCommandId: string): string {
  return `사용자 즉시 정지로 중단 · 연결된 정지 요청 ${formatCommandReference(causedByCommandId)}`;
}

function formatCommandReference(commandId: string): string {
  const [, reference = commandId] = commandId.split(":");
  return reference;
}

function resolveApplicationStatusLabel(irrigation: IrrigationStrategyViewState): string {
  if (irrigation.applying) return "적용 중";
  switch (irrigation.application?.status ?? null) {
    case "pending":
      return "적용 중";
    case "succeeded":
      return "적용 완료";
    case "partial":
      return "일부 실패";
    case "failed":
      return "적용 실패";
    case null:
      return irrigation.applicationError === null ? "대기 중" : "적용 실패";
  }
}
