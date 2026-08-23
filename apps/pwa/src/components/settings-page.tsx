import type { Device, Farm } from "@smartfarm-os/contracts";
import type { UiLocale } from "../dashboard-model";

export type SettingsPageProps = {
  readonly selectedFarm: Farm | null;
  readonly selectedDevice: Device | null;
  readonly farmCount: number;
  readonly deviceCount: number;
  readonly online: boolean;
  readonly locale: UiLocale;
  readonly localeError: string | null;
  readonly adminUrl: string | null;
  readonly onLocaleChange: (locale: UiLocale) => void;
  readonly onNavigate: (route: string) => void;
};

export function SettingsPage({
  selectedFarm,
  selectedDevice,
  farmCount,
  deviceCount,
  online,
  locale,
  localeError,
  adminUrl,
  onLocaleChange,
  onNavigate,
}: SettingsPageProps) {
  const environmentReady = selectedFarm !== null && selectedDevice !== null;

  return (
    <section className="page-shell settings-page" aria-labelledby="settings-title">
      <header className="page-header">
        <div>
          <p className="section-label">설정</p>
          <h1 id="settings-title">시스템 설정</h1>
          <p className="page-copy">
            현재 농장 연결을 확인하고 접근 보호 범위와 날짜·시간 표시 형식을 관리합니다.
          </p>
        </div>
      </header>

      <div className="panel-grid two-column settings-grid">
        <section
          className="panel-block settings-panel settings-connection-panel"
          aria-labelledby="farm-connection-title"
        >
          <div className="panel-row">
            <div>
              <p className="section-label">작업 범위</p>
              <h2 id="farm-connection-title">농장 연결</h2>
              <p className="muted-copy">
                이 화면에서는 이미 등록된 농장과 장치의 연결 상태만 확인합니다.
              </p>
            </div>
            <span
              className={`status-chip settings-connection-status ${online ? "is-online" : "is-offline"}`}
              data-testid="settings-api-status"
            >
              {online ? "API 연결됨" : "API 연결 안 됨"}
            </span>
          </div>

          <dl className="fact-list settings-fact-list">
            <div>
              <dt>중앙 API 통신</dt>
              <dd>{online ? "정상" : "오프라인 또는 확인 필요"}</dd>
            </div>
            <div>
              <dt>선택 농장</dt>
              <dd data-testid="settings-selected-farm">
                {selectedFarm?.name ?? "선택되지 않음"}
              </dd>
            </div>
            <div>
              <dt>선택 장치</dt>
              <dd data-testid="settings-selected-device">
                {selectedDevice?.name ?? "선택되지 않음"}
              </dd>
            </div>
            <div>
              <dt>장치 상태</dt>
              <dd>{selectedDevice === null ? "확인 대기" : deviceStatusLabel(selectedDevice)}</dd>
            </div>
            <div>
              <dt>등록 범위</dt>
              <dd>{farmCount}개 농장, 선택 농장에 {deviceCount}개 장치</dd>
            </div>
          </dl>

          <div className="form-actions settings-actions">
            <button
              className="primary-control"
              type="button"
              onClick={() => onNavigate("environment")}
              disabled={!environmentReady}
            >
              농장 환경 열기
            </button>
            {adminUrl === null ? (
              <button
                className="secondary-control"
                type="button"
                disabled
                aria-describedby="gateway-enrollment-note"
              >
                관리자 연결 열기
              </button>
            ) : (
              <a
                className="primary-control admin-console-link"
                href={adminUrl}
                target="_blank"
                rel="noreferrer"
                aria-describedby="gateway-enrollment-note"
              >
                관리자 연결 열기
              </a>
            )}
          </div>

          {!environmentReady && (
            <p className="muted-copy">농장 환경을 열려면 농장과 장치를 먼저 선택하세요.</p>
          )}
          <p className="notice" id="gateway-enrollment-note" data-testid="gateway-enrollment-note">
            {adminUrl === null
              ? "관리자 화면 주소가 설정되지 않았습니다. 배포 환경의 PUBLIC_ADMIN_URL을 구성하세요."
              : "분리된 관리자 화면에서 10분짜리 일회용 연결 코드를 발급한 뒤 Raspberry Pi의 Edge 명령에 입력합니다."}
            {" "}이 PWA는 연결 코드나 장치 인증 정보를 받거나 저장하지 않습니다.
          </p>
        </section>

        <section className="panel-block settings-panel" aria-labelledby="access-protection-title">
          <div className="panel-row">
            <div>
              <p className="section-label">보안 경계</p>
              <h2 id="access-protection-title">접근 보호와 OS 비밀번호</h2>
              <p className="muted-copy">게이트웨이 운영체제 계정은 PWA와 분리해 관리합니다.</p>
            </div>
          </div>

          <dl className="fact-list settings-fact-list">
            <div>
              <dt>OS 비밀번호 변경</dt>
              <dd>Raspberry Pi에서 로컬 명령으로 지원</dd>
            </div>
            <div>
              <dt>관리 위치</dt>
              <dd>게이트웨이 터미널</dd>
            </div>
            <div>
              <dt>브라우저 보관</dt>
              <dd>비밀번호와 SSH 인증 정보를 저장하지 않음</dd>
            </div>
          </dl>

          <code className="settings-command" aria-label="Raspberry Pi OS 비밀번호 변경 명령">
            sudo smartfarm-edge passwd --user smartfarm
          </code>
          <p className="notice" id="os-password-note" data-testid="os-password-note">
            Raspberry Pi 터미널에서 위 명령을 실행하면 새 비밀번호를 숨김 입력으로 두 번
            확인한 뒤 로컬 OS 계정에 적용합니다. SmartFarmOS PWA와 중앙 API는 이 비밀번호를
            입력받거나 저장하지 않습니다.
          </p>
        </section>

        <section className="panel-block settings-panel" aria-labelledby="language-region-title">
          <div className="panel-row">
            <div>
              <p className="section-label">표시 형식</p>
              <h2 id="language-region-title">언어 및 지역</h2>
              <p className="muted-copy">시간 기록을 읽는 형식을 선택합니다.</p>
            </div>
          </div>

          <label className="field-stack" htmlFor="settings-locale-select">
            날짜·시간 형식
            <select
              id="settings-locale-select"
              data-testid="settings-locale-select"
              value={locale}
              onChange={(event) => {
                const nextLocale = event.currentTarget.value;
                if (isUiLocale(nextLocale)) onLocaleChange(nextLocale);
              }}
            >
              <option value="ko-KR">한국어 형식 (2026. 8. 12.)</option>
              <option value="en-US">English format (Aug 12, 2026)</option>
            </select>
          </label>

          {localeError !== null && <p className="inline-error" role="alert">{localeError}</p>}

          <dl className="fact-list settings-fact-list">
            <div>
              <dt>현재 형식</dt>
              <dd data-testid="settings-current-locale">
                {locale === "ko-KR" ? "한국어 날짜·시간" : "English date & time"}
              </dd>
            </div>
          </dl>
          <p className="notice" data-testid="settings-locale-scope-note">
            현재 메뉴와 업무 화면 문구는 한국어로 유지됩니다. 이 선택은 날짜·시간 표시 형식만
            바꾸며 비밀번호나 인증 정보를 저장하지 않습니다.
          </p>
        </section>
      </div>
    </section>
  );
}

function isUiLocale(value: string): value is UiLocale {
  return value === "ko-KR" || value === "en-US";
}

function deviceStatusLabel(device: Device): string {
  switch (device.status) {
    case "online":
      return "온라인";
    case "degraded":
      return "점검 필요";
    case "offline":
      return "오프라인";
  }
}
