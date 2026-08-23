import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  REQUIRED_DEMO_EVIDENCE,
  createDemoVideo,
  encodeFrameSequence,
  materializeFrameSequence,
  parseCliArgs,
  resolveVideoOutput,
  runCli,
  selectFrameIndices,
} from "./create-demo-video.mjs";

const scriptPath = fileURLToPath(new URL("./create-demo-video.mjs", import.meta.url));

test("parses a strict candidate-output CLI without a reviewed shortcut", () => {
  const cwd = "/tmp/smartfarm-video-cli";
  assert.deepEqual(parseCliArgs([], { cwd }), {
    help: false,
    outputPath: resolve(cwd, "artifacts/submission/smartfarm-demo-candidate.mp4"),
  });
  assert.deepEqual(parseCliArgs(["--help"], { cwd }), {
    help: true,
    outputPath: resolve(cwd, "artifacts/submission/smartfarm-demo-candidate.mp4"),
  });
  assert.deepEqual(
    parseCliArgs(["--out", "artifacts/submission/rehearsal.mp4"], { cwd }),
    {
      help: false,
      outputPath: resolve(cwd, "artifacts/submission/rehearsal.mp4"),
    },
  );
  assert.throws(() => parseCliArgs(["candidate.mp4"], { cwd }), /Unknown argument/);
  assert.throws(() => parseCliArgs(["--reviewed"], { cwd }), /Unknown argument/);
  assert.throws(() => parseCliArgs(["--out"], { cwd }), /requires a path/);
  assert.throws(
    () => parseCliArgs(["--out", "one.mp4", "--out", "two.mp4"], { cwd }),
    /at most once/,
  );
  assert.throws(() => parseCliArgs(["--help", "--out", "one.mp4"], { cwd }), /cannot be combined/);
});

test("resolves only simple new MP4 outputs directly inside artifacts/submission", async (t) => {
  const root = await createRepositoryFixture("smartfarm-demo-video-output-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputPath = join(root, "artifacts", "submission", "candidate-01.mp4");
  const output = await resolveVideoOutput(outputPath, { repositoryRoot: root });
  assert.equal(output.absolutePath, outputPath);
  assert.equal(output.relativePath, "artifacts/submission/candidate-01.mp4");

  await assert.rejects(
    resolveVideoOutput(join(root, "outside.mp4"), { repositoryRoot: root }),
    /directly inside artifacts\/submission/,
  );
  await assert.rejects(
    resolveVideoOutput(join(root, "artifacts", "submission", "nested", "video.mp4"), {
      repositoryRoot: root,
    }),
    /directly inside artifacts\/submission/,
  );
  await assert.rejects(
    resolveVideoOutput(join(root, "artifacts", "submission", "bad name.mp4"), {
      repositoryRoot: root,
    }),
    /simple \.mp4 filename/,
  );
  await assert.rejects(
    resolveVideoOutput(join(root, "artifacts", "submission", "candidate.webm"), {
      repositoryRoot: root,
    }),
    /simple \.mp4 filename/,
  );
});

test("rejects a symbolic-link artifacts directory before creating output", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "smartfarm-demo-video-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "smartfarm-demo-video-outside-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(root, "artifacts"));
  await assert.rejects(
    resolveVideoOutput(join(root, "artifacts", "submission", "candidate.mp4"), {
      repositoryRoot: root,
    }),
    /Symbolic links are not allowed/,
  );
});

test("normalizes monotonic screencast frames to a fixed-rate sequence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "smartfarm-demo-video-frames-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceDirectory = join(root, "source");
  const sequenceDirectory = join(root, "sequence");
  await mkdir(sourceDirectory);
  const frames = [];
  for (const [index, capturedAtMs] of [0, 180, 510].entries()) {
    const path = join(sourceDirectory, `source-${index}.jpg`);
    await writeFile(path, `frame-${index}`, "utf8");
    frames.push({ path, capturedAtMs });
  }

  assert.deepEqual(selectFrameIndices(frames, 4), [0, 1, 1, 2]);
  const frameCount = await materializeFrameSequence(frames, sequenceDirectory, { fps: 4 });
  assert.equal(frameCount, 4);
  assert.deepEqual(await readdir(sequenceDirectory), [
    "frame-000000.jpg",
    "frame-000001.jpg",
    "frame-000002.jpg",
    "frame-000003.jpg",
  ]);
  assert.equal(await readFile(join(sequenceDirectory, "frame-000002.jpg"), "utf8"), "frame-1");

  assert.throws(() => selectFrameIndices([], 4), /At least one/);
  assert.throws(
    () => selectFrameIndices([{ path: "a", capturedAtMs: 2 }, { path: "b", capturedAtMs: 1 }], 4),
    /invalid or unordered/,
  );
  assert.throws(() => selectFrameIndices(frames, 0), /integer from 1 to 30/);
});

