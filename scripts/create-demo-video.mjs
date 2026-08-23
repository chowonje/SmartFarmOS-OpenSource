#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
  access,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { probeVideoDuration } from "./create-video-proof.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_OUTPUT_PATH = "artifacts/submission/smartfarm-demo-candidate.mp4";
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;
const CAPTURE_FPS = 8;
const MIN_CANDIDATE_DURATION_SECONDS = 45;
const MAX_CANDIDATE_DURATION_SECONDS = 170;
export const REQUIRED_DEMO_EVIDENCE = Object.freeze([
  "two-area-comparison",
  "active-low-water-alarm",
  "alarm-acknowledgement-audit",
  "timed-irrigation-final-off",
  "software-stop-boundary",
  "manual-stop-causal-result",
  "command-history",
  "audit-history",
]);

const HELP_TEXT = `Usage: node scripts/create-demo-video.mjs [--out PATH]

Creates a deterministic, silent SmartFarmOS demo-video candidate from the real
local PWA and simulator. This command does not mark the result as reviewed.

Options:
  --out <path>        New MP4 path directly inside artifacts/submission
                      (default: artifacts/submission/smartfarm-demo-candidate.mp4)
  --help              Show this help

After personal privacy, claims, narration, and visual review, create the separate
reviewed proof with submission:video-proof. Existing outputs are never replaced.
`;

class CliUsageError extends Error {}
class ValidationError extends Error {}
class OutputExistsError extends Error {}

export function parseCliArgs(args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  let help = false;
  let outputDefined = false;
  let outputPath = resolve(cwd, DEFAULT_OUTPUT_PATH);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      if (help) throw new CliUsageError("--help must be provided at most once");
      help = true;
      continue;
    }
    if (argument === "--out") {
      if (outputDefined) throw new CliUsageError("--out must be provided at most once");
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CliUsageError("--out requires a path");
      }
      outputPath = resolve(cwd, value);
      outputDefined = true;
      index += 1;
      continue;
    }
    throw new CliUsageError("Unknown argument");
  }

  if (help && outputDefined) {
    throw new CliUsageError("--help cannot be combined with other arguments");
  }

  return { help, outputPath };
}

export async function createDemoVideo(options = {}) {
  const root = options.repositoryRoot ?? repositoryRoot;
  const outputPath = options.outputPath ?? join(root, DEFAULT_OUTPUT_PATH);
  const output = await resolveVideoOutput(outputPath, {
    repositoryRoot: root,
    lstatImpl: options.lstatImpl,
    mkdirImpl: options.mkdirImpl,
    realpathImpl: options.realpathImpl,
  });
  const accessImpl = options.accessImpl ?? access;
  if (await pathExists(output.absolutePath, accessImpl)) {
    throw new OutputExistsError("Video candidate already exists");
  }

  const mkdtempImpl = options.mkdtempImpl ?? mkdtemp;
  const rmImpl = options.rmImpl ?? rm;
  const linkImpl = options.linkImpl ?? link;
  const stagingDirectory = await mkdtempImpl(join(tmpdir(), "smartfarm-demo-video-"));
  const temporaryOutputPath = join(
    output.directory,
    `.smartfarm-demo-video.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.mp4`,
  );

  try {
    const captureImpl = options.captureImpl ?? captureDemoStory;
    const capture = await captureImpl({
      repositoryRoot: root,
      stagingDirectory,
      env: options.env ?? process.env,
      spawnImpl: options.spawnImpl ?? spawn,
      timingScale: options.timingScale ?? 1,
    });
    assertRequiredEvidence(capture.evidence);

    const sequenceDirectory = join(stagingDirectory, "sequence");
    const frameCount = await materializeFrameSequence(capture.frames, sequenceDirectory, {
      fps: options.fps ?? CAPTURE_FPS,
      linkImpl: options.frameLinkImpl ?? link,
      mkdirImpl: options.mkdirImpl ?? mkdir,
    });
    const encodeImpl = options.encodeImpl ?? encodeFrameSequence;
    await encodeImpl({
      sequenceDirectory,
      frameCount,
      fps: options.fps ?? CAPTURE_FPS,
      outputPath: temporaryOutputPath,
      env: options.env ?? process.env,
      spawnSyncImpl: options.spawnSyncImpl ?? spawnSync,
    });

    const probeImpl = options.probeImpl ?? probeVideoDuration;
    const durationSeconds = await probeImpl(temporaryOutputPath, {
      env: options.env ?? process.env,
      spawnSyncImpl: options.spawnSyncImpl ?? spawnSync,
    });
    if (
      !Number.isFinite(durationSeconds)
      || durationSeconds < MIN_CANDIDATE_DURATION_SECONDS
      || durationSeconds > MAX_CANDIDATE_DURATION_SECONDS
    ) {
      throw new ValidationError("Video candidate duration must be between 45 and 170 seconds");
    }

    try {
      await linkImpl(temporaryOutputPath, output.absolutePath);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new OutputExistsError("Video candidate already exists");
      }
      throw error;
    }

    return {
      outputPath: output.absolutePath,
      relativeOutputPath: output.relativePath,
      durationSeconds,
      evidence: Object.freeze([...capture.evidence]),
      frameCount,
    };
  } finally {
    await rmImpl(temporaryOutputPath, { force: true });
    await rmImpl(stagingDirectory, { recursive: true, force: true });
  }
}

