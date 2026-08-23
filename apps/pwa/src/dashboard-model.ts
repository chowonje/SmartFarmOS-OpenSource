import {
  AlarmInstanceIdSchema,
  CommandProjectionSchema,
  CreateCropRequestSchema,
  CropHealthStatusSchema,
  CropRecordSchema,
  LatestTelemetryResponseSchema,
  PatchCropRequestSchema,
  type CommandProjection,
  type CommandLifecycleStatus,
  type CreateCropRequestInput,
  type CropHealthStatus,
  type CropRecord,
  type Device,
  type Farm,
  type LatestTelemetryResponse,
  type PatchCropRequestInput,
  type PumpState,
  type TelemetryMetric,
} from "@smartfarm-os/contracts";
import { SmartFarmApiError } from "./api/smart-farm-api";
import type { EnvironmentTelemetryMetric, TelemetryByMetric } from "./components/page-state";

const TELEMETRY_CACHE_KEY = "smartfarm.latest-telemetry.v2";
const LEGACY_TELEMETRY_CACHE_KEY = "smartfarm.latest-temperature.v1";
const COMMAND_CACHE_KEY = "smartfarm.last-command.v1";
const SELECTED_FARM_KEY = "smartfarm.selected-farm.v1";
const SELECTED_DEVICE_KEY = "smartfarm.selected-device.v1";
const UI_LOCALE_KEY = "smartfarm.ui-locale.v1";
const TELEMETRY_METRICS = [
  "temperature",
  "humidity",
  "illuminance",
  "water_level",
] as const satisfies readonly TelemetryMetric[];

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type UiLocale = "ko-KR" | "en-US";

export type SelectionScope = {
  readonly farmId: string;
  readonly deviceId: string;
};

export type CropDraft = {
  readonly deviceId: string;
  readonly name: string;
  readonly healthStatus: CropHealthStatus;
  readonly managerName: string;
  readonly notes: string;
};

export function readCachedTelemetry(
  storage: KeyValueStorage,
  scope: SelectionScope,
  metric: EnvironmentTelemetryMetric,
): LatestTelemetryResponse | null {
  const current = readTelemetryCacheEnvelope(storage);
  const scopeId = createScopeCacheId(scope);
  const filtered = filterTelemetryByScope(current.scopes[scopeId], scope);
  return filtered[metric] ?? readLegacyCachedTelemetry(storage, scope, metric);
}

export function cacheTelemetry(
  storage: KeyValueStorage,
  response: LatestTelemetryResponse,
): boolean {
  try {
    const current = readTelemetryCacheEnvelope(storage);
    const scope = {
      farmId: response.telemetry.farmId,
      deviceId: response.telemetry.deviceId,
    };
    const scopeId = createScopeCacheId(scope);
    const nextScopeRecord = {
      ...(current.scopes[scopeId] ?? {}),
      [response.telemetry.metric]: response,
    };
    current.scopes[scopeId] = nextScopeRecord;
    storage.setItem(TELEMETRY_CACHE_KEY, JSON.stringify(current));
    if (response.telemetry.metric === "temperature") {
      storage.setItem(LEGACY_TELEMETRY_CACHE_KEY, JSON.stringify(response));
    }
    return true;
  } catch {
    return false;
  }
}

export function removeCachedTelemetry(
  storage: KeyValueStorage,
  scope: SelectionScope,
  metric: EnvironmentTelemetryMetric,
): boolean {
  try {
    const current = readTelemetryCacheEnvelope(storage);
    const scopeId = createScopeCacheId(scope);
    const nextScopeRecord = { ...(current.scopes[scopeId] ?? {}) };
    delete nextScopeRecord[metric];
    if (hasTelemetryEntries(nextScopeRecord)) {
      current.scopes[scopeId] = nextScopeRecord;
    } else {
      delete current.scopes[scopeId];
    }
    storage.setItem(TELEMETRY_CACHE_KEY, JSON.stringify(current));

    if (metric === "temperature") {
      clearLegacyTemperatureCache(storage, scope);
    }
    return true;
  } catch {
    return false;
  }
}

export function hasTelemetryEntries(telemetryByMetric: TelemetryByMetric): boolean {
  return TELEMETRY_METRICS.some((metric) => telemetryByMetric[metric] !== undefined);
}

