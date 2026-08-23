import { z } from "zod";

export const PLATFORM_API_VERSION = "1" as const;

const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/);

const RouteSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z][a-z0-9-]*$/);

const LabelSchema = z.string().trim().min(1).max(80);
const DescriptionSchema = z.string().trim().min(1).max(240);

export const ModulePermissionSchema = z.enum([
  "farm.read",
  "device.read",
  "area.read",
  "crop.read",
  "crop.write",
  "cycle.read",
  "cycle.write",
  "journal.read",
  "journal.write",
  "alarm.read",
  "alarm.acknowledge",
  "audit.read",
  "strategy.read",
  "strategy.apply",
  "telemetry.read",
  "weather.read",
  "location.read",
  "device.command",
  "layout.write",
  "automation.write",
]);

export type ModulePermission = z.infer<typeof ModulePermissionSchema>;

export const ModulePageContributionSchema = z.object({
  route: RouteSchema,
  label: LabelSchema,
  order: z.number().int().min(0).max(10_000),
  testId: IdentifierSchema.optional(),
}).strict();

export type ModulePageContribution = z.infer<typeof ModulePageContributionSchema>;

export const ModuleHomeCardContributionSchema = z.object({
  id: IdentifierSchema,
  label: LabelSchema,
  description: DescriptionSchema,
  route: RouteSchema,
  order: z.number().int().min(0).max(10_000),
}).strict();

export type ModuleHomeCardContribution = z.infer<typeof ModuleHomeCardContributionSchema>;

export const ModuleConfigurationFieldSchema = z.object({
  key: IdentifierSchema,
  label: LabelSchema,
  valueType: z.enum(["boolean", "number", "string", "select"]),
  required: z.boolean(),
}).strict();

export type ModuleConfigurationField = z.infer<typeof ModuleConfigurationFieldSchema>;

export const ModuleConfigurationSchemaV1Schema = z.object({
  schemaVersion: z.literal("smartfarm.module-configuration-schema.v1"),
  fields: z.array(ModuleConfigurationFieldSchema).max(64),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.fields.map((field) => field.key), context, ["fields"]);
});

export type ModuleConfigurationSchemaV1 = z.infer<typeof ModuleConfigurationSchemaV1Schema>;

export const ModuleManifestV1Schema = z.object({
  schemaVersion: z.literal("smartfarm.module-manifest.v1"),
  id: IdentifierSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  platformApiVersion: z.literal(PLATFORM_API_VERSION),
  name: LabelSchema,
  description: DescriptionSchema,
  permissions: z.array(ModulePermissionSchema).max(ModulePermissionSchema.options.length),
  pages: z.array(ModulePageContributionSchema).max(16),
  homeCards: z.array(ModuleHomeCardContributionSchema).max(32),
  configSchema: ModuleConfigurationSchemaV1Schema,
  subscriptions: z.array(IdentifierSchema).max(64),
}).strict().superRefine((manifest, context) => {
  addDuplicateIssues(manifest.permissions, context, ["permissions"]);
  addDuplicateIssues(manifest.pages.map((page) => page.route), context, ["pages"]);
  addDuplicateIssues(manifest.homeCards.map((card) => card.id), context, ["homeCards"]);
  addDuplicateIssues(manifest.subscriptions, context, ["subscriptions"]);

  const routes = new Set(manifest.pages.map((page) => page.route));
  manifest.homeCards.forEach((card, index) => {
    if (!routes.has(card.route)) {
      context.addIssue({
        code: "custom",
        message: `Home card route '${card.route}' is not declared by this module`,
        path: ["homeCards", index, "route"],
      });
    }
  });
});

export type ModuleManifestV1 = z.infer<typeof ModuleManifestV1Schema>;

export const ModuleActivationV1Schema = z.object({
  moduleId: IdentifierSchema,
  enabled: z.boolean(),
  order: z.number().int().min(0).max(10_000),
}).strict();

export type ModuleActivationV1 = z.infer<typeof ModuleActivationV1Schema>;

export const ModuleRegistryConfigurationV1Schema = z.object({
  schemaVersion: z.literal("smartfarm.module-registry-configuration.v1"),
  modules: z.array(ModuleActivationV1Schema).max(256),
}).strict().superRefine((value, context) => {
  addDuplicateIssues(value.modules.map((module) => module.moduleId), context, ["modules"]);
});

export type ModuleRegistryConfigurationV1 = z.infer<typeof ModuleRegistryConfigurationV1Schema>;

export type StaticModuleContribution<TImplementation> = {
  readonly manifest: ModuleManifestV1;
  readonly requiredPermissions: readonly ModulePermission[];
  readonly implementation: TImplementation;
};

export type RegisteredModule<TImplementation> = {
  readonly manifest: ModuleManifestV1;
  readonly implementation: TImplementation;
  readonly order: number;
};

export type RegisteredPageContribution = ModulePageContribution & {
  readonly moduleId: string;
};

