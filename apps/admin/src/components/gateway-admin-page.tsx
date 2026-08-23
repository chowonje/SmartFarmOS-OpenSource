import type { Device, Farm } from "@smartfarm-os/contracts";
import type {
  GatewayAccessView,
  IssuedGatewayEnrollment,
} from "../gateway-admin-model";

export type GatewayAdminPageProps = {
  readonly farms: readonly Farm[];
  readonly devices: readonly Device[];
  readonly selectedFarmId: string;
  readonly selectedDeviceId: string;
  readonly access: GatewayAccessView | null;
  readonly issuedEnrollment: IssuedGatewayEnrollment | null;
  readonly loading: boolean;
  readonly busyAction: string | null;
  readonly error: string | null;
  readonly authMode: "demo" | "external";
  readonly onSelectFarm: (farmId: string) => void;
  readonly onSelectDevice: (deviceId: string) => void;
  readonly onIssueEnrollment: () => void;
  readonly onRevokeCredential: (credentialId: string) => void;
  readonly onRevokeEnrollment: (enrollmentId: string) => void;
  readonly onRefresh: () => void;
  readonly onDismissEnrollment: () => void;
};

export function GatewayAdminPage({
  farms,
  devices,
  selectedFarmId,
  selectedDeviceId,
  access,
  issuedEnrollment,
  loading,
  busyAction,
  error,
  authMode,
  onSelectFarm,
  onSelectDevice,
  onIssueEnrollment,
  onRevokeCredential,
  onRevokeEnrollment,
  onRefresh,
  onDismissEnrollment,
}: GatewayAdminPageProps) {
  const canIssue = !loading
    && selectedFarmId !== ""
    && selectedDeviceId !== ""
    && busyAction === null;

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <a href="#main" className="admin-brand" aria-label="SmartFarm OS 관리자 홈">
          <span className="admin-brand-mark" aria-hidden="true">SF</span>
          <span><strong>SmartFarm OS</strong><small>Gateway Administration</small></span>
        </a>
        <span className="admin-role-badge">관리자 전용</span>
      </header>

      <main id="main" className="admin-main">
        <header className="admin-page-header">
          <div>
            <p className="admin-kicker">EDGE ENROLLMENT</p>
            <h1>농장 게이트웨이 연결</h1>
            <p>
              일회성 연결 코드를 발급하고 Raspberry Pi 장치 자격증명을 즉시 폐기합니다.
            </p>
          </div>
          <button type="button" className="secondary-button" onClick={onRefresh} disabled={loading}>
            새로고침
          </button>
        </header>

        {authMode === "demo" && (
          <p className="boundary-note" role="status">
            현재는 로컬 데모 관리자 프록시입니다. 실제 배포에서는 이 앱과 API 앞에 별도
            관리자 인증을 구성해야 합니다.
          </p>
        )}

        {error !== null && <p className="error-note" role="alert">{error}</p>}

        <section className="admin-panel" aria-labelledby="target-title">
          <div className="panel-heading">
            <div><p className="admin-kicker">TARGET</p><h2 id="target-title">연결할 장치 선택</h2></div>
          </div>
          <div className="selector-grid">
            <label>
              <span>농장</span>
              <select
                value={selectedFarmId}
                onChange={(event) => onSelectFarm(event.currentTarget.value)}
                disabled={busyAction !== null}
              >
                {farms.length === 0 && <option value="">등록 농장 없음</option>}
                {farms.map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}
              </select>
            </label>
            <label>
              <span>장치</span>
              <select
                value={selectedDeviceId}
                onChange={(event) => onSelectDevice(event.currentTarget.value)}
                disabled={devices.length === 0 || busyAction !== null}
              >
                {devices.length === 0 && <option value="">등록 장치 없음</option>}
                {devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}
              </select>
            </label>
          </div>
          <div className="button-row">
            <button type="button" className="primary-button" onClick={onIssueEnrollment} disabled={!canIssue}>
              {busyAction === "issue" ? "코드 발급 중" : "10분 연결 코드 발급"}
            </button>
          </div>
        </section>

        {issuedEnrollment !== null && (
          <section className="admin-panel enrollment-result" aria-labelledby="enrollment-result-title">
            <div className="panel-heading">
              <div>
                <p className="admin-kicker">ONE TIME ONLY</p>
                <h2 id="enrollment-result-title">연결 코드가 발급되었습니다</h2>
              </div>
              <button type="button" className="text-button" onClick={onDismissEnrollment}>화면에서 지우기</button>
            </div>
            <p>이 코드는 한 번만 표시되며 {formatDateTime(issuedEnrollment.expiresAt)}에 만료됩니다.</p>
            <output className="token-output" aria-label="일회성 게이트웨이 연결 코드">
              {issuedEnrollment.token}
            </output>
            <ol className="command-steps">
              <li>Raspberry Pi 터미널에서 아래 명령을 실행합니다.</li>
              <li><code>sudo -u smartfarm-edge smartfarm-edge enroll</code></li>
              <li>화면에 표시된 연결 코드를 숨김 입력창에 붙여넣습니다.</li>
              <li><code>sudo -u smartfarm-edge smartfarm-edge credential-status</code>로 설치 상태를 확인합니다.</li>
            </ol>
            <p className="boundary-note">
              코드를 명령행 인수나 환경 변수에 넣지 마세요. 셸 기록과 프로세스 목록에 남을 수 있습니다.
            </p>
          </section>
        )}

        <div className="admin-grid">
          <section className="admin-panel" aria-labelledby="credential-title">
            <div className="panel-heading">
              <div><p className="admin-kicker">CREDENTIALS</p><h2 id="credential-title">장치 자격증명</h2></div>
            </div>
            {access === null || access.credentials.length === 0 ? (
              <p className="empty-copy">발급된 장치 자격증명이 없습니다.</p>
            ) : (
              <ul className="record-list">
                {access.credentials.map((credential) => (
                  <li key={credential.id}>
                    <div>
                      <strong>{credential.status === "active" ? "활성" : "폐기됨"}</strong>
                      <span>{credential.id}</span>
                      <time dateTime={credential.createdAt}>{formatDateTime(credential.createdAt)}</time>
                    </div>
                    {credential.status === "active" && (
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => onRevokeCredential(credential.id)}
                        disabled={busyAction !== null}
                      >
                        {busyAction === credential.id ? "폐기 중" : "즉시 폐기"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="admin-panel" aria-labelledby="enrollment-history-title">
            <div className="panel-heading">
              <div>
                <p className="admin-kicker">ENROLLMENT HISTORY</p>
                <h2 id="enrollment-history-title">최근 연결 코드 상태</h2>
              </div>
            </div>
            {access === null || access.enrollments.length === 0 ? (
              <p className="empty-copy">발급된 연결 코드가 없습니다.</p>
            ) : (
              <ul className="record-list">
                {access.enrollments.map((enrollment) => (
                  <li key={enrollment.id}>
                    <div>
                      <strong>{enrollmentStatusLabel(enrollment.status)}</strong>
                      <span>{enrollment.id}</span>
                      <time dateTime={enrollment.expiresAt}>
                        만료 {formatDateTime(enrollment.expiresAt)}
                      </time>
                    </div>
                    {(enrollment.status === "pending" || enrollment.status === "expired") && (
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => onRevokeEnrollment(enrollment.id)}
                        disabled={busyAction !== null}
                      >
                        {busyAction === enrollment.id ? "취소 중" : "연결 코드 취소"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="admin-panel" aria-labelledby="password-title">
            <div className="panel-heading">
              <div><p className="admin-kicker">PI LOCAL</p><h2 id="password-title">OS 비밀번호 변경</h2></div>
            </div>
            <p>
              Linux 비밀번호는 중앙 서버나 브라우저를 거치지 않고 Raspberry Pi에서 직접 변경합니다.
            </p>
            <code className="command-output">sudo smartfarm-edge passwd --user smartfarm</code>
            <p className="boundary-note">
              명령은 새 비밀번호를 터미널에서 숨김 입력으로 두 번 확인하고 Pi의 시스템 계정에 직접 적용합니다.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function enrollmentStatusLabel(status: GatewayAccessView["enrollments"][number]["status"]): string {
  switch (status) {
    case "pending":
      return "입력 대기";
    case "exchanged":
      return "연결 완료";
    case "expired":
      return "만료됨";
    case "revoked":
      return "취소됨";
  }
}
