import type { FastifyInstance } from "fastify";
import type { AuthenticateRequest } from "./auth.js";
import type { SmartFarmStore } from "./store.js";
import type { WeatherProvider } from "./weather-provider.js";

export type ApiModuleContext = {
  readonly app: FastifyInstance;
  readonly authenticate: AuthenticateRequest;
  readonly store: SmartFarmStore;
  readonly now: () => Date;
  readonly createCommandId: () => string;
  readonly createCropId: () => string;
  readonly createCropCycleId: () => string;
  readonly createStrategyApplicationId: () => string;
  readonly weatherProvider: WeatherProvider;
  readonly weatherRequestTimeoutMs: number;
};

export type ApiModuleRegistrar = (context: ApiModuleContext) => void;
