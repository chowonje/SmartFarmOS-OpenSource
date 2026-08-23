import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { DeviceIdSchema, FarmIdSchema } from "@smartfarm-os/contracts";
import type { EdgeAgentConfig } from "./agent-config.js";
import { parseCliArgs, runCli } from "./cli.js";

const edgeKey = `edge-credential:demo-edge.${"a".repeat(43)}`;

function createConfig(): EdgeAgentConfig {
  return {
    apiUrl: "https://api.example.test",
    farmId: FarmIdSchema.parse("farm:demo"),
    deviceId: DeviceIdSchema.parse("device:bed-1"),
    credentialPath: "/tmp/credential.json",
    journalPath: "/tmp/execution.sqlite",
    enrollmentPath: "/v1/gateway-enrollments/exchange",
    commandPollIntervalMs: 1_000,
    stopPollIntervalMs: 250,
    telemetryIntervalMs: 5_000,
    requestTimeoutMs: 5_000,
    maxResponseBytes: 1_024,
  };
}

test("parses the supported CLI commands", () => {
  assert.deepEqual(parseCliArgs(["run"]), { kind: "run", configPath: "/etc/smartfarm-edge/config.json" });
  assert.deepEqual(parseCliArgs(["enroll", "--config", "/tmp/config.json"]), {
    kind: "enroll",
    configPath: "/tmp/config.json",
  });
  assert.deepEqual(parseCliArgs(["credential-status"]), {
    kind: "credential-status",
    configPath: "/etc/smartfarm-edge/config.json",
  });
  assert.deepEqual(parseCliArgs(["passwd", "--user", "pi"]), {
    kind: "passwd",
    username: "pi",
    configPath: "/etc/smartfarm-edge/config.json",
  });
  assert.throws(() => parseCliArgs(["passwd"]), /requires --user/);
});

test("enroll reads a hidden token and writes only the resulting credential", async () => {
  let written: unknown = null;
  const stdout = new PassThrough();
  let output = "";
  stdout.on("data", (chunk) => {
    output += String(chunk);
  });

  const exitCode = await runCli(["enroll"], {
    stdout: stdout as unknown as NodeJS.WriteStream,
    loadConfig: async () => createConfig(),
    readHiddenValue: async () => "one-time-token",
    createEnrollmentClient: () => ({
      exchangeToken: async () => ({
        credential: {
          schemaVersion: "smartfarm.edge-credential-record.v1",
          id: "edge-credential:demo-edge",
          farmId: "farm:demo",
          deviceId: "device:bed-1",
          status: "active",
          createdFromEnrollmentId: "gateway-enrollment:demo-enroll",
          createdAt: "2026-08-12T00:00:00.000Z",
          revokedAt: null,
          revokedByActorId: null,
        },
        edgeKey,
      }),
    }) as never,
    writeCredential: async (_path, record) => {
      written = record;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(written, {
    schemaVersion: "smartfarm.edge-local-credential.v1",
    credential: {
      schemaVersion: "smartfarm.edge-credential-record.v1",
      id: "edge-credential:demo-edge",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      status: "active",
      createdFromEnrollmentId: "gateway-enrollment:demo-enroll",
      createdAt: "2026-08-12T00:00:00.000Z",
      revokedAt: null,
      revokedByActorId: null,
    },
    edgeKey,
  });
  assert.equal(output.includes(edgeKey), false);
});

test("credential-status prints only non-secret metadata", async () => {
  const stdout = new PassThrough();
  let output = "";
  stdout.on("data", (chunk) => {
    output += String(chunk);
  });

  const exitCode = await runCli(["credential-status"], {
    stdout: stdout as unknown as NodeJS.WriteStream,
    loadConfig: async () => createConfig(),
    credentialStatus: async () => ({
      exists: true,
      issuedAt: "2026-08-12T00:00:00.000Z",
      mode: 0o600,
    }),
  });

  assert.equal(exitCode, 0);
  assert.equal(output.includes(edgeKey), false);
  assert.equal(output.includes("\"credentialPresent\": true"), true);
});

test("passwd stays local-only and uses the injected system adapter", async () => {
  let changed: { readonly username: string; readonly password: string } | null = null;
  const exitCode = await runCli(["passwd", "--user", "pi"], {
    loadConfig: async () => {
      throw new Error("passwd must not depend on central API config");
    },
    readConfirmedPassword: async () => "good-pass-01",
    createSystemAccountPort: () => ({
      changePassword: async (username, password) => {
        changed = { username, password };
      },
    }),
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(changed, { username: "pi", password: "good-pass-01" });
});

test("run reports daemon startup and stops cleanly through the injected runtime", async () => {
  const stdout = new PassThrough();
  let output = "";
  stdout.on("data", (chunk) => {
    output += String(chunk);
  });
  const exitCode = await runCli(["run"], {
    stdout: stdout as unknown as NodeJS.WriteStream,
    loadConfig: async () => createConfig(),
    startRuntime: async () => ({
      stop: async () => undefined,
      getLastBackgroundError: () => null,
    }),
    waitForTermination: async (stop) => {
      await stop();
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(output.includes("daemon started"), true);
});
