import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createVideoProof,
  parseCliArgs,
  revalidateProof,
  runCli,
} from "./create-video-proof.mjs";

const scriptPath = fileURLToPath(new URL("./create-video-proof.mjs", import.meta.url));
const repositoryRoot = dirname(dirname(scriptPath));

test("parseCliArgs stays strict about help, required review, and unknown flags", () => {
  assert.deepEqual(parseCliArgs(["--help"], { cwd: "/tmp/repo" }), {
    help: true,
    reviewed: false,
    videoPath: null,
    outputPath: "/tmp/repo/artifacts/submission/video-proof.json",
  });
  assert.throws(() => parseCliArgs([], { cwd: "/tmp/repo" }), /Expected exactly one video file path/);
  assert.throws(() => parseCliArgs(["artifacts/submission/demo.mp4"], { cwd: "/tmp/repo" }), /--reviewed is required/);
  assert.throws(() => parseCliArgs(["artifacts/submission/demo.mp4", "--reviewed", "--unknown"], { cwd: "/tmp/repo" }), /Unknown argument/);
  assert.throws(() => parseCliArgs(["--help", "--reviewed"], { cwd: "/tmp/repo" }), /--help cannot be combined/);
});

test("createVideoProof writes a reviewed proof with rounded duration and streamed hash", async (t) => {
  const root = await createRepositoryFixture("smartfarm-video-proof-valid-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const videoPath = join(root, "artifacts", "submission", "smartfarm-demo.mp4");
  await writeFile(videoPath, "reviewed-video-binary", "utf8");

  const result = await createVideoProof({
    repositoryRoot: root,
    videoPath,
    reviewed: true,
    spawnSyncImpl: () => ({ status: 0, stdout: "165.4\n", stderr: "" }),
  });

  assert.equal(result.proof.durationSeconds, 165);
  assert.equal(result.proof.reviewed, true);
  assert.equal(result.proof.filePath, "artifacts/submission/smartfarm-demo.mp4");

  const saved = JSON.parse(await readFile(result.outputPath, "utf8"));
  assert.deepEqual(saved, result.proof);
  assert.deepEqual(revalidateProof(saved), result.proof);
});

test("createVideoProof rejects missing explicit reviewed assertion", async (t) => {
  const root = await createRepositoryFixture("smartfarm-video-proof-review-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const videoPath = join(root, "artifacts", "submission", "smartfarm-demo.mp4");
  await writeFile(videoPath, "reviewed-video-binary", "utf8");

  await assert.rejects(
    createVideoProof({
      repositoryRoot: root,
      videoPath,
      reviewed: false,
      spawnSyncImpl: () => ({ status: 0, stdout: "150\n", stderr: "" }),
    }),
    /explicit human review/,
  );
});

test("createVideoProof rejects videos longer than 180.01 seconds", async (t) => {
  const root = await createRepositoryFixture("smartfarm-video-proof-too-long-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const videoPath = join(root, "artifacts", "submission", "smartfarm-demo.mp4");
  await writeFile(videoPath, "reviewed-video-binary", "utf8");

  await assert.rejects(
    createVideoProof({
      repositoryRoot: root,
      videoPath,
      reviewed: true,
      spawnSyncImpl: () => ({ status: 0, stdout: "180.02\n", stderr: "" }),
    }),
    /180-second contest limit/,
  );
  assert.deepEqual(await readdir(join(root, "artifacts", "submission")), ["smartfarm-demo.mp4"]);
});

test("createVideoProof rejects invalid ffprobe duration output and probe failures", async (t) => {
  const root = await createRepositoryFixture("smartfarm-video-proof-invalid-probe-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const videoPath = join(root, "artifacts", "submission", "smartfarm-demo.mp4");
  await writeFile(videoPath, "reviewed-video-binary", "utf8");

  await assert.rejects(
    createVideoProof({
      repositoryRoot: root,
      videoPath,
      reviewed: true,
      spawnSyncImpl: () => ({ status: 0, stdout: "not-a-number\n", stderr: "/outside/path" }),
    }),
    /duration could not be verified/,
  );
  await assert.rejects(
    createVideoProof({
      repositoryRoot: root,
      videoPath,
      reviewed: true,
      spawnSyncImpl: () => ({ status: 0, stdout: "165.4junk\n", stderr: "" }),
    }),
    /duration could not be verified/,
  );
  await assert.rejects(
    createVideoProof({
      repositoryRoot: root,
      videoPath,
      reviewed: true,
      spawnSyncImpl: () => ({ status: 1, stdout: "", stderr: "ffprobe internal details" }),
    }),
    /duration could not be verified/,
  );
});

test("createVideoProof rejects outside and symbolic-link video paths", async (t) => {
  const root = await createRepositoryFixture("smartfarm-video-proof-paths-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const outsideVideoPath = join(root, "outside.mp4");
  await writeFile(outsideVideoPath, "outside-video", "utf8");

  await assert.rejects(
    createVideoProof({
      repositoryRoot: root,
      videoPath: outsideVideoPath,
      reviewed: true,
      spawnSyncImpl: () => ({ status: 0, stdout: "120\n", stderr: "" }),
    }),
    /inside artifacts\/submission/,
  );

  const videoTargetPath = join(root, "artifacts", "submission", "real.mp4");
  const symlinkPath = join(root, "artifacts", "submission", "linked.mp4");
  await writeFile(videoTargetPath, "real-video", "utf8");
  await symlink(videoTargetPath, symlinkPath);
  assert.equal((await lstat(symlinkPath)).isSymbolicLink(), true);

  await assert.rejects(
    createVideoProof({
      repositoryRoot: root,
      videoPath: symlinkPath,
      reviewed: true,
      spawnSyncImpl: () => ({ status: 0, stdout: "120\n", stderr: "" }),
    }),
    /Symbolic links are not allowed/,
  );
});

test("createVideoProof rejects symbolic links in the artifacts/submission base chain", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "smartfarm-video-proof-base-symlink-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const realArtifactsDirectory = join(root, "real-artifacts");
  const realSubmissionDirectory = join(realArtifactsDirectory, "submission");
  await mkdir(realSubmissionDirectory, { recursive: true });
  await symlink(realArtifactsDirectory, join(root, "artifacts"));

  const videoPath = join(root, "artifacts", "submission", "smartfarm-demo.mp4");
  await writeFile(join(realSubmissionDirectory, "smartfarm-demo.mp4"), "reviewed-video-binary", "utf8");

  await assert.rejects(
    createVideoProof({
      repositoryRoot: root,
      videoPath,
      reviewed: true,
      spawnSyncImpl: () => ({ status: 0, stdout: "120\n", stderr: "" }),
    }),
    /Symbolic links are not allowed/,
  );
});

test("createVideoProof rejects unsupported extensions and non-regular inputs", async (t) => {
  const root = await createRepositoryFixture("smartfarm-video-proof-input-shape-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const badExtensionPath = join(root, "artifacts", "submission", "smartfarm-demo.txt");
  await writeFile(badExtensionPath, "reviewed-video-binary", "utf8");

  await assert.rejects(
    createVideoProof({
      repositoryRoot: root,
      videoPath: badExtensionPath,
      reviewed: true,
      spawnSyncImpl: () => ({ status: 0, stdout: "150\n", stderr: "" }),
    }),
    /extension is not supported/,
  );

  const directoryPath = join(root, "artifacts", "submission", "folder.mp4");
  await mkdir(directoryPath);
  await assert.rejects(
    createVideoProof({
      repositoryRoot: root,
      videoPath: directoryPath,
      reviewed: true,
      spawnSyncImpl: () => ({ status: 0, stdout: "150\n", stderr: "" }),
    }),
    /regular file/,
  );
});

test("runCli and createVideoProof refuse to overwrite an existing proof", async (t) => {
  const root = await createRepositoryFixture("smartfarm-video-proof-existing-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const videoPath = join(root, "artifacts", "submission", "smartfarm-demo.mp4");
  const outputPath = join(root, "artifacts", "submission", "video-proof.json");
  await writeFile(videoPath, "reviewed-video-binary", "utf8");
  await writeFile(outputPath, "{\"keep\":true}\n", "utf8");

  await assert.rejects(
    createVideoProof({
      repositoryRoot: root,
      videoPath,
      outputPath,
      reviewed: true,
      spawnSyncImpl: () => ({ status: 0, stdout: "150\n", stderr: "" }),
    }),
    /already exists/,
  );

  const stderr = createSink();
  const exitCode = await runCli(
    ["artifacts/submission/smartfarm-demo.mp4", "--reviewed"],
    {
      stdout: createSink(),
      stderr,
    },
    {
      cwd: root,
      repositoryRoot: root,
      spawnSyncImpl: () => ({ status: 0, stdout: "150\n", stderr: "" }),
    },
  );
  assert.equal(exitCode, 1);
  assert.match(stderr.value, /\[smartfarm-video-proof\] Proof output already exists/);
  assert.equal(await readFile(outputPath, "utf8"), "{\"keep\":true}\n");
});

test("createVideoProof cleans temporary files when atomic publish fails", async (t) => {
  const root = await createRepositoryFixture("smartfarm-video-proof-temp-cleanup-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactDirectory = join(root, "artifacts", "submission");
  const videoPath = join(artifactDirectory, "smartfarm-demo.mp4");
  await writeFile(videoPath, "reviewed-video-binary", "utf8");

  await assert.rejects(
    createVideoProof({
      repositoryRoot: root,
      videoPath,
      reviewed: true,
      spawnSyncImpl: () => ({ status: 0, stdout: "150\n", stderr: "" }),
      linkImpl: async () => {
        const error = new Error("simulated publish failure");
        error.code = "EPERM";
        throw error;
      },
    }),
    /simulated publish failure/,
  );

  const files = await readdir(artifactDirectory);
  assert.deepEqual(files, ["smartfarm-demo.mp4"]);
});

test("revalidateProof rejects noncanonical repo-relative POSIX file paths", () => {
  const base = {
    schemaVersion: "smartfarm.submission-video-proof.v1",
    filePath: "artifacts/submission/demo.mp4",
    durationSeconds: 180,
    sha256: "a".repeat(64),
    reviewed: true,
  };

  assert.throws(() => revalidateProof({ ...base, filePath: "artifacts/submission/../demo.mp4" }), /Proof payload is invalid/);
  assert.throws(() => revalidateProof({ ...base, filePath: "artifacts/submission/./demo.mp4" }), /Proof payload is invalid/);
  assert.throws(() => revalidateProof({ ...base, filePath: "artifacts//submission/demo.mp4" }), /Proof payload is invalid/);
  assert.throws(() => revalidateProof({ ...base, filePath: "artifacts\\submission\\demo.mp4" }), /Proof payload is invalid/);
});

test("real child CLI uses a fake ffprobe on PATH and writes a sanitized proof", async (t) => {
  const uniqueStem = `video-proof-cli-${process.pid}-${Date.now()}`;
  const videoRelativePath = `artifacts/submission/${uniqueStem}.mp4`;
  const proofRelativePath = `artifacts/submission/${uniqueStem}.json`;
  const videoPath = join(repositoryRoot, videoRelativePath);
  const proofPath = join(repositoryRoot, proofRelativePath);
  t.after(() => rm(videoPath, { force: true }));
  t.after(() => rm(proofPath, { force: true }));
  await mkdir(dirname(videoPath), { recursive: true });
  await writeFile(videoPath, "reviewed-video-binary", "utf8");

  const fakeBinDirectory = await mkdtemp(join(tmpdir(), "smartfarm-fake-ffprobe-"));
  t.after(() => rm(fakeBinDirectory, { recursive: true, force: true }));
  const fakeProbePath = join(fakeBinDirectory, "ffprobe");
  await writeFile(
    fakeProbePath,
    "#!/bin/sh\nprintf '179.6\\n'\n",
    "utf8",
  );
  await chmod(fakeProbePath, 0o755);

  const result = spawnSync(
    process.execPath,
    [scriptPath, videoRelativePath, "--out", proofRelativePath, "--reviewed"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBinDirectory}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`,
      },
      timeout: 5_000,
    },
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, new RegExp(`\\[smartfarm-video-proof\\] wrote ${proofRelativePath.replace(/\./g, "\\.")} \\(180s\\)`));
  assert.equal(result.stderr, "");

  const saved = JSON.parse(await readFile(proofPath, "utf8"));
  assert.equal(saved.durationSeconds, 180);
  assert.equal(saved.reviewed, true);
  assert.equal(saved.filePath, videoRelativePath);
});

function createSink() {
  return {
    value: "",
    write(chunk) {
      this.value += String(chunk);
    },
  };
}

async function createRepositoryFixture(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, "artifacts", "submission"), { recursive: true });
  return root;
}
