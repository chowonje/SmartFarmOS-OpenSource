#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createUsabilitySummary,
  loadSessionResults,
  writeUsabilitySummary,
} from "./summarize-usability-results.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_OUTPUT_DIRECTORY = "artifacts/submission/rehearsal";
const DEFAULT_PRIVACY_REPORT = "artifacts/privacy-preflight/report.json";
const DEFAULT_USABILITY_INPUT = "artifacts/usability";
const DEFAULT_USABILITY_OUTPUT = "artifacts/usability/summary";
const DEFAULT_VIDEO_PROOF = "artifacts/submission/video-proof.json";
const STRICT_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
const RECOGNIZED_OSI_LICENSE_SIGNATURES = [
  {
    name: "MIT",
    patterns: [
      /Permission is hereby granted, free of charge/i,
      /THE SOFTWARE IS PROVIDED ["“]AS IS["”]/i,
    ],
  },
  {
    name: "Apache-2.0",
    patterns: [
      /Apache License/i,
      /Version 2\.0, January 2004/i,
      /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/i,
    ],
  },
  {
    name: "BSD",
    patterns: [
      /Redistribution and use in source and binary forms/i,
      /THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS/i,
    ],
  },
  {
    name: "MPL-2.0",
    patterns: [
      /Mozilla Public License Version 2\.0/i,
      /This Source Code Form is subject to the terms/i,
    ],
  },
  {
    name: "GPL-family",
    patterns: [
      /GNU (?:AFFERO )?(?:LESSER )?GENERAL PUBLIC LICENSE/i,
      /everyone is permitted to copy and distribute verbatim copies/i,
    ],
  },
  {
    name: "EPL-2.0",
    patterns: [
      /Eclipse Public License - v 2\.0/i,
      /THE ACCOMPANYING PROGRAM IS PROVIDED UNDER THE TERMS/i,
    ],
  },
  {
    name: "ISC-or-0BSD",
    patterns: [
      /Permission to use, copy, modify, and\/or distribute this software/i,
      /THE SOFTWARE IS PROVIDED ["“]AS IS["”]/i,
    ],
  },
];
const REQUIRED_SUBMISSION_DOCUMENTS = [
  "docs/submission/official-requirements.md",
  "docs/submission/release-checklist.md",
  "docs/submission/result-report.md",
  "docs/submission/demo-rehearsal.md",
  "docs/submission/presentation-outline.md",
  "docs/submission/ai-use-disclosure.md",
];

