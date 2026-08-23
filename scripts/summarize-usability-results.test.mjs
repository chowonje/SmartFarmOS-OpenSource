import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SESSION_RESULT_SCHEMA_VERSION,
  SUMMARY_SCHEMA_VERSION,
  buildMarkdownSummary,
  createUsabilitySummary,
  loadSessionResults,
  parseCliArgs,
  runCli,
  validateSessionResult,
} from "./summarize-usability-results.mjs";

test("passes five valid sessions when four participants understand the safety boundary", () => {
  const sessions = ["S01", "S02", "S03", "S04", "S05"].map(makeSession);
  sessions[4].safety.explainedTimedStopIsNotPhysicalSafetyBeforeDebrief = false;

  const summary = createUsabilitySummary({ sessions });

  assert.equal(summary.schemaVersion, SUMMARY_SCHEMA_VERSION);
  assert.equal(summary.decision, "pass");
  assert.equal(summary.sessionCount, 5);
  assert.deepEqual(summary.reasons, []);
  assert.equal(summary.safety.understandingPassCount, 4);
  assert.equal(summary.safety.understandingRequiredCount, 4);
  assert.equal(summary.fieldTasks.applyIrrigationPreset.unassistedCompletedCount, 5);
});

test("fails an insufficient or oversized valid sample", async (t) => {
  await t.test("fewer than three", () => {
    const summary = createUsabilitySummary({ sessions: [makeSession("S01"), makeSession("S02")] });
    assert.equal(summary.decision, "fail");
    assert.ok(summary.reasons.includes("VALID_SESSION_COUNT_BELOW_MINIMUM"));
  });

  await t.test("more than five", () => {
    const sessions = ["S01", "S02", "S03", "S04", "S05", "S06"].map(makeSession);
    const summary = createUsabilitySummary({ sessions });
    assert.equal(summary.decision, "fail");
    assert.ok(summary.reasons.includes("VALID_SESSION_COUNT_ABOVE_MAXIMUM"));
  });
});

test("strict validation rejects malformed values and unknown fields", async (t) => {
  await t.test("malformed task metric", () => {
    const session = makeSession("S01");
    session.tasks.acknowledgeAlarm.durationSeconds = "36";
    const result = validateSessionResult(session);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === "INVALID_INTEGER"));
  });

  await t.test("unknown free-text field", () => {
    const session = makeSession("S01");
    session.participantName = "must-not-be-retained";
    const result = validateSessionResult(session);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === "UNKNOWN_FIELD"));
    assert.doesNotMatch(JSON.stringify(result), /must-not-be-retained/);
  });

  await t.test("issue pattern is a bounded non-free-text slug", () => {
    const session = makeSession("S01");
    session.issues.push({
      code: "S01-01",
      pattern: "Participant name and free text",
      severity: "P2",
      retestStatus: "pending",
    });
    const result = validateSessionResult(session);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === "INVALID_ISSUE_PATTERN"));
    assert.doesNotMatch(JSON.stringify(result), /Participant name and free text/);
  });
});

test("fails duplicate anonymous session codes without counting them twice", () => {
  const summary = createUsabilitySummary({
    sessions: [
      makeSession("S01"),
      makeSession("S01"),
      makeSession("S02"),
      makeSession("S03"),
    ],
  });

  assert.equal(summary.decision, "fail");
  assert.equal(summary.sessionCount, 3);
  assert.deepEqual(summary.duplicateSessionCodes, ["S01"]);
  assert.ok(summary.reasons.includes("DUPLICATE_SESSION_CODE"));
});

test("fails every safety stop condition and an unresolved P1", () => {
  const sessions = ["S01", "S02", "S03"].map(makeSession);
  sessions[0].safety.wrongAreaSubmissionCount = 1;
  sessions[0].safety.pendingDuplicateSubmissionCount = 1;
  sessions[1].safety.productionDeviceUsed = true;
  sessions[2].safety.productionCredentialsUsed = true;
  sessions[2].issues.push({
    code: "S03-01",
    pattern: "target-confirmation-bypass",
    severity: "P1",
    retestStatus: "pending",
  });

  const summary = createUsabilitySummary({ sessions });

  assert.equal(summary.decision, "fail");
  assert.ok(summary.reasons.includes("WRONG_AREA_SUBMISSION"));
  assert.ok(summary.reasons.includes("PENDING_DUPLICATE_SUBMISSION"));
  assert.ok(summary.reasons.includes("PRODUCTION_DEVICE_USED"));
  assert.ok(summary.reasons.includes("PRODUCTION_CREDENTIAL_USED"));
  assert.equal(summary.issues.counts.P1, 1);
  assert.equal(summary.issues.unresolvedP1Count, 1);
  assert.ok(summary.reasons.includes("UNRESOLVED_P1_REPORTED"));
});

