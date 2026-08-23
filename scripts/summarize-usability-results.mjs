import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SESSION_RESULT_SCHEMA_VERSION = "smartfarm.usability-session-result.v1";
export const SUMMARY_SCHEMA_VERSION = "smartfarm.usability-summary.v1";

export const TASK_KEYS = Object.freeze([
  "findAttentionArea",
  "explainOutOfRangeMetric",
  "acknowledgeAlarm",
  "applyIrrigationPreset",
  "verifyCommandAndAudit",
]);

export const TASK_LABELS = Object.freeze({
  findAttentionArea: "Find the area needing attention",
  explainOutOfRangeMetric: "Explain the out-of-range metric and time",
  acknowledgeAlarm: "Acknowledge the alarm",
  applyIrrigationPreset: "Apply the preset to the correct area",
  verifyCommandAndAudit: "Verify the command result and audit",
});

export const PARTICIPANT_ROLES = Object.freeze([
  "current-farmer",
  "recent-farm-worker",
  "agricultural-instructor",
  "agriculture-student",
  "domain-proxy",
]);

export const EXPERIENCE_BANDS = Object.freeze([
  "none",
  "under-1-year",
  "1-to-3-years",
  "4-plus-years",
]);

export const DEVICE_CLASSES = Object.freeze(["desktop", "mobile"]);

const JUDGMENT_KEYS = Object.freeze([
  "attentionAreaCorrect",
  "outOfRangeMetricCorrect",
  "irrigationTargetCorrect",
  "ackAndAuditEvidenceCorrect",
]);

const SAFETY_KEYS = Object.freeze([
  "wrongAreaSubmissionCount",
  "pendingDuplicateSubmissionCount",
  "explainedTimedStopIsNotPhysicalSafetyBeforeDebrief",
  "productionDeviceUsed",
  "productionCredentialsUsed",
]);

const TASK_RESULT_KEYS = Object.freeze([
  "unassistedCompleted",
  "durationSeconds",
  "helpRequestCount",
  "correctedMisstepCount",
  "navigationLoopCount",
]);

const SESSION_KEYS = Object.freeze([
  "schemaVersion",
  "sessionCode",
  "participantRole",
  "experienceBand",
  "deviceClass",
  "tasks",
  "judgments",
  "totalDurationSeconds",
  "confidenceScore",
  "safety",
  "issues",
]);

const ISSUE_KEYS = Object.freeze(["code", "pattern", "severity", "retestStatus"]);
const ISSUE_SEVERITIES = Object.freeze(["P1", "P2", "P3"]);
const RETEST_STATUSES = Object.freeze(["not-required", "pending", "passed", "failed"]);
const SESSION_CODE_PATTERN = /^S(?:0[1-9]|[1-9][0-9])$/;
const SESSION_FILE_PATTERN = /^(S(?:0[1-9]|[1-9][0-9]))-result\.json$/;
const ISSUE_PATTERN_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const HELP_TEXT = `Usage: node scripts/summarize-usability-results.mjs [options]

Strictly validates anonymous usability session results and writes a deterministic
JSON and Markdown summary. Session files must be named SNN-result.json.

Options:
  --input <directory>  Result directory (default: artifacts/usability)
  --out <directory>    Summary directory (default: <input>/summary)
  --help               Show this help

Result shape example: docs/usability/session-result.example.json
`;

