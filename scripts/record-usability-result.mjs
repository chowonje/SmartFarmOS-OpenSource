import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  DEVICE_CLASSES,
  EXPERIENCE_BANDS,
  SESSION_RESULT_SCHEMA_VERSION,
  TASK_KEYS,
  validateSessionResult,
} from "./summarize-usability-results.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const SESSION_CODE_PATTERN = /^S(?:0[1-9]|[1-9][0-9])$/;
const ISSUE_PATTERN_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const MAX_ISSUE_COUNT = 99;

const HELP_TEXT = `Usage: node scripts/record-usability-result.mjs S01 [--out DIRECTORY]

Interactively records one strict anonymous usability session result.

Options:
  --out <directory>  Result directory (default: artifacts/usability)
  --help             Show this help
`;

const TASK_PROMPTS = Object.freeze({
  findAttentionArea: "주의가 필요한 구역 찾기",
  explainOutOfRangeMetric: "이상 수치와 시점 설명",
  acknowledgeAlarm: "알람 확인 처리",
  applyIrrigationPreset: "올바른 구역에 관수 프리셋 적용",
  verifyCommandAndAudit: "제어 결과와 감사 기록 확인",
});

const JUDGMENT_PROMPTS = Object.freeze([
  ["attentionAreaCorrect", "주의 구역 판단이 정확했습니까?"],
  ["outOfRangeMetricCorrect", "이상 수치와 시점 설명이 정확했습니까?"],
  ["irrigationTargetCorrect", "관수 대상 구역이 정확했습니까?"],
  ["ackAndAuditEvidenceCorrect", "알람 처리와 감사 기록 확인이 정확했습니까?"],
]);

const SAFETY_PROMPTS = Object.freeze([
  ["wrongAreaSubmissionCount", "잘못된 구역 제출 횟수"],
  ["pendingDuplicateSubmissionCount", "pending 상태에서 중복 제출한 횟수"],
  [
    "explainedTimedStopIsNotPhysicalSafetyBeforeDebrief",
    "디브리핑 전 '타이머 정지'가 물리 안전장치가 아님을 구분했습니까?",
  ],
  ["productionDeviceUsed", "실제 운영 장비를 사용했습니까?"],
  ["productionCredentialsUsed", "실제 운영 자격증명을 사용했습니까?"],
]);

const TASK_RESULT_LABELS = Object.freeze([
  ["unassistedCompleted", "도움 없이 완료했습니까?"],
  ["durationSeconds", "소요 시간(초)"],
  ["helpRequestCount", "도움 요청 횟수"],
  ["correctedMisstepCount", "수정된 실수 횟수"],
  ["navigationLoopCount", "같은 화면 왕복 횟수"],
]);

const ISSUE_SEVERITIES = Object.freeze(["P1", "P2", "P3"]);
const RETEST_STATUSES = Object.freeze(["not-required", "pending", "passed", "failed"]);
const BOOLEAN_CHOICES = Object.freeze([
  { value: true, label: "예" },
  { value: false, label: "아니오" },
]);
const PARTICIPANT_ROLE_CHOICES = Object.freeze([
  { value: "current-farmer", label: "현재 농업 종사자" },
  { value: "recent-farm-worker", label: "최근 농장 근무 경험자" },
  { value: "agricultural-instructor", label: "농업 교육자" },
  { value: "agriculture-student", label: "농업 관련 학생" },
  { value: "domain-proxy", label: "도메인 대리 사용자" },
]);
const EXPERIENCE_BAND_CHOICES = Object.freeze([
  { value: "none", label: "경험 없음" },
  { value: "under-1-year", label: "1년 미만" },
  { value: "1-to-3-years", label: "1년 이상 3년 이하" },
  { value: "4-plus-years", label: "4년 이상" },
]);
const DEVICE_CLASS_CHOICES = Object.freeze([
  { value: "desktop", label: "데스크톱/노트북" },
  { value: "mobile", label: "모바일" },
]);
const ISSUE_SEVERITY_CHOICES = Object.freeze([
  { value: "P1", label: "치명적 문제" },
  { value: "P2", label: "중간 문제" },
  { value: "P3", label: "경미한 문제" },
]);
const RETEST_STATUS_CHOICES = Object.freeze([
  { value: "not-required", label: "재검증 불필요" },
  { value: "pending", label: "재검증 대기" },
  { value: "passed", label: "재검증 통과" },
  { value: "failed", label: "재검증 실패" },
]);

class CliUsageError extends Error {}
class CliAbortError extends Error {}
class ResultExistsError extends Error {}

