import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DeviceSchema, FarmSchema } from "@smartfarm-os/contracts";
import { OverviewPage, type OverviewQuickLink } from "./overview-page";

const farm = FarmSchema.parse({
  schemaVersion: "smartfarm.farm.v1",
  id: "farm:demo",
  name: "대회 데모 농장",
  timezone: "Asia/Seoul",
  createdAt: "2026-08-12T00:00:00.000Z",
});

const device = DeviceSchema.parse({
  schemaVersion: "smartfarm.device.v1",
  id: "device:bed-1",
  farmId: "farm:demo",
  name: "베드 1 컨트롤러",
  kind: "hybrid",
  capabilities: ["temperature", "humidity", "pump"],
  status: "online",
  lastSeenAt: "2026-08-12T00:00:00.000Z",
});

const quickLinks: readonly OverviewQuickLink[] = [
  { route: "operations", label: "작물 운영", description: "재배 구역을 비교합니다." },
  { route: "alarms", label: "알람 센터", description: "활성 알람을 확인합니다." },
  { route: "crops", label: "작물일지", description: "작물 기록을 남깁니다." },
  { route: "control", label: "농장 컨트롤", description: "장치를 제어합니다." },
  { route: "weather", label: "날씨·위치", description: "외부 정보를 확인합니다." },
  { route: "environment", label: "농장 환경", description: "센서 상태를 확인합니다." },
];

describe("OverviewPage", () => {
  it("prioritizes core work while keeping supporting tools available", () => {
    const html = renderOverview(farm, device);

    expect(html).toContain("오늘의 농장 운영");
    expect(html).toContain("운영 준비 상태");
    expect(html).toContain("장치 정상");
    expect(html).toContain("선택 완료");
    expect(html).toContain("등록 농장");
    expect(html).toContain("선택 농장 장치");
    expect(html).toContain('class="quick-link-button overview-lead-action"');
    expect(html).toMatch(/overview-lead-action[\s\S]*작물 운영/);
    expect(html).toContain("먼저 확인할 업무");
    expect(html).toContain("알람 센터");
    expect(html).toMatch(/overview-supporting-action[\s\S]*작물일지/);
    expect(html).toContain("운영 도구");
    expect(html).toMatch(/overview-tool-link[\s\S]*농장 컨트롤/);
    expect(html).toContain("날씨·위치");
    expect(html).toContain("농장 환경");
  });

  it("uses the configured home-card order instead of fixed route priorities", () => {
    const reorderedLinks = [quickLinks[3]!, quickLinks[0]!, quickLinks[1]!, quickLinks[2]!];
    const html = renderOverview(farm, device, reorderedLinks);

    expect(html).toMatch(/overview-lead-action[\s\S]*농장 컨트롤/);
    expect(html).toMatch(/overview-supporting-action[\s\S]*작물 운영/);
    expect(html).toMatch(/overview-tool-link[\s\S]*작물일지/);
  });

  it("makes an incomplete work scope explicit", () => {
    const html = renderOverview(null, null);

    expect(html).toContain("농장과 장치를 선택해 주세요");
    expect(html).toContain("장치 선택 대기");
    expect(html).toContain("선택 필요");
  });

  it("shows an explicit empty state when every optional module is disabled", () => {
    const html = renderOverview(farm, device, []);

    expect(html).toContain("활성화된 업무 화면이 없습니다.");
    expect(html).not.toContain('id="overview-tools-title"');
  });
});

function renderOverview(
  selectedFarm: typeof farm | null,
  selectedDevice: typeof device | null,
  links: readonly OverviewQuickLink[] = quickLinks,
): string {
  return renderToStaticMarkup(
    <OverviewPage
      selectedFarm={selectedFarm}
      selectedDevice={selectedDevice}
      farmCount={1}
      deviceCount={2}
      quickLinks={links}
      onNavigate={() => {}}
    />,
  );
}
