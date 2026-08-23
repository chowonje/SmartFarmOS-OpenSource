import { resolve } from "node:path";
import { assertDemoModeEnabled, startLocalDemo } from "./runtime.js";

async function main(): Promise<void> {
  assertDemoModeEnabled();

  const port = parseOptionalPort(process.env.SMARTFARM_DEMO_PORT);
  const telemetryIntervalMs = parseOptionalPositiveInteger(
    process.env.SMARTFARM_DEMO_TELEMETRY_INTERVAL_MS,
  );
  const commandPollIntervalMs = parseOptionalPositiveInteger(
    process.env.SMARTFARM_DEMO_COMMAND_POLL_INTERVAL_MS,
  );
  const lowWaterRecoveryEmissionIndex = parseOptionalPositiveInteger(
    process.env.SMARTFARM_DEMO_LOW_WATER_EMISSIONS,
  );

  const runtime = await startLocalDemo({
    farmId: process.env.SMARTFARM_DEMO_FARM_ID ?? "farm:demo",
    deviceId: process.env.SMARTFARM_DEMO_DEVICE_ID ?? "device:bed-1",
    databasePath: resolve(process.env.SMARTFARM_DEMO_DB_PATH ?? ".smartfarm-demo.sqlite"),
    demoKey: requireEnvironmentValue("SMARTFARM_DEMO_KEY"),
    ...(port === undefined ? {} : { port }),
    ...(telemetryIntervalMs === undefined ? {} : { telemetryIntervalMs }),
    ...(commandPollIntervalMs === undefined ? {} : { commandPollIntervalMs }),
    ...(lowWaterRecoveryEmissionIndex === undefined ? {} : { lowWaterRecoveryEmissionIndex }),
    onBackgroundError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[smartfarm-local-demo] background error: ${message}`);
    },
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await runtime.close();
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  console.log(`[smartfarm-local-demo] listening on ${runtime.baseUrl}`);
  console.log(`[smartfarm-local-demo] auth headers: ${"x-smartfarm-demo-key"}, ${"x-smartfarm-demo-role"}`);
}

function parseOptionalPort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Number.parseInt(value, 10);
}

function parseOptionalPositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Number.parseInt(value, 10);
}

function requireEnvironmentValue(name: "SMARTFARM_DEMO_KEY"): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} must be set by the local demo launcher`);
  }
  return value;
}

const exitCode = await main().then(
  () => 0,
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  },
);

if (exitCode !== 0) {
  process.exitCode = exitCode;
}