export function readCachedCommandProjection(
  storage: KeyValueStorage,
  scope: { readonly farmId: string; readonly deviceId: string },
): CommandProjection | null {
  let value: string | null;
  try {
    value = storage.getItem(COMMAND_CACHE_KEY);
  } catch {
    return null;
  }
  if (value === null) return null;

  try {
    const parsed = CommandProjectionSchema.safeParse(JSON.parse(value) as unknown);
    if (!parsed.success) return null;
    return parsed.data.command.farmId === scope.farmId
      && parsed.data.command.deviceId === scope.deviceId
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

export function cacheCommandProjection(
  storage: KeyValueStorage,
  projection: CommandProjection,
): boolean {
  try {
    storage.setItem(COMMAND_CACHE_KEY, JSON.stringify(projection));
    return true;
  } catch {
    return false;
  }
}

export function createIdempotencyKey(
  now: number = Date.now(),
  randomId: string = crypto.randomUUID(),
): string {
  return `pwa-${now.toString(36)}-${randomId}`;
}

export function createAlarmAcknowledgementIdempotencyKey(alarmIdInput: string): string {
  const alarmId = AlarmInstanceIdSchema.parse(alarmIdInput);
  return `pwa-alarm-ack-${alarmId}`;
}

export function readSelectedFarmId(storage: KeyValueStorage): string | null {
  return readStoredSelection(storage, SELECTED_FARM_KEY);
}

export function writeSelectedFarmId(storage: KeyValueStorage, farmId: string): boolean {
  return writeStoredSelection(storage, SELECTED_FARM_KEY, farmId);
}

export function readSelectedDeviceId(storage: KeyValueStorage): string | null {
  return readStoredSelection(storage, SELECTED_DEVICE_KEY);
}

export function writeSelectedDeviceId(storage: KeyValueStorage, deviceId: string): boolean {
  return writeStoredSelection(storage, SELECTED_DEVICE_KEY, deviceId);
}

export function readUiLocale(storage: KeyValueStorage): UiLocale {
  let value: string | null;
  try {
    value = storage.getItem(UI_LOCALE_KEY);
  } catch {
    return "ko-KR";
  }

  return isUiLocale(value) ? value : "ko-KR";
}

export function writeUiLocale(storage: KeyValueStorage, locale: UiLocale): boolean {
  if (!isUiLocale(locale)) return false;

  try {
    storage.setItem(UI_LOCALE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

export function readBrowserUiLocale(): UiLocale {
  if (typeof window === "undefined") return "ko-KR";

  try {
    return readUiLocale(window.localStorage);
  } catch {
    return "ko-KR";
  }
}

export function writeBrowserUiLocale(locale: UiLocale): boolean {
  if (typeof window === "undefined") return false;

  try {
    return writeUiLocale(window.localStorage, locale);
  } catch {
    return false;
  }
}

export function resolveFarmSelection(
  farms: readonly Farm[],
  preferredFarmId: string | null,
): string | null {
  if (preferredFarmId !== null && farms.some((farm) => farm.id === preferredFarmId)) {
    return preferredFarmId;
  }
  return farms[0]?.id ?? null;
}

export function resolveDeviceSelection(
  devices: readonly Device[],
  preferredDeviceId: string | null,
): string | null {
  if (preferredDeviceId !== null && devices.some((device) => device.id === preferredDeviceId)) {
    return preferredDeviceId;
  }

  return devices.find((device) => device.capabilities.includes("pump"))?.id
    ?? devices[0]?.id
    ?? null;
}

export function createEmptyCropDraft(): CropDraft {
  return {
    deviceId: "",
    name: "",
    healthStatus: "fair",
    managerName: "",
    notes: "",
  };
}

export function createCropDraftFromRecord(crop: CropRecord): CropDraft {
  return {
    deviceId: crop.deviceId ?? "",
    name: crop.name,
    healthStatus: crop.healthStatus,
    managerName: crop.managerName ?? "",
    notes: crop.notes ?? "",
  };
}

export function createCropRequestFromDraft(draft: CropDraft): CreateCropRequestInput {
  const request = CreateCropRequestSchema.parse({
    deviceId: normalizeOptionalIdentifier(draft.deviceId),
    name: draft.name.trim(),
    healthStatus: CropHealthStatusSchema.parse(draft.healthStatus),
    managerName: normalizeOptionalText(draft.managerName),
    notes: normalizeOptionalText(draft.notes),
  });
  return request;
}

export function patchCropRequestFromDraft(
  crop: CropRecord,
  draft: CropDraft,
): PatchCropRequestInput | null {
  const patch: Record<string, unknown> = {};
  const nextDeviceId = normalizeOptionalIdentifier(draft.deviceId) ?? null;
  const nextName = draft.name.trim();
  const nextHealthStatus = CropHealthStatusSchema.parse(draft.healthStatus);
  const nextManagerName = normalizeOptionalText(draft.managerName);
  const nextNotes = normalizeOptionalText(draft.notes);

  if ((crop.deviceId ?? null) !== nextDeviceId) patch.deviceId = nextDeviceId;
  if (crop.name !== nextName) patch.name = nextName;
  if (crop.healthStatus !== nextHealthStatus) patch.healthStatus = nextHealthStatus;
  if ((crop.managerName ?? null) !== nextManagerName) patch.managerName = nextManagerName;
  if ((crop.notes ?? null) !== nextNotes) patch.notes = nextNotes;

  if (Object.keys(patch).length === 0) return null;
  return PatchCropRequestSchema.parse(patch);
}

export function sortCropRecords(crops: readonly CropRecord[]): CropRecord[] {
  return [...crops].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function upsertCropRecord(
  crops: readonly CropRecord[],
  crop: CropRecord,
): CropRecord[] {
  const next = crops.filter((entry) => entry.id !== crop.id);
  next.push(CropRecordSchema.parse(crop));
  return sortCropRecords(next);
}

export function removeCropRecord(
  crops: readonly CropRecord[],
  cropId: string,
): CropRecord[] {
  return crops.filter((crop) => crop.id !== cropId);
}

export function commandStatusLabel(status: CommandLifecycleStatus | null): string {
  switch (status) {
    case "pending":
      return "장치 응답 대기 중";
    case "acknowledged":
      return "제어 완료";
    case "failed":
      return "제어 실패";
    case "timed_out":
      return "응답 시간 초과";
    case null:
      return "제어 기록 없음";
    default:
      return assertNever(status);
  }
}

export function pumpStateLabel(state: PumpState | null): string {
  switch (state) {
    case "on":
      return "작동 중";
    case "off":
      return "정지";
    case null:
      return "확인 전";
    default:
      return assertNever(state);
  }
}

export function cropHealthStatusLabel(status: CropHealthStatus): string {
  switch (status) {
    case "good":
      return "좋음";
    case "fair":
      return "보통";
    case "poor":
      return "주의";
    default:
      return assertNever(status);
  }
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(readBrowserUiLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function userFacingError(
  error: unknown,
  online: boolean,
  options: {
    readonly notFoundMessage?: string;
    readonly conflictMessage?: string;
    readonly defaultMessage?: string;
  } = {},
): string {
  if (!online) return "인터넷 연결이 끊겼습니다. 마지막으로 저장된 값을 표시합니다.";
  if (!(error instanceof SmartFarmApiError)) {
    return options.defaultMessage ?? "요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }

  if (error.kind === "timeout") return "서버 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.";
  if (error.kind === "network") return "SmartFarm 서버에 연결할 수 없습니다.";
  if (error.apiCode === "unauthorized") return "로그인이 필요합니다.";
  if (error.apiCode === "forbidden") return "이 농장에 접근할 권한이 없습니다.";
  if (error.apiCode === "not_found") return options.notFoundMessage ?? "아직 수집된 센서 데이터가 없습니다.";
  if (error.apiCode === "conflict") return options.conflictMessage ?? "이전 요청과 충돌했습니다. 새로고침 후 다시 시도해 주세요.";
  if (error.kind === "invalid_response") return "서버 응답 형식을 확인할 수 없습니다.";
  return options.defaultMessage ?? "요청을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}

function isUiLocale(value: unknown): value is UiLocale {
  return value === "ko-KR" || value === "en-US";
}

function readStoredSelection(storage: KeyValueStorage, key: string): string | null {
  let value: string | null;
  try {
    value = storage.getItem(key);
  } catch {
    return null;
  }

  if (value === null) return null;
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function readLegacyCachedTelemetry(
  storage: KeyValueStorage,
  scope: SelectionScope,
  metric: EnvironmentTelemetryMetric,
): LatestTelemetryResponse | null {
  if (metric !== "temperature") return null;
  let value: string | null;
  try {
    value = storage.getItem(LEGACY_TELEMETRY_CACHE_KEY);
  } catch {
    return null;
  }
  if (value === null) return null;

  try {
    const parsed = LatestTelemetryResponseSchema.safeParse(JSON.parse(value) as unknown);
    if (!parsed.success) return null;
    return parsed.data.telemetry.farmId === scope.farmId
      && parsed.data.telemetry.deviceId === scope.deviceId
      && parsed.data.telemetry.metric === metric
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}

type TelemetryCacheEnvelope = {
  readonly schemaVersion: "smartfarm.telemetry-cache.v1";
  readonly scopes: Record<string, TelemetryByMetric>;
};

function readTelemetryCacheEnvelope(storage: KeyValueStorage): TelemetryCacheEnvelope {
  let value: string | null;
  try {
    value = storage.getItem(TELEMETRY_CACHE_KEY);
  } catch {
    return createEmptyTelemetryCacheEnvelope();
  }
  if (value === null) return createEmptyTelemetryCacheEnvelope();

  try {
    return parseTelemetryCacheEnvelope(JSON.parse(value) as unknown);
  } catch {
    return createEmptyTelemetryCacheEnvelope();
  }
}

function parseTelemetryCacheEnvelope(input: unknown): TelemetryCacheEnvelope {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return createEmptyTelemetryCacheEnvelope();
  }

  const maybeEnvelope = input as {
    readonly schemaVersion?: unknown;
    readonly scopes?: unknown;
  };

  if (maybeEnvelope.schemaVersion === "smartfarm.telemetry-cache.v1") {
    return {
      schemaVersion: "smartfarm.telemetry-cache.v1",
      scopes: parseScopedTelemetryCacheRecord(maybeEnvelope.scopes),
    };
  }

  const legacyFlatRecord = parseTelemetryCacheRecord(input);
  if (!hasTelemetryEntries(legacyFlatRecord)) {
    return createEmptyTelemetryCacheEnvelope();
  }

  const scope = inferScopeFromTelemetryByMetric(legacyFlatRecord);
  if (scope === null) return createEmptyTelemetryCacheEnvelope();
  return {
    schemaVersion: "smartfarm.telemetry-cache.v1",
    scopes: {
      [createScopeCacheId(scope)]: legacyFlatRecord,
    },
  };
}

function parseScopedTelemetryCacheRecord(input: unknown): Record<string, TelemetryByMetric> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const next: Record<string, TelemetryByMetric> = {};
  for (const [scopeId, scopeValue] of Object.entries(input)) {
    const parsed = parseTelemetryCacheRecord(scopeValue);
    if (hasTelemetryEntries(parsed)) {
      next[scopeId] = parsed;
    }
  }
  return next;
}

function parseTelemetryCacheRecord(input: unknown): TelemetryByMetric {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  const next: TelemetryByMetric = {};
  for (const metric of TELEMETRY_METRICS) {
    const parsed = LatestTelemetryResponseSchema.safeParse(
      (input as Partial<Record<TelemetryMetric, unknown>>)[metric],
    );
    if (parsed.success && parsed.data.telemetry.metric === metric) {
      next[metric] = parsed.data;
    }
  }
  return next;
}

function filterTelemetryByScope(
  telemetryByMetric: TelemetryByMetric | undefined,
  scope: SelectionScope,
): TelemetryByMetric {
  if (telemetryByMetric === undefined) return {};
  const next: TelemetryByMetric = {};
  for (const metric of TELEMETRY_METRICS) {
    const telemetry = telemetryByMetric[metric];
    if (
      telemetry !== undefined
      && telemetry.telemetry.farmId === scope.farmId
      && telemetry.telemetry.deviceId === scope.deviceId
    ) {
      next[metric] = telemetry;
    }
  }
  return next;
}

function writeStoredSelection(
  storage: KeyValueStorage,
  key: string,
  value: string,
): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function normalizeOptionalText(value: string): string | null {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function normalizeOptionalIdentifier(value: string): string | undefined {
  const normalized = value.trim();
  return normalized === "" ? undefined : normalized;
}

function createEmptyTelemetryCacheEnvelope(): TelemetryCacheEnvelope {
  return {
    schemaVersion: "smartfarm.telemetry-cache.v1",
    scopes: {},
  };
}

function inferScopeFromTelemetryByMetric(telemetryByMetric: TelemetryByMetric): SelectionScope | null {
  let scope: SelectionScope | null = null;
  for (const metric of TELEMETRY_METRICS) {
    const telemetry = telemetryByMetric[metric];
    if (telemetry === undefined) continue;
    const nextScope = {
      farmId: telemetry.telemetry.farmId,
      deviceId: telemetry.telemetry.deviceId,
    };
    if (scope === null) {
      scope = nextScope;
      continue;
    }
    if (scope.farmId !== nextScope.farmId || scope.deviceId !== nextScope.deviceId) {
      return null;
    }
  }
  return scope;
}

function createScopeCacheId(scope: SelectionScope): string {
  return `${encodeURIComponent(scope.farmId)}::${encodeURIComponent(scope.deviceId)}`;
}

function clearLegacyTemperatureCache(storage: KeyValueStorage, scope: SelectionScope): void {
  let value: string | null;
  try {
    value = storage.getItem(LEGACY_TELEMETRY_CACHE_KEY);
  } catch {
    return;
  }
  if (value === null) return;

  try {
    const parsed = LatestTelemetryResponseSchema.safeParse(JSON.parse(value) as unknown);
    if (
      parsed.success
      && parsed.data.telemetry.metric === "temperature"
      && parsed.data.telemetry.farmId === scope.farmId
      && parsed.data.telemetry.deviceId === scope.deviceId
    ) {
      storage.setItem(LEGACY_TELEMETRY_CACHE_KEY, "");
    }
  } catch {
    return;
  }
}