export function parseCliArgs(args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  let help = false;
  let outputDirectory;
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      help = true;
      continue;
    }
    if (argument === "--out") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new CliUsageError("--out requires a directory");
      }
      outputDirectory = resolve(cwd, value);
      index += 1;
      continue;
    }
    if (argument.startsWith("--out=")) {
      const value = argument.slice("--out=".length);
      if (value.length === 0) throw new CliUsageError("--out requires a directory");
      outputDirectory = resolve(cwd, value);
      continue;
    }
    if (argument.startsWith("--")) {
      throw new CliUsageError("Unknown argument");
    }
    positional.push(argument);
  }

  if (help) {
    if (positional.length > 0) throw new CliUsageError("Unexpected session code with --help");
    return {
      help: true,
      sessionCode: null,
      outputDirectory: outputDirectory ?? join(repositoryRoot, "artifacts", "usability"),
    };
  }

  if (positional.length !== 1) {
    throw new CliUsageError("Expected one anonymous session code such as S01");
  }
  const sessionCode = positional[0];
  if (!SESSION_CODE_PATTERN.test(sessionCode)) {
    throw new CliUsageError("Session code must match S01 to S99");
  }

  return {
    help: false,
    sessionCode,
    outputDirectory: outputDirectory ?? join(repositoryRoot, "artifacts", "usability"),
  };
}

