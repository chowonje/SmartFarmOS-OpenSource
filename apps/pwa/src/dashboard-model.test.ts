import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandProjectionSchema,
  CropRecordSchema,
  DeviceSchema,
  FarmSchema,
  LatestTelemetryResponseSchema,
} from "@smartfarm-os/contracts";
import { SmartFarmApiError } from "./api/smart-farm-api";
import {
  cacheCommandProjection,
  cacheTelemetry,
  commandStatusLabel,
  createAlarmAcknowledgementIdempotencyKey,
  createCropDraftFromRecord,
  createCropRequestFromDraft,
  createEmptyCropDraft,
  createIdempotencyKey,
  formatDateTime,
  removeCachedTelemetry,
  patchCropRequestFromDraft,
  readBrowserUiLocale,
  readCachedCommandProjection,
  readCachedTelemetry,
  readSelectedDeviceId,
  readSelectedFarmId,
  readUiLocale,
  removeCropRecord,
  resolveDeviceSelection,
  resolveFarmSelection,
  sortCropRecords,
  upsertCropRecord,
  userFacingError,
  writeSelectedDeviceId,
  writeSelectedFarmId,
  writeBrowserUiLocale,
  writeUiLocale,
  type KeyValueStorage,
} from "./dashboard-model";

const latest = LatestTelemetryResponseSchema.parse({
  schemaVersion: "smartfarm.latest-telemetry.v1",
  telemetry: {
    schemaVersion: "smartfarm.telemetry.v1",
    id: "telemetry:bed-1-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    metric: "temperature",
    value: 24.5,
    unit: "celsius",
    sequence: 1,
    observedAt: "2026-07-17T00:00:00.000Z",
  },
});

const humidityLatest = LatestTelemetryResponseSchema.parse({
  schemaVersion: "smartfarm.latest-telemetry.v1",
  telemetry: {
    schemaVersion: "smartfarm.telemetry.v1",
    id: "telemetry:bed-1-000002",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    metric: "humidity",
    value: 61.2,
    unit: "percent",
    sequence: 2,
    observedAt: "2026-07-17T00:01:00.000Z",
  },
});

const otherScopeLatest = LatestTelemetryResponseSchema.parse({
  schemaVersion: "smartfarm.latest-telemetry.v1",
  telemetry: {
    schemaVersion: "smartfarm.telemetry.v1",
    id: "telemetry:bed-2-000001",
    farmId: "farm:secondary",
    deviceId: "device:bed-2",
    metric: "temperature",
    value: 19.8,
    unit: "celsius",
    sequence: 1,
    observedAt: "2026-07-17T00:02:00.000Z",
  },
});

const completedCommand = CommandProjectionSchema.parse({
  schemaVersion: "smartfarm.command-projection.v1",
  command: {
    schemaVersion: "smartfarm.command.v1",
    id: "command:pump-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    payload: { action: "set_pump_state", state: "on" },
    actor: { type: "user", id: "user:demo" },
    idempotencyKey: "pwa-pump-000001",
    issuedAt: "2026-07-17T00:00:00.000Z",
    expiresAt: "2026-07-17T00:01:00.000Z",
  },
  status: "acknowledged",
  ack: {
    schemaVersion: "smartfarm.command-ack.v1",
    commandId: "command:pump-000001",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    status: "acknowledged",
    reasonCode: null,
    result: { pumpState: "on" },
    processedAt: "2026-07-17T00:00:01.000Z",
  },
  updatedAt: "2026-07-17T00:00:01.000Z",
});

const farms = [
  FarmSchema.parse({
    schemaVersion: "smartfarm.farm.v1",
    id: "farm:demo",
    name: "대회 데모 농장",
    timezone: "Asia/Seoul",
    createdAt: "2026-07-17T00:00:00.000Z",
  }),
] as const;

const devices = [
  DeviceSchema.parse({
    schemaVersion: "smartfarm.device.v1",
    id: "device:sensor-1",
    farmId: "farm:demo",
    name: "베드 1 센서",
    kind: "sensor",
    capabilities: ["temperature"],
    status: "online",
    lastSeenAt: "2026-07-17T00:00:00.000Z",
  }),
  DeviceSchema.parse({
    schemaVersion: "smartfarm.device.v1",
    id: "device:bed-1",
    farmId: "farm:demo",
    name: "베드 1 컨트롤러",
    kind: "hybrid",
    capabilities: ["temperature", "pump"],
    status: "online",
    lastSeenAt: "2026-07-17T00:00:00.000Z",
  }),
] as const;

