import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const podmanScript = "deploy/cloud-pilot/podman.sh";

test("Podman cloud-pilot helper is POSIX sh, secret-safe, and replacement-safe", async () => {
  const source = await readFile(podmanScript, "utf8");

  assert.match(source, /^#!\/bin\/sh/m);
  assert.doesNotMatch(source, /\beval\b/u);
  assert.doesNotMatch(source, /(^|[;\n])\s*source\s+/mu);
  assert.match(source, /chmod 600 "\$normalized_env_file"/u);
  assert.match(source, /trap cleanup EXIT HUP INT TERM/u);
  assert.match(source, /--env-file "\$normalized_env_file"/u);
  assert.match(source, /podman container exists -- "\$CONTAINER_NAME"/u);
  assert.doesNotMatch(source, /--replace/u);
  assert.match(source, /--publish 80:80/u);
  assert.match(source, /--publish 443:443/u);
  assert.doesNotMatch(source, /--publish (?:3100|4173|4174):/u);
  assert.match(source, /:\/data:Z/u);
  assert.match(source, /:\/srv\/caddy-data:Z/u);
  assert.match(source, /:\/srv\/caddy-config:Z/u);
  assert.match(source, /--health-cmd/u);
  assert.match(source, /rootful Podman/u);
  assert.match(source, /tar -tf "\$archive" \| awk/u);
  assert.match(source, /tar -tvf "\$archive" \| awk/u);
  assert.match(source, /path-safe, and have one top-level directory/u);
  assert.match(source, /--archive-sha256/u);
  assert.match(source, /MAX_ARCHIVE_BYTES=536870912/u);
  assert.match(source, /io\.smartfarm\.cloud-pilot\.managed=true/u);
  assert.match(source, /SMARTFARM_SITE_ADDRESS.*A-Za-z0-9/mu);
  assert.match(source, /SMARTFARM_BASIC_AUTH_USER.*A-Za-z0-9/mu);
  assert.doesNotMatch(source, /SMARTFARM_CLOUD_PILOT_(?:CONTAINER|DATA_VOLUME|CADDY_DATA_VOLUME|CADDY_CONFIG_VOLUME)/u);
});

test("Podman helper rejects a site value that could alter the Caddy directive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-podman-cloud-pilot-invalid-env-"));
  const binDirectory = join(directory, "bin");
  const envPath = join(directory, "pilot.env");
  await mkdir(binDirectory);
  await writeFile(
    envPath,
    [
      "SMARTFARM_SITE_ADDRESS=pilot.example.test {",
      "SMARTFARM_BASIC_AUTH_USER=pilot",
      "SMARTFARM_BASIC_AUTH_HASH='$2a$14$exampleexampleexampleexampleexampleexampleexampleexample'",
      "SMARTFARM_DEMO_KEY=fake-demo-key-for-test-only",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(binDirectory, "podman"), fakePodman(), "utf8");
  await chmod(join(binDirectory, "podman"), 0o755);

  const result = await run("/bin/sh", [podmanScript, "up", "--env", envPath], {
    PATH: `${binDirectory}:${process.env.PATH}`,
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /unsupported whitespace or characters/u);
  assert.doesNotMatch(result.stderr, /pilot\.example/u);
});

