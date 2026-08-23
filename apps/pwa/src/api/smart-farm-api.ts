import {
  AcknowledgeAlarmRequestSchema,
  AlarmListQuerySchema,
  AlarmListResponseSchema,
  AlarmPathParamsSchema,
  AlarmResponseSchema,
  ApplyIrrigationStrategyRequestSchema,
  ApiErrorSchema,
  AuditEventListQuerySchema,
  AuditEventListResponseSchema,
  CommandListQuerySchema,
  CommandListResponseSchema,
  CommandIdSchema,
  CommandProjectionSchema,
  CurrentWeatherResponseSchema,
  CreateCropRequestSchema,
  CreateCropCycleRequestSchema,
  CreatePumpCommandRequestSchema,
  CropCycleIdSchema,
  CropIdSchema,
  CropListResponseSchema,
  CropCycleListResponseSchema,
  type CropCycleDetail,
  CropCycleResponseSchema,
  CropResponseSchema,
  DeviceListResponseSchema,
  DeviceIdSchema,
  FarmControlProfileResponseSchema,
  FarmListResponseSchema,
  FarmIdSchema,
  GrowingAreaListResponseSchema,
  HealthResponseSchema,
  LatestTelemetryResponseSchema,
  IrrigationStrategyListQuerySchema,
  IrrigationStrategyListResponseSchema,
  IrrigationStrategyPathParamsSchema,
  StrategyApplicationPathParamsSchema,
  StrategyApplicationResponseSchema,
  TelemetryHistoryQuerySchema,
  TelemetryHistoryResponseSchema,
  TelemetryMetricSchema,
  WeatherLocationQuerySchema,
  type AlarmInstance,
  type AuditEvent,
  type CommandProjection,
  type CurrentWeatherResponse,
  type CreateCropRequestInput,
  type CreateCropCycleRequestInput,
  type CropRecord,
  type Device,
  type Farm,
  type FarmControlProfile,
  type FarmControlWidget,
  type GrowingArea,
  type HealthResponse,
  type LatestTelemetryResponse,
  type IrrigationStrategy,
  type PatchCropCycleRequestInput,
  type TelemetryHistoryResponse,
  type PatchCropRequestInput,
  type PumpState,
  type StrategyApplication,
  type TelemetryMetric,
  type WeatherLocationQueryInput,
  PatchCropCycleRequestSchema,
  PatchCropRequestSchema,
  PutFarmControlProfileRequestSchema,
} from "@smartfarm-os/contracts";

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 1_024 * 1_024;

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type SmartFarmApiOptions = {
  readonly baseUrl: string;
  readonly fetchImplementation?: FetchImplementation;
  readonly timeoutMs?: number;
};

export type SmartFarmApiErrorKind =
  | "http"
  | "invalid_configuration"
  | "invalid_response"
  | "network"
  | "timeout";

export class SmartFarmApiError extends Error {
  override readonly name = "SmartFarmApiError";

  constructor(
    readonly kind: SmartFarmApiErrorKind,
    message: string,
    readonly statusCode: number | null = null,
    readonly apiCode: string | null = null,
  ) {
    super(message);
  }
}

export class SmartFarmApi {
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly timeoutMs: number;

  constructor(options: SmartFarmApiOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImplementation = options.fetchImplementation
      ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = parsePositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
  }

  async health(): Promise<HealthResponse> {
    const body = await this.request("/health");
    return parseResponse(HealthResponseSchema, body);
  }

