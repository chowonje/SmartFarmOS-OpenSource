import { randomUUID } from "node:crypto";
import { HealthResponseSchema } from "@smartfarm-os/contracts";
import type { ModuleRegistryConfigurationV1 } from "@smartfarm-os/module-sdk";
import fastify, { type FastifyInstance } from "fastify";
import type { AuthenticateRequest } from "./auth.js";
import { sendError } from "./http-boundary.js";
import type { ApiModuleContext } from "./module-context.js";
import { registerAdminGatewayEnrollmentRoutes } from "./modules/admin-gateway-enrollment-server.js";
import { registerPlatformCatalogRoutes } from "./modules/platform-catalog-routes.js";
import { registerApiModules } from "./server-module-registry.js";
import { InMemorySmartFarmStore, type SmartFarmStore } from "./store.js";
import {
  createWeatherProviderFromEnvironment,
  type WeatherProvider,
} from "./weather-provider.js";

const DEFAULT_WEATHER_REQUEST_TIMEOUT_MS = 4_000;

export type BuildApiOptions = {
  readonly authenticate: AuthenticateRequest;
  readonly createCommandId?: () => string;
  readonly createCropId?: () => string;
  readonly createCropCycleId?: () => string;
  readonly createStrategyApplicationId?: () => string;
  readonly moduleConfiguration?: ModuleRegistryConfigurationV1;
  readonly now?: () => Date;
  readonly store?: SmartFarmStore;
  readonly weatherProvider?: WeatherProvider;
  readonly weatherRequestTimeoutMs?: number;
};

export function buildApi(options: BuildApiOptions): FastifyInstance {
  const app = fastify({
    bodyLimit: 64 * 1_024,
    logger: false,
  });
  const context: ApiModuleContext = {
    app,
    authenticate: options.authenticate,
    store: options.store ?? new InMemorySmartFarmStore(),
    now: options.now ?? (() => new Date()),
    createCommandId: options.createCommandId ?? (() => `command:${randomUUID()}`),
    createCropId: options.createCropId ?? (() => `crop:${randomUUID()}`),
    createCropCycleId: options.createCropCycleId ?? (() => `cycle:${randomUUID()}`),
    createStrategyApplicationId: options.createStrategyApplicationId
      ?? (() => `strategy-application:${randomUUID()}`),
    weatherProvider: options.weatherProvider ?? createWeatherProviderFromEnvironment(),
    weatherRequestTimeoutMs: validateWeatherRequestTimeout(
      options.weatherRequestTimeoutMs ?? DEFAULT_WEATHER_REQUEST_TIMEOUT_MS,
    ),
  };

  app.setErrorHandler((_error, _request, reply) =>
    sendError(reply, 500, "internal_error", "The request could not be completed"));

  app.setNotFoundHandler((_request, reply) =>
    sendError(reply, 404, "not_found", "Route not found"));

  app.get("/health", async () => HealthResponseSchema.parse({
    schemaVersion: "smartfarm.health.v1",
    status: "ok",
  }));

  registerPlatformCatalogRoutes(context);
  registerAdminGatewayEnrollmentRoutes(context);
  registerApiModules(context, options.moduleConfiguration);

  return app;
}

function validateWeatherRequestTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new RangeError("weatherRequestTimeoutMs must be an integer from 1 to 10000");
  }
  return value;
}