test("P1 evidence blocks until its retest passes", async (t) => {
  await t.test("passed retest is reported but does not block", () => {
    const sessions = ["S01", "S02", "S03"].map(makeSession);
    sessions[0].issues.push({
      code: "S01-01",
      pattern: "target-confirmation-bypass",
      severity: "P1",
      retestStatus: "passed",
    });

    const summary = createUsabilitySummary({ sessions });

    assert.equal(summary.decision, "pass");
    assert.equal(summary.issues.counts.P1, 1);
    assert.equal(summary.issues.unresolvedP1Count, 0);
    assert.ok(!summary.reasons.includes("UNRESOLVED_P1_REPORTED"));
    assert.match(buildMarkdownSummary(summary), /\| S01 .*\| 1\/0 \| 0\/0 \|/);
  });

  for (const retestStatus of ["pending", "failed"]) {
    await t.test(`${retestStatus} retest blocks`, () => {
      const sessions = ["S01", "S02", "S03"].map(makeSession);
      sessions[0].issues.push({
        code: "S01-01",
        pattern: "target-confirmation-bypass",
        severity: "P1",
        retestStatus,
      });

      const summary = createUsabilitySummary({ sessions });

      assert.equal(summary.decision, "fail");
      assert.equal(summary.issues.counts.P1, 1);
      assert.equal(summary.issues.unresolvedP1Count, 1);
      assert.ok(summary.reasons.includes("UNRESOLVED_P1_REPORTED"));
      assert.match(buildMarkdownSummary(summary), /\| S01 .*\| 1\/1 \| 0\/0 \|/);
    });
  }
});

test("repeated unresolved P2 patterns block until retests clear the repeat", async (t) => {
  await t.test("same unresolved pattern in two sessions blocks", () => {
    const sessions = ["S01", "S02", "S03"].map(makeSession);
    sessions[0].issues.push({
      code: "S01-01",
      pattern: "command-result-location",
      severity: "P2",
      retestStatus: "pending",
    });
    sessions[1].issues.push({
      code: "S02-01",
      pattern: "command-result-location",
      severity: "P2",
      retestStatus: "failed",
    });

    const summary = createUsabilitySummary({ sessions });

    assert.equal(summary.decision, "fail");
    assert.equal(summary.issues.counts.P2, 2);
    assert.equal(summary.issues.unresolvedP2Count, 2);
    assert.deepEqual(summary.issues.repeatedUnresolvedP2Patterns, [{
      pattern: "command-result-location",
      issueCount: 2,
      sessionCount: 2,
      sessionCodes: ["S01", "S02"],
    }]);
    assert.ok(summary.reasons.includes("REPEATED_UNRESOLVED_P2_PATTERN"));
    assert.match(
      buildMarkdownSummary(summary),
      /\| command-result-location \| 2 \| 2 \| S01, S02 \| block \|/,
    );
  });

  await t.test("passed retest preserves totals and clears the repeated-pattern gate", () => {
    const sessions = ["S01", "S02", "S03"].map(makeSession);
    sessions[0].issues.push({
      code: "S01-01",
      pattern: "command-result-location",
      severity: "P2",
      retestStatus: "pending",
    });
    sessions[1].issues.push({
      code: "S02-01",
      pattern: "command-result-location",
      severity: "P2",
      retestStatus: "passed",
    });

    const summary = createUsabilitySummary({ sessions });

    assert.equal(summary.decision, "pass");
    assert.equal(summary.issues.counts.P2, 2);
    assert.equal(summary.issues.unresolvedP2Count, 1);
    assert.deepEqual(summary.issues.repeatedUnresolvedP2Patterns, []);
    assert.ok(!summary.reasons.includes("REPEATED_UNRESOLVED_P2_PATTERN"));
    assert.match(
      buildMarkdownSummary(summary),
      /\| command-result-location \| 1 \| 1 \| S01 \| clear \|/,
    );
  });

  await t.test("multiple issue rows in one session do not fabricate a repeat", () => {
    const sessions = ["S01", "S02", "S03"].map(makeSession);
    sessions[0].issues.push(
      {
        code: "S01-01",
        pattern: "command-result-location",
        severity: "P2",
        retestStatus: "pending",
      },
      {
        code: "S01-02",
        pattern: "command-result-location",
        severity: "P2",
        retestStatus: "failed",
      },
    );

    const summary = createUsabilitySummary({ sessions });

    assert.equal(summary.decision, "pass");
    assert.equal(summary.issues.unresolvedP2Count, 2);
    assert.equal(summary.issues.unresolvedP2Patterns[0].sessionCount, 1);
    assert.deepEqual(summary.issues.repeatedUnresolvedP2Patterns, []);
  });
});

test("requires all three participants to distinguish timed stop from physical safety", () => {
  const sessions = ["S01", "S02", "S03"].map(makeSession);
  sessions[2].safety.explainedTimedStopIsNotPhysicalSafetyBeforeDebrief = false;

  const summary = createUsabilitySummary({ sessions });

  assert.equal(summary.decision, "fail");
  assert.equal(summary.safety.understandingPassCount, 2);
  assert.equal(summary.safety.understandingRequiredCount, 3);
  assert.ok(summary.reasons.includes("SAFETY_UNDERSTANDING_THRESHOLD_NOT_MET"));
});