export async function collectSessionResult({ sessionCode, prompter }) {
  const participantRole = await askNumberedChoice(
    prompter,
    "참여자 역할",
    PARTICIPANT_ROLE_CHOICES,
  );
  const experienceBand = await askNumberedChoice(
    prompter,
    "농업 경험 기간",
    EXPERIENCE_BAND_CHOICES,
  );
  const deviceClass = await askNumberedChoice(
    prompter,
    "사용 기기",
    DEVICE_CLASS_CHOICES,
  );

  const tasks = {};
  for (const taskKey of TASK_KEYS) {
    const taskLabel = TASK_PROMPTS[taskKey] ?? taskKey;
    tasks[taskKey] = await collectTaskResult(prompter, taskLabel);
  }

  const judgments = {};
  for (const [key, label] of JUDGMENT_PROMPTS) {
    judgments[key] = await askBoolean(prompter, label);
  }

  const totalDurationSeconds = await askInteger(
    prompter,
    "전체 소요 시간(초)",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const confidenceScore = await askInteger(prompter, "참여자 자신감 점수(1-5)", 1, 5);

  const safety = {};
  for (const [key, label] of SAFETY_PROMPTS) {
    safety[key] = key.endsWith("Count")
      ? await askInteger(prompter, label, 0, Number.MAX_SAFE_INTEGER)
      : await askBoolean(prompter, label);
  }

  const issueCount = await askInteger(prompter, "이슈 개수(0-99)", 0, MAX_ISSUE_COUNT);
  const issues = [];
  for (let index = 0; index < issueCount; index += 1) {
    const issueCode = `${sessionCode}-${String(index + 1).padStart(2, "0")}`;
    issues.push({
      code: issueCode,
      pattern: await askIssuePattern(prompter, `이슈 패턴 ${issueCode}`),
      severity: await askNumberedChoice(
        prompter,
        `이슈 심각도 ${issueCode}`,
        ISSUE_SEVERITY_CHOICES,
      ),
      retestStatus: await askNumberedChoice(
        prompter,
        `이슈 재검증 상태 ${issueCode}`,
        RETEST_STATUS_CHOICES,
      ),
    });
  }

  const sessionResult = {
    schemaVersion: SESSION_RESULT_SCHEMA_VERSION,
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
  };

  const validation = validateSessionResult(sessionResult, { expectedSessionCode: sessionCode });
  if (!validation.ok) throw new Error("Collected result did not pass strict validation");
  return validation.value;
}

export async function persistSessionResult(sessionResult, options = {}) {
  const outputDirectory = resolve(options.outputDirectory ?? join(repositoryRoot, "artifacts", "usability"));
  const sessionCode = typeof sessionResult?.sessionCode === "string"
    ? sessionResult.sessionCode
    : null;
  if (sessionCode === null || !SESSION_CODE_PATTERN.test(sessionCode)) {
    throw new Error("Invalid session result");
  }
  const validation = validateSessionResult(sessionResult, { expectedSessionCode: sessionCode });
  if (!validation.ok) {
    throw new Error("Invalid session result");
  }

  const validatedResult = validation.value;
  const outputPath = join(outputDirectory, `${validatedResult.sessionCode}-result.json`);
  const tempPath = join(
    outputDirectory,
    `.${validatedResult.sessionCode}-result.${process.pid}.${Date.now()}.tmp`,
  );

  await mkdir(outputDirectory, { recursive: true });
  if (await pathExists(outputPath)) {
    throw new ResultExistsError("Result file already exists");
  }

  const payload = `${JSON.stringify(validatedResult, null, 2)}\n`;
  try {
    await writeFile(tempPath, payload, { encoding: "utf8", flag: "wx" });
    await link(tempPath, outputPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new ResultExistsError("Result file already exists");
    }
    throw error;
  } finally {
    await rm(tempPath, { force: true });
  }

  return { outputPath };
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

  let prompter = null;
  try {
    const outputPath = join(options.outputDirectory, `${options.sessionCode}-result.json`);
    if (await pathExists(outputPath)) {
      stderr.write(`[smartfarm-usability] ${options.sessionCode} result already exists\n`);
      return 1;
    }
    prompter = streams.promptFactory
      ? await streams.promptFactory({ stdin: streams.stdin, stdout })
      : createReadlinePrompter({ stdin: streams.stdin, stdout });
    const sessionResult = await collectSessionResult({
      sessionCode: options.sessionCode,
      prompter,
    });
    const persisted = await persistSessionResult(sessionResult, {
      outputDirectory: options.outputDirectory,
    });
    stdout.write(
      `[smartfarm-usability] ${sessionResult.sessionCode} ${persisted.outputPath}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ResultExistsError) {
      stderr.write(`[smartfarm-usability] ${options.sessionCode} result already exists\n`);
      return 1;
    }
    if (error instanceof CliAbortError) {
      stderr.write("[smartfarm-usability] 입력이 중단되어 저장하지 않았습니다.\n");
      return 1;
    }
    stderr.write("[smartfarm-usability] 결과를 저장하지 못했습니다.\n");
    return 1;
  } finally {
    prompter?.close?.();
  }
}

async function collectTaskResult(prompter, taskLabel) {
  const taskResult = {};
  for (const [key, label] of TASK_RESULT_LABELS) {
    taskResult[key] = key === "unassistedCompleted"
      ? await askBoolean(prompter, `${taskLabel}: ${label}`)
      : await askInteger(
        prompter,
        `${taskLabel}: ${label}`,
        key === "durationSeconds" ? 1 : 0,
        Number.MAX_SAFE_INTEGER,
      );
  }
  return taskResult;
}

async function askNumberedChoice(prompter, label, choices) {
  const lines = [
    label,
    ...choices.map((choice, index) => `${index + 1}. ${choice.label}`),
  ];
  while (true) {
    const answer = await prompter.ask(`${lines.join("\n")}\n번호 입력: `);
    if (/^[1-9][0-9]*$/.test(answer)) {
      const index = Number.parseInt(answer, 10) - 1;
      if (choices[index]) return choices[index].value;
    }
    prompter.notice?.(`${label} 번호를 다시 선택해 주세요.`);
  }
}

async function askBoolean(prompter, label) {
  return askNumberedChoice(prompter, label, BOOLEAN_CHOICES);
}

async function askInteger(prompter, label, minimum, maximum) {
  while (true) {
    const answer = await prompter.ask(`${label}: `);
    if (/^(0|[1-9][0-9]*)$/.test(answer)) {
      const value = Number.parseInt(answer, 10);
      if (value >= minimum && value <= maximum) return value;
    }
    prompter.notice?.(`${label} 값이 범위를 벗어났습니다.`);
  }
}

async function askIssuePattern(prompter, label) {
  while (true) {
    const answer = await prompter.ask(
      `${label} [slug]\n`
        + "- 예시: command-result-location\n"
        + "- 개인정보, 이름, 원문 문장 입력 금지\n"
        + "값 입력: ",
    );
    if (answer.length >= 3 && answer.length <= 64 && ISSUE_PATTERN_SLUG.test(answer)) {
      return answer;
    }
    prompter.notice?.(`${label}은 slug 형식만 허용됩니다.`);
  }
}

function createReadlinePrompter({ stdin, stdout }) {
  const input = stdin ?? process.stdin;
  const output = stdout ?? process.stdout;
  const rl = createInterface({
    input,
    output,
    terminal: Boolean(input.isTTY && output.isTTY),
  });
  const abortController = new AbortController();
  let closed = false;
  let resolveClosed;
  const closedPromise = new Promise((resolve) => {
    resolveClosed = resolve;
  });

  rl.on("SIGINT", () => abortController.abort());
  rl.once("close", () => {
    closed = true;
    abortController.abort();
    resolveClosed();
  });

  return {
    async ask(prompt) {
      if (closed || abortController.signal.aborted) {
        throw new CliAbortError("Input aborted");
      }

      const questionPromise = rl.question(prompt, { signal: abortController.signal })
        .then(
          (answer) => ({ type: "answer", answer }),
          (error) => ({ type: "error", error }),
        );
      const closeRace = closed
        ? Promise.resolve({ type: "close" })
        : closedPromise.then(() => ({ type: "close" }));

      const settled = await Promise.race([questionPromise, closeRace]);
      if (settled.type === "close") {
        throw new CliAbortError("Input aborted");
      }
      if (settled.type === "error") {
        if (closed || abortController.signal.aborted || settled.error?.name === "AbortError") {
          throw new CliAbortError("Input aborted");
        }
        throw settled.error;
      }
      return settled.answer.trim();
    },
    notice(message) {
      rl.write(`${message}\n`);
    },
    close() {
      rl.close();
    },
  };
}

async function pathExists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