export function parseArguments(args) {
  const options = {
    runVerify: true,
    outputDirectory: DEFAULT_OUTPUT_DIRECTORY,
    privacyReport: DEFAULT_PRIVACY_REPORT,
    usabilityInput: DEFAULT_USABILITY_INPUT,
    usabilityOutput: DEFAULT_USABILITY_OUTPUT,
    videoProof: DEFAULT_VIDEO_PROOF,
    force: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") return { ...options, help: true };
    if (argument === "--skip-verify") {
      options.runVerify = false;
      continue;
    }
    if (argument === "--force") {
      options.force = true;
      continue;
    }
    if ([
      "--out",
      "--privacy-report",
      "--usability-input",
      "--usability-out",
      "--video-proof",
    ].includes(argument)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${argument} requires a path`);
      }
      index += 1;
      if (argument === "--out") options.outputDirectory = value;
      if (argument === "--privacy-report") options.privacyReport = value;
      if (argument === "--usability-input") options.usabilityInput = value;
      if (argument === "--usability-out") options.usabilityOutput = value;
      if (argument === "--video-proof") options.videoProof = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  return { ...options, help: false };
}

export function countUncheckedChecklistItems(text) {
  return [...text.matchAll(/^\s*- \[ \]/gm)].length;
}

export function evaluateChecklistText(text, id, label, pendingMarkers = []) {
  const unchecked = countUncheckedChecklistItems(text);
  const unresolvedMarkers = pendingMarkers.filter((marker) => text.includes(marker));
  return createCheck(
    id,
    unchecked === 0 && unresolvedMarkers.length === 0 ? "pass" : "block",
    unchecked === 0 && unresolvedMarkers.length === 0
      ? `${label} has no unchecked owner items.`
      : `${label} still has ${unchecked} unchecked owner item(s) and ${unresolvedMarkers.length} pending marker(s).`,
  );
}

export function deriveDecision(checks) {
  if (checks.some((check) => check.status === "block")) return "block";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "pass";
}

export function evaluateLicenseText(text, path) {
  const normalized = text.trim();
  if (normalized.length < 200 || /\b(?:PENDING|TODO|TBD)\b/i.test(normalized)) {
    return createCheck(
      "release.license",
      "block",
      "Release license file is empty, incomplete, or still contains a pending marker.",
    );
  }
  const recognized = RECOGNIZED_OSI_LICENSE_SIGNATURES.find(({ patterns }) => (
    patterns.every((pattern) => pattern.test(normalized))
  ));
  if (recognized === undefined) {
    return createCheck(
      "release.license",
      "block",
      "Release license text is not recognized as a supported OSI license candidate; owner rights and compatibility review remain required.",
    );
  }
  return createCheck(
    "release.license",
    "pass",
    `Recognized ${recognized.name} candidate text in ${path}; provenance and compatibility approval remain separate gates.`,
  );
}

export function evaluatePrivacyReport(report) {
  if (!isPlainObject(report) || !isPlainObject(report.summary)) {
    return createCheck("privacy.report", "block", "Privacy report has an invalid shape.");
  }
  const blockFindings = report.summary.block_findings;
  const warnFindings = report.summary.warn_findings;
  if (!Number.isInteger(blockFindings) || blockFindings < 0) {
    return createCheck("privacy.report", "block", "Privacy report block count is invalid.");
  }
  if (!Number.isInteger(warnFindings) || warnFindings < 0) {
    return createCheck("privacy.report", "block", "Privacy report warning count is invalid.");
  }
  if (blockFindings > 0) {
    return createCheck(
      "privacy.report",
      "block",
      `Privacy preflight still has ${blockFindings} BLOCK finding(s).`,
    );
  }
  if (warnFindings > 0 || report.summary.opf_status !== "available") {
    return createCheck(
      "privacy.report",
      "warn",
      `Privacy preflight has ${warnFindings} warning(s); model PII status is ${String(report.summary.opf_status)}.`,
    );
  }
  return createCheck("privacy.report", "pass", "Privacy preflight has no unresolved findings.");
}

export function evaluateUsabilitySummary(summary) {
  if (!isPlainObject(summary)
    || summary.schemaVersion !== "smartfarm.usability-summary.v1"
    || !Number.isInteger(summary.sessionCount)
    || summary.sessionCount < 0
    || !["pass", "fail"].includes(summary.decision)) {
    return createCheck("usability.summary", "block", "Usability summary has an invalid shape.");
  }
  if (summary.sessionCount < 3 || summary.sessionCount > 5) {
    return createCheck(
      "usability.summary",
      "block",
      `Usability evidence contains ${summary.sessionCount} session(s); 3 to 5 are required.`,
    );
  }
  if (summary.decision !== "pass") {
    return createCheck("usability.summary", "block", "Usability safety gate did not pass.");
  }
  return createCheck(
    "usability.summary",
    "pass",
    `Usability safety gate passed with ${summary.sessionCount} anonymous session(s).`,
  );
}

export function evaluateVideoProof(proof) {
  if (!isPlainObject(proof)
    || proof.schemaVersion !== "smartfarm.submission-video-proof.v1"
    || typeof proof.filePath !== "string"
    || !/\.(?:mkv|mov|mp4|webm)$/i.test(proof.filePath)
    || !Number.isInteger(proof.durationSeconds)
    || proof.durationSeconds < 1
    || typeof proof.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(proof.sha256)
    || proof.reviewed !== true) {
    return createCheck("submission.video", "block", "Reviewed 3-minute video proof is missing or invalid.");
  }
  if (proof.durationSeconds > 180) {
    return createCheck(
      "submission.video",
      "block",
      `Submission video is ${proof.durationSeconds} seconds; the official limit is 180 seconds.`,
    );
  }
  return createCheck(
    "submission.video",
    "pass",
    `Reviewed video proof is ${proof.durationSeconds} seconds with a recorded SHA-256.`,
  );
}

export async function evaluateVideoArtifact(root, proofPath, options = {}) {
  let proof;
  let actualDurationSeconds = null;
  try {
    proof = JSON.parse(await readFile(proofPath, "utf8"));
  } catch {
    return createCheck("submission.video", "block", "Reviewed 3-minute video proof is missing.");
  }

  const proofCheck = evaluateVideoProof(proof);
  if (proofCheck.status === "block") return proofCheck;

  const allowedDirectory = resolve(root, "artifacts/submission");
  const artifactPath = resolve(root, proof.filePath);
  if (artifactPath !== allowedDirectory && !artifactPath.startsWith(`${allowedDirectory}${sep}`)) {
    return createCheck(
      "submission.video",
      "block",
      "Video proof points outside the ignored local submission-artifact directory.",
    );
  }

  try {
    const resolvedArtifact = await realpath(artifactPath);
    const resolvedAllowedDirectory = await realpath(allowedDirectory);
    if (!resolvedArtifact.startsWith(`${resolvedAllowedDirectory}${sep}`)) {
      return createCheck(
        "submission.video",
        "block",
        "Video artifact resolves outside the ignored local submission-artifact directory.",
      );
    }
    if (!(await stat(resolvedArtifact)).isFile()) throw new Error("not a file");
    const actualHash = await sha256File(resolvedArtifact);
    if (actualHash !== proof.sha256) {
      return createCheck(
        "submission.video",
        "block",
        "Video artifact SHA-256 does not match the reviewed proof.",
      );
    }
    const probeDuration = options.probeDuration ?? probeVideoDuration;
    actualDurationSeconds = await probeDuration(resolvedArtifact);
    if (!Number.isFinite(actualDurationSeconds) || actualDurationSeconds <= 0) {
      return createCheck(
        "submission.video",
        "block",
        "Video duration could not be verified with ffprobe.",
      );
    }
    if (actualDurationSeconds > 180.01) {
      return createCheck(
        "submission.video",
        "block",
        `Measured video duration is ${actualDurationSeconds.toFixed(2)} seconds; the official limit is 180 seconds.`,
      );
    }
    if (Math.abs(actualDurationSeconds - proof.durationSeconds) > 1) {
      return createCheck(
        "submission.video",
        "block",
        "Measured video duration does not match the reviewed proof.",
      );
    }
  } catch {
    return createCheck(
      "submission.video",
      "block",
      "Reviewed video artifact is missing, unreadable, or outside the allowed directory.",
    );
  }

  return createCheck(
    "submission.video",
    "pass",
    `Reviewed video artifact measures ${actualDurationSeconds.toFixed(2)} seconds and matches its SHA-256.`,
  );
}

export async function collectReadinessChecks(options, root = repositoryRoot) {
  const outputPaths = options.outputPaths ?? await prepareRehearsalOutputs(options, root);
  const checks = [];

  if (options.runVerify) {
    const verify = spawnSync("npm", ["run", "verify"], {
      cwd: root,
      encoding: "utf8",
      stdio: "inherit",
    });
    checks.push(createCheck(
      "verification.full",
      verify.status === 0 ? "pass" : "block",
      verify.status === 0
        ? "Full repository verification passed in this rehearsal."
        : "Full repository verification failed in this rehearsal.",
    ));
  } else {
    checks.push(createCheck(
      "verification.full",
      "block",
      "Full repository verification was skipped; diagnostic reports cannot authorize submission.",
    ));
  }

  for (const path of REQUIRED_SUBMISSION_DOCUMENTS) {
    checks.push(createCheck(
      `document.${path.split("/").at(-1)}`,
      await fileExists(join(root, path)) ? "pass" : "block",
      await fileExists(join(root, path))
        ? `Required submission document exists: ${path}.`
        : `Required submission document is missing: ${path}.`,
    ));
  }

  const licensePath = await firstExistingPath(root, ["LICENSE", "LICENSE.md", "COPYING"]);
  if (licensePath === null) {
    checks.push(createCheck(
      "release.license",
      "block",
      "No release license file exists; licensing remains an owner/provenance gate.",
    ));
  } else {
    checks.push(evaluateLicenseText(await readFile(join(root, licensePath), "utf8"), licensePath));
  }

  checks.push(...await evaluateGitState(root));
  checks.push(await evaluateChecklistFile(
    root,
    "docs/credential-rotation.md",
    "release.credentials",
    "Credential rotation checklist",
    ["reissue pending", "architecture review pending"],
  ));
  checks.push(await evaluateChecklistFile(
    root,
    "docs/provenance.md",
    "release.provenance",
    "Prior-work provenance checklist",
    ["Pending human confirmation", "Pending staged migration", "Pending per-task recording"],
  ));
  checks.push(await evaluatePendingMarker(
    root,
    "docs/submission/ai-use-disclosure.md",
    "PENDING_OWNER_CONFIRMATION",
    "release.ai-disclosure",
    "AI-use disclosure",
  ));
  checks.push(await evaluatePendingMarker(
    root,
    "docs/submission/result-report.md",
    "PENDING_FINALIZATION",
    "submission.report",
    "Contest result report",
  ));

  const privacyPath = resolve(root, options.privacyReport);
  const privacyResult = await readJsonCheck(
    privacyPath,
    "privacy.report",
    evaluatePrivacyReport,
    "Privacy preflight report is missing. Run the scoped local privacy check.",
  );
  checks.push(privacyResult);
  if (await fileExists(privacyPath)) {
    const reportTime = (await stat(privacyPath)).mtimeMs;
    const sourceTime = await latestSourceModificationTime(root);
    checks.push(createCheck(
      "privacy.freshness",
      reportTime >= sourceTime ? "pass" : "block",
      reportTime >= sourceTime
        ? "Privacy report is newer than the current releasable source files."
        : "Privacy report is stale relative to the current releasable source files.",
    ));
  }

  try {
    const loadedSessions = await loadSessionResults(resolve(root, options.usabilityInput));
    const usabilitySummary = createUsabilitySummary(loadedSessions);
    await writeUsabilitySummary(usabilitySummary, outputPaths.usabilityOutputDirectory);
    checks.push(evaluateUsabilitySummary(usabilitySummary));
  } catch {
    checks.push(createCheck(
      "usability.summary",
      "block",
      "Anonymous usability results could not be validated and summarized.",
    ));
  }
  checks.push(await evaluateVideoArtifact(root, resolve(root, options.videoProof)));

  return checks;
}

export function createReadinessReport(checks, generatedAt = new Date().toISOString()) {
  const decision = deriveDecision(checks);
  return {
    schemaVersion: "smartfarm.submission-readiness.v1",
    generatedAt,
    decision,
    counts: {
      pass: checks.filter((check) => check.status === "pass").length,
      warn: checks.filter((check) => check.status === "warn").length,
      block: checks.filter((check) => check.status === "block").length,
    },
    checks,
  };
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`[smartfarm-submission] ${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    process.stdout.write(
      "Usage: npm run submission:rehearse -- [--skip-verify] [--out PATH] "
      + "[--privacy-report PATH] [--usability-input PATH] [--usability-out PATH] "
      + "[--video-proof PATH] [--force]\n"
      + "Runs the full contest rehearsal and writes a redacted PASS/WARN/BLOCK report.\n",
    );
    return;
  }

  let outputPaths;
  try {
    outputPaths = await prepareRehearsalOutputs(options, repositoryRoot);
  } catch (error) {
    process.stderr.write(`[smartfarm-submission] ${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  const checks = await collectReadinessChecks({ ...options, outputPaths });
  const report = createReadinessReport(checks);
  const outputDirectory = outputPaths.reportOutputDirectory;
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(
    join(outputDirectory, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await writeFile(join(outputDirectory, "report.md"), renderMarkdownReport(report), "utf8");

  process.stdout.write(
    `[smartfarm-submission] ${report.decision.toUpperCase()} `
    + `(${report.counts.pass} pass / ${report.counts.warn} warn / ${report.counts.block} block)\n`
    + `[smartfarm-submission] report: ${join(outputDirectory, "report.md")}\n`,
  );
  process.exitCode = report.decision === "pass" ? 0 : report.decision === "warn" ? 1 : 2;
}

export async function prepareRehearsalOutputs(options, root = repositoryRoot) {
  const reportOutputDirectory = await resolveSafeOutputDirectory(
    root,
    options.outputDirectory,
    "artifacts/submission",
    "Rehearsal report output",
  );
  const usabilityOutputDirectory = await resolveSafeOutputDirectory(
    root,
    options.usabilityOutput,
    "artifacts/usability",
    "Usability summary output",
  );
  const outputFiles = [
    join(reportOutputDirectory, "report.json"),
    join(reportOutputDirectory, "report.md"),
    join(usabilityOutputDirectory, "usability-summary.json"),
    join(usabilityOutputDirectory, "usability-summary.md"),
  ];
  if (options.force !== true) {
    for (const outputFile of outputFiles) {
      if (await fileExists(outputFile)) {
        throw new Error(`Output already exists; rerun with --force only after preserving it: ${outputFile}`);
      }
    }
  }
  return { reportOutputDirectory, usabilityOutputDirectory };
}

async function resolveSafeOutputDirectory(root, requestedPath, allowedRelativePath, label) {
  const allowedDirectory = resolve(root, allowedRelativePath);
  const outputDirectory = resolve(root, requestedPath);
  if (
    outputDirectory !== allowedDirectory
    && !outputDirectory.startsWith(`${allowedDirectory}${sep}`)
  ) {
    throw new Error(`${label} must stay inside ${allowedRelativePath}.`);
  }

  let cursor = resolve(root);
  const pathFromRoot = relative(cursor, outputDirectory);
  for (const segment of pathFromRoot.split(sep).filter(Boolean)) {
    cursor = join(cursor, segment);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) {
        throw new Error(`${label} must not traverse a symbolic link.`);
      }
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }

  await mkdir(allowedDirectory, { recursive: true });
  const resolvedAllowedDirectory = await realpath(allowedDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const resolvedOutputDirectory = await realpath(outputDirectory);
  if (
    resolvedOutputDirectory !== resolvedAllowedDirectory
    && !resolvedOutputDirectory.startsWith(`${resolvedAllowedDirectory}${sep}`)
  ) {
    throw new Error(`${label} resolves outside ${allowedRelativePath}.`);
  }
  return outputDirectory;
}

async function evaluateGitState(root) {
  const checks = [];
  const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  checks.push(createCheck(
    "git.initial-commit",
    head.status === 0 ? "pass" : "block",
    head.status === 0
      ? "A Git commit exists for the submission source."
      : "No initial Git commit exists; the submission source cannot be identified reproducibly.",
  ));

  const status = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });
  const changedCount = status.status === 0
    ? status.stdout.split("\n").filter((line) => line.trim() !== "").length
    : null;
  checks.push(createCheck(
    "git.clean-worktree",
    changedCount === 0 ? "pass" : "block",
    changedCount === 0
      ? "Git worktree is clean."
      : changedCount === null
        ? "Git worktree status could not be read."
        : `Git worktree has ${changedCount} uncommitted path(s).`,
  ));

  const origin = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: root,
    encoding: "utf8",
  });
  checks.push(createCheck(
    "git.origin",
    origin.status === 0 && origin.stdout.trim() !== "" ? "pass" : "block",
    origin.status === 0 && origin.stdout.trim() !== ""
      ? "A canonical origin remote is configured."
      : "Canonical origin remote is missing.",
  ));
  return checks;
}

async function evaluateChecklistFile(root, relativePath, id, label, pendingMarkers = []) {
  try {
    const text = await readFile(join(root, relativePath), "utf8");
    return evaluateChecklistText(text, id, label, pendingMarkers);
  } catch {
    return createCheck(id, "block", `${label} is missing or unreadable.`);
  }
}

async function evaluatePendingMarker(root, relativePath, marker, id, label) {
  try {
    const text = await readFile(join(root, relativePath), "utf8");
    const unchecked = countUncheckedChecklistItems(text);
    const pending = text.includes(marker) || unchecked > 0;
    return createCheck(
      id,
      pending ? "block" : "pass",
      pending
        ? `${label} still requires owner finalization (${unchecked} unchecked item(s)).`
        : `${label} has no pending marker or unchecked finalization item.`,
    );
  } catch {
    return createCheck(id, "block", `${label} is missing or unreadable.`);
  }
}

async function readJsonCheck(path, id, evaluator, missingMessage) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return evaluator(value);
  } catch {
    return createCheck(id, "block", missingMessage);
  }
}

export async function latestSourceModificationTime(root) {
  const listed = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  );
  if (listed.status !== 0) return Number.POSITIVE_INFINITY;
  let latest = 0;
  for (const relativePath of listed.stdout.split("\0").filter(Boolean)) {
    try {
      latest = Math.max(latest, (await stat(join(root, relativePath))).mtimeMs);
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }
  return latest;
}

async function firstExistingPath(root, candidates) {
  for (const candidate of candidates) {
    if (await fileExists(join(root, candidate))) return candidate;
  }
  return null;
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function createCheck(id, status, summary) {
  return { id, status, summary };
}

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function renderMarkdownReport(report) {
  const lines = [
    "# SmartFarmOS Submission Rehearsal",
    "",
    `- Decision: **${report.decision.toUpperCase()}**`,
    `- Generated: ${report.generatedAt}`,
    `- Checks: ${report.counts.pass} pass / ${report.counts.warn} warn / ${report.counts.block} block`,
    "",
    "## Checks",
    "",
    ...report.checks.map((check) => (
      `- **${check.status.toUpperCase()}** \`${check.id}\` — ${check.summary}`
    )),
    "",
    "This report contains status labels and counts only. It is not a substitute for owner review, official contest-office confirmation, or physical-device safety evidence.",
    "",
  ];
  return lines.join("\n");
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function probeVideoDuration(path, options = {}) {
  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
  const probe = spawnSyncImpl("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ], {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (probe.status !== 0) return null;
  const rawDuration = String(probe.stdout ?? "").trim();
  if (!STRICT_DECIMAL_PATTERN.test(rawDuration)) return null;
  const duration = Number(rawDuration);
  return Number.isFinite(duration) ? duration : null;
}

const invokedPath = process.argv[1] === undefined ? null : pathToFileURL(resolve(process.argv[1])).href;
if (invokedPath === import.meta.url) {
  await main();
}