export async function resolveVideoOutput(outputPath, options = {}) {
  const root = options.repositoryRoot ?? repositoryRoot;
  const lstatImpl = options.lstatImpl ?? lstat;
  const mkdirImpl = options.mkdirImpl ?? mkdir;
  const realpathImpl = options.realpathImpl ?? realpath;

  if (typeof outputPath !== "string" || outputPath.length === 0) {
    throw new ValidationError("Video output path is required");
  }

  const allowedDirectory = join(root, "artifacts", "submission");
  if (dirname(outputPath) !== allowedDirectory) {
    throw new ValidationError("Video output must be directly inside artifacts/submission");
  }
  const outputName = basename(outputPath);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.mp4$/.test(outputName)) {
    throw new ValidationError("Video output must use a simple .mp4 filename");
  }

  await assertNoSymlinkChain(root, allowedDirectory, {
    allowMissing: true,
    lstatImpl,
  });
  await mkdirImpl(allowedDirectory, { recursive: true });
  await assertNoSymlinkChain(root, allowedDirectory, { lstatImpl });

  const resolvedRoot = await realpathImpl(root);
  const resolvedDirectory = await realpathImpl(allowedDirectory);
  if (
    resolvedDirectory !== resolvedRoot
    && !resolvedDirectory.startsWith(`${resolvedRoot}${sep}`)
  ) {
    throw new ValidationError("Video output directory resolves outside the repository");
  }

  if (await pathExists(outputPath, access)) {
    const stats = await lstatImpl(outputPath);
    if (stats.isSymbolicLink()) {
      throw new ValidationError("Video output must not be a symbolic link");
    }
  }

  return {
    absolutePath: outputPath,
    directory: allowedDirectory,
    relativePath: relative(root, outputPath).split(sep).join("/"),
  };
}

export function selectFrameIndices(frames, fps = CAPTURE_FPS) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new ValidationError("At least one captured frame is required");
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > 30) {
    throw new ValidationError("Capture FPS must be an integer from 1 to 30");
  }

  let previousTime = -Infinity;
  for (const frame of frames) {
    if (
      frame === null
      || typeof frame !== "object"
      || typeof frame.path !== "string"
      || frame.path.length === 0
      || !Number.isFinite(frame.capturedAtMs)
      || frame.capturedAtMs < previousTime
    ) {
      throw new ValidationError("Captured frames are invalid or unordered");
    }
    previousTime = frame.capturedAtMs;
  }

  const start = frames[0].capturedAtMs;
  const end = frames.at(-1).capturedAtMs;
  const intervalMs = 1_000 / fps;
  const count = Math.max(2, Math.ceil((end - start) / intervalMs) + 1);
  const indices = [];
  let sourceIndex = 0;

  for (let index = 0; index < count; index += 1) {
    const targetTime = start + index * intervalMs;
    while (
      sourceIndex + 1 < frames.length
      && frames[sourceIndex + 1].capturedAtMs <= targetTime
    ) {
      sourceIndex += 1;
    }
    indices.push(sourceIndex);
  }
  return indices;
}

export async function materializeFrameSequence(frames, sequenceDirectory, options = {}) {
  const fps = options.fps ?? CAPTURE_FPS;
  const linkImpl = options.linkImpl ?? link;
  const mkdirImpl = options.mkdirImpl ?? mkdir;
  const selectedIndices = selectFrameIndices(frames, fps);
  await mkdirImpl(sequenceDirectory, { recursive: true });

  for (let index = 0; index < selectedIndices.length; index += 1) {
    const source = frames[selectedIndices[index]].path;
    const destination = join(sequenceDirectory, `frame-${String(index).padStart(6, "0")}.jpg`);
    await linkImpl(source, destination);
  }
  return selectedIndices.length;
}

export async function encodeFrameSequence(options) {
  const {
    sequenceDirectory,
    frameCount,
    fps,
    outputPath,
    env = process.env,
    spawnSyncImpl = spawnSync,
  } = options;
  if (!Number.isInteger(frameCount) || frameCount < 2) {
    throw new ValidationError("Video encoding requires at least two frames");
  }
  const durationSeconds = frameCount / fps;
  const result = spawnSyncImpl(
    "ffmpeg",
    [
      "-v",
      "error",
      "-nostdin",
      "-n",
      "-framerate",
      String(fps),
      "-start_number",
      "0",
      "-i",
      join(sequenceDirectory, "frame-%06d.jpg"),
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      durationSeconds.toFixed(3),
      "-vf",
      "fps=24,format=yuv420p",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-movflags",
      "+faststart",
      outputPath,
    ],
    {
      encoding: "utf8",
      env,
      timeout: 180_000,
    },
  );
  if (result.error || result.status !== 0) {
    throw new ValidationError("ffmpeg could not encode the demo-video candidate");
  }
}

