import type { Device, Farm } from "@smartfarm-os/contracts";

type ScopeSidebarProps = {
  readonly farms: readonly Farm[];
  readonly devices: readonly Device[];
  readonly selectedFarmId: string | null;
  readonly selectedDeviceId: string | null;
  readonly selectedFarm: Farm | null;
  readonly selectedDevice: Device | null;
  readonly farmsLoading: boolean;
  readonly devicesLoading: boolean;
  readonly error: string | null;
  readonly onFarmChange: (farmId: string) => void;
  readonly onDeviceChange: (deviceId: string) => void;
};

export function ScopeSidebar({
  farms,
  devices,
  selectedFarmId,
  selectedDeviceId,
  selectedFarm,
  selectedDevice,
  farmsLoading,
  devicesLoading,
  error,
  onFarmChange,
  onDeviceChange,
}: ScopeSidebarProps) {
  return (
    <section className="panel-block scope-panel" aria-labelledby="scope-title">
      <div className="page-header compact-header">
        <div>
          <p className="section-label">작업 범위</p>
          <h2 id="scope-title">농장과 장치 선택</h2>
        </div>
      </div>

      <div className="scope-form">
        <label className="field-stack">
          <span>농장</span>
          <select
            aria-label="농장 선택"
            value={selectedFarmId ?? ""}
            onChange={(event) => onFarmChange(event.target.value)}
            disabled={farmsLoading || farms.length === 0}
          >
            {selectedFarmId === null && <option value="">농장을 선택하세요</option>}
            {farms.map((farm) => (
              <option key={farm.id} value={farm.id}>{farm.name}</option>
            ))}
          </select>
        </label>

        <label className="field-stack">
          <span>장치</span>
          <select
            aria-label="장치 선택"
            value={selectedDeviceId ?? ""}
            onChange={(event) => onDeviceChange(event.target.value)}
            disabled={devicesLoading || devices.length === 0}
          >
            {selectedDeviceId === null && <option value="">장치를 선택하세요</option>}
            {devices.map((device) => (
              <option key={device.id} value={device.id}>{device.name}</option>
            ))}
          </select>
        </label>
      </div>

      <dl className="scope-facts">
        <div>
          <dt>현재 농장</dt>
          <dd>{selectedFarm?.name ?? "선택 대기"}</dd>
        </div>
        <div>
          <dt>현재 장치</dt>
          <dd>{selectedDevice?.name ?? "선택 대기"}</dd>
        </div>
        <div>
          <dt>장치 상태</dt>
          <dd>{selectedDevice === null ? "선택 대기" : selectedDevice.status === "online" ? "온라인" : selectedDevice.status === "degraded" ? "주의" : "오프라인"}</dd>
        </div>
      </dl>

      {error !== null && <p className="inline-error" role="alert">{error}</p>}
    </section>
  );
}
