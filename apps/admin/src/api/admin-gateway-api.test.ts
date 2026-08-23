import { describe, expect, it, vi } from "vitest";
import {
  AdminGatewayApi,
  AdminGatewayApiError,
  type FetchImplementation,
} from "./admin-gateway-api";

const farm = {
  schemaVersion: "smartfarm.farm.v1",
  id: "farm:demo",
  name: "데모 농장",
  timezone: "Asia/Seoul",
  createdAt: "2026-08-12T00:00:00.000Z",
};

const device = {
  schemaVersion: "smartfarm.device.v1",
  id: "device:bed-1",
  farmId: farm.id,
  name: "베드 1 게이트웨이",
  kind: "hybrid",
  capabilities: ["temperature", "pump"],
  status: "online",
  lastSeenAt: "2026-08-12T00:00:00.000Z",
};

const enrollment = {
  schemaVersion: "smartfarm.gateway-enrollment-record.v1",
  id: "gateway-enrollment:demo-1",
  farmId: farm.id,
  deviceId: device.id,
  status: "pending",
  issuedByActorId: "admin:demo",
  issuedAt: "2026-08-12T00:00:00.000Z",
  expiresAt: "2026-08-12T00:10:00.000Z",
  exchangedAt: null,
  exchangedCredentialId: null,
  revokedAt: null,
  revokedByActorId: null,
};

const credential = {
  schemaVersion: "smartfarm.edge-credential-record.v1",
  id: "edge-credential:demo-1",
  farmId: farm.id,
  deviceId: device.id,
  status: "active",
  createdFromEnrollmentId: enrollment.id,
  createdAt: "2026-08-12T00:01:00.000Z",
  revokedAt: null,
  revokedByActorId: null,
};

describe("AdminGatewayApi", () => {
  it("loads the selectable farm and device boundary", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: "smartfarm.farm-list.v1",
        farms: [farm],
      }))
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: "smartfarm.device-list.v1",
        devices: [device],
      }));
    const api = new AdminGatewayApi({ baseUrl: "/api", fetchImplementation });

    expect((await api.listFarms())[0]?.id).toBe(farm.id);
    expect((await api.listDevices(farm.id))[0]?.id).toBe(device.id);
    expect(fetchImplementation.mock.calls[1]?.[0]).toBe("/api/v1/farms/farm%3Ademo/devices");
  });

  it("issues an enrollment token once and maps access records without secret fields", async () => {
    const token = `${enrollment.id}.${"a".repeat(43)}`;
    const fetchImplementation = vi.fn<FetchImplementation>()
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: "smartfarm.issue-gateway-enrollment-response.v1",
        enrollment,
        enrollmentToken: token,
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        schemaVersion: "smartfarm.gateway-access-list.v1",
        enrollments: [enrollment],
        credentials: [credential],
      }));
    const api = new AdminGatewayApi({ baseUrl: "/api", fetchImplementation });

    const issued = await api.issueEnrollment(farm.id, device.id);
    const access = await api.gatewayAccess(farm.id, device.id);

    expect(issued).toEqual({ id: enrollment.id, token, expiresAt: enrollment.expiresAt });
    expect(access.credentials[0]).toEqual({
      id: credential.id,
      status: "active",
      createdAt: credential.createdAt,
      revokedAt: null,
    });
    expect(access).not.toHaveProperty("edgeKey");
    const [, issueInit] = fetchImplementation.mock.calls[0] ?? [];
    expect(issueInit?.method).toBe("POST");
    expect(issueInit?.cache).toBe("no-store");
    expect(issueInit?.credentials).toBe("same-origin");
    expect(issueInit?.body).toBe("{}");
  });

  it("revokes a credential within the exact farm and device path", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>().mockResolvedValue(jsonResponse({
      schemaVersion: "smartfarm.revoke-edge-credential-response.v1",
      credential: {
        ...credential,
        status: "revoked",
        revokedAt: "2026-08-12T00:02:00.000Z",
        revokedByActorId: "admin:demo",
      },
    }));
    const api = new AdminGatewayApi({ baseUrl: "/api", fetchImplementation });

    await api.revokeCredential(farm.id, device.id, credential.id);

    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "/api/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/edge-credentials/edge-credential%3Ademo-1/revocations",
    );
  });

  it("cancels an unconsumed enrollment within the exact farm and device path", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>().mockResolvedValue(jsonResponse({
      schemaVersion: "smartfarm.revoke-gateway-enrollment-response.v1",
      enrollment: {
        ...enrollment,
        status: "revoked",
        revokedAt: "2026-08-12T00:02:00.000Z",
        revokedByActorId: "admin:demo",
      },
    }));
    const api = new AdminGatewayApi({ baseUrl: "/api", fetchImplementation });

    await api.revokeEnrollment(farm.id, device.id, enrollment.id);

    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      "/api/v1/admin/farms/farm%3Ademo/devices/device%3Abed-1/gateway-enrollments/gateway-enrollment%3Ademo-1/revocations",
    );
    const [, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe("{}");
  });

  it("maps contract errors without exposing response details", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>().mockResolvedValue(jsonResponse({
      schemaVersion: "smartfarm.error.v1",
      code: "forbidden",
      message: "Admin role required",
    }, 403));
    const api = new AdminGatewayApi({ baseUrl: "/api", fetchImplementation });

    await expect(api.gatewayAccess(farm.id, device.id)).rejects.toMatchObject({
      kind: "http",
      statusCode: 403,
      apiCode: "forbidden",
    } satisfies Partial<AdminGatewayApiError>);
  });

  it("rejects malformed success responses", async () => {
    const api = new AdminGatewayApi({
      baseUrl: "/api",
      fetchImplementation: vi.fn<FetchImplementation>().mockResolvedValue(jsonResponse({
        enrollmentToken: "not-a-token",
      })),
    });

    await expect(api.issueEnrollment(farm.id, device.id)).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("requires a same-origin reverse-proxy API path", () => {
    expect(() => new AdminGatewayApi({
      baseUrl: "http://api.example.test",
      fetchImplementation: vi.fn<FetchImplementation>(),
    })).toThrowError(/same-origin path/);
    expect(() => new AdminGatewayApi({
      baseUrl: "https://api.example.test",
      fetchImplementation: vi.fn<FetchImplementation>(),
    })).toThrowError(/same-origin path/);
    expect(() => new AdminGatewayApi({
      baseUrl: "/api/../outside",
      fetchImplementation: vi.fn<FetchImplementation>(),
    })).toThrowError(/same-origin path/);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