test("Podman helper normalizes a quoted bcrypt hash without evaluating it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-podman-cloud-pilot-"));
  const binDirectory = join(directory, "bin");
  const envPath = join(directory, "pilot.env");
  const capturedEnvPath = join(directory, "captured.env");
  const capturedArgsPath = join(directory, "captured.args");
  await mkdir(binDirectory);
  await writeFile(
    envPath,
    [
      "SMARTFARM_SITE_ADDRESS=pilot.example.test",
      "SMARTFARM_BASIC_AUTH_USER=pilot",
      "SMARTFARM_BASIC_AUTH_HASH='$2a$14$exampleexampleexampleexampleexampleexampleexampleexample'",
      "SMARTFARM_DEMO_KEY=fake-demo-key-for-test-only",
      "SMARTFARM_OPENWEATHER_API_KEY=",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(binDirectory, "podman"), fakePodman(), "utf8");
  await chmod(join(binDirectory, "podman"), 0o755);

  const result = await run("/bin/sh", [podmanScript, "up", "--env", envPath, "--image", "pilot:test"], {
    PATH: `${binDirectory}:${process.env.PATH}`,
    CAPTURED_ENV: capturedEnvPath,
    CAPTURED_ARGS: capturedArgsPath,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /fake-demo-key-for-test-only/u);
  const normalized = await readFile(capturedEnvPath, "utf8");
  assert.match(normalized, /^SMARTFARM_BASIC_AUTH_HASH=\$2a\$14\$/mu);
  assert.doesNotMatch(normalized, /SMARTFARM_BASIC_AUTH_HASH='\$/u);
  assert.match(normalized, /^SMARTFARM_OPENWEATHER_API_KEY=$/mu);
  assert.equal((await stat(capturedEnvPath)).mode & 0o777, 0o600);

  const args = await readFile(capturedArgsPath, "utf8");
  assert.match(args, /--publish\n80:80/u);
  assert.match(args, /--publish\n443:443/u);
  assert.match(args, /smartfarm_cloud_pilot_data:\/data:Z/u);
  assert.doesNotMatch(args, /--replace/u);
});

test("Podman helper builds a public source archive with an explicit revision and image", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-podman-cloud-pilot-build-"));
  const binDirectory = join(directory, "bin");
  const releaseDirectory = join(directory, "public-release");
  const archivePath = join(directory, "public-release.tar.gz");
  const capturedArgsPath = join(directory, "captured-build.args");
  await mkdir(binDirectory);
  await mkdir(join(releaseDirectory, "deploy/cloud-pilot"), { recursive: true });
  await writeFile(join(releaseDirectory, "deploy/cloud-pilot/Dockerfile"), "FROM scratch\n", "utf8");
  const archived = await run("tar", ["-czf", archivePath, "-C", directory, "public-release"], {});
  assert.equal(archived.code, 0, archived.stderr);
  await writeFile(join(binDirectory, "podman"), fakePodman(), "utf8");
  await chmod(join(binDirectory, "podman"), 0o755);
  const archiveSha256 = await sha256(archivePath);

  const result = await run("/bin/sh", [
    podmanScript,
    "build",
    "--archive", archivePath,
    "--archive-sha256", archiveSha256,
    "--commit", "4af586a47b9da9a7a1220f05b1318460f1031ede",
    "--image", "smartfarm-os-cloud-pilot:2026-final",
  ], {
    PATH: `${binDirectory}:${process.env.PATH}`,
    CAPTURED_BUILD_ARGS: capturedArgsPath,
  });

  assert.equal(result.code, 0, result.stderr);
  const args = await readFile(capturedArgsPath, "utf8");
  assert.match(args, /--tag\nsmartfarm-os-cloud-pilot:2026-final/u);
  assert.match(args, /org\.opencontainers\.image\.revision=4af586a47b9da9a7a1220f05b1318460f1031ede/u);
  assert.match(args, new RegExp(`io\\.smartfarm\\.cloud-pilot\\.archive-sha256=${archiveSha256}`, "u"));
  assert.match(args, /--file\n.*deploy\/cloud-pilot\/Dockerfile/u);
});

test("Podman helper refuses an archive with the wrong SHA-256 before build", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-podman-cloud-pilot-digest-"));
  const binDirectory = join(directory, "bin");
  const releaseDirectory = join(directory, "public-release");
  const archivePath = join(directory, "public-release.tar.gz");
  await mkdir(binDirectory);
  await mkdir(join(releaseDirectory, "deploy/cloud-pilot"), { recursive: true });
  await writeFile(join(releaseDirectory, "deploy/cloud-pilot/Dockerfile"), "FROM scratch\n", "utf8");
  assert.equal((await run("tar", ["-czf", archivePath, "-C", directory, "public-release"], {})).code, 0);
  await writeFile(join(binDirectory, "podman"), fakePodman(), "utf8");
  await chmod(join(binDirectory, "podman"), 0o755);

  const result = await run("/bin/sh", [
    podmanScript,
    "build",
    "--archive", archivePath,
    "--archive-sha256", "0000000000000000000000000000000000000000000000000000000000000000",
    "--commit", "4af586a47b9da9a7a1220f05b1318460f1031ede",
  ], { PATH: `${binDirectory}:${process.env.PATH}` });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /SHA-256 does not match/u);
});

