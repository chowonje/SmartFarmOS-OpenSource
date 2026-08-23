import { useEffect, useMemo, useState } from "react";
import type {
  Device,
  Farm,
  FarmControlProfile,
  FarmControlWidget,
  PumpState,
} from "@smartfarm-os/contracts";
import { commandStatusLabel, pumpStateLabel } from "../dashboard-model";
import type { CommandViewState, FarmControlProfileViewState } from "./page-state";

type ControlViewProps = {
  readonly farm: Farm | null;
  readonly device: Device | null;
  readonly devices: readonly Device[];
  readonly online: boolean;
  readonly command: CommandViewState;
  readonly controlProfile: FarmControlProfileViewState;
  readonly onSelectDevice: (deviceId: string) => void;
  readonly onRequestPumpState: (state: PumpState) => void;
  readonly onRefreshControlProfile: () => void;
  readonly onSaveControlProfile: (
    widgets: readonly FarmControlWidget[],
  ) => Promise<boolean>;
};

type ControlProfileDraftRow = {
  readonly deviceId: Device["id"];
  readonly enabled: boolean;
  readonly label: string;
  readonly showStart: boolean;
};

export const MAX_FARM_CONTROL_WIDGETS = 16;

export function isControlProfileEnableDisabled(
  enabled: boolean,
  enabledCount: number,
): boolean {
  return !enabled && enabledCount >= MAX_FARM_CONTROL_WIDGETS;
}

