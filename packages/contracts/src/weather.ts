import * as z from "zod";
import { IsoDateTimeSchema } from "./identifiers.js";

export const WeatherCitySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/u.test(value),
    "City must not contain control characters",
  );

const LatitudeQuerySchema = z.preprocess(
  rejectBlankCoordinate,
  z.coerce.number().finite().min(-90).max(90),
);
const LongitudeQuerySchema = z.preprocess(
  rejectBlankCoordinate,
  z.coerce.number().finite().min(-180).max(180),
);

export const WeatherLocationQuerySchema = z
  .strictObject({
    city: WeatherCitySchema.optional(),
    latitude: LatitudeQuerySchema.optional(),
    longitude: LongitudeQuerySchema.optional(),
  })
  .superRefine((query, context) => {
    const hasCity = query.city !== undefined;
    const hasLatitude = query.latitude !== undefined;
    const hasLongitude = query.longitude !== undefined;

    if (hasCity && (hasLatitude || hasLongitude)) {
      context.addIssue({
        code: "custom",
        message: "Use either city or coordinates, not both",
        path: ["city"],
      });
      return;
    }

    if (!hasCity && !hasLatitude) {
      context.addIssue({
        code: "custom",
        message: "City or latitude is required",
        path: ["latitude"],
      });
    }
    if (!hasCity && !hasLongitude) {
      context.addIssue({
        code: "custom",
        message: "City or longitude is required",
        path: ["longitude"],
      });
    }
  });

export const WeatherSourceKindSchema = z.enum(["fixture", "live"]);
export const WeatherCacheStatusSchema = z.enum(["miss", "hit", "stale"]);

export const WeatherLocationSchema = z.strictObject({
  name: WeatherCitySchema,
  countryCode: z.string().regex(/^[A-Z]{2}$/).nullable(),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  timezoneOffsetSeconds: z.number().int().min(-64_800).max(64_800),
});

export const WeatherConditionsSchema = z.strictObject({
  summary: z.string().trim().min(1).max(120),
  temperatureCelsius: z.number().finite().min(-100).max(80),
  feelsLikeCelsius: z.number().finite().min(-100).max(80),
  humidityPercent: z.number().finite().min(0).max(100),
  cloudCoverPercent: z.number().finite().min(0).max(100),
  windSpeedMetersPerSecond: z.number().finite().min(0).max(150),
  precipitationMillimetersLastHour: z.number().finite().min(0).max(1_000).nullable(),
});

export const WeatherProviderReadingSchema = z.strictObject({
  schemaVersion: z.literal("smartfarm.weather-provider-reading.v1"),
  source: z.strictObject({
    kind: WeatherSourceKindSchema,
    provider: z.string().trim().min(1).max(80),
    observedAt: IsoDateTimeSchema,
  }),
  location: WeatherLocationSchema,
  conditions: WeatherConditionsSchema,
});

export const WeatherWarningSchema = z.strictObject({
  code: z.literal("provider_unavailable"),
  message: z.string().trim().min(1).max(160),
});

export const CurrentWeatherResponseSchema = z
  .strictObject({
    schemaVersion: z.literal("smartfarm.current-weather.v1"),
    source: z.strictObject({
      kind: WeatherSourceKindSchema,
      provider: z.string().trim().min(1).max(80),
      observedAt: IsoDateTimeSchema,
      fetchedAt: IsoDateTimeSchema,
    }),
    location: WeatherLocationSchema,
    conditions: WeatherConditionsSchema,
    cache: z.strictObject({
      status: WeatherCacheStatusSchema,
      cachedAt: IsoDateTimeSchema,
      expiresAt: IsoDateTimeSchema,
    }),
    warning: WeatherWarningSchema.nullable(),
  })
  .refine(
    (response) => Date.parse(response.cache.expiresAt) >= Date.parse(response.cache.cachedAt),
    {
      message: "Cache expiry must not precede cache creation",
      path: ["cache", "expiresAt"],
    },
  )
  .refine(
    (response) => (response.cache.status === "stale") === (response.warning !== null),
    {
      message: "Only stale weather responses carry a provider warning",
      path: ["warning"],
    },
  );

export type WeatherCity = z.infer<typeof WeatherCitySchema>;
export type WeatherLocationQueryInput = z.input<typeof WeatherLocationQuerySchema>;
export type WeatherLocationQuery = z.output<typeof WeatherLocationQuerySchema>;
export type WeatherSourceKind = z.infer<typeof WeatherSourceKindSchema>;
export type WeatherCacheStatus = z.infer<typeof WeatherCacheStatusSchema>;
export type WeatherProviderReading = z.infer<typeof WeatherProviderReadingSchema>;
export type CurrentWeatherResponse = z.infer<typeof CurrentWeatherResponseSchema>;

function rejectBlankCoordinate(value: unknown): unknown {
  return typeof value === "string" && value.trim() === "" ? Number.NaN : value;
}