  async currentWeather(
    farmIdInput: string,
    locationInput: WeatherLocationQueryInput,
  ): Promise<CurrentWeatherResponse> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const location = WeatherLocationQuerySchema.parse(locationInput);
    const search = new URLSearchParams();
    if (location.city !== undefined) {
      search.set("city", location.city);
    } else {
      if (location.latitude === undefined || location.longitude === undefined) {
        throw new SmartFarmApiError("invalid_configuration", "Weather coordinates are missing");
      }
      search.set("latitude", String(location.latitude));
      search.set("longitude", String(location.longitude));
    }
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/weather/current?${search.toString()}`,
    );
    return parseResponse(CurrentWeatherResponseSchema, body);
  }

  async latestTelemetry(
    farmIdInput: string,
    deviceIdInput: string,
    metricInput: TelemetryMetric,
  ): Promise<LatestTelemetryResponse> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const deviceId = DeviceIdSchema.parse(deviceIdInput);
    const metric = TelemetryMetricSchema.parse(metricInput);
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/devices/${encodeURIComponent(deviceId)}/telemetry/latest?metric=${encodeURIComponent(metric)}`,
    );
    return parseResponse(LatestTelemetryResponseSchema, body);
  }

  async latestTemperature(
    farmIdInput: string,
    deviceIdInput: string,
  ): Promise<LatestTelemetryResponse> {
    return this.latestTelemetry(farmIdInput, deviceIdInput, "temperature");
  }

  async telemetryHistory(
    farmIdInput: string,
    deviceIdInput: string,
    metricInput: TelemetryMetric,
    limit = 24,
  ): Promise<TelemetryHistoryResponse> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const deviceId = DeviceIdSchema.parse(deviceIdInput);
    const query = TelemetryHistoryQuerySchema.parse({ metric: metricInput, limit });
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/devices/${encodeURIComponent(deviceId)}/telemetry/history?metric=${encodeURIComponent(query.metric)}&limit=${query.limit}`,
    );
    return parseResponse(TelemetryHistoryResponseSchema, body);
  }

  async listFarms(): Promise<readonly Farm[]> {
    const body = await this.request("/v1/farms");
    return parseResponse(FarmListResponseSchema, body).farms;
  }

  async listDevices(farmIdInput: string): Promise<readonly Device[]> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const body = await this.request(`/v1/farms/${encodeURIComponent(farmId)}/devices`);
    return parseResponse(DeviceListResponseSchema, body).devices;
  }

  async listAreas(farmIdInput: string): Promise<readonly GrowingArea[]> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const body = await this.request(`/v1/farms/${encodeURIComponent(farmId)}/areas`);
    return parseResponse(GrowingAreaListResponseSchema, body).areas;
  }

  async listCrops(farmIdInput: string): Promise<readonly CropRecord[]> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const body = await this.request(`/v1/farms/${encodeURIComponent(farmId)}/crops`);
    return parseResponse(CropListResponseSchema, body).crops;
  }

  async listCropCycles(farmIdInput: string): Promise<readonly CropCycleDetail[]> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const body = await this.request(`/v1/farms/${encodeURIComponent(farmId)}/crop-cycles`);
    return parseResponse(CropCycleListResponseSchema, body).cropCycles;
  }

  async listIrrigationStrategies(
    farmIdInput: string,
    cycleIdInput: string,
  ): Promise<readonly IrrigationStrategy[]> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const query = IrrigationStrategyListQuerySchema.parse({ cycleId: cycleIdInput });
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/irrigation-strategies?cycleId=${encodeURIComponent(query.cycleId)}`,
    );
    return parseResponse(IrrigationStrategyListResponseSchema, body).irrigationStrategies;
  }

  async applyIrrigationStrategy(
    farmIdInput: string,
    strategyIdInput: string,
    requestInput: {
      readonly cycleId: string;
      readonly strategyVersion: number;
      readonly areaIds: readonly string[];
      readonly idempotencyKey: string;
    },
  ): Promise<StrategyApplication> {
    const { farmId, strategyId } = IrrigationStrategyPathParamsSchema.parse({
      farmId: farmIdInput,
      strategyId: strategyIdInput,
    });
    const request = ApplyIrrigationStrategyRequestSchema.parse(requestInput);
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/irrigation-strategies/${encodeURIComponent(strategyId)}/applications`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
    return parseResponse(StrategyApplicationResponseSchema, body).strategyApplication;
  }

  async strategyApplication(
    farmIdInput: string,
    applicationIdInput: string,
  ): Promise<StrategyApplication> {
    const { farmId, applicationId } = StrategyApplicationPathParamsSchema.parse({
      farmId: farmIdInput,
      applicationId: applicationIdInput,
    });
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/strategy-applications/${encodeURIComponent(applicationId)}`,
    );
    return parseResponse(StrategyApplicationResponseSchema, body).strategyApplication;
  }

  async listAlarms(
    farmIdInput: string,
    queryInput: {
      readonly state?: "active" | "cleared";
      readonly cycleId?: string;
      readonly limit?: number;
    } = {},
  ): Promise<readonly AlarmInstance[]> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const query = AlarmListQuerySchema.parse({
      state: queryInput.state,
      cycleId: queryInput.cycleId,
      limit: queryInput.limit,
    });
    const search = new URLSearchParams();
    if (query.state !== undefined) search.set("state", query.state);
    if (query.cycleId !== undefined) search.set("cycleId", query.cycleId);
    search.set("limit", String(query.limit));
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/alarms?${search.toString()}`,
    );
    return parseResponse(AlarmListResponseSchema, body).alarms;
  }

  async acknowledgeAlarm(
    farmIdInput: string,
    alarmIdInput: string,
    idempotencyKey: string,
  ): Promise<AlarmInstance> {
    const { farmId, alarmId } = AlarmPathParamsSchema.parse({
      farmId: farmIdInput,
      alarmId: alarmIdInput,
    });
    const request = AcknowledgeAlarmRequestSchema.parse({ idempotencyKey });
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/alarms/${encodeURIComponent(alarmId)}/acknowledgements`,
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
    return parseResponse(AlarmResponseSchema, body).alarm;
  }

  async listCommands(
    farmIdInput: string,
    queryInput: {
      readonly deviceId?: string;
      readonly limit?: number;
    } = {},
  ): Promise<readonly CommandProjection[]> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const query = CommandListQuerySchema.parse({
      deviceId: queryInput.deviceId,
      limit: queryInput.limit,
    });
    const search = new URLSearchParams();
    if (query.deviceId !== undefined) search.set("deviceId", query.deviceId);
    search.set("limit", String(query.limit));
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/commands?${search.toString()}`,
    );
    return parseResponse(CommandListResponseSchema, body).commands;
  }

  async farmControlProfile(farmIdInput: string): Promise<FarmControlProfile> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/control-profile`,
    );
    return parseResponse(FarmControlProfileResponseSchema, body).controlProfile;
  }

  async updateFarmControlProfile(
    farmIdInput: string,
    input: {
      readonly expectedRevision: number;
      readonly widgets: readonly FarmControlWidget[];
    },
  ): Promise<FarmControlProfile> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const request = PutFarmControlProfileRequestSchema.parse(input);
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/control-profile`,
      {
        method: "PUT",
        body: JSON.stringify(request),
      },
    );
    return parseResponse(FarmControlProfileResponseSchema, body).controlProfile;
  }

  async listAuditEvents(
    farmIdInput: string,
    queryInput: {
      readonly cycleId?: string;
      readonly includeUnscoped?: boolean;
      readonly limit?: number;
    } = {},
  ): Promise<readonly AuditEvent[]> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const query = AuditEventListQuerySchema.parse({
      cycleId: queryInput.cycleId,
      includeUnscoped: queryInput.includeUnscoped,
      limit: queryInput.limit,
    });
    const search = new URLSearchParams();
    if (query.cycleId !== undefined) search.set("cycleId", query.cycleId);
    if (query.includeUnscoped) search.set("includeUnscoped", "true");
    search.set("limit", String(query.limit));
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/audit-events?${search.toString()}`,
    );
    return parseResponse(AuditEventListResponseSchema, body).auditEvents;
  }

  async createCropCycle(
    farmIdInput: string,
    input: CreateCropCycleRequestInput,
  ): Promise<CropCycleDetail> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const request = CreateCropCycleRequestSchema.parse(input);
    const body = await this.request(`/v1/farms/${encodeURIComponent(farmId)}/crop-cycles`, {
      method: "POST",
      body: JSON.stringify(request),
    });
    return parseResponse(CropCycleResponseSchema, body).cropCycle;
  }

  async updateCropCycle(
    farmIdInput: string,
    cycleIdInput: string,
    input: PatchCropCycleRequestInput,
  ): Promise<CropCycleDetail> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const cycleId = CropCycleIdSchema.parse(cycleIdInput);
    const request = PatchCropCycleRequestSchema.parse(input);
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/crop-cycles/${encodeURIComponent(cycleId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(request),
      },
    );
    return parseResponse(CropCycleResponseSchema, body).cropCycle;
  }

  async createCrop(farmIdInput: string, input: CreateCropRequestInput): Promise<CropRecord> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const request = CreateCropRequestSchema.parse(input);
    const body = await this.request(`/v1/farms/${encodeURIComponent(farmId)}/crops`, {
      method: "POST",
      body: JSON.stringify(request),
    });
    return parseResponse(CropResponseSchema, body).crop;
  }

  async updateCrop(
    farmIdInput: string,
    cropIdInput: string,
    input: PatchCropRequestInput,
  ): Promise<CropRecord> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const cropId = CropIdSchema.parse(cropIdInput);
    const request = PatchCropRequestSchema.parse(input);
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/crops/${encodeURIComponent(cropId)}`,
      {
        method: "PATCH",
        body: JSON.stringify(request),
      },
    );
    return parseResponse(CropResponseSchema, body).crop;
  }

  async deleteCrop(
    farmIdInput: string,
    cropIdInput: string,
  ): Promise<CropRecord | null> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const cropId = CropIdSchema.parse(cropIdInput);
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/crops/${encodeURIComponent(cropId)}`,
      { method: "DELETE" },
    );
    if (body === null) return null;
    return parseResponse(CropResponseSchema, body).crop;
  }

  async createPumpCommand(input: {
    readonly farmId: string;
    readonly deviceId: string;
    readonly state: PumpState;
    readonly idempotencyKey: string;
  }): Promise<CommandProjection> {
    const farmId = FarmIdSchema.parse(input.farmId);
    const request = CreatePumpCommandRequestSchema.parse({
      deviceId: input.deviceId,
      state: input.state,
      idempotencyKey: input.idempotencyKey,
      ttlSeconds: 60,
    });
    const body = await this.request(`/v1/farms/${encodeURIComponent(farmId)}/commands`, {
      method: "POST",
      body: JSON.stringify(request),
    });
    return parseResponse(CommandProjectionSchema, body);
  }

  async commandProjection(
    farmIdInput: string,
    commandIdInput: string,
  ): Promise<CommandProjection> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const commandId = CommandIdSchema.parse(commandIdInput);
    const body = await this.request(
      `/v1/farms/${encodeURIComponent(farmId)}/commands/${encodeURIComponent(commandId)}`,
    );
    return parseResponse(CommandProjectionSchema, body);
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined) headers.set("content-type", "application/json");

    let response: Response;
    try {
      response = await this.fetchImplementation(joinUrl(this.baseUrl, path), {
        ...init,
        headers,
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new SmartFarmApiError("timeout", "Central API request timed out");
      }
      throw new SmartFarmApiError(
        "network",
        error instanceof Error ? error.message : "Central API request failed",
      );
    } finally {
      clearTimeout(timeout);
    }

    const body = await readBoundedJson(response);
    if (!response.ok) {
      const apiError = ApiErrorSchema.safeParse(body);
      if (!apiError.success) {
        throw new SmartFarmApiError(
          "invalid_response",
          "Central API error response did not match the contract",
          response.status,
        );
      }
      throw new SmartFarmApiError(
        "http",
        apiError.data.message,
        response.status,
        apiError.data.code,
      );
    }

    return body;
  }
}