test("Podman helper rejects archive links and special members before extraction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-podman-cloud-pilot-links-"));
  const binDirectory = join(directory, "bin");
  const releaseDirectory = join(directory, "public-release");
  const archivePath = join(directory, "public-release.tar.gz");
  await mkdir(binDirectory);
  await mkdir(join(releaseDirectory, "deploy/cloud-pilot"), { recursive: true });
  await writeFile(join(releaseDirectory, "deploy/cloud-pilot/Dockerfile"), "FROM scratch\n", "utf8");
  await symlink("deploy/cloud-pilot/Dockerfile", join(releaseDirectory, "linked-dockerfile"));
  assert.equal((await run("tar", ["-czf", archivePath, "-C", directory, "public-release"], {})).code, 0);
  await writeFile(join(binDirectory, "podman"), fakePodman(), "utf8");
  await chmod(join(binDirectory, "podman"), 0o755);

  const result = await run("/bin/sh", [
    podmanScript,
    "build",
    "--archive", archivePath,
    "--archive-sha256", await sha256(archivePath),
    "--commit", "4af586a47b9da9a7a1220f05b1318460f1031ede",
  ], { PATH: `${binDirectory}:${process.env.PATH}` });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /only regular files and directories/u);
});

test("Podman helper fails clearly when Podman is unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-podman-cloud-pilot-missing-"));
  const result = await run("/bin/sh", [podmanScript, "status"], {
    PATH: directory,
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Podman is required/u);
});

test("Podman status preserves a running state when optional health metadata is unavailable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-podman-cloud-pilot-status-"));
  const binDirectory = join(directory, "bin");
  await mkdir(binDirectory);
  await writeFile(join(binDirectory, "podman"), fakePodman(), "utf8");
  await chmod(join(binDirectory, "podman"), 0o755);

  const result = await run("/bin/sh", [podmanScript, "status"], {
    PATH: `${binDirectory}:${process.env.PATH}`,
    STATUS_CONTAINER_EXISTS: "1",
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /state=running health=unknown revision=unknown/u);
});

test("Podman helper refuses to remove a same-named container without its ownership label", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-podman-cloud-pilot-unmanaged-"));
  const binDirectory = join(directory, "bin");
  await mkdir(binDirectory);
  await writeFile(join(binDirectory, "podman"), fakePodman(), "utf8");
  await chmod(join(binDirectory, "podman"), 0o755);

  const result = await run("/bin/sh", [podmanScript, "down"], {
    PATH: `${binDirectory}:${process.env.PATH}`,
    STATUS_CONTAINER_EXISTS: "1",
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Refusing to manage a container/u);
});

function fakePodman() {
  return `#!/bin/sh
set -eu
case "$1" in
  info) printf '%s\\n' false ;;
  container)
    [ "\${STATUS_CONTAINER_EXISTS:-}" = 1 ] && exit 0
    exit 1
    ;;
  image) exit 0 ;;
  volume)
    case "$2" in
      exists) exit 1 ;;
      create) exit 0 ;;
    esac
    ;;
  run)
    shift
    while [ "$#" -gt 0 ]; do
      if [ "$1" = "--env-file" ]; then
        cp "$2" "$CAPTURED_ENV"
        shift 2
        continue
      fi
      printf '%s\\n' "$1" >> "$CAPTURED_ARGS"
      shift
    done
    chmod 600 "$CAPTURED_ENV"
    ;;
  build)
    shift
    printf '%s\\n' "$@" > "$CAPTURED_BUILD_ARGS"
    ;;
  inspect)
    [ "$3" = '{{.State.Status}}' ] && printf '%s\\n' running && exit 0
    [ "$3" = '{{index .Config.Labels "io.smartfarm.cloud-pilot.managed"}}' ] && printf '\\n' && exit 0
    exit 1
    ;;
  *) exit 1 ;;
esac
`;
}

async function run(command, args, additions) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...additions },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => resolve({ code: 1, stdout, stderr: String(error) }));
    child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