export function validateSessionResult(input, options = {}) {
  const errors = [];
  const session = expectObject(input, SESSION_KEYS, "$", errors);

  if (session === null) return invalidResult(errors);

  const schemaVersion = expectLiteral(
    session.schemaVersion,
    SESSION_RESULT_SCHEMA_VERSION,
    "$.schemaVersion",
    errors,
  );
  const sessionCode = expectPattern(
    session.sessionCode,
    SESSION_CODE_PATTERN,
    "$.sessionCode",
    errors,
  );
  const participantRole = expectEnum(
    session.participantRole,
    PARTICIPANT_ROLES,
    "$.participantRole",
    errors,
  );
  const experienceBand = expectEnum(
    session.experienceBand,
    EXPERIENCE_BANDS,
    "$.experienceBand",
    errors,
  );
  const deviceClass = expectEnum(
    session.deviceClass,
    DEVICE_CLASSES,
    "$.deviceClass",
    errors,
  );

  if (
    options.expectedSessionCode !== undefined
    && sessionCode !== null
    && sessionCode !== options.expectedSessionCode
  ) {
    addError(errors, "SESSION_CODE_FILENAME_MISMATCH", "$.sessionCode");
  }

  const taskObject = expectObject(session.tasks, TASK_KEYS, "$.tasks", errors);
  const tasks = {};
  if (taskObject !== null) {
    for (const taskKey of TASK_KEYS) {
      const path = `$.tasks.${taskKey}`;
      const task = expectObject(taskObject[taskKey], TASK_RESULT_KEYS, path, errors);
      if (task === null) continue;
      tasks[taskKey] = {
        unassistedCompleted: expectBoolean(
          task.unassistedCompleted,
          `${path}.unassistedCompleted`,
          errors,
        ),
        durationSeconds: expectInteger(
          task.durationSeconds,
          1,
          Number.MAX_SAFE_INTEGER,
          `${path}.durationSeconds`,
          errors,
        ),
        helpRequestCount: expectInteger(
          task.helpRequestCount,
          0,
          Number.MAX_SAFE_INTEGER,
          `${path}.helpRequestCount`,
          errors,
        ),
        correctedMisstepCount: expectInteger(
          task.correctedMisstepCount,
          0,
          Number.MAX_SAFE_INTEGER,
          `${path}.correctedMisstepCount`,
          errors,
        ),
        navigationLoopCount: expectInteger(
          task.navigationLoopCount,
          0,
          Number.MAX_SAFE_INTEGER,
          `${path}.navigationLoopCount`,
          errors,
        ),
      };
    }
  }

  const judgmentObject = expectObject(
    session.judgments,
    JUDGMENT_KEYS,
    "$.judgments",
    errors,
  );
  const judgments = {};
  if (judgmentObject !== null) {
    for (const judgmentKey of JUDGMENT_KEYS) {
      judgments[judgmentKey] = expectBoolean(
        judgmentObject[judgmentKey],
        `$.judgments.${judgmentKey}`,
        errors,
      );
    }
  }

  const totalDurationSeconds = expectInteger(
    session.totalDurationSeconds,
    1,
    Number.MAX_SAFE_INTEGER,
    "$.totalDurationSeconds",
    errors,
  );
  const confidenceScore = expectInteger(
    session.confidenceScore,
    1,
    5,
    "$.confidenceScore",
    errors,
  );

  const safetyObject = expectObject(session.safety, SAFETY_KEYS, "$.safety", errors);
  let safety = null;
  if (safetyObject !== null) {
    safety = {
      wrongAreaSubmissionCount: expectInteger(
        safetyObject.wrongAreaSubmissionCount,
        0,
        Number.MAX_SAFE_INTEGER,
        "$.safety.wrongAreaSubmissionCount",
        errors,
      ),
      pendingDuplicateSubmissionCount: expectInteger(
        safetyObject.pendingDuplicateSubmissionCount,
        0,
        Number.MAX_SAFE_INTEGER,
        "$.safety.pendingDuplicateSubmissionCount",
        errors,
      ),
      explainedTimedStopIsNotPhysicalSafetyBeforeDebrief: expectBoolean(
        safetyObject.explainedTimedStopIsNotPhysicalSafetyBeforeDebrief,
        "$.safety.explainedTimedStopIsNotPhysicalSafetyBeforeDebrief",
        errors,
      ),
      productionDeviceUsed: expectBoolean(
        safetyObject.productionDeviceUsed,
        "$.safety.productionDeviceUsed",
        errors,
      ),
      productionCredentialsUsed: expectBoolean(
        safetyObject.productionCredentialsUsed,
        "$.safety.productionCredentialsUsed",
        errors,
      ),
    };
  }

  const issues = [];
  if (!Array.isArray(session.issues)) {
    addError(errors, "EXPECTED_ARRAY", "$.issues");
  } else if (session.issues.length > 99) {
    addError(errors, "ARRAY_TOO_LONG", "$.issues");
  } else {
    const seenIssueCodes = new Set();
    for (const [index, issueInput] of session.issues.entries()) {
      const path = `$.issues[${index}]`;
      const issue = expectObject(issueInput, ISSUE_KEYS, path, errors);
      if (issue === null) continue;
      const code = expectIssueCode(issue.code, sessionCode, `${path}.code`, errors);
      const pattern = expectIssuePattern(issue.pattern, `${path}.pattern`, errors);
      const severity = expectEnum(
        issue.severity,
        ISSUE_SEVERITIES,
        `${path}.severity`,
        errors,
      );
      const retestStatus = expectEnum(
        issue.retestStatus,
        RETEST_STATUSES,
        `${path}.retestStatus`,
        errors,
      );
      if (code !== null) {
        if (seenIssueCodes.has(code)) {
          addError(errors, "DUPLICATE_ISSUE_CODE", `${path}.code`);
        }
        seenIssueCodes.add(code);
      }
      issues.push({ code, pattern, severity, retestStatus });
    }
  }

  if (errors.length > 0) return invalidResult(errors);

  return {
    ok: true,
    value: {
      schemaVersion,
      sessionCode,
      participantRole,
      experienceBand,
      deviceClass,
      tasks,
      judgments,
      totalDurationSeconds,
      confidenceScore,
      safety,
      issues,
    },
  };
}