function normalizeBaseUrl(value: string): string {
  const baseUrl = value.trim().replace(/\/+$/, "");
  if (baseUrl === "") {
    throw new SmartFarmApiError("invalid_configuration", "API base URL cannot be empty");
  }
  if (baseUrl.startsWith("/") && !baseUrl.startsWith("//")) return baseUrl;

  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new SmartFarmApiError("invalid_configuration", "API base URL is invalid");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username !== "" || parsed.password !== "") {
    throw new SmartFarmApiError("invalid_configuration", "API base URL must be an HTTP origin without credentials");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function joinUrl(baseUrl: string, path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new SmartFarmApiError("invalid_configuration", "API request path must be origin-relative");
  }
  return `${baseUrl}${path}`;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_RESPONSE_BYTES) {
    throw new SmartFarmApiError("invalid_response", "Central API response was too large");
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw new SmartFarmApiError("invalid_response", "Central API response was too large");
  }
  if (text.trim() === "") return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SmartFarmApiError("invalid_response", "Central API response was not valid JSON");
  }
}

function parseResponse<T>(
  schema: { readonly safeParse: (input: unknown) => { success: true; data: T } | { success: false } },
  body: unknown,
): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new SmartFarmApiError(
      "invalid_response",
      "Central API response did not match the expected contract",
    );
  }
  return result.data;
}

function parsePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SmartFarmApiError("invalid_configuration", `${label} must be a positive integer`);
  }
  return value;
}
