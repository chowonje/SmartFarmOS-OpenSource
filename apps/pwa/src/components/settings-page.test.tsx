import { DeviceSchema, FarmSchema } from "@smartfarm-os/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsPage } from "./settings-page";

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

describe("SettingsPage", () => {
  it("shows current connection facts without accepting gateway credentials", () => {
    const html = renderSettings();

    expect(html).toContain("시스템 설정");
    expect(html).toContain("농장 연결");
    expect(html).toContain("API 연결됨");
    expect(html).toContain("대회 데모 농장");
    expect(html).toContain("베드 1 컨트롤러");
    expect(html).toContain("온라인");
    expect(html).toContain("2개 농장, 선택 농장에 3개 장치");
    expect(html).toContain("농장 환경 열기");
    expect(html).toContain('href="http://127.0.0.1:5174"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("10분짜리 일회용 연결 코드");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('name="credential"');
  });

  it("keeps OS passwords outside the PWA security boundary", () => {
    const html = renderSettings();

    expect(html).toContain("접근 보호와 OS 비밀번호");
    expect(html).toContain("Raspberry Pi에서 로컬 명령으로 지원");
    expect(html).toContain("게이트웨이 터미널");
    expect(html).toContain("비밀번호와 SSH 인증 정보를 저장하지 않음");
    expect(html).toContain("sudo smartfarm-edge passwd --user smartfarm");
    expect(html).not.toContain("localStorage");
  });

  it("offers only the supported date-time locales and states the translation scope", () => {
    const koreanHtml = renderSettings("ko-KR");
    const englishHtml = renderSettings("en-US");

    expect(koreanHtml).toContain('<option value="ko-KR" selected="">한국어 형식');
    expect(koreanHtml).toContain('<option value="en-US">English format');
    expect(englishHtml).toContain('<option value="en-US" selected="">English format');
    expect(englishHtml).toContain("English date &amp; time");
    expect(englishHtml).toContain("메뉴와 업무 화면 문구는 한국어로 유지됩니다");
    expect(englishHtml).toContain("날짜·시간 표시 형식만");
  });

  it("makes missing farm and device selection explicit", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        selectedFarm={null}
        selectedDevice={null}
        farmCount={0}
        deviceCount={0}
        online={false}
        locale="ko-KR"
        localeError={null}
        adminUrl={null}
        onLocaleChange={() => {}}
        onNavigate={() => {}}
      />,
    );

    expect(html).toContain("API 연결 안 됨");
    expect((html.match(/선택되지 않음/g) ?? [])).toHaveLength(2);
    expect(html).toContain("농장과 장치를 먼저 선택하세요");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>농장 환경 열기<\/button>/);
    expect(html).toContain("관리자 화면 주소가 설정되지 않았습니다");
  });

  it("reports a locale persistence failure without implying that the selection succeeded", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        selectedFarm={farm}
        selectedDevice={device}
        farmCount={2}
        deviceCount={3}
        online
        locale="ko-KR"
        localeError="날짜·시간 형식을 저장할 수 없습니다."
        adminUrl="http://127.0.0.1:5174"
        onLocaleChange={() => {}}
        onNavigate={() => {}}
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("날짜·시간 형식을 저장할 수 없습니다.");
    expect(html).toContain('<option value="ko-KR" selected="">');
  });
});

function renderSettings(locale: "ko-KR" | "en-US" = "ko-KR"): string {
  return renderToStaticMarkup(
    <SettingsPage
      selectedFarm={farm}
      selectedDevice={device}
      farmCount={2}
      deviceCount={3}
      online
      locale={locale}
      localeError={null}
      adminUrl="http://127.0.0.1:5174"
      onLocaleChange={() => {}}
      onNavigate={() => {}}
    />,
  );
}