export async function findSessionResultFiles(inputDirectory) {
  const discovered = [];

  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    entries.sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && SESSION_FILE_PATTERN.test(entry.name)) {
        discovered.push(path);
      }
    }
  }

  await visit(resolve(inputDirectory));
  return discovered.sort(compareText);
}

export async function loadSessionResults(inputDirectory) {
  const files = await findSessionResultFiles(inputDirectory);
  const sessions = [];
  const invalidSubmissions = [];

  for (const file of files) {
    const fileName = basename(file);
    const expectedSessionCode = SESSION_FILE_PATTERN.exec(fileName)?.[1];
    let raw;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      invalidSubmissions.push({ fileName, errors: ["FILE_READ_FAILED"] });
      continue;
    }

    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      invalidSubmissions.push({ fileName, errors: ["INVALID_JSON"] });
      continue;
    }

    const validation = validateSessionResult(input, { expectedSessionCode });
    if (!validation.ok) {
      invalidSubmissions.push({
        fileName,
        errors: [...new Set(validation.errors.map((error) => error.code))].sort(compareText),
      });
      continue;
    }
    sessions.push(validation.value);
  }

  return { sessions, invalidSubmissions };
}

export function createUsabilitySummary({ sessions, invalidSubmissions = [] }) {
  const orderedSessions = [...sessions].sort((left, right) => (
    compareText(left.sessionCode, right.sessionCode)
  ));
  const uniqueSessions = [];
  const duplicateCodes = new Set();
  const seenCodes = new Set();

  for (const session of orderedSessions) {
    if (seenCodes.has(session.sessionCode)) {
      duplicateCodes.add(session.sessionCode);
      continue;
    }
    seenCodes.add(session.sessionCode);
    uniqueSessions.push(session);
  }

  const orderedInvalidSubmissions = invalidSubmissions
    .map((submission) => ({
      fileName: SESSION_FILE_PATTERN.test(submission.fileName)
        ? submission.fileName
        : "anonymous-result.json",
      errors: [...new Set(submission.errors)].sort(compareText),
    }))
    .sort((left, right) => compareText(left.fileName, right.fileName));

  const sessionCount = uniqueSessions.length;
  const safetyUnderstandingRequiredCount = sessionCount <= 3 ? 3 : 4;
  const severityCounts = { P1: 0, P2: 0, P3: 0 };
  let unresolvedP1Count = 0;
  let unresolvedP2Count = 0;
  const unresolvedP2ByPattern = new Map();
  const issueItems = [];
  const taskMetrics = Object.fromEntries(TASK_KEYS.map((taskKey) => [taskKey, {
    unassistedCompletedCount: 0,
    medianDurationSeconds: null,
    helpRequestCount: 0,
    correctedMisstepCount: 0,
    navigationLoopCount: 0,
  }]));
  const taskDurations = Object.fromEntries(TASK_KEYS.map((taskKey) => [taskKey, []]));
  const judgmentCounts = Object.fromEntries(JUDGMENT_KEYS.map((key) => [key, 0]));
  const roleCounts = Object.fromEntries(PARTICIPANT_ROLES.map((role) => [role, 0]));
  const deviceCounts = Object.fromEntries(DEVICE_CLASSES.map((device) => [device, 0]));
  const totalDurations = [];
  let fullyCorrectJudgmentSessionCount = 0;
  let wrongAreaSubmissionCount = 0;
  let pendingDuplicateSubmissionCount = 0;
  let safetyUnderstandingPassCount = 0;
  let productionDeviceUseCount = 0;
  let productionCredentialUseCount = 0;

  for (const session of uniqueSessions) {
    roleCounts[session.participantRole] += 1;
    deviceCounts[session.deviceClass] += 1;
    totalDurations.push(session.totalDurationSeconds);

    for (const taskKey of TASK_KEYS) {
      const task = session.tasks[taskKey];
      taskMetrics[taskKey].unassistedCompletedCount += Number(task.unassistedCompleted);
      taskMetrics[taskKey].helpRequestCount += task.helpRequestCount;
      taskMetrics[taskKey].correctedMisstepCount += task.correctedMisstepCount;
      taskMetrics[taskKey].navigationLoopCount += task.navigationLoopCount;
      taskDurations[taskKey].push(task.durationSeconds);
    }

    for (const judgmentKey of JUDGMENT_KEYS) {
      judgmentCounts[judgmentKey] += Number(session.judgments[judgmentKey]);
    }
    fullyCorrectJudgmentSessionCount += Number(
      JUDGMENT_KEYS.every((key) => session.judgments[key]),
    );

    wrongAreaSubmissionCount += session.safety.wrongAreaSubmissionCount;
    pendingDuplicateSubmissionCount += session.safety.pendingDuplicateSubmissionCount;
    safetyUnderstandingPassCount += Number(
      session.safety.explainedTimedStopIsNotPhysicalSafetyBeforeDebrief,
    );
    productionDeviceUseCount += Number(session.safety.productionDeviceUsed);
    productionCredentialUseCount += Number(session.safety.productionCredentialsUsed);

    for (const issue of session.issues) {
      severityCounts[issue.severity] += 1;
      if (issue.severity === "P1" && issue.retestStatus !== "passed") {
        unresolvedP1Count += 1;
      }
      if (issue.severity === "P2" && issue.retestStatus !== "passed") {
        unresolvedP2Count += 1;
        const group = unresolvedP2ByPattern.get(issue.pattern) ?? {
          issueCount: 0,
          sessionCodes: new Set(),
        };
        group.issueCount += 1;
        group.sessionCodes.add(session.sessionCode);
        unresolvedP2ByPattern.set(issue.pattern, group);
      }
      issueItems.push({
        sessionCode: session.sessionCode,
        code: issue.code,
        pattern: issue.pattern,
        severity: issue.severity,
        retestStatus: issue.retestStatus,
      });
    }
  }

  for (const taskKey of TASK_KEYS) {
    taskMetrics[taskKey].medianDurationSeconds = median(taskDurations[taskKey]);
  }
  issueItems.sort((left, right) => (
    compareText(left.sessionCode, right.sessionCode) || compareText(left.code, right.code)
  ));
  const unresolvedP2Patterns = [...unresolvedP2ByPattern.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([pattern, group]) => ({
      pattern,
      issueCount: group.issueCount,
      sessionCount: group.sessionCodes.size,
      sessionCodes: [...group.sessionCodes].sort(compareText),
    }));
  const repeatedUnresolvedP2Patterns = unresolvedP2Patterns.filter((group) => (
    group.sessionCount >= 2
  ));

  const maximumHelpRequestCount = Math.max(
    0,
    ...TASK_KEYS.map((taskKey) => taskMetrics[taskKey].helpRequestCount),
  );
  const mostHelpRequestedTasks = maximumHelpRequestCount === 0
    ? []
    : TASK_KEYS.filter((taskKey) => (
      taskMetrics[taskKey].helpRequestCount === maximumHelpRequestCount
    ));

  const reasons = [];
  if (orderedInvalidSubmissions.length > 0) reasons.push("INVALID_SESSION_RESULT");
  if (duplicateCodes.size > 0) reasons.push("DUPLICATE_SESSION_CODE");
  if (sessionCount < 3) reasons.push("VALID_SESSION_COUNT_BELOW_MINIMUM");
  if (sessionCount > 5) reasons.push("VALID_SESSION_COUNT_ABOVE_MAXIMUM");
  if (wrongAreaSubmissionCount > 0) reasons.push("WRONG_AREA_SUBMISSION");
  if (pendingDuplicateSubmissionCount > 0) {
    reasons.push("PENDING_DUPLICATE_SUBMISSION");
  }
  if (productionDeviceUseCount > 0) reasons.push("PRODUCTION_DEVICE_USED");
  if (productionCredentialUseCount > 0) reasons.push("PRODUCTION_CREDENTIAL_USED");
  if (unresolvedP1Count > 0) reasons.push("UNRESOLVED_P1_REPORTED");
  if (repeatedUnresolvedP2Patterns.length > 0) {
    reasons.push("REPEATED_UNRESOLVED_P2_PATTERN");
  }
  if (safetyUnderstandingPassCount < safetyUnderstandingRequiredCount) {
    reasons.push("SAFETY_UNDERSTANDING_THRESHOLD_NOT_MET");
  }

  const sessionSummaries = uniqueSessions.map((session) => ({
    sessionCode: session.sessionCode,
    participantRole: session.participantRole,
    experienceBand: session.experienceBand,
    deviceClass: session.deviceClass,
    unassistedTaskCount: TASK_KEYS.reduce(
      (count, taskKey) => count + Number(session.tasks[taskKey].unassistedCompleted),
      0,
    ),
    correctJudgmentCount: JUDGMENT_KEYS.reduce(
      (count, key) => count + Number(session.judgments[key]),
      0,
    ),
    totalDurationSeconds: session.totalDurationSeconds,
    confidenceScore: session.confidenceScore,
    safetyUnderstandingPassed:
      session.safety.explainedTimedStopIsNotPhysicalSafetyBeforeDebrief,
    issueCounts: {
      P1: session.issues.filter((issue) => issue.severity === "P1").length,
      P2: session.issues.filter((issue) => issue.severity === "P2").length,
      P3: session.issues.filter((issue) => issue.severity === "P3").length,
      unresolvedP1: session.issues.filter((issue) => (
        issue.severity === "P1" && issue.retestStatus !== "passed"
      )).length,
      unresolvedP2: session.issues.filter((issue) => (
        issue.severity === "P2" && issue.retestStatus !== "passed"
      )).length,
    },
  }));

  return {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    decision: reasons.length === 0 ? "pass" : "fail",
    sessionCount,
    invalidSessionCount: orderedInvalidSubmissions.length,
    reasons,
    duplicateSessionCodes: [...duplicateCodes].sort(compareText),
    invalidSubmissions: orderedInvalidSubmissions,
    sample: {
      participantRoleCounts: roleCounts,
      deviceClassCounts: deviceCounts,
    },
    fieldTasks: taskMetrics,
    operationalJudgments: {
      fullyCorrectSessionCount: fullyCorrectJudgmentSessionCount,
      correctSessionCounts: judgmentCounts,
    },
    timing: {
      medianTotalDurationSeconds: median(totalDurations),
    },
    diagnostics: {
      mostHelpRequestedTasks,
      maximumHelpRequestCount,
    },
    safety: {
      wrongAreaSubmissionCount,
      pendingDuplicateSubmissionCount,
      productionDeviceUseCount,
      productionCredentialUseCount,
      understandingPassCount: safetyUnderstandingPassCount,
      understandingRequiredCount: safetyUnderstandingRequiredCount,
    },
    issues: {
      counts: severityCounts,
      unresolvedP1Count,
      unresolvedP2Count,
      unresolvedP2Patterns,
      repeatedUnresolvedP2Patterns,
      items: issueItems,
    },
    sessions: sessionSummaries,
  };
}