const crop = CropRecordSchema.parse({
  schemaVersion: "smartfarm.crop.v1",
  id: "crop:basil-bed-1",
  farmId: "farm:demo",
  deviceId: "device:bed-1",
  name: "바질 1베드",
  healthStatus: "good",
  managerName: "홍길동",
  notes: "급수량 조정 완료",
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:05:00.000Z",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dashboard model", () => {
  it("round-trips only contract-valid cached telemetry for the selected scope", () => {
    const storage = memoryStorage();
    cacheTelemetry(storage, latest);
    cacheTelemetry(storage, humidityLatest);
    cacheTelemetry(storage, otherScopeLatest);

    expect(readCachedTelemetry(storage, {
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    }, "temperature")?.telemetry.value).toBe(24.5);
    expect(readCachedTelemetry(storage, {
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    }, "humidity")?.telemetry.value).toBe(61.2);
    expect(readCachedTelemetry(storage, {
      farmId: "farm:demo",
      deviceId: "device:other",
    }, "temperature")).toBeNull();
    expect(readCachedTelemetry(storage, {
      farmId: "farm:secondary",
      deviceId: "device:bed-2",
    }, "temperature")?.telemetry.value).toBe(19.8);
  });

  it("falls back to the legacy temperature cache when the per-metric cache is absent", () => {
    const storage = memoryStorage();
    storage.setItem("smartfarm.latest-temperature.v1", JSON.stringify(latest));

    expect(readCachedTelemetry(storage, {
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    }, "temperature")?.telemetry.value).toBe(24.5);
    expect(readCachedTelemetry(storage, {
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    }, "humidity")).toBeNull();
  });

  it("rejects valid telemetry payloads that are stored under the wrong metric key", () => {
    const storage = memoryStorage();
    storage.setItem("smartfarm.latest-telemetry.v2", JSON.stringify({
      humidity: latest,
    }));

    expect(readCachedTelemetry(storage, {
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    }, "humidity")).toBeNull();
  });

  it("reads the legacy flat v2 record and migrates without overwriting another scope", () => {
    const storage = memoryStorage();
    storage.setItem("smartfarm.latest-telemetry.v2", JSON.stringify({
      temperature: latest,
      humidity: humidityLatest,
    }));

    cacheTelemetry(storage, otherScopeLatest);

    expect(readCachedTelemetry(storage, {
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    }, "temperature")?.telemetry.value).toBe(24.5);
    expect(readCachedTelemetry(storage, {
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    }, "humidity")?.telemetry.value).toBe(61.2);
    expect(readCachedTelemetry(storage, {
      farmId: "farm:secondary",
      deviceId: "device:bed-2",
    }, "temperature")?.telemetry.value).toBe(19.8);
  });

  it("evicts only the requested scope metric cache without touching other scope data", () => {
    const storage = memoryStorage();
    cacheTelemetry(storage, latest);
    cacheTelemetry(storage, humidityLatest);
    cacheTelemetry(storage, otherScopeLatest);

    expect(removeCachedTelemetry(storage, {
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    }, "temperature")).toBe(true);

    expect(readCachedTelemetry(storage, {
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    }, "temperature")).toBeNull();
    expect(readCachedTelemetry(storage, {
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    }, "humidity")?.telemetry.value).toBe(61.2);
    expect(readCachedTelemetry(storage, {
      farmId: "farm:secondary",
      deviceId: "device:bed-2",
    }, "temperature")?.telemetry.value).toBe(19.8);
  });

  it("keeps runtime data usable when browser storage is unavailable", () => {
    const unavailableStorage: KeyValueStorage = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
    };

    expect(readCachedTelemetry(unavailableStorage, {
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    }, "temperature")).toBeNull();
    expect(cacheTelemetry(unavailableStorage, latest)).toBe(false);
  });

  it("rehydrates only a contract-valid command from the active farm and device", () => {
    const storage = memoryStorage();
    expect(cacheCommandProjection(storage, completedCommand)).toBe(true);
    expect(readCachedCommandProjection(storage, {
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    })?.ack?.result?.pumpState).toBe("on");
    expect(readCachedCommandProjection(storage, {
      farmId: "farm:other",
      deviceId: "device:bed-1",
    })).toBeNull();
  });

  it("persists selected farm and device identifiers", () => {
    const storage = memoryStorage();
    expect(writeSelectedFarmId(storage, "farm:demo")).toBe(true);
    expect(writeSelectedDeviceId(storage, "device:bed-1")).toBe(true);
    expect(readSelectedFarmId(storage)).toBe("farm:demo");
    expect(readSelectedDeviceId(storage)).toBe("device:bed-1");
  });

  it("persists only supported UI locales", () => {
    const storage = memoryStorage();

    expect(readUiLocale(storage)).toBe("ko-KR");
    expect(writeUiLocale(storage, "en-US")).toBe(true);
    expect(readUiLocale(storage)).toBe("en-US");

    storage.setItem("smartfarm.ui-locale.v1", "not-a-locale");
    expect(readUiLocale(storage)).toBe("ko-KR");
  });

  it("falls back to Korean when locale storage is unavailable", () => {
    const unavailableStorage: KeyValueStorage = {
      getItem: () => {
        throw new Error("storage unavailable");
      },
      setItem: () => {
        throw new Error("storage unavailable");
      },
    };

    expect(readUiLocale(unavailableStorage)).toBe("ko-KR");
    expect(writeUiLocale(unavailableStorage, "en-US")).toBe(false);
  });

  it("reads and writes the browser locale through safe wrappers", () => {
    const storage = memoryStorage();
    vi.stubGlobal("window", { localStorage: storage });

    expect(readBrowserUiLocale()).toBe("ko-KR");
    expect(writeBrowserUiLocale("en-US")).toBe(true);
    expect(readBrowserUiLocale()).toBe("en-US");
  });

  it("handles SSR and an inaccessible browser localStorage getter", () => {
    vi.stubGlobal("window", undefined);
    expect(readBrowserUiLocale()).toBe("ko-KR");
    expect(writeBrowserUiLocale("en-US")).toBe(false);

    const inaccessibleWindow = {};
    Object.defineProperty(inaccessibleWindow, "localStorage", {
      get: () => {
        throw new Error("localStorage unavailable");
      },
    });
    vi.stubGlobal("window", inaccessibleWindow);

    expect(readBrowserUiLocale()).toBe("ko-KR");
    expect(writeBrowserUiLocale("en-US")).toBe(false);
  });

  it("formats dates with the stored browser locale and uses Korean during SSR", () => {
    const value = "2026-07-17T00:00:00.000Z";
    const options = { dateStyle: "medium", timeStyle: "short" } as const;

    vi.stubGlobal("window", undefined);
    expect(formatDateTime(value)).toBe(
      new Intl.DateTimeFormat("ko-KR", options).format(new Date(value)),
    );

    const storage = memoryStorage();
    writeUiLocale(storage, "en-US");
    vi.stubGlobal("window", { localStorage: storage });
    expect(formatDateTime(value)).toBe(
      new Intl.DateTimeFormat("en-US", options).format(new Date(value)),
    );
  });

  it("resolves stored selections while preferring a pump-capable device", () => {
    expect(resolveFarmSelection(farms, "farm:missing")).toBe("farm:demo");
    expect(resolveDeviceSelection(devices, null)).toBe("device:bed-1");
    expect(resolveDeviceSelection(devices, "device:sensor-1")).toBe("device:sensor-1");
  });

  it("builds strict create and patch crop payloads from form drafts", () => {
    const draft = createEmptyCropDraft();
    const nextDraft = {
      ...draft,
      deviceId: "device:bed-1",
      name: "바질 1베드",
      healthStatus: "good" as const,
      managerName: "홍길동",
      notes: "급수량 조정 완료",
    };

    expect(createCropRequestFromDraft(nextDraft)).toEqual({
      deviceId: "device:bed-1",
      name: "바질 1베드",
      healthStatus: "good",
      managerName: "홍길동",
      notes: "급수량 조정 완료",
    });

    const editedDraft = {
      ...createCropDraftFromRecord(crop),
      healthStatus: "fair" as const,
      notes: "점검 필요",
    };
    expect(patchCropRequestFromDraft(crop, editedDraft)).toEqual({
      healthStatus: "fair",
      notes: "점검 필요",
    });
  });

  it("sorts, upserts, and removes crop records predictably", () => {
    const olderCrop = CropRecordSchema.parse({
      ...crop,
      id: "crop:bokchoy-bed-1",
      name: "청경채 1베드",
      updatedAt: "2026-07-17T00:01:00.000Z",
    });

    const sorted = sortCropRecords([olderCrop, crop]);
    expect(sorted[0]?.id).toBe("crop:basil-bed-1");

    const updated = CropRecordSchema.parse({
      ...crop,
      healthStatus: "fair",
      updatedAt: "2026-07-17T00:06:00.000Z",
    });

    expect(upsertCropRecord([olderCrop, crop], updated)[0]?.healthStatus).toBe("fair");
    expect(removeCropRecord([olderCrop, crop], crop.id)).toEqual([olderCrop]);
  });

  it("creates unique, contract-sized idempotency keys", () => {
    const key = createIdempotencyKey(1_721_177_600_000, "123e4567-e89b-12d3-a456-426614174000");
    expect(key).toBe(`pwa-${(1_721_177_600_000).toString(36)}-123e4567-e89b-12d3-a456-426614174000`);
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(128);
  });

  it("creates stable acknowledgement idempotency keys from validated alarm ids", () => {
    const key = createAlarmAcknowledgementIdempotencyKey("alarm:bed-1-temperature");
    expect(key).toBe("pwa-alarm-ack-alarm:bed-1-temperature");
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(128);
    expect(() => createAlarmAcknowledgementIdempotencyKey("invalid")).toThrow();
  });

  it("uses clear Korean lifecycle labels and errors", () => {
    expect(commandStatusLabel("pending")).toBe("장치 응답 대기 중");
    expect(commandStatusLabel("acknowledged")).toBe("제어 완료");
    expect(commandStatusLabel("timed_out")).toBe("응답 시간 초과");
    expect(userFacingError(new Error("ignored"), false)).toContain("인터넷 연결");
    expect(userFacingError(
      new SmartFarmApiError("http", "Authentication is required", 401, "unauthorized"),
      true,
    )).toBe("로그인이 필요합니다.");
    expect(userFacingError(new SmartFarmApiError("network", "fetch failed"), true)).toContain("연결할 수 없습니다");
  });
});

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