export async function captureDemoStory(options) {
  const {
    repositoryRoot: root,
    stagingDirectory,
    env,
    spawnImpl,
    timingScale = 1,
  } = options;
  if (!Number.isFinite(timingScale) || timingScale <= 0 || timingScale > 1) {
    throw new ValidationError("Timing scale must be greater than zero and at most one");
  }

  await assertBuiltDemo(root);
  const chromePath = await findChromeExecutable(env);
  if (chromePath === null) {
    throw new ValidationError("Chrome or Chromium is required to capture the demo video");
  }
  assertCommandAvailable("ffmpeg", env);
  assertCommandAvailable("ffprobe", env);

  const apiPort = await reserveLoopbackPort();
  const pwaPort = await reserveLoopbackPort();
  const pwaUrl = `http://127.0.0.1:${pwaPort}/`;
  const databasePath = join(stagingDirectory, "smartfarm.sqlite");
  let launcher = null;
  let chrome = null;
  let cdp = null;
  let recorder = null;
  let launcherOutput = "";

  try {
    launcher = spawnImpl(process.execPath, [
      join(root, "scripts", "run-local-demo.mjs"),
      "--preview",
    ], {
      cwd: root,
      env: {
        ...env,
        NO_COLOR: "1",
        SMARTFARM_DEMO_PORT: String(apiPort),
        SMARTFARM_PWA_PORT: String(pwaPort),
        SMARTFARM_DEMO_DB_PATH: databasePath,
        SMARTFARM_DEMO_LOW_WATER_EMISSIONS: "180",
        SMARTFARM_DEMO_TELEMETRY_INTERVAL_MS: "1000",
        SMARTFARM_DEMO_COMMAND_POLL_INTERVAL_MS: "100",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    launcher.stdout?.on("data", (chunk) => {
      launcherOutput = appendBounded(launcherOutput, chunk);
    });
    launcher.stderr?.on("data", (chunk) => {
      launcherOutput = appendBounded(launcherOutput, chunk);
    });
    await waitForHttp(pwaUrl, launcher);

    const chromeProfile = join(stagingDirectory, "chrome-profile");
    chrome = spawnImpl(chromePath, [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-component-update",
      "--disable-extensions",
      "--force-device-scale-factor=1",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-port=0",
      `--user-data-dir=${chromeProfile}`,
      `--window-size=${CAPTURE_WIDTH},${CAPTURE_HEIGHT}`,
      pwaUrl,
    ], { stdio: "ignore" });

    const debuggingPort = await waitForDevToolsPort(chromeProfile, chrome);
    const target = await waitForPageTarget(debuggingPort, pwaUrl, chrome);
    cdp = await createCdpClient(target.webSocketDebuggerUrl);
    await cdp.call("Runtime.enable");
    await cdp.call("Page.enable");
    await cdp.call("Network.enable");
    await cdp.call("Emulation.setDeviceMetricsOverride", {
      width: CAPTURE_WIDTH,
      height: CAPTURE_HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.waitForTruthy(
      'document.readyState === "complete" && document.querySelector(".app-shell") !== null',
      "rendered app shell",
      15_000,
    );
    await installVideoOverlay(cdp);

    recorder = await startFrameRecorder(cdp, join(stagingDirectory, "captured-frames"));
    const evidence = await runDemoStory(cdp, { timingScale });
    await setVideoCaption(
      cdp,
      "검토용 영상 후보 생성 완료",
      "개인정보·화면 값·설명·나레이션을 사람이 확인한 뒤에만 reviewed 증빙을 만드세요.",
    );
    await delay(4_000 * timingScale);
    const frames = await recorder.stop();
    recorder = null;
    if (frames.length < 2) {
      throw new ValidationError("Chrome did not provide enough demo-video frames");
    }
    return { frames, evidence };
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError("Could not capture the deterministic demo story", { cause: error });
  } finally {
    await recorder?.stop().catch(() => undefined);
    cdp?.close();
    await terminateChild(chrome, "SIGTERM");
    await terminateChild(launcher, "SIGINT");
    void launcherOutput;
  }
}

async function runDemoStory(cdp, options = {}) {
  const timingScale = options.timingScale ?? 1;
  const evidence = [];
  const hold = (milliseconds) => delay(milliseconds * timingScale);

  await cdp.waitForTruthy(
    'document.querySelector("[data-testid=nav-operations]") !== null',
    "crop operations navigation",
  );
  await cdp.evaluate('document.querySelector("[data-testid=nav-operations]").click(); true');
  await cdp.waitForValue(
    'document.querySelectorAll("[data-testid=operations-comparison-area]").length',
    2,
    "two growing-area comparison cards",
    15_000,
  );
  await cdp.waitForValue(
    'document.querySelectorAll("[data-testid=operations-comparison-area] [data-testid^=operations-comparison-metric-]").length',
    8,
    "four metrics for each growing area",
    15_000,
  );
  await cdp.waitForTruthy(
    `Array.from(document.querySelectorAll("[data-testid=operations-comparison-value]"))
      .length === 8 && Array.from(document.querySelectorAll("[data-testid=operations-comparison-value]"))
      .every((element) => element.textContent?.trim() !== "--")`,
    "live values for both growing areas",
    15_000,
  );
  evidence.push("two-area-comparison");
  await setVideoCaption(
    cdp,
    "SmartFarmOS · 시뮬레이터 기반 대회 MVP",
    "두 재배 구역의 환경·수위 상태부터 장치 결과와 감사 기록까지 한 흐름으로 확인합니다.",
  );
  await scrollIntoView(cdp, "[data-testid=operations-comparison-area]");
  await hold(5_000);
  await setVideoCaption(
    cdp,
    "두 구역을 같은 기준으로 비교",
    "각 구역의 온도·습도·토양수분·수위를 최신 시각과 추세로 비교해 저수위 구역을 찾습니다.",
  );
  await highlightMany(cdp, "[data-testid=operations-comparison-area]");
  await hold(7_000);

  await cdp.evaluate('document.querySelector("[data-testid=nav-alarms]").click(); true');
  await cdp.waitForValue(
    'document.querySelectorAll("[data-testid=alarm-active-card]").length',
    1,
    "one active low-water alarm",
    12_000,
  );
  await cdp.waitForValue(
    'document.querySelector("[data-testid=alarm-active-card] [data-testid=alarm-ack-status]")?.textContent',
    "미확인",
    "unacknowledged alarm",
  );
  evidence.push("active-low-water-alarm");
  await setVideoCaption(
    cdp,
    "저수위 알람의 근거를 먼저 확인",
    "임계치, 최근 관측값, 발생 시각과 사용자 확인 상태를 분리해 보여줍니다.",
  );
  await highlightMany(cdp, "[data-testid=alarm-active-card]");
  await scrollIntoView(cdp, "[data-testid=alarm-active-card]");
  await hold(5_000);
  await cdp.evaluate(
    'document.querySelector("[data-testid=alarm-active-card] [data-testid=alarm-acknowledge]").click(); true',
  );
  await cdp.waitForValue(
    'document.querySelector("[data-testid=alarm-active-card] [data-testid=alarm-ack-status]")?.textContent',
    "확인됨",
    "acknowledged alarm",
  );
  await cdp.waitForTruthy(
    'document.querySelectorAll("[data-testid=audit-event]").length >= 1',
    "alarm acknowledgement audit",
  );
  evidence.push("alarm-acknowledgement-audit");
  await setVideoCaption(
    cdp,
    "확인은 상태 변경과 감사 기록으로 남음",
    "같은 요청을 반복해도 결과가 중복되지 않도록 멱등적으로 처리합니다.",
  );
  await hold(4_000);

  await cdp.evaluate('document.querySelector("[data-testid=nav-operations]").click(); true');
  await cdp.waitForTruthy(
    'document.querySelector("[data-testid=irrigation-strategy-select]")?.value === "strategy:basil-recovery@2"',
    "approved irrigation strategy",
    12_000,
  );
  await selectIrrigationArea(cdp, "area:bed-2");
  await confirmIrrigation(cdp);
  await scrollIntoView(cdp, "[data-testid=operations-irrigation]");
  await setVideoCaption(
    cdp,
    "승인된 관수 전략을 저수위 구역에만 적용",
    "최근 알람 근거, 대상 구역, 5초 로컬 실행, 최종 off 확인과 물리 안전 미검증 범위를 함께 확인합니다.",
  );
  await highlightMany(cdp, "[data-testid=operations-irrigation]");
  await hold(7_000);
  await cdp.evaluate('document.querySelector("[data-testid=irrigation-apply]").click(); true');
  await cdp.waitForValue(
    'document.querySelector("[data-testid=irrigation-application-status] strong")?.textContent',
    "적용 중",
    "pending timed irrigation",
  );
  await setVideoCaption(
    cdp,
    "접수와 장치 완료를 구분",
    "중앙 접수만으로 완료 처리하지 않고 Edge와 장치의 최종 결과를 기다립니다.",
  );
  await hold(3_000);
  await cdp.waitForValue(
    'document.querySelector("[data-testid=irrigation-application-status] strong")?.textContent',
    "적용 완료",
    "completed timed irrigation",
    15_000,
  );
  await cdp.waitForTruthy(
    `(() => {
      const result = document.querySelector("[data-testid=irrigation-target-result]");
      return result?.textContent?.includes("제어 완료") === true
        && result?.textContent?.includes("5초 설정 · 최종 off 확인") === true;
    })()`,
    "timed irrigation final-off evidence",
  );
  evidence.push("timed-irrigation-final-off");
  await setVideoCaption(
    cdp,
    "장치 로컬 타이머 종료 후 최종 off ACK",
    "5초 실행이 끝난 뒤 펌프가 정지 상태임을 확인해야 대상과 전체 전략이 완료됩니다.",
  );
  await highlightMany(cdp, "[data-testid=irrigation-target-result]");
  await hold(6_000);

  await selectIrrigationArea(cdp, "area:bed-1");
  await confirmIrrigation(cdp);
  await setVideoCaption(
    cdp,
    "두 번째 시간제 실행으로 정지 우선순위 확인",
    "이번 실행은 사용자가 소프트웨어 정지로 의도적으로 중단해 인과관계를 남깁니다.",
  );
  await hold(4_000);
  await cdp.evaluate('document.querySelector("[data-testid=irrigation-apply]").click(); true');
  await cdp.waitForValue(
    'document.querySelector("[data-testid=irrigation-application-status] strong")?.textContent',
    "적용 중",
    "second timed irrigation",
  );
  await hold(750);

  await cdp.evaluate('document.querySelector("[data-testid=nav-control]").click(); true');
  await cdp.waitForTruthy(
    `(() => {
      const stop = document.querySelector("[data-testid=pump-off]");
      const page = document.querySelector("#control-title")?.closest(".page-shell");
      return stop !== null
        && stop.disabled === false
        && stop.textContent?.includes("즉시 정지") === true
        && page?.textContent?.includes("물리 비상정지 버튼이나 안전 인터록을 대체하지 않습니다") === true;
    })()`,
    "software stop safety boundary",
  );
  evidence.push("software-stop-boundary");
  await setVideoCaption(
    cdp,
    "즉시 정지 (소프트웨어)",
    "실행 중 명령보다 우선하지만, 물리 비상정지 버튼이나 안전 인터록을 대체하지 않습니다.",
  );
  await highlightMany(cdp, "[data-testid=pump-off]");
  await hold(4_000);
  await cdp.evaluate('document.querySelector("[data-testid=pump-off]").click(); true');
  await cdp.waitForValue(
    'document.querySelector("[data-testid=command-status]")?.textContent',
    "제어 완료",
    "acknowledged software stop",
    6_000,
  );

  await cdp.evaluate('document.querySelector("[data-testid=nav-operations]").click(); true');
  await cdp.waitForValue(
    'document.querySelector("[data-testid=irrigation-application-status] strong")?.textContent',
    "적용 실패",
    "manual-stop terminal irrigation result",
    6_000,
  );
  await cdp.waitForTruthy(
    `(() => {
      const result = document.querySelector("[data-testid=irrigation-target-result]");
      return result?.textContent?.includes("사용자 즉시 정지") === true
        && result?.textContent?.includes("사용자 정지로 조기 종료") === true
        && result?.textContent?.includes("연결된 정지 요청") === true;
    })()`,
    "manual-stop causal result",
    6_000,
  );
  evidence.push("manual-stop-causal-result");
  await setVideoCaption(
    cdp,
    "의도된 조기 종료와 연결된 정지 요청",
    "실패로 숨기지 않고 어떤 정지 명령이 시간제 실행을 중단했는지 결과에 남깁니다.",
  );
  await highlightMany(cdp, "[data-testid=irrigation-target-result]");
  await hold(6_000);

  await cdp.waitForTruthy(
    'document.querySelectorAll("[data-testid=operations-command-row]").length >= 3',
    "recent command history",
    12_000,
  );
  evidence.push("command-history");
  await setVideoCaption(
    cdp,
    "최근 제어 이력은 결과 중심으로 보존",
    "완료된 전략, 중단된 실행, 정지 명령을 구역·장치·최종 상태와 함께 확인합니다.",
  );
  await scrollIntoView(cdp, "[data-testid=operations-command-history]");
  await highlightMany(cdp, "[data-testid=operations-command-history]");
  await hold(5_000);

  await cdp.evaluate('document.querySelector("[data-testid=nav-alarms]").click(); true');
  await cdp.waitForTruthy(
    'document.querySelectorAll("[data-testid=audit-event]").length >= 6',
    "alarm, strategy, command, and stop audit history",
    12_000,
  );
  evidence.push("audit-history");
  await setVideoCaption(
    cdp,
    "알람·전략·명령·정지의 감사 흐름",
    "작물 주기 범위의 기록과 농장 공통 직접 제어 기록을 구분해 추적합니다.",
  );
  await scrollIntoView(cdp, "#audit-events-title");
  await highlightMany(cdp, "[data-testid=audit-event]");
  await hold(6_000);

  await clearHighlights(cdp);
  await cdp.evaluate('document.querySelector("[data-testid=nav-operations]").click(); true');
  await cdp.evaluate("window.scrollTo({ top: 0, behavior: 'instant' }); true");
  await setVideoCaption(
    cdp,
    "구현 범위와 현장 게이트를 분리",
    "구현: 장치별 Edge 권한·ACK 재시작 복구·감사 기록 · 현장 게이트: 물리 인터록·MQTT·실장비 검증",
  );
  await hold(7_000);
  return Object.freeze(evidence);
}

async function selectIrrigationArea(cdp, areaId) {
  const expression = `(() => {
    const inputs = Array.from(document.querySelectorAll(
      "[data-testid=irrigation-area-option] input",
    ));
    const target = inputs.find((input) => input.value === ${JSON.stringify(areaId)});
    if (!(target instanceof HTMLInputElement)) return false;
    for (const input of inputs) {
      if (input instanceof HTMLInputElement && input !== target && input.checked) input.click();
    }
    if (!target.checked) target.click();
    return target.checked && inputs.filter((input) => input.checked).length === 1;
  })()`;
  await cdp.waitForTruthy(expression, `selected irrigation area ${areaId}`);
}

async function confirmIrrigation(cdp) {
  await cdp.evaluate(`(() => {
    const confirmation = document.querySelector(
      "[data-testid=irrigation-application-confirmation] input",
    );
    if (!(confirmation instanceof HTMLInputElement)) return false;
    if (!confirmation.checked) confirmation.click();
    return confirmation.checked;
  })()`);
  await cdp.waitForTruthy(
    'document.querySelector("[data-testid=irrigation-apply]")?.disabled === false',
    "explicit irrigation confirmation",
  );
}

async function installVideoOverlay(cdp) {
  const styleText = `
    #smartfarm-video-overlay {
      position: fixed;
      left: 28px;
      right: 28px;
      bottom: 20px;
      z-index: 2147483647;
      padding: 14px 18px 13px;
      border: 1px solid rgba(165, 232, 195, 0.55);
      border-radius: 14px;
      background: rgba(8, 31, 25, 0.92);
      box-shadow: 0 16px 50px rgba(0, 0, 0, 0.24);
      color: #f5fff9;
      font-family: -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", sans-serif;
      pointer-events: none;
    }
    #smartfarm-video-overlay::before {
      content: "검토용 자동 자막";
      display: block;
      margin-bottom: 3px;
      color: #9be4ba;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
    }
    #smartfarm-video-title { font-size: 21px; font-weight: 750; line-height: 1.25; }
    #smartfarm-video-body { margin-top: 4px; font-size: 14px; line-height: 1.45; color: #dcebe3; }
    #smartfarm-video-pulse {
      position: absolute;
      left: 14px;
      right: 14px;
      bottom: 0;
      height: 3px;
      overflow: hidden;
      border-radius: 3px;
      background: rgba(255, 255, 255, 0.1);
    }
    #smartfarm-video-pulse > span {
      display: block;
      width: 24%;
      height: 100%;
      border-radius: 3px;
      background: #79d69f;
    }
    .smartfarm-video-highlight {
      outline: 4px solid rgba(38, 190, 107, 0.82) !important;
      outline-offset: 4px !important;
      border-radius: 12px !important;
    }
  `;
  const overlayHtml = `
    <div id="smartfarm-video-title">SmartFarmOS</div>
    <div id="smartfarm-video-body">실제 로컬 데모를 준비하고 있습니다.</div>
    <div id="smartfarm-video-pulse"><span></span></div>
  `;
  await cdp.evaluate(`(() => {
    if (document.querySelector("#smartfarm-video-overlay") !== null) return true;
    const style = document.createElement("style");
    style.id = "smartfarm-video-style";
    style.textContent = ${JSON.stringify(styleText)};
    document.head.append(style);
    const overlay = document.createElement("section");
    overlay.id = "smartfarm-video-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = ${JSON.stringify(overlayHtml)};
    document.body.append(overlay);
    const pulse = overlay.querySelector("#smartfarm-video-pulse > span");
    let tick = 0;
    window.__smartfarmVideoTicker = window.setInterval(() => {
      tick = (tick + 1) % 100;
      if (pulse instanceof HTMLElement) {
        pulse.style.transform = "translateX(" + (tick * 3.2 - 80) + "%)";
      }
      overlay.dataset.tick = String(tick);
    }, 125);
    return true;
  })()`);
}

async function setVideoCaption(cdp, title, body) {
  const result = await cdp.evaluate(`(() => {
    const title = document.querySelector("#smartfarm-video-title");
    const body = document.querySelector("#smartfarm-video-body");
    if (!(title instanceof HTMLElement) || !(body instanceof HTMLElement)) return false;
    title.textContent = ${JSON.stringify(title)};
    body.textContent = ${JSON.stringify(body)};
    return true;
  })()`);
  assert.equal(result, true, "Could not update the video caption");
}

async function highlightMany(cdp, selector) {
  await cdp.evaluate(`(() => {
    document.querySelectorAll(".smartfarm-video-highlight")
      .forEach((element) => element.classList.remove("smartfarm-video-highlight"));
    document.querySelectorAll(${JSON.stringify(selector)})
      .forEach((element) => element.classList.add("smartfarm-video-highlight"));
    return true;
  })()`);
}

async function clearHighlights(cdp) {
  await cdp.evaluate(`(() => {
    document.querySelectorAll(".smartfarm-video-highlight")
      .forEach((element) => element.classList.remove("smartfarm-video-highlight"));
    return true;
  })()`);
}

async function scrollIntoView(cdp, selector) {
  await cdp.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    element?.scrollIntoView({ block: "center", behavior: "instant" });
    return element !== null;
  })()`);
  await delay(250);
}

async function startFrameRecorder(cdp, frameDirectory) {
  await mkdir(frameDirectory, { recursive: true });
  const frames = [];
  let writeChain = Promise.resolve();
  let writeError = null;
  let accepting = true;

  const unsubscribe = cdp.on("Page.screencastFrame", (params) => {
    const capturedAtMs = performance.now();
    writeChain = writeChain.then(async () => {
      try {
        if (accepting) {
          const framePath = join(
            frameDirectory,
            `capture-${String(frames.length).padStart(6, "0")}.jpg`,
          );
          await writeFile(framePath, Buffer.from(params.data, "base64"), { flag: "wx" });
          frames.push({ path: framePath, capturedAtMs });
        }
      } catch (error) {
        writeError ??= error;
      } finally {
        await cdp.call("Page.screencastFrameAck", { sessionId: params.sessionId });
      }
    });
  });

  await cdp.call("Page.startScreencast", {
    format: "jpeg",
    quality: 86,
    maxWidth: CAPTURE_WIDTH,
    maxHeight: CAPTURE_HEIGHT,
    everyNthFrame: 1,
  });

  let stopped = false;
  return {
    stop: async () => {
      if (stopped) return Object.freeze([...frames]);
      stopped = true;
      await cdp.call("Page.stopScreencast");
      await delay(250);
      accepting = false;
      await writeChain;
      unsubscribe();
      if (writeError !== null) throw writeError;
      return Object.freeze([...frames]);
    },
  };
}

function assertRequiredEvidence(evidence) {
  if (!Array.isArray(evidence)) {
    throw new ValidationError("Demo capture evidence is missing");
  }
  const unique = new Set(evidence);
  if (unique.size !== evidence.length) {
    throw new ValidationError("Demo capture evidence contains duplicates");
  }
  for (const item of REQUIRED_DEMO_EVIDENCE) {
    if (!unique.has(item)) {
      throw new ValidationError(`Demo capture evidence is incomplete: ${item}`);
    }
  }
  if (evidence.some((item) => !REQUIRED_DEMO_EVIDENCE.includes(item))) {
    throw new ValidationError("Demo capture evidence contains an unknown item");
  }
}

async function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolvePromise, rejectPromise) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", rejectPromise, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined) {
      const operation = pending.get(message.id);
      if (operation === undefined) return;
      pending.delete(message.id);
      if (message.error !== undefined) operation.reject(new Error(message.error.message));
      else operation.resolve(message.result);
      return;
    }
    if (typeof message.method !== "string") return;
    for (const listener of listeners.get(message.method) ?? []) {
      listener(message.params ?? {});
    }
  });

  const call = (method, params = {}) => {
    const id = ++nextId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolvePromise, rejectPromise) => {
      pending.set(id, { resolve: resolvePromise, reject: rejectPromise });
    });
  };
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails !== undefined) {
      throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed");
    }
    return result.result.value;
  };
  const waitForValue = async (expression, expected, label, timeoutMs = 8_000) => {
    const deadline = Date.now() + timeoutMs;
    let value;
    while (Date.now() < deadline) {
      value = await evaluate(expression);
      if (value === expected) return value;
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${label}; last value was ${String(value)}`);
  };
  const waitForTruthy = async (expression, label, timeoutMs = 8_000) => {
    const deadline = Date.now() + timeoutMs;
    let value;
    while (Date.now() < deadline) {
      value = await evaluate(expression);
      if (value) return value;
      await delay(100);
    }
    throw new Error(`Timed out waiting for ${label}; last value was ${String(value)}`);
  };
  const on = (method, listener) => {
    const methodListeners = listeners.get(method) ?? new Set();
    methodListeners.add(listener);
    listeners.set(method, methodListeners);
    return () => methodListeners.delete(listener);
  };

  return { call, evaluate, waitForValue, waitForTruthy, on, close: () => socket.close() };
}

async function assertBuiltDemo(root) {
  for (const path of [
    join(root, "tools", "local-demo", "dist", "cli.js"),
    join(root, "apps", "pwa", "dist", "index.html"),
  ]) {
    if (!await pathExists(path, access)) {
      throw new ValidationError("Built local demo is missing; run npm run build first");
    }
  }
}

function assertCommandAvailable(command, env) {
  const result = spawnSync(command, ["-version"], {
    encoding: "utf8",
    env,
    timeout: 10_000,
  });
  if (result.error || result.status !== 0) {
    throw new ValidationError(`${command} is required to create the demo-video candidate`);
  }
}

async function findChromeExecutable(env) {
  const candidates = [
    env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((value) => value !== undefined && value.trim() !== "");
  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next known executable.
    }
  }
  return null;
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  await new Promise((resolvePromise, rejectPromise) => server.close((error) => (
    error === undefined ? resolvePromise() : rejectPromise(error)
  )));
  return address.port;
}