export function buildMarkdownSummary(summary) {
  const lines = [
    "# SmartFarmOS usability summary",
    "",
    `- Decision: **${summary.decision.toUpperCase()}**`,
    `- Valid anonymous sessions: ${summary.sessionCount}`,
    `- Invalid result files: ${summary.invalidSessionCount}`,
    `- Median total duration: ${formatOptionalNumber(summary.timing.medianTotalDurationSeconds, " s")}`,
    "",
    "## Readiness gates",
    "",
  ];

  if (summary.reasons.length === 0) {
    lines.push("- PASS", "");
  } else {
    for (const reason of summary.reasons) lines.push(`- ${reason}`);
    lines.push("");
  }

  lines.push(
    "## Safety",
    "",
    "| Metric | Result |",
    "| --- | ---: |",
    `| Wrong-area submissions | ${summary.safety.wrongAreaSubmissionCount} |`,
    `| Pending duplicate submissions | ${summary.safety.pendingDuplicateSubmissionCount} |`,
    `| Production device uses | ${summary.safety.productionDeviceUseCount} |`,
    `| Production credential uses | ${summary.safety.productionCredentialUseCount} |`,
    `| Safety understanding | ${summary.safety.understandingPassCount}/${summary.safety.understandingRequiredCount} required |`,
    `| P1 issues (total) | ${summary.issues.counts.P1} |`,
    `| P1 issues (unresolved) | ${summary.issues.unresolvedP1Count} |`,
    `| P2 issues (total) | ${summary.issues.counts.P2} |`,
    `| P2 issues (unresolved) | ${summary.issues.unresolvedP2Count} |`,
    `| Repeated unresolved P2 patterns | ${summary.issues.repeatedUnresolvedP2Patterns.length} |`,
    "",
    "## Field tasks",
    "",
    "| Task | Unassisted | Median time | Help requests | Corrected missteps | Navigation loops |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  );

  for (const taskKey of TASK_KEYS) {
    const task = summary.fieldTasks[taskKey];
    lines.push(
      `| ${TASK_LABELS[taskKey]} | ${task.unassistedCompletedCount}/${summary.sessionCount}`
      + ` | ${formatOptionalNumber(task.medianDurationSeconds, " s")}`
      + ` | ${task.helpRequestCount}`
      + ` | ${task.correctedMisstepCount}`
      + ` | ${task.navigationLoopCount} |`,
    );
  }

  lines.push(
    "",
    "## Sessions",
    "",
    "| Session | Role | Device | Unassisted tasks | Correct judgments | Total time | Safety understanding | P1 total/unresolved | P2 total/unresolved |",
    "| --- | --- | --- | ---: | ---: | ---: | --- | ---: | ---: |",
  );

  for (const session of summary.sessions) {
    lines.push(
      `| ${session.sessionCode} | ${session.participantRole} | ${session.deviceClass}`
      + ` | ${session.unassistedTaskCount}/5 | ${session.correctJudgmentCount}/4`
      + ` | ${session.totalDurationSeconds} s`
      + ` | ${session.safetyUnderstandingPassed ? "pass" : "fail"}`
      + ` | ${session.issueCounts.P1}/${session.issueCounts.unresolvedP1}`
      + ` | ${session.issueCounts.P2}/${session.issueCounts.unresolvedP2} |`,
    );
  }
  if (summary.sessions.length === 0) {
    lines.push("| - | - | - | - | - | - | - | - | - |");
  }

  lines.push("", "## Unresolved P2 patterns", "");
  if (summary.issues.unresolvedP2Patterns.length === 0) {
    lines.push("- None", "");
  } else {
    lines.push(
      "| Pattern | Issues | Sessions | Session codes | Gate |",
      "| --- | ---: | ---: | --- | --- |",
    );
    for (const group of summary.issues.unresolvedP2Patterns) {
      lines.push(
        `| ${group.pattern} | ${group.issueCount} | ${group.sessionCount}`
        + ` | ${group.sessionCodes.join(", ")}`
        + ` | ${group.sessionCount >= 2 ? "block" : "clear"} |`,
      );
    }
    lines.push("");
  }

  lines.push("", "## P1/P2 issues", "");
  const actionableIssues = summary.issues.items.filter((issue) => issue.severity !== "P3");
  if (actionableIssues.length === 0) {
    lines.push("- None", "");
  } else {
    lines.push(
      "| Session | Issue | Pattern | Severity | Retest |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const issue of actionableIssues) {
      lines.push(
        `| ${issue.sessionCode} | ${issue.code} | ${issue.pattern}`
        + ` | ${issue.severity} | ${issue.retestStatus} |`,
      );
    }
    lines.push("");
  }

  if (summary.invalidSubmissions.length > 0) {
    lines.push(
      "## Invalid result files",
      "",
      "| File | Validation codes |",
      "| --- | --- |",
    );
    for (const invalid of summary.invalidSubmissions) {
      lines.push(`| ${invalid.fileName} | ${invalid.errors.join(", ")} |`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export async function writeUsabilitySummary(summary, outputDirectory) {
  const resolvedOutput = resolve(outputDirectory);
  await mkdir(resolvedOutput, { recursive: true });
  const jsonPath = join(resolvedOutput, "usability-summary.json");
  const markdownPath = join(resolvedOutput, "usability-summary.md");
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, buildMarkdownSummary(summary), "utf8");
  return { jsonPath, markdownPath };
}

export function parseCliArgs(args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  let inputDirectory;
  let outputDirectory;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      help = true;
      continue;
    }
    if (argument === "--input" || argument === "--out") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CliUsageError(`${argument} requires a directory`);
      }
      if (argument === "--input") inputDirectory = resolve(cwd, value);
      else outputDirectory = resolve(cwd, value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--input=") || argument.startsWith("--out=")) {
      const [flag, ...valueParts] = argument.split("=");
      const value = valueParts.join("=");
      if (value.length === 0) throw new CliUsageError(`${flag} requires a directory`);
      if (flag === "--input") inputDirectory = resolve(cwd, value);
      else outputDirectory = resolve(cwd, value);
      continue;
    }
    throw new CliUsageError("Unknown argument");
  }

  inputDirectory ??= join(repositoryRoot, "artifacts", "usability");
  outputDirectory ??= join(inputDirectory, "summary");
  return { help, inputDirectory, outputDirectory };
}

export async function runCli(args, streams = {}) {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;
  let options;
  try {
    options = parseCliArgs(args, streams);
  } catch (error) {
    if (error instanceof CliUsageError) {
      stderr.write(`[smartfarm-usability] ${error.message}\n`);
      stderr.write(HELP_TEXT);
      return 2;
    }
    stderr.write("[smartfarm-usability] Unable to parse options\n");
    return 2;
  }

  if (options.help) {
    stdout.write(HELP_TEXT);
    return 0;
  }

  try {
    const loaded = await loadSessionResults(options.inputDirectory);
    const summary = createUsabilitySummary(loaded);
    await writeUsabilitySummary(summary, options.outputDirectory);
    stdout.write(
      `[smartfarm-usability] ${summary.decision.toUpperCase()}: `
      + `${summary.sessionCount} valid anonymous session(s)\n`,
    );
    if (summary.reasons.length > 0) {
      stderr.write(`[smartfarm-usability] ${summary.reasons.join(",")}\n`);
    }
    return summary.decision === "pass" ? 0 : 1;
  } catch {
    stderr.write("[smartfarm-usability] Unable to summarize session result files\n");
    return 1;
  }
}

function expectObject(input, allowedKeys, path, errors) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    addError(errors, "EXPECTED_OBJECT", path);
    return null;
  }

  const keys = Object.keys(input);
  if (keys.some((key) => !allowedKeys.includes(key))) {
    addError(errors, "UNKNOWN_FIELD", path);
  }
  for (const key of allowedKeys) {
    if (!Object.hasOwn(input, key)) addError(errors, "MISSING_FIELD", `${path}.${key}`);
  }
  return input;
}

