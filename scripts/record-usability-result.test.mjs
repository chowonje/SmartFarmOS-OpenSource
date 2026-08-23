import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseCliArgs,
  persistSessionResult,
  runCli,
} from "./record-usability-result.mjs";

test("CLI collects a valid session and writes one strict result file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-record-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const stdout = createSink();
  const stderr = createSink();
  const exitCode = await runCli(
    ["S01", "--out", directory],
    {
      stdout,
      stderr,
      promptFactory: () => createPrompt([
        "1",
        "4",
        "1",
        ...repeatTaskAnswers(),
        ...repeatTaskAnswers(),
        ...repeatTaskAnswers(),
        ...repeatTaskAnswers(),
        ...repeatTaskAnswers(),
        "1",
        "1",
        "1",
        "1",
        "270",
        "4",
        "0",
        "0",
        "1",
        "2",
        "2",
        "2",
        "command-result-location",
        "2",
        "2",
        "target-confirmation-bypass",
        "1",
        "3",
      ]),
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(stderr.value, "");
  assert.match(stdout.value, /\[smartfarm-usability\] S01 .*S01-result\.json/);

  const saved = JSON.parse(await readFile(join(directory, "S01-result.json"), "utf8"));
  assert.equal(saved.sessionCode, "S01");
  assert.equal(saved.issues[0].code, "S01-01");
  assert.equal(saved.issues[1].code, "S01-02");
  assert.equal(saved.issues[0].pattern, "command-result-location");
  assert.equal(saved.tasks.findAttentionArea.durationSeconds, 60);
});

test("invalid answers are re-prompted without echoing raw invalid input", async () => {
  const stdout = createSink();
  const stderr = createSink();
  const prompt = createPrompt([
    "9",
    "1",
    "4",
    "1",
    "0",
    "1",
    "60",
    "0",
    "0",
    "0",
    ...repeatTaskAnswers(),
    ...repeatTaskAnswers(),
    ...repeatTaskAnswers(),
    ...repeatTaskAnswers(),
    "1",
    "1",
    "1",
    "1",
    "270",
    "4",
    "0",
    "0",
    "1",
    "2",
    "2",
    "1",
    "free text note",
    "command-result-location",
    "2",
    "2",
  ]);

  const directory = await mkdtemp(join(tmpdir(), "smartfarm-record-reprompt-"));
  await runCli(["S02", "--out", directory], {
    stdout,
    stderr,
    promptFactory: () => prompt,
  });

  assert.equal(prompt.askCount(startsWith("참여자 역할\n1. 현재 농업 종사자")), 2);
  assert.equal(prompt.askCount(startsWith("주의가 필요한 구역 찾기: 도움 없이 완료했습니까?\n1. 예")), 2);
  assert.equal(prompt.askCount(startsWith("이슈 패턴 S02-01 [slug]\n- 예시: command-result-location")), 2);
  assert.doesNotMatch(stdout.value, /free text note/);
  assert.doesNotMatch(stderr.value, /free text note/);

  await rm(directory, { recursive: true, force: true });
});

test("CLI refuses to overwrite an existing result file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-record-existing-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const existingPath = join(directory, "S03-result.json");
  await writeFile(existingPath, '{"keep":true}\n', "utf8");

  const exitCode = await runCli(["S03", "--out", directory], {
    stdout: createSink(),
    stderr: createSink(),
    promptFactory: () => {
      throw new Error("prompt must not run");
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(await readFile(existingPath, "utf8"), '{"keep":true}\n');
});

test("persist refuses existing targets and never overwrites", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-record-persist-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const session = makeSession("S04");
  await persistSessionResult(session, { outputDirectory: directory });

  await assert.rejects(
    persistSessionResult(session, { outputDirectory: directory }),
    /Result file already exists/,
  );
});

test("persist revalidates input and creates no files for invalid session shapes", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-record-invalid-persist-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const traversalSession = makeSession("../escape");
  await assert.rejects(
    persistSessionResult(traversalSession, { outputDirectory: directory }),
    /Invalid session result/,
  );
  assert.deepEqual(await readdir(directory), []);

  const unknownFieldSession = {
    ...makeSession("S08"),
    freeTextNote: "name or raw note must not persist",
  };
  await assert.rejects(
    persistSessionResult(unknownFieldSession, { outputDirectory: directory }),
    /Invalid session result/,
  );
  assert.deepEqual(await readdir(directory), []);
});

test("help and argument parsing stay strict", async () => {
  const stdout = createSink();
  const stderr = createSink();
  assert.equal(await runCli(["--help"], { stdout, stderr }), 0);
  assert.match(stdout.value, /Usage:/);

  const parsed = parseCliArgs(["S07", "--out=results"], { cwd: "/tmp/smartfarm" });
  assert.equal(parsed.sessionCode, "S07");
  assert.equal(parsed.outputDirectory, "/tmp/smartfarm/results");

  assert.throws(() => parseCliArgs([], { cwd: "/tmp" }), /Expected one anonymous session code/);
  assert.throws(() => parseCliArgs(["S100"], { cwd: "/tmp" }), /Session code must match/);
});

test("failed collection leaves no partial result file or temp file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-record-failure-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const exitCode = await runCli(["S05", "--out", directory], {
    stdout: createSink(),
    stderr: createSink(),
    promptFactory: () => createPrompt(["current-farmer", new Error("EOF")]),
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(await readdir(directory), []);
});