test("CLI writes deterministic JSON and Markdown from anonymous result files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-usability-"));
  const outputDirectory = join(directory, "summary");
  t.after(() => rm(directory, { recursive: true, force: true }));

  for (const code of ["S03", "S01", "S02"]) {
    await writeFile(
      join(directory, `${code}-result.json`),
      JSON.stringify(makeSession(code)),
      "utf8",
    );
  }

  const stdout = createSink();
  const stderr = createSink();
  const exitCode = await runCli(
    ["--input", directory, "--out", outputDirectory],
    { stdout, stderr },
  );
  assert.equal(exitCode, 0);
  assert.equal(stderr.value, "");

  const firstJson = await readFile(join(outputDirectory, "usability-summary.json"), "utf8");
  const firstMarkdown = await readFile(join(outputDirectory, "usability-summary.md"), "utf8");
  const summary = JSON.parse(firstJson);
  assert.equal(summary.decision, "pass");
  assert.deepEqual(summary.sessions.map((session) => session.sessionCode), ["S01", "S02", "S03"]);
  assert.match(firstMarkdown, /\| S01 \|/);

  const secondExitCode = await runCli(
    ["--input", directory, "--out", outputDirectory],
    { stdout: createSink(), stderr: createSink() },
  );
  assert.equal(secondExitCode, 0);
  assert.equal(
    await readFile(join(outputDirectory, "usability-summary.json"), "utf8"),
    firstJson,
  );
  assert.equal(
    await readFile(join(outputDirectory, "usability-summary.md"), "utf8"),
    firstMarkdown,
  );
});

test("CLI marks unknown-field submissions invalid and exits nonzero", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-usability-invalid-"));
  const outputDirectory = join(directory, "summary");
  t.after(() => rm(directory, { recursive: true, force: true }));

  for (const code of ["S01", "S02", "S03"]) {
    const session = makeSession(code);
    if (code === "S03") session.freeTextNote = "not retained";
    await writeFile(join(directory, `${code}-result.json`), JSON.stringify(session), "utf8");
  }

  const exitCode = await runCli(
    ["--input", directory, "--out", outputDirectory],
    { stdout: createSink(), stderr: createSink() },
  );
  assert.equal(exitCode, 1);
  const summaryText = await readFile(join(outputDirectory, "usability-summary.json"), "utf8");
  assert.doesNotMatch(summaryText, /not retained|freeTextNote/);
  const summary = JSON.parse(summaryText);
  assert.equal(summary.sessionCount, 2);
  assert.equal(summary.invalidSessionCount, 1);
  assert.ok(summary.reasons.includes("INVALID_SESSION_RESULT"));
});

test("CLI help and equal-sign directory options are supported", async () => {
  const stdout = createSink();
  assert.equal(await runCli(["--help"], { stdout, stderr: createSink() }), 0);
  assert.match(stdout.value, /Usage:/);

  const parsed = parseCliArgs(
    ["--input=results", "--out=reports"],
    { cwd: "/tmp/smartfarm-usability-cli" },
  );
  assert.equal(parsed.inputDirectory, "/tmp/smartfarm-usability-cli/results");
  assert.equal(parsed.outputDirectory, "/tmp/smartfarm-usability-cli/reports");
});

test("loader rejects a filename and session-code mismatch", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-usability-mismatch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "S01-result.json"),
    JSON.stringify(makeSession("S02")),
    "utf8",
  );

  const loaded = await loadSessionResults(directory);

  assert.deepEqual(loaded.sessions, []);
  assert.deepEqual(loaded.invalidSubmissions, [{
    fileName: "S01-result.json",
    errors: ["SESSION_CODE_FILENAME_MISMATCH"],
  }]);
});

function makeSession(sessionCode) {
  const task = (durationSeconds) => ({
    unassistedCompleted: true,
    durationSeconds,
    helpRequestCount: 0,
    correctedMisstepCount: 0,
    navigationLoopCount: 0,
  });
  return {
    schemaVersion: SESSION_RESULT_SCHEMA_VERSION,
    sessionCode,
    participantRole: "current-farmer",
    experienceBand: "4-plus-years",
    deviceClass: Number(sessionCode.slice(1)) % 2 === 0 ? "mobile" : "desktop",
    tasks: {
      findAttentionArea: task(40),
      explainOutOfRangeMetric: task(50),
      acknowledgeAlarm: task(35),
      applyIrrigationPreset: task(70),
      verifyCommandAndAudit: task(45),
    },
    judgments: {
      attentionAreaCorrect: true,
      outOfRangeMetricCorrect: true,
      irrigationTargetCorrect: true,
      ackAndAuditEvidenceCorrect: true,
    },
    totalDurationSeconds: 270,
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
