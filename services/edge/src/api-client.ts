import {
  ApiErrorSchema,
  CommandAckSchema,
  CommandProjectionSchema,
  DeviceIdSchema,
  FarmIdSchema,
  PendingCommandResponseSchema,
  TelemetryReceiptSchema,
  TelemetrySchema,
  type Command,
  type CommandAck,
  type CommandProjection,
  type DeviceId,
  type FarmId,
  type Telemetry,
  type TelemetryReceipt,
} from "@smartfarm-os/contracts";

export type ApiRequest = {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
};

export type ApiResponse = {
  readonly statusCode: number;
  readonly body: unknown | null;
};

export interface ApiRequestExecutor {
  execute(request: ApiRequest): Promise<ApiResponse>;
}

export type ApiHeaderProvider = () => Readonly<Record<string, string>>;

export type FetchApiRequestExecutorOptions = {
  readonly baseUrl: string;
  readonly headers?: ApiHeaderProvider;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
};

export type EdgeTransportErrorCode =
  | "invalid_configuration"
  | "invalid_request"
  | "network_error"
  | "timeout"
  | "response_too_large"
  | "invalid_response";

export class EdgeTransportError extends Error {
  override readonly name = "EdgeTransportError";

  constructor(
    readonly code: EdgeTransportErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export class CentralApiClientError extends Error {
  override readonly name = "CentralApiClientError";

  constructor(
    readonly statusCode: number,
    readonly code: string,
  ) {
    super(`Central API request failed (${statusCode}, ${code})`);
  }
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_024 * 1_024;

export class FetchApiRequestExecutor implements ApiRequestExecutor {
  private readonly baseUrl: URL;
  private readonly headers: ApiHeaderProvider;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: FetchApiRequestExecutorOptions) {
    this.baseUrl = parseBaseUrl(options.baseUrl);
    this.headers = options.headers ?? (() => ({}));
    this.timeoutMs = parsePositiveInteger(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "timeoutMs",
    );
    this.maxResponseBytes = parsePositiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes",
    );
  }

  async execute(request: ApiRequest): Promise<ApiResponse> {
    if (!request.path.startsWith("/") || request.path.startsWith("//")) {
      throw new EdgeTransportError(
        "invalid_request",
        "Central API request path must be an origin-relative path",
      );
    }

    const url = new URL(request.path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin) {
      throw new EdgeTransportError(
        "invalid_request",
        "Central API request cannot change origin",
      );
    }

    const headers = new Headers(this.headers());
    for (const [key, value] of Object.entries(request.headers ?? {})) {
      headers.set(key, value);
    }
    headers.set("accept", "application/json");

    let body: string | undefined;
    if (request.body !== undefined) {
      try {
        body = JSON.stringify(request.body);
      } catch {
        throw new EdgeTransportError(
          "invalid_request",
          "Central API request body is not JSON serializable",
        );
      }
      headers.set("content-type", "application/json");
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: request.method,
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(body === undefined ? {} : { body }),
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        throw new EdgeTransportError("timeout", "Central API request timed out");
      }
      throw new EdgeTransportError("network_error", "Central API request failed");
    }

    return {
      statusCode: response.status,
      body: response.status === 204
        ? null
        : await readBoundedJson(response, this.maxResponseBytes),
    };
  }
}

export class CentralApiClient {
  constructor(private readonly executor: ApiRequestExecutor) {}

  async submitTelemetry(
    farmIdInput: FarmId | string,
    telemetryInput: Telemetry,
  ): Promise<TelemetryReceipt> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const telemetry = TelemetrySchema.parse(telemetryInput);
    if (telemetry.farmId !== farmId) {
      throw new EdgeTransportError(
        "invalid_request",
        "Telemetry farm scope does not match the target farm",
      );
    }

    const response = await this.executor.execute({
      method: "POST",
      path: `/v1/farms/${encodeURIComponent(farmId)}/telemetry`,
      body: telemetry,
    });
    if (response.statusCode !== 200 && response.statusCode !== 202) {
      throwCentralApiError(response);
    }