export type RegisteredHomeCardContribution = ModuleHomeCardContribution & {
  readonly moduleId: string;
};

export type StaticModuleRegistry<TImplementation> = {
  readonly modules: readonly RegisteredModule<TImplementation>[];
  readonly pages: readonly RegisteredPageContribution[];
  readonly homeCards: readonly RegisteredHomeCardContribution[];
  findById(moduleId: string): RegisteredModule<TImplementation> | null;
  findByRoute(route: string): RegisteredModule<TImplementation> | null;
};

export function defineModuleManifest(input: ModuleManifestV1): ModuleManifestV1 {
  return deepFreeze(ModuleManifestV1Schema.parse(input));
}

export function defineModuleRegistryConfiguration(
  input: ModuleRegistryConfigurationV1,
): ModuleRegistryConfigurationV1 {
  return deepFreeze(ModuleRegistryConfigurationV1Schema.parse(input));
}

export function createStaticModuleRegistry<TImplementation>(
  contributions: readonly StaticModuleContribution<TImplementation>[],
  configuration: ModuleRegistryConfigurationV1 = {
    schemaVersion: "smartfarm.module-registry-configuration.v1",
    modules: [],
  },
): StaticModuleRegistry<TImplementation> {
  const parsedConfiguration = ModuleRegistryConfigurationV1Schema.parse(configuration);
  const parsedContributions = contributions.map((contribution) => ({
    ...contribution,
    manifest: ModuleManifestV1Schema.parse(contribution.manifest),
  }));

  assertUnique(
    parsedContributions.map((contribution) => contribution.manifest.id),
    "module ID",
  );

  const contributionById = new Map(
    parsedContributions.map((contribution) => [contribution.manifest.id, contribution]),
  );
  const activationById = new Map(
    parsedConfiguration.modules.map((activation) => [activation.moduleId, activation]),
  );

  for (const activation of parsedConfiguration.modules) {
    if (!contributionById.has(activation.moduleId)) {
      throw new Error(`Module configuration references unknown module '${activation.moduleId}'`);
    }
  }

  for (const contribution of parsedContributions) {
    const declared = new Set(contribution.manifest.permissions);
    for (const permission of contribution.requiredPermissions) {
      if (!declared.has(permission)) {
        throw new Error(
          `Module '${contribution.manifest.id}' uses undeclared permission '${permission}'`,
        );
      }
    }
  }

  const registered = parsedContributions
    .filter((contribution) => activationById.get(contribution.manifest.id)?.enabled !== false)
    .map((contribution, index) => ({
      manifest: deepFreeze(contribution.manifest),
      implementation: contribution.implementation,
      order: activationById.get(contribution.manifest.id)?.order ?? index * 10,
    }))
    .sort(compareRegisteredModules);

  const orderByModuleId = new Map(
    registered.map((module) => [module.manifest.id, module.order]),
  );

  const pages = registered.flatMap((module) => module.manifest.pages.map((page) => ({
    ...page,
    moduleId: module.manifest.id,
  }))).sort((left, right) => compareContributions(left, right, orderByModuleId));
  const homeCards = registered.flatMap((module) => module.manifest.homeCards.map((card) => ({
    ...card,
    moduleId: module.manifest.id,
  }))).sort((left, right) => compareContributions(left, right, orderByModuleId));

  assertUnique(pages.map((page) => page.route), "page route");
  assertUnique(homeCards.map((card) => card.id), "home card ID");

  const moduleById = new Map(registered.map((module) => [module.manifest.id, module]));
  const moduleByRoute = new Map(
    pages.map((page) => [page.route, moduleById.get(page.moduleId)!]),
  );

  return Object.freeze({
    modules: Object.freeze(registered),
    pages: Object.freeze(pages),
    homeCards: Object.freeze(homeCards),
    findById: (moduleId: string) => moduleById.get(moduleId) ?? null,
    findByRoute: (route: string) => moduleByRoute.get(route) ?? null,
  });
}

function addDuplicateIssues(
  values: readonly string[],
  context: z.core.$RefinementCtx,
  path: readonly PropertyKey[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate value '${value}'`,
        path: [...path, index],
      });
    }
    seen.add(value);
  });
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label} '${value}'`);
    seen.add(value);
  }
}

function compareRegisteredModules<TImplementation>(
  left: RegisteredModule<TImplementation>,
  right: RegisteredModule<TImplementation>,
): number {
  return left.order - right.order || left.manifest.id.localeCompare(right.manifest.id);
}

function compareContributions(
  left: { readonly order: number; readonly moduleId: string },
  right: { readonly order: number; readonly moduleId: string },
  orderByModuleId: ReadonlyMap<string, number>,
): number {
  return (orderByModuleId.get(left.moduleId) ?? 0) - (orderByModuleId.get(right.moduleId) ?? 0)
    || left.order - right.order
    || left.moduleId.localeCompare(right.moduleId);
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
