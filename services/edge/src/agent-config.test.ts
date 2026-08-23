import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_EDGE_CONFIG_PATH,
  DEFAULT_EDGE_CREDENTIAL_PATH,
  DEFAULT_EDGE_ENROLLMENT_PATH,
  DEFAULT_EDGE_JOURNAL_PATH,
  ensureEdgeRuntimeDirectories,
  loadEdgeAgentConfig,
  parseEdgeAgentConfig,
} from "./agent-config.js";

test("parses a minimal config with runtime defaults", () => {
  const config = parseEdgeAgentConfig({
    apiUrl: "https://api.example.test",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
  });

  assert.equal(config.apiUrl, "https://api.example.test");
  assert.equal(config.credentialPath, DEFAULT_EDGE_CREDENTIAL_PATH);
  assert.equal(config.journalPath, DEFAULT_EDGE_JOURNAL_PATH);
  assert.equal(config.enrollmentPath, DEFAULT_EDGE_ENROLLMENT_PATH);
  assert.equal(config.commandPollIntervalMs > 0, true);
  assert.equal(config.telemetryIntervalMs > 0, true);
});

test("resolves relative config paths from the config file directory", () => {
  const config = parseEdgeAgentConfig({
    apiUrl: "https://api.example.test",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    credentialPath: "./creds.json",
    journalPath: "./journal.sqlite",
  }, { configPath: "/etc/smartfarm-edge/config.json" });

  assert.equal(config.credentialPath, "/etc/smartfarm-edge/creds.json");
  assert.equal(config.journalPath, "/etc/smartfarm-edge/journal.sqlite");
});

test("rejects invalid API URLs and non-positive intervals", () => {
  assert.throws(
    () => parseEdgeAgentConfig({
      apiUrl: "https://api.example.test",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      credentialHeaderName: "x-custom-key",
    }),
    /fixed Authorization Bearer contract/,
  );
  assert.throws(
    () => parseEdgeAgentConfig({
      apiUrl: "http://api.example.test",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    }),
    /must use https unless the API is on loopback/,
  );
  assert.equal(parseEdgeAgentConfig({
    apiUrl: "http://127.0.0.1:3100",
    farmId: "farm:demo",
    deviceId: "device:bed-1",
  }).apiUrl, "http://127.0.0.1:3100");
  assert.throws(
    () => parseEdgeAgentConfig({
      apiUrl: "https://user:pass@example.test",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    }),
    /must not contain credentials/,
  );
  assert.throws(
    () => parseEdgeAgentConfig({
      apiUrl: "https://api.example.test/path",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
    }),
    /must not contain a path/,
  );
  assert.throws(
    () => parseEdgeAgentConfig({
      apiUrl: "https://api.example.test",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      commandPollIntervalMs: 0,
    }),
    /positive integer/,
  );
  assert.throws(
    () => parseEdgeAgentConfig({
      apiUrl: "https://api.example.test",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      enrollmentPath: "/v1/gateway-enrollments/exchange?token=no",
    }),
    /origin-relative path/,
  );
});

test("loads config from disk and creates parent runtime directories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-edge-config-"));
  try {
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({
      apiUrl: "https://api.example.test",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      credentialPath: "./state/credential.json",
      journalPath: "./state/execution.sqlite",
    }), "utf8");

    const config = await loadEdgeAgentConfig(configPath);
    await ensureEdgeRuntimeDirectories(config);

    assert.equal(config.credentialPath, join(directory, "state", "credential.json"));
    assert.equal(config.journalPath, join(directory, "state", "execution.sqlite"));
    const credentialParent = await readFile(configPath, "utf8");
    assert.ok(credentialParent.includes("api.example.test"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps the documented default config path stable", () => {
  assert.equal(DEFAULT_EDGE_CONFIG_PATH, "/etc/smartfarm-edge/config.json");
});

test("rejects too-open and symbolic-link runtime directories on POSIX", async () => {
  if (process.platform === "win32") return;
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-edge-path-guard-"));
  try {
    const openDirectory = join(directory, "open");
    const linkedDirectory = join(directory, "linked");
    await ensureEdgeRuntimeDirectories(parseEdgeAgentConfig({
      apiUrl: "https://api.example.test",
      farmId: "farm:demo",
      deviceId: "device:bed-1",
      credentialPath: join(openDirectory, "credential.json"),
      journalPath: join(openDirectory, "journal.sqlite"),
    }));
    await chmod(openDirectory, 0o777);
    await assert.rejects(
      ensureEdgeRuntimeDirectories(parseEdgeAgentConfig({
        apiUrl: "https://api.example.test",
        farmId: "farm:demo",
        deviceId: "device:bed-1",
        credentialPath: join(openDirectory, "credential.json"),
        journalPath: join(openDirectory, "journal.sqlite"),
      })),
      /must not grant group or other access/,
    );

    await symlink(openDirectory, linkedDirectory);
    await assert.rejects(
      ensureEdgeRuntimeDirectories(parseEdgeAgentConfig({
        apiUrl: "https://api.example.test",
        farmId: "farm:demo",
        deviceId: "device:bed-1",
        credentialPath: join(linkedDirectory, "credential.json"),
        journalPath: join(linkedDirectory, "journal.sqlite"),
      })),
      /real directory, not a symbolic link/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
