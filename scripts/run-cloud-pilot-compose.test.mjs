import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createComposeArguments,
  parseEnvValue,
  parseSimpleEnvFile,
  resolveComposeCommand,
} from "./run-cloud-pilot-compose.mjs";

test("parseSimpleEnvFile reads key/value pairs and skips comments", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-cloud-pilot-env-"));
  const envPath = join(directory, ".env");
  await writeFile(
    envPath,
    [
      "# comment",
      "SMARTFARM_SITE_ADDRESS=pilot.example.com",
      "SMARTFARM_DEMO_KEY='demo-key'",
      "SMARTFARM_BASIC_AUTH_HASH='$2a$14$exampleexampleexampleexampleexampleexampleexampleexample'",
      "",
      "SMARTFARM_HTTP_PORT=8080",
    ].join("\n"),
    "utf8",
  );

  const env = await parseSimpleEnvFile(envPath);
  assert.deepEqual(env, {
    SMARTFARM_SITE_ADDRESS: "pilot.example.com",
    SMARTFARM_DEMO_KEY: "demo-key",
    SMARTFARM_BASIC_AUTH_HASH: "$2a$14$exampleexampleexampleexampleexampleexampleexampleexample",
    SMARTFARM_HTTP_PORT: "8080",
  });
});

test("parseEnvValue keeps single-quoted bcrypt hashes literal", () => {
  assert.equal(
    parseEnvValue("'$2a$14$exampleexampleexampleexampleexampleexampleexampleexample'"),
    "$2a$14$exampleexampleexampleexampleexampleexampleexampleexample",
  );
});

test("resolveComposeCommand prefers docker compose when available", async () => {
  const command = await resolveComposeCommand(async (candidate) => {
    return candidate.join(" ") === "docker compose version";
  });

  assert.deepEqual(command, ["docker", "compose"]);
});

test("resolveComposeCommand falls back to docker-compose", async () => {
  const command = await resolveComposeCommand(async (candidate) => {
    return candidate.join(" ") === "docker-compose --version";
  });

  assert.deepEqual(command, ["docker-compose"]);
});

test("createComposeArguments pins the cloud-pilot compose file", () => {
  const args = createComposeArguments(["docker", "compose"], ["config"]);
  assert.deepEqual(args, [
    "docker",
    "compose",
    "-f",
    "deploy/cloud-pilot/docker-compose.yml",
    "config",
  ]);
});