test("promptFactory/preflight failures fail closed without raw error output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-record-preflight-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const stderr = createSink();
  const exitCode = await runCli(["S06", "--out", directory], {
    stdout: createSink(),
    stderr,
    promptFactory: async () => {
      throw new Error("raw stack candidate");
    },
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.value, /\[smartfarm-usability\] 결과를 저장하지 못했습니다\./);
  assert.doesNotMatch(stderr.value, /raw stack candidate|Error:/);
  assert.deepEqual(await readdir(directory), []);
});

test("real readline EOF exits 1 with fixed abort message and no internal warning output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-record-real-eof-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const scriptPath = fileURLToPath(new URL("./record-usability-result.mjs", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [scriptPath, "S09", "--out", directory],
    {
      cwd: process.cwd(),
      input: "",
      encoding: "utf8",
      timeout: 5_000,
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[smartfarm-usability\] 입력이 중단되어 저장하지 않았습니다\./);
  assert.doesNotMatch(result.stderr, /Warning|unsettled|Error:|\/Users\//);
  assert.doesNotMatch(result.stdout, /Warning|unsettled|Error:|\/Users\//);
  assert.deepEqual(await readdir(directory), []);
});

function repeatTaskAnswers() {
  return ["1", "60", "0", "0", "0"];
}

function makeSession(sessionCode) {
  const task = {
    unassistedCompleted: true,
    durationSeconds: 60,
    helpRequestCount: 0,
    correctedMisstepCount: 0,
    navigationLoopCount: 0,
  };
  return {
    schemaVersion: "smartfarm.usability-session-result.v1",
    sessionCode,
    participantRole: "current-farmer",
    experienceBand: "4-plus-years",
    deviceClass: "desktop",
    tasks: {
      findAttentionArea: { ...task },
      explainOutOfRangeMetric: { ...task },
      acknowledgeAlarm: { ...task },
      applyIrrigationPreset: { ...task },
      verifyCommandAndAudit: { ...task },
    },
    judgments: {
      attentionAreaCorrect: true,
      outOfRangeMetricCorrect: true,
      irrigationTargetCorrect: true,
      ackAndAuditEvidenceCorrect: true,
    },
    totalDurationSeconds: 300,
    confidenceScore: 4,
    safety: {
      wrongAreaSubmissionCount: 0,
      pendingDuplicateSubmissionCount: 0,
      explainedTimedStopIsNotPhysicalSafetyBeforeDebrief: true,
      productionDeviceUsed: false,
      productionCredentialsUsed: false,
    },
    issues: [],
  };
}

function createSink() {
  return {
    value: "",
    write(chunk) {
      this.value += chunk;
    },
  };
}

function createPrompt(answers) {
  const queue = [...answers];
  const prompts = [];
  return {
    async ask(prompt) {
      prompts.push(prompt);
      if (queue.length === 0) throw new Error("No more answers");
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return String(next);
    },
    close() {},
    askCount(matcher) {
      if (typeof matcher === "function") {
        return prompts.filter((item) => matcher(item)).length;
      }
      return prompts.filter((item) => item === matcher).length;
    },
  };
}

function startsWith(prefix) {
  return (value) => value.startsWith(prefix);
}
