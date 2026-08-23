import type {
  AlarmInstance,
  AuditEvent,
  CropCycleDetail,
  Device,
  Farm,
  GrowingArea,
} from "@smartfarm-os/contracts";
import { formatDateTime } from "../dashboard-model";
import {
  compareAlarmPriority,
  describeAlarmScope,
  getAlarmAcknowledgementLabel,
  getAlarmComparisonLabel,
  getAlarmMetricLabel,
  getAlarmObservedValueLabel,
  getAlarmSeverityLabel,
  getAlarmStateLabel,
  getAlarmThresholdLabel,
  getAuditActionLabel,
  getAuditActorLabel,
  getAuditCycleName,
  getAuditScopeFieldLabel,
  getAuditDetailsLabel,
  getAuditResultLabel,
  getAuditTargetLabel,
  resolveAlarmAreaName,
  resolveAlarmCycleName,
  resolveAlarmDeviceName,
} from "./alarm-presenters";

type AlarmCenterViewProps = {
  readonly farm: Farm | null;
  readonly devices: readonly Device[];
  readonly areas: readonly GrowingArea[];
  readonly cropCycles: readonly CropCycleDetail[];
  readonly alarms: readonly AlarmInstance[];
  readonly alarmsLoading: boolean;
  readonly alarmsRefreshing: boolean;
  readonly alarmsError: string | null;
  readonly auditEvents: readonly AuditEvent[];
  readonly auditLoading: boolean;
  readonly auditRefreshing: boolean;
  readonly auditError: string | null;
  readonly acknowledgingAlarmId: string | null;
  readonly acknowledgeError: string | null;
  readonly acknowledgeNotice: string | null;
  readonly onRefresh: () => void;
  readonly onAcknowledgeAlarm: (alarmId: string) => void;
};

