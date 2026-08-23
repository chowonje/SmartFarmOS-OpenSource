import type { Device, Farm } from "@smartfarm-os/contracts";

export type OverviewQuickLink = {
  readonly route: string;
  readonly label: string;
  readonly description: string;
};

type OverviewPageProps = {
  readonly selectedFarm: Farm | null;
  readonly selectedDevice: Device | null;
  readonly farmCount: number;
  readonly deviceCount: number;
  readonly quickLinks: readonly OverviewQuickLink[];
  readonly onNavigate: (route: string) => void;
};

export function OverviewPage({
  selectedFarm,
  selectedDevice,
  farmCount,
  deviceCount,
  quickLinks,
  onNavigate,
}: OverviewPageProps) {
  const leadLink = quickLinks[0] ?? null;
  const supportingLinks = quickLinks.slice(1, 3);
  const utilityLinks = quickLinks.slice(3);
  const scopeReady = selectedFarm !== null && selectedDevice !== null;
  const deviceStatus = selectedDevice === null
    ? { label: "선택 대기", className: "is-pending" }
    : selectedDevice.status === "online"
      ? { label: "정상", className: "is-ready" }
      : selectedDevice.status === "degraded"
        ? { label: "주의", className: "is-warning" }
        : { label: "오프라인", className: "is-offline" };

  return (
    <section className="page-shell overview-page" aria-labelledby="overview-title">
      <header className="page-header overview-page-header">
        <div>
          <p className="section-label">개요</p>
          <h1 id="overview-title">오늘의 농장 운영</h1>
          <p className="page-copy">
            선택한 농장 기준으로 우선 확인할 업무와 보조 도구를 한 화면에서 시작하세요.
          </p>
        </div>
      </header>

      <section className="panel-block overview-status-panel" aria-labelledby="overview-status-title">
        <div className="overview-section-heading">
          <div>
            <h2 id="overview-status-title">운영 준비 상태</h2>
            <p className="muted-copy">
              {scopeReady
                ? `${selectedFarm.name}에서 선택한 장치를 기준으로 업무를 이어갑니다.`
                : "왼쪽 작업 범위에서 농장과 장치를 선택해 주세요."}
            </p>
          </div>
          <span className={`overview-device-status ${deviceStatus.className}`}>
            장치 {deviceStatus.label}
          </span>
        </div>

        <dl className="overview-fact-grid">
          <div>
            <dt>작업 범위</dt>
            <dd>{scopeReady ? "선택 완료" : "선택 필요"}</dd>
          </div>
          <div>
            <dt>등록 농장</dt>
            <dd>{farmCount}개</dd>
          </div>
          <div>
            <dt>선택 농장 장치</dt>
            <dd>{deviceCount}개</dd>
          </div>
        </dl>
      </section>

      <div
        className={`overview-workspace-grid ${utilityLinks.length === 0 ? "is-single-column" : ""}`}
      >
        <section
          className="panel-block overview-actions-panel"
          aria-labelledby="overview-primary-title"
        >
          <div className="overview-section-heading">
            <div>
              <h2 id="overview-primary-title">먼저 확인할 업무</h2>
              <p className="muted-copy">활성화된 운영 순서에 따라 앞선 화면을 먼저 표시합니다.</p>
            </div>
          </div>

          {leadLink !== null && (
            <button
              className="quick-link-button overview-lead-action"
              type="button"
              onClick={() => onNavigate(leadLink.route)}
            >
              <span>
                <strong>{leadLink.label}</strong>
                <small>{leadLink.description}</small>
              </span>
              <span className="overview-action-hint" aria-hidden="true">열기</span>
            </button>
          )}

          <div className="overview-supporting-actions">
            {supportingLinks.map((item) => (
              <button
                key={item.route}
                className="quick-link-button overview-supporting-action"
                type="button"
                onClick={() => onNavigate(item.route)}
              >
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <span className="overview-action-hint" aria-hidden="true">열기</span>
              </button>
            ))}
          </div>

          {leadLink === null && (
            <p className="overview-empty-note">활성화된 업무 화면이 없습니다.</p>
          )}
        </section>

        {utilityLinks.length > 0 && (
          <section
            className="panel-block overview-tools-panel"
            aria-labelledby="overview-tools-title"
          >
            <div className="overview-section-heading">
              <div>
                <h2 id="overview-tools-title">운영 도구</h2>
                <p className="muted-copy">추가 업무와 상세 화면으로 이동합니다.</p>
              </div>
            </div>

            <div className="overview-tool-list">
              {utilityLinks.map((item) => (
                <button
                  key={item.route}
                  className="overview-tool-link"
                  type="button"
                  onClick={() => onNavigate(item.route)}
                >
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
                  </span>
                  <span className="overview-action-hint" aria-hidden="true">열기</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