async function waitForHttp(url, launcher) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (launcher.exitCode !== null || launcher.signalCode !== null) {
      throw new Error("Local demo launcher exited before PWA startup");
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // The API and preview server may still be starting.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the local PWA");
}

async function waitForDevToolsPort(profilePath, chrome) {
  const file = join(profilePath, "DevToolsActivePort");
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null || chrome.signalCode !== null) {
      throw new Error("Chrome exited before opening its debugging port");
    }
    try {
      const [port] = (await readFile(file, "utf8")).trim().split("\n");
      const parsed = Number.parseInt(port ?? "", 10);
      if (Number.isInteger(parsed) && parsed > 0) return parsed;
    } catch {
      // Chrome has not written its debugging-port file yet.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the Chrome debugging port");
}

async function waitForPageTarget(port, pageUrl, chrome) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null || chrome.signalCode !== null) {
      throw new Error("Chrome exited before creating the PWA page");
    }
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`)
        .then((response) => response.json());
      const page = targets.find((target) => target.type === "page" && target.url === pageUrl);
      if (page?.webSocketDebuggerUrl !== undefined) return page;
    } catch {
      // The DevTools endpoint may still be starting.
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for the SmartFarm PWA page");
}

async function terminateChild(child, signal) {
  if (child === null) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, "exit");
  child.kill(signal);
  const exited = await Promise.race([
    exit.then(() => true),
    delay(5_000).then(() => false),
  ]);
  if (!exited) {
    child.kill("SIGKILL");
    await exit;
  }
}

async function assertNoSymlinkChain(root, target, options = {}) {
  const lstatImpl = options.lstatImpl ?? lstat;
  const allowMissing = options.allowMissing ?? false;
  const relativePath = relative(root, target);
  if (relativePath === "" || relativePath.startsWith(`..${sep}`) || relativePath === "..") {
    throw new ValidationError("Submission directory must be inside the repository");
  }
  let current = root;
  for (const segment of relativePath.split(sep)) {
    current = join(current, segment);
    try {
      const stats = await lstatImpl(current);
      if (stats.isSymbolicLink()) {
        throw new ValidationError("Symbolic links are not allowed in demo-video output paths");
      }
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      if (allowMissing && error?.code === "ENOENT") return;
      throw error;
    }
  }
}

async function pathExists(path, accessImpl) {
  try {
    await accessImpl(path, fsConstants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function appendBounded(current, chunk) {
  return `${current}${String(chunk)}`.slice(-4_000);
}

async function delay(milliseconds) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export async function runCli(args, streams = {}, options = {}) {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;
  let cliOptions;
  try {
    cliOptions = parseCliArgs(args, { cwd: options.cwd ?? process.cwd() });
  } catch (error) {
    if (error instanceof CliUsageError) {
      stderr.write(`[smartfarm-demo-video] ${error.message}\n`);
      stderr.write(HELP_TEXT);
      return 2;
    }
    stderr.write("[smartfarm-demo-video] Unable to parse options\n");
    return 2;
  }

  if (cliOptions.help) {
    stdout.write(HELP_TEXT);
    return 0;
  }

  try {
    const createImpl = options.createImpl ?? createDemoVideo;
    const result = await createImpl({
      repositoryRoot: options.repositoryRoot ?? repositoryRoot,
      outputPath: cliOptions.outputPath,
      env: options.env ?? process.env,
    });
    stdout.write(
      `[smartfarm-demo-video] wrote ${result.relativeOutputPath} (${result.durationSeconds.toFixed(1)}s, silent candidate)\n`,
    );
    stdout.write(
      "[smartfarm-demo-video] Personal privacy, claims, visual, edit, and narration review is still required.\n",
    );
    return 0;
  } catch (error) {
    if (error instanceof OutputExistsError) {
      stderr.write("[smartfarm-demo-video] Video candidate already exists\n");
      return 1;
    }
    if (error instanceof ValidationError) {
      stderr.write(`[smartfarm-demo-video] ${error.message}\n`);
      return 1;
    }
    stderr.write("[smartfarm-demo-video] Failed to create the demo-video candidate\n");
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
