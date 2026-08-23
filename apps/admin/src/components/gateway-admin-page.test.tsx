import { DeviceSchema, FarmSchema } from "@smartfarm-os/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GatewayAdminPage } from "./gateway-admin-page";

const farm = FarmSchema.parse({
  schemaVersion: "smartfarm.farm.v1",
  id: "farm:demo",
  name: "데모 농장",
  timezone: "Asia/Seoul",
  createdAt: "2026-08-12T00:00:00.000Z",
});

const device = DeviceSchema.parse({
  schemaVersion: "smartfarm.device.v1",
  id: "device:bed-1",
  farmId: farm.id,
  name: "베드 1 게이트웨이",
  kind: "hybrid",
  capabilities: ["temperature", "pump"],
  status: "online",
  lastSeenAt: "2026-08-12T00:00:00.000Z",
});

describe("GatewayAdminPage", () => {
  it("keeps enrollment usable without collecting Edge or Linux passwords", () => {
    const html = renderPage();

    expect(html).toContain("농장 게이트웨이 연결");
    expect(html).toContain("10분 연결 코드 발급");
    expect(html).toContain("sudo smartfarm-edge passwd --user smartfarm");
    expect(html).toContain("credential:demo");
    expect(html).toContain("즉시 폐기");
    expect(html).toContain("연결 코드 취소");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain("localStorage");
  });

  it("shows a one-time token only from ephemeral component state", () => {
    const html = renderPage({
      id: "enrollment:demo",
      token: "enrollment:demo.secret-once",
      expiresAt: "2026-08-12T00:10:00.000Z",
    });

    expect(html).toContain("ONE TIME ONLY");
    expect(html).toContain("enrollment:demo.secret-once");
    expect(html).toContain("화면에서 지우기");
    expect(html).toContain("명령행 인수나 환경 변수에 넣지 마세요");
    expect(html).toContain("sudo -u smartfarm-edge smartfarm-edge enroll");
  });
});

function renderPage(issuedEnrollment: Parameters<typeof GatewayAdminPage>[0]["issuedEnrollment"] = null): string {
  return renderToStaticMarkup(
    <GatewayAdminPage
      farms={[farm]}
      devices={[device]}
      selectedFarmId={farm.id}
      selectedDeviceId={device.id}
      access={{
        farmId: farm.id,
        deviceId: device.id,
        enrollments: [{
          id: "gateway-enrollment:demo",
          status: "pending",
          issuedAt: "2026-08-12T00:00:00.000Z",
          expiresAt: "2026-08-12T00:10:00.000Z",
          exchangedAt: null,
        }],
        credentials: [{
          id: "credential:demo",
          status: "active",
          createdAt: "2026-08-12T00:00:00.000Z",
          revokedAt: null,
        }],
      }}
      issuedEnrollment={issuedEnrollment}
      loading={false}
      busyAction={null}
      error={null}
      authMode="demo"
      onSelectFarm={() => {}}
      onSelectDevice={() => {}}
      onIssueEnrollment={() => {}}
      onRevokeCredential={() => {}}
      onRevokeEnrollment={() => {}}
      onRefresh={() => {}}
      onDismissEnrollment={() => {}}
    />,
  );
}