test("builds a bounded silent H.264 MP4 encoding command", async () => {
  let invocation = null;
  await encodeFrameSequence({
    sequenceDirectory: "/tmp/smartfarm-frames",
    frameCount: 400,
    fps: 8,
    outputPath: "/tmp/candidate.mp4",
    env: { PATH: "/safe" },
    spawnSyncImpl: (command, args, options) => {
      invocation = { command, args, options };
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(invocation.command, "ffmpeg");
  assert.equal(invocation.args.includes("-n"), true);
  assert.equal(invocation.args.includes("anullsrc=r=48000:cl=stereo"), true);
  assert.equal(invocation.args.includes("libx264"), true);
  assert.equal(invocation.args.includes("fps=24,format=yuv420p"), true);
  assert.equal(invocation.args[invocation.args.indexOf("-t") + 1], "50.000");
  assert.equal(invocation.args.at(-1), "/tmp/candidate.mp4");
  assert.equal(invocation.options.timeout, 180_000);

  await assert.rejects(
    encodeFrameSequence({
      sequenceDirectory: "/tmp/smartfarm-frames",
      frameCount: 1,
      fps: 8,
      outputPath: "/tmp/candidate.mp4",
    }),
    /at least two frames/,
  );
});

test("creates one atomic candidate from complete deterministic evidence", async (t) => {
  const root = await createRepositoryFixture("smartfarm-demo-video-create-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputPath = join(root, "artifacts", "submission", "candidate.mp4");
  let stagingDirectory = null;
  let encodedFrameCount = null;

  const result = await createDemoVideo({
    repositoryRoot: root,
    outputPath,
    fps: 1,
    captureImpl: async (options) => {
      stagingDirectory = options.stagingDirectory;
      const first = join(stagingDirectory, "first.jpg");
      const last = join(stagingDirectory, "last.jpg");
      await writeFile(first, "first", "utf8");
      await writeFile(last, "last", "utf8");
      return {
        frames: [
          { path: first, capturedAtMs: 0 },
          { path: last, capturedAtMs: 60_000 },
        ],
        evidence: [...REQUIRED_DEMO_EVIDENCE],
      };
    },
    encodeImpl: async (options) => {
      encodedFrameCount = options.frameCount;
      await writeFile(options.outputPath, "encoded-video", { encoding: "utf8", flag: "wx" });
    },
    probeImpl: async () => 60,
  });

  assert.equal(result.relativeOutputPath, "artifacts/submission/candidate.mp4");
  assert.equal(result.durationSeconds, 60);
  assert.equal(result.frameCount, 61);
  assert.equal(encodedFrameCount, 61);
  assert.deepEqual(result.evidence, REQUIRED_DEMO_EVIDENCE);
  assert.equal(await readFile(outputPath, "utf8"), "encoded-video");
  await assert.rejects(access(stagingDirectory), /ENOENT/);

  await assert.rejects(
    createDemoVideo({
      repositoryRoot: root,
      outputPath,
      captureImpl: async () => assert.fail("capture must not run for an existing output"),
    }),
    /already exists/,
  );
});

test("rejects incomplete evidence and removes every partial artifact", async (t) => {
  const root = await createRepositoryFixture("smartfarm-demo-video-cleanup-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputPath = join(root, "artifacts", "submission", "candidate.mp4");
  let stagingDirectory = null;

  await assert.rejects(
    createDemoVideo({
      repositoryRoot: root,
      outputPath,
      captureImpl: async (options) => {
        stagingDirectory = options.stagingDirectory;
        const frame = join(stagingDirectory, "frame.jpg");
        await writeFile(frame, "frame", "utf8");
        return {
          frames: [{ path: frame, capturedAtMs: 0 }],
          evidence: REQUIRED_DEMO_EVIDENCE.slice(0, -1),
        };
      },
      encodeImpl: async () => assert.fail("encoding must not run"),
      probeImpl: async () => 60,
    }),
    /evidence is incomplete/,
  );
  await assert.rejects(access(stagingDirectory), /ENOENT/);
  await assert.rejects(access(outputPath), /ENOENT/);
  assert.deepEqual(await readdir(join(root, "artifacts", "submission")), []);
});

test("CLI labels output as a silent candidate and keeps review explicitly human", async () => {
  const stdout = createStream();
  const stderr = createStream();
  const helpCode = await runCli(["--help"], { stdout, stderr });
  assert.equal(helpCode, 0);
  assert.match(stdout.value, /does not mark the result as reviewed/);

  stdout.value = "";
  const successCode = await runCli([], { stdout, stderr }, {
    cwd: "/tmp/repo",
    repositoryRoot: "/tmp/repo",
    createImpl: async () => ({
      relativeOutputPath: "artifacts/submission/candidate.mp4",
      durationSeconds: 75.25,
    }),
  });
  assert.equal(successCode, 0);
  assert.match(stdout.value, /75\.3s, silent candidate/);
  assert.match(stdout.value, /Personal privacy, claims, visual, edit, and narration review is still required/);
  assert.equal(stderr.value, "");

  const usageCode = await runCli(["--reviewed"], { stdout: createStream(), stderr });
  assert.equal(usageCode, 2);
  assert.match(stderr.value, /Unknown argument/);
});

test("real child help is dependency-free and creates no candidate", async () => {
  const result = spawnSync(process.execPath, [scriptPath, "--help"], {
    cwd: dirname(scriptPath),
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /silent SmartFarmOS demo-video candidate/);
  assert.equal(result.stderr, "");
});

async function createRepositoryFixture(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(root, "artifacts", "submission"), { recursive: true });
  return root;
}

function createStream() {
  return {
    value: "",
    write(chunk) {
      this.value += String(chunk);
    },
  };
}