export function AlarmCenterView({
  farm,
  devices,
  areas,
  cropCycles,
  alarms,
  alarmsLoading,
  alarmsRefreshing,
  alarmsError,
  auditEvents,
  auditLoading,
  auditRefreshing,
  auditError,
  acknowledgingAlarmId,
  acknowledgeError,
  acknowledgeNotice,
  onRefresh,
  onAcknowledgeAlarm,
}: AlarmCenterViewProps) {
  const sortedAlarms = [...alarms].sort(compareAlarmPriority);
  const activeAlarms = sortedAlarms.filter((alarm) => alarm.state !== "cleared");
  const clearedAlarms = sortedAlarms.filter((alarm) => alarm.state === "cleared");

  return (
    <section className="page-shell" aria-labelledby="alarm-center-title">
      <header className="page-header">
        <div>
          <p className="section-label">알람 센터</p>
          <h1 id="alarm-center-title">활성 알람과 운영 감사</h1>
          <p className="page-copy">
            선택한 농장과 재배 범위 기준으로 현재 알람, 최근 해제 이력, 확인 기록을 함께 확인합니다.
          </p>
        </div>
        <button
          className="text-button"
          type="button"
          onClick={onRefresh}
          disabled={farm === null || alarmsLoading || alarmsRefreshing || auditLoading || auditRefreshing}
        >
          {alarmsRefreshing || auditRefreshing ? "동기화 중" : "새로고침"}
        </button>
      </header>

      <section className="panel-block alarm-section" aria-labelledby="alarm-active-title">
        <div className="panel-row">
          <div>
            <p className="section-label">활성 알람</p>
            <h2 id="alarm-active-title">{farm?.name ?? "농장 선택 대기"}</h2>
            <p className="muted-copy">현재 기준을 벗어난 알람을 심각도 우선으로 정렬해 보여줍니다.</p>
          </div>
          <span className="count-pill">{activeAlarms.length}건</span>
        </div>

        {farm === null ? (
          <div className="empty-state">
            <strong>먼저 농장을 선택하세요.</strong>
            <span>농장을 선택하면 현재 활성 알람을 확인할 수 있습니다.</span>
          </div>
        ) : alarmsLoading ? (
          <div className="loading-state" role="status">활성 알람을 불러오는 중입니다.</div>
        ) : alarmsError !== null && activeAlarms.length === 0 ? (
          <p className="inline-error" role="alert">{alarmsError}</p>
        ) : activeAlarms.length === 0 ? (
          <div className="empty-state">
            <strong>현재 활성 알람이 없습니다.</strong>
            <span>기준을 벗어난 환경 지표가 감지되면 이곳에 표시됩니다.</span>
          </div>
        ) : (
          <div className="alarm-list">
            {activeAlarms.map((alarm) => (
              <AlarmCard
                key={alarm.id}
                alarm={alarm}
                devices={devices}
                areas={areas}
                cropCycles={cropCycles}
                acknowledging={acknowledgingAlarmId === alarm.id}
                testId="alarm-active-card"
                onAcknowledgeAlarm={onAcknowledgeAlarm}
              />
            ))}
          </div>
        )}

        {alarmsError !== null && activeAlarms.length > 0 && (
          <p className="inline-error" role="alert">{alarmsError}</p>
        )}

        {acknowledgeNotice !== null && <p className="notice" role="status">{acknowledgeNotice}</p>}
        {acknowledgeError !== null && <p className="inline-error" role="alert">{acknowledgeError}</p>}
      </section>

      <section className="panel-block alarm-section" aria-labelledby="alarm-history-title">
        <div className="panel-row">
          <div>
            <p className="section-label">해제 이력</p>
            <h2 id="alarm-history-title">최근 정상 복귀 알람</h2>
          </div>
          <span className="count-pill">{clearedAlarms.length}건</span>
        </div>

        {farm !== null && !alarmsLoading && alarmsError === null && clearedAlarms.length === 0 ? (
          <div className="empty-state">
            <strong>최근 해제된 알람이 없습니다.</strong>
            <span>정상 범위로 복귀한 알람은 이 목록에 누적됩니다.</span>
          </div>
        ) : (
          <div className="alarm-list">
            {clearedAlarms.map((alarm) => (
              <AlarmCard
                key={alarm.id}
                alarm={alarm}
                devices={devices}
                areas={areas}
                cropCycles={cropCycles}
                acknowledging={acknowledgingAlarmId === alarm.id}
                testId="alarm-cleared-card"
                onAcknowledgeAlarm={onAcknowledgeAlarm}
              />
            ))}
          </div>
        )}
      </section>

      <section className="panel-block alarm-section" aria-labelledby="audit-events-title">
        <div className="panel-row">
          <div>
            <p className="section-label">감사 이력</p>
            <h2 id="audit-events-title">최근 운영 이벤트</h2>
            <p className="muted-copy">알람 확인, 전략 적용, 농장 공통 수동 제어 완료를 append-only 기록으로 남깁니다.</p>
          </div>
          <span className="count-pill">{auditEvents.length}건</span>
        </div>

        {farm === null ? (
          <div className="empty-state">
            <strong>감사 이력을 보려면 농장을 선택하세요.</strong>
            <span>선택한 범위의 최근 운영 기록을 보여줍니다.</span>
          </div>
        ) : auditLoading ? (
          <div className="loading-state" role="status">감사 이력을 불러오는 중입니다.</div>
        ) : auditError !== null && auditEvents.length === 0 ? (
          <p className="inline-error" role="alert">{auditError}</p>
        ) : auditEvents.length === 0 ? (
          <div className="empty-state">
            <strong>표시할 운영 이력이 없습니다.</strong>
            <span>알람 확인, 전략 적용, 농장 공통 수동 제어가 발생하면 여기에 기록됩니다.</span>
          </div>
        ) : (
          <div className="alarm-list">
            {auditEvents.map((event) => (
              <article
                key={event.id}
                className="alarm-card"
                data-testid="audit-event"
              >
                <div className="alarm-card-header">
                  <div>
                    <h3>{getAuditActionLabel(event)}</h3>
                    <p>{getAuditCycleName(event, cropCycles)}</p>
                  </div>
                  <span className="status-chip">{getAuditResultLabel(event)}</span>
                </div>

                <dl className="fact-list alarm-fact-list">
                  <div>
                    <dt>기록자</dt>
                    <dd>{getAuditActorLabel(event)}</dd>
                  </div>
                  <div>
                    <dt>대상</dt>
                    <dd>{getAuditTargetLabel(event)}</dd>
                  </div>
                  <div>
                    <dt>{getAuditScopeFieldLabel(event)}</dt>
                    <dd>{getAuditCycleName(event, cropCycles)}</dd>
                  </div>
                  <div>
                    <dt>시각</dt>
                    <dd>{formatDateTime(event.occurredAt)}</dd>
                  </div>
                  <div>
                    <dt>세부</dt>
                    <dd>{getAuditDetailsLabel(event, devices)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
        {auditError !== null && auditEvents.length > 0 && (
          <p className="inline-error" role="alert">{auditError}</p>
        )}
      </section>
    </section>
  );
}

function AlarmCard({
  alarm,
  devices,
  areas,
  cropCycles,
  acknowledging,
  testId,
  onAcknowledgeAlarm,
}: {
  readonly alarm: AlarmInstance;
  readonly devices: readonly Device[];
  readonly areas: readonly GrowingArea[];
  readonly cropCycles: readonly CropCycleDetail[];
  readonly acknowledging: boolean;
  readonly testId: "alarm-active-card" | "alarm-cleared-card";
  readonly onAcknowledgeAlarm: (alarmId: string) => void;
}) {
  const acknowledgedAt = alarm.acknowledgement?.acknowledgedAt ?? null;
  const clearedAt = alarm.clearedAt;

  return (
    <article className="alarm-card" data-testid={testId}>
      <div className="alarm-card-header">
        <div>
          <h3>{describeAlarmScope(alarm, { devices, areas, cropCycles })}</h3>
          <p>{formatDateTime(alarm.lastObservedAt)}</p>
        </div>
        <span className={`status-chip alarm-severity alarm-severity-${alarm.severity}`}>
          {getAlarmSeverityLabel(alarm)}
        </span>
      </div>

      <dl className="fact-list alarm-fact-list">
        <div>
          <dt>지표</dt>
          <dd>{getAlarmMetricLabel(alarm)}</dd>
        </div>
        <div>
          <dt>비교</dt>
          <dd>{getAlarmComparisonLabel(alarm)}</dd>
        </div>
        <div>
          <dt>기준값</dt>
          <dd>{getAlarmThresholdLabel(alarm)}</dd>
        </div>
        <div>
          <dt>관측값</dt>
          <dd>{getAlarmObservedValueLabel(alarm)}</dd>
        </div>
        <div>
          <dt>상태</dt>
          <dd data-testid="alarm-state">{getAlarmStateLabel(alarm)}</dd>
        </div>
        <div>
          <dt>확인</dt>
          <dd data-testid="alarm-ack-status">{getAlarmAcknowledgementLabel(alarm)}</dd>
        </div>
        <div>
          <dt>재배 주기</dt>
          <dd>{resolveAlarmCycleName(alarm, cropCycles)}</dd>
        </div>
        <div>
          <dt>구역</dt>
          <dd>{resolveAlarmAreaName(alarm, areas)}</dd>
        </div>
        <div>
          <dt>장치</dt>
          <dd>{resolveAlarmDeviceName(alarm, devices)}</dd>
        </div>
        {clearedAt !== null && (
          <div>
            <dt>해제 시각</dt>
            <dd>{formatDateTime(clearedAt)}</dd>
          </div>
        )}
        {acknowledgedAt !== null && (
          <div>
            <dt>확인 시각</dt>
            <dd>{formatDateTime(acknowledgedAt)}</dd>
          </div>
        )}
      </dl>

      <div className="control-actions">
        <button
          className="text-button"
          type="button"
          data-testid="alarm-acknowledge"
          onClick={() => onAcknowledgeAlarm(alarm.id)}
          disabled={acknowledging || alarm.acknowledgement !== null}
        >
          {acknowledging ? "확인 처리 중" : "알람 확인"}
        </button>
      </div>
    </article>
  );
}