export function ControlView({
  farm,
  device,
  devices,
  online,
  command,
  controlProfile,
  onSelectDevice,
  onRequestPumpState,
  onRefreshControlProfile,
  onSaveControlProfile,
}: ControlViewProps) {
  const pumpState = command.projection?.ack?.result?.pumpState ?? null;
  const commandStatus = command.projection?.status ?? null;
  const softwareStopNoteId = "software-stop-note";
  const pumpDevices = useMemo(
    () => devices.filter((candidate) => candidate.capabilities.includes("pump")),
    [devices],
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<readonly ControlProfileDraftRow[]>(
    () => createControlProfileDraft(pumpDevices, controlProfile.profile),
  );

  useEffect(() => {
    if (!editing) {
      setDraft(createControlProfileDraft(pumpDevices, controlProfile.profile));
    }
  }, [controlProfile.profile, editing, pumpDevices]);

  const profileWidgetByDeviceId = useMemo(
    () => new Map(
      (controlProfile.profile?.widgets ?? []).map((widget) => [widget.deviceId, widget]),
    ),
    [controlProfile.profile],
  );
  const deviceById = useMemo(
    () => new Map(devices.map((candidate) => [candidate.id, candidate])),
    [devices],
  );
  const selectedWidget = device === null ? null : profileWidgetByDeviceId.get(device.id) ?? null;
  const selectedDeviceLabel = selectedWidget?.label ?? device?.name ?? "장치 선택 대기";
  const enabledDraftCount = draft.filter((row) => row.enabled).length;

  const beginEditing = () => {
    setDraft(createControlProfileDraft(pumpDevices, controlProfile.profile));
    setEditing(true);
  };

  const updateDraft = (
    deviceId: Device["id"],
    update: (row: ControlProfileDraftRow) => ControlProfileDraftRow,
  ) => {
    setDraft((current) => current.map((row) => row.deviceId === deviceId ? update(row) : row));
  };

  const saveDraft = async () => {
    const widgets = draft
      .filter((row) => row.enabled)
      .map((row) => ({
        schemaVersion: "smartfarm.farm-control-widget.v1" as const,
        kind: "pump_control" as const,
        deviceId: row.deviceId,
        label: row.label.trim(),
        showStart: row.showStart,
      }));
    if (widgets.some((widget) => widget.label.length === 0)) return;
    if (await onSaveControlProfile(widgets)) setEditing(false);
  };

  return (
    <section className="page-shell" aria-labelledby="control-title">
      <header className="page-header">
        <div>
          <p className="section-label">농장 컨트롤</p>
          <h1 id="control-title">급수 장치 제어</h1>
          <p className="page-copy">
            현재 선택한 농장과 장치를 제어하고, 농장 설비에 맞춰 제어 카드를 구성합니다.
          </p>
        </div>
      </header>

      <section className="panel-block" aria-labelledby="pump-title">
        <div className="panel-row">
          <div>
            <p className="section-label">선택 장치</p>
            <h2 id="pump-title">{selectedDeviceLabel}</h2>
            <p className="muted-copy">{farm?.name ?? "농장을 먼저 선택하세요."}</p>
          </div>
          <span className={`pump-state pump-${pumpState ?? "unknown"}`}>
            {pumpStateLabel(pumpState)}
          </span>
        </div>

        <div className="control-actions" aria-label="펌프 제어">
          {selectedWidget?.showStart === true && (
            <button
              className="primary-control"
              type="button"
              data-testid="pump-on"
              onClick={() => onRequestPumpState("on")}
              disabled={command.busy || !online || pumpState === "on" || device === null}
            >
              펌프 켜기
            </button>
          )}
          <button
            className="secondary-control"
            type="button"
            data-testid="pump-off"
            aria-label="즉시 정지 (소프트웨어)"
            aria-describedby={softwareStopNoteId}
            onClick={() => onRequestPumpState("off")}
            disabled={command.busy || !online || device === null}
          >
            즉시 정지 (소프트웨어)
          </button>
        </div>
        <p id={softwareStopNoteId} className="muted-copy">
          이 기능은 물리 비상정지 버튼이나 안전 인터록을 대체하지 않습니다.
        </p>

        <div className="command-result" aria-live="polite">
          <div>
            <span className="result-label">명령 상태</span>
            <strong data-testid="command-status">
              {command.busy && command.projection === null ? "명령 전송 중" : commandStatusLabel(commandStatus)}
            </strong>
          </div>
          {command.requestedState !== null && (
            <span className="requested-state">
              요청: {command.requestedState === "on" ? "켜기" : "끄기"}
            </span>
          )}
        </div>

        {command.error !== null && <p className="inline-error" role="alert">{command.error}</p>}
      </section>

      <section className="panel-block" aria-labelledby="custom-control-title" data-testid="farm-control-profile">
        <div className="panel-row">
          <div>
            <p className="section-label">농장별 개인화</p>
            <h2 id="custom-control-title">맞춤 제어 카드</h2>
            <p className="muted-copy">
              검토된 펌프 제어 기능만 장치별 카드로 배치하며 임의 코드나 명령은 실행하지 않습니다.
            </p>
          </div>
          <span className="count-pill" data-testid="control-profile-revision">
            개정 {controlProfile.profile?.revision ?? 0}
          </span>
        </div>

        <div className="page-actions">
          <button
            className="secondary-control"
            type="button"
            data-testid="edit-control-profile"
            onClick={beginEditing}
            disabled={farm === null || controlProfile.loading || controlProfile.saving || editing}
          >
            맞춤 설정 편집
          </button>
          <button
            className="text-button"
            type="button"
            onClick={onRefreshControlProfile}
            disabled={farm === null || controlProfile.loading || controlProfile.refreshing || controlProfile.saving}
          >
            {controlProfile.refreshing ? "새로고침 중" : "새로고침"}
          </button>
        </div>

        <p className="notice control-profile-safety-note">
          안전을 위해 모든 맞춤 카드에는 소프트웨어 정지가 항상 표시되며 숨길 수 없습니다.
        </p>

        {controlProfile.loading && controlProfile.profile === null ? (
          <div className="loading-state">맞춤 제어 설정을 불러오는 중입니다.</div>
        ) : editing ? (
          <div className="control-profile-editor" data-testid="control-profile-editor">
            <p className="muted-copy">
              한 농장에 최대 {MAX_FARM_CONTROL_WIDGETS}개의 제어 카드를 표시할 수 있습니다.
            </p>
            {draft.length === 0 ? (
              <div className="empty-state">펌프 기능을 제공하는 장치가 없습니다.</div>
            ) : draft.map((row) => {
              const target = deviceById.get(row.deviceId);
              return (
                <fieldset
                  className="control-profile-editor-row"
                  key={row.deviceId}
                  data-testid={`control-profile-editor-${row.deviceId}`}
                >
                  <legend>{target?.name ?? row.deviceId}</legend>
                  <label className="control-profile-checkbox">
                    <input
                      type="checkbox"
                      data-testid={`control-profile-enabled-${row.deviceId}`}
                      checked={row.enabled}
                      disabled={isControlProfileEnableDisabled(row.enabled, enabledDraftCount)}
                      onChange={(event) => {
                        const enabled = event.currentTarget.checked;
                        updateDraft(row.deviceId, (current) => ({ ...current, enabled }));
                      }}
                    />
                    맞춤 컨트롤에 표시
                  </label>
                  <label className="field-stack">
                    표시 이름
                    <input
                      type="text"
                      data-testid={`control-profile-label-${row.deviceId}`}
                      value={row.label}
                      maxLength={80}
                      disabled={!row.enabled}
                      onChange={(event) => {
                        const label = event.currentTarget.value;
                        updateDraft(row.deviceId, (current) => ({ ...current, label }));
                      }}
                    />
                  </label>
                  <label className="control-profile-checkbox">
                    <input
                      type="checkbox"
                      data-testid={`control-profile-start-${row.deviceId}`}
                      checked={row.showStart}
                      disabled={!row.enabled}
                      onChange={(event) => {
                        const showStart = event.currentTarget.checked;
                        updateDraft(row.deviceId, (current) => ({ ...current, showStart }));
                      }}
                    />
                    펌프 시작 버튼 표시
                  </label>
                </fieldset>
              );
            })}
            <div className="form-actions">
              <button
                className="primary-control"
                type="button"
                data-testid="save-control-profile"
                onClick={() => void saveDraft()}
                disabled={
                  controlProfile.saving
                  || enabledDraftCount > MAX_FARM_CONTROL_WIDGETS
                  || draft.some((row) => row.enabled && row.label.trim().length === 0)
                }
              >
                {controlProfile.saving ? "저장 중" : "맞춤 설정 저장"}
              </button>
              <button
                className="secondary-control"
                type="button"
                onClick={() => setEditing(false)}
                disabled={controlProfile.saving}
              >
                취소
              </button>
            </div>
          </div>
        ) : controlProfile.profile === null || controlProfile.profile.widgets.length === 0 ? (
          <div className="empty-state">표시 중인 맞춤 제어 카드가 없습니다. 편집에서 장치를 추가하세요.</div>
        ) : (
          <div className="control-profile-grid" data-testid="control-profile-grid">
            {controlProfile.profile.widgets.map((widget) => {
              const target = deviceById.get(widget.deviceId);
              const selected = device?.id === widget.deviceId;
              return (
                <article
                  className={`control-profile-card${selected ? " is-selected" : ""}`}
                  key={widget.deviceId}
                  data-testid={`control-profile-card-${widget.deviceId}`}
                >
                  <div className="control-profile-card-header">
                    <div>
                      <h3>{widget.label}</h3>
                      <p>{target?.name ?? "등록 해제된 장치"}</p>
                    </div>
                    <span className={`status-chip status-${target?.status ?? "offline"}`}>
                      {target?.status === "online" ? "온라인" : target?.status === "degraded" ? "점검 필요" : "오프라인"}
                    </span>
                  </div>
                  {selected ? (
                    <div className="control-actions">
                      {widget.showStart && (
                        <button
                          className="primary-control"
                          type="button"
                          onClick={() => onRequestPumpState("on")}
                          disabled={command.busy || !online || pumpState === "on"}
                        >
                          펌프 켜기
                        </button>
                      )}
                      <button
                        className="secondary-control"
                        type="button"
                        onClick={() => onRequestPumpState("off")}
                        disabled={command.busy || !online}
                      >
                        소프트웨어 정지
                      </button>
                    </div>
                  ) : (
                    <button
                      className="secondary-control"
                      type="button"
                      onClick={() => onSelectDevice(widget.deviceId)}
                      disabled={target === undefined}
                    >
                      이 장치 선택
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {controlProfile.error !== null && <p className="inline-error" role="alert">{controlProfile.error}</p>}
        {controlProfile.notice !== null && <p className="success-notice" role="status">{controlProfile.notice}</p>}
      </section>
    </section>
  );
}

export function createControlProfileDraft(
  devices: readonly Device[],
  profile: FarmControlProfile | null,
): readonly ControlProfileDraftRow[] {
  const widgetByDeviceId = new Map(
    (profile?.widgets ?? []).map((widget) => [widget.deviceId, widget]),
  );
  return devices.filter((target) => target.capabilities.includes("pump")).map((target) => {
    const widget = widgetByDeviceId.get(target.id);
    return {
      deviceId: target.id,
      enabled: widget !== undefined,
      label: widget?.label ?? target.name,
      showStart: widget?.showStart ?? true,
    };
  });
}