function expectLiteral(input, expected, path, errors) {
  if (input !== expected) {
    addError(errors, "INVALID_LITERAL", path);
    return null;
  }
  return input;
}

function expectEnum(input, allowed, path, errors) {
  if (typeof input !== "string" || !allowed.includes(input)) {
    addError(errors, "INVALID_ENUM", path);
    return null;
  }
  return input;
}

function expectPattern(input, pattern, path, errors) {
  if (typeof input !== "string" || !pattern.test(input)) {
    addError(errors, "INVALID_FORMAT", path);
    return null;
  }
  return input;
}

function expectBoolean(input, path, errors) {
  if (typeof input !== "boolean") {
    addError(errors, "EXPECTED_BOOLEAN", path);
    return null;
  }
  return input;
}

function expectInteger(input, minimum, maximum, path, errors) {
  if (!Number.isSafeInteger(input) || input < minimum || input > maximum) {
    addError(errors, "INVALID_INTEGER", path);
    return null;
  }
  return input;
}

function expectIssueCode(input, sessionCode, path, errors) {
  if (
    typeof input !== "string"
    || sessionCode === null
    || !input.startsWith(`${sessionCode}-`)
    || !/^\d{2}$/.test(input.slice(sessionCode.length + 1))
    || input.endsWith("-00")
  ) {
    addError(errors, "INVALID_ISSUE_CODE", path);
    return null;
  }
  return input;
}

function expectIssuePattern(input, path, errors) {
  if (
    typeof input !== "string"
    || input.length < 3
    || input.length > 64
    || !ISSUE_PATTERN_SLUG.test(input)
  ) {
    addError(errors, "INVALID_ISSUE_PATTERN", path);
    return null;
  }
  return input;
}

function addError(errors, code, path) {
  errors.push({ code, path });
}

function invalidResult(errors) {
  return {
    ok: false,
    errors: errors.sort((left, right) => (
      compareText(`${left.path}:${left.code}`, `${right.path}:${right.code}`)
    )),
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function formatOptionalNumber(value, suffix) {
  return value === null ? "n/a" : `${value}${suffix}`;
}

class CliUsageError extends Error {}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