    return parseResponseBody(TelemetryReceiptSchema, response.body);
  }

  async pullNextCommand(
    farmIdInput: FarmId | string,
    deviceIdInput: DeviceId | string,
  ): Promise<Command | null> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const deviceId = DeviceIdSchema.parse(deviceIdInput);
    const response = await this.executor.execute({
      method: "GET",
      path: `/v1/farms/${encodeURIComponent(farmId)}/edge/commands/next?deviceId=${encodeURIComponent(deviceId)}`,
    });

    if (response.statusCode === 204) return null;
    if (response.statusCode !== 200) throwCentralApiError(response);

    return parseResponseBody(PendingCommandResponseSchema, response.body).command;
  }

  async pullNextStopCommand(
    farmIdInput: FarmId | string,
    deviceIdInput: DeviceId | string,
  ): Promise<Command | null> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const deviceId = DeviceIdSchema.parse(deviceIdInput);
    const response = await this.executor.execute({
      method: "GET",
      path: `/v1/farms/${encodeURIComponent(farmId)}/edge/commands/next-stop?deviceId=${encodeURIComponent(deviceId)}`,
    });

    if (response.statusCode === 204) return null;
    if (response.statusCode !== 200) throwCentralApiError(response);

    return parseResponseBody(PendingCommandResponseSchema, response.body).command;
  }

  async submitAck(
    farmIdInput: FarmId | string,
    ackInput: CommandAck,
  ): Promise<CommandProjection> {
    const farmId = FarmIdSchema.parse(farmIdInput);
    const ack = CommandAckSchema.parse(ackInput);
    if (ack.farmId !== farmId) {
      throw new EdgeTransportError(
        "invalid_request",
        "Acknowledgement farm scope does not match the target farm",
      );
    }

    const response = await this.executor.execute({
      method: "POST",
      path: `/v1/farms/${encodeURIComponent(farmId)}/command-acks`,
      body: ack,
    });
    if (response.statusCode !== 200) throwCentralApiError(response);

    return parseResponseBody(CommandProjectionSchema, response.body);
  }
}

function parseBaseUrl(input: string): URL {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new EdgeTransportError(
      "invalid_configuration",
      "Central API base URL is invalid",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EdgeTransportError(
      "invalid_configuration",
      "Central API base URL must use HTTP or HTTPS",
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new EdgeTransportError(
      "invalid_configuration",
      "Central API credentials must be supplied through headers",
    );
  }
  if (url.search !== "" || url.hash !== "") {
    throw new EdgeTransportError(
      "invalid_configuration",
      "Central API base URL cannot contain a query or fragment",
    );
  }
  if (url.pathname !== "/") {
    throw new EdgeTransportError(
      "invalid_configuration",
      "Central API base URL must not contain a path",
    );
  }

  return url;
}

function parsePositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EdgeTransportError(
      "invalid_configuration",
      `${field} must be a positive integer`,
    );
  }
  return value;
}

async function readBoundedJson(response: Response, maximumBytes: number): Promise<unknown | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      await response.body?.cancel();
      throw new EdgeTransportError(
        "response_too_large",
        "Central API response exceeded the configured size limit",
      );
    }
  }

  if (response.body === null) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;

      totalBytes += result.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new EdgeTransportError(
          "response_too_large",
          "Central API response exceeded the configured size limit",
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) return null;

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new EdgeTransportError(
      "invalid_response",
      "Central API response was not valid UTF-8",
    );
  }

  if (text.trim() === "") return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new EdgeTransportError(
      "invalid_response",
      "Central API response was not valid JSON",
    );
  }
}

function parseResponseBody<T>(
  schema: { readonly safeParse: (input: unknown) => { success: true; data: T } | { success: false } },
  body: unknown,
): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new EdgeTransportError(
      "invalid_response",
      "Central API response did not match the expected contract",
    );
  }
  return parsed.data;
}

function throwCentralApiError(response: ApiResponse): never {
  const parsed = ApiErrorSchema.safeParse(response.body);
  if (!parsed.success) {
    throw new EdgeTransportError(
      "invalid_response",
      "Central API error response did not match the expected contract",
    );
  }

  throw new CentralApiClientError(
    response.statusCode,
    parsed.data.code,
  );
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error
    && (error.name === "TimeoutError" || error.name === "AbortError");
}
