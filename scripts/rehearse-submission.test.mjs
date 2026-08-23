import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  countUncheckedChecklistItems,
  createReadinessReport,
  deriveDecision,
  evaluateChecklistText,
  evaluateLicenseText,
  evaluatePrivacyReport,
  evaluateUsabilitySummary,
  evaluateVideoArtifact,
  evaluateVideoProof,
  latestSourceModificationTime,
  parseArguments,
  prepareRehearsalOutputs,
  probeVideoDuration,
  sha256,
} from "./rehearse-submission.mjs";

test("parses strict rehearsal arguments and rejects missing values", () => {
  assert.deepEqual(parseArguments(["--skip-verify", "--out", "tmp/report"]), {
    runVerify: false,
    outputDirectory: "tmp/report",
    privacyReport: "artifacts/privacy-preflight/report.json",
    usabilityInput: "artifacts/usability",
    usabilityOutput: "artifacts/usability/summary",
    videoProof: "artifacts/submission/video-proof.json",
    force: false,
    help: false,
  });
  assert.equal(parseArguments(["--force"]).force, true);
  assert.throws(() => parseArguments(["--out"]), /requires a path/);
  assert.throws(() => parseArguments(["--unknown"]), /Unknown argument/);
});

test("keeps rehearsal writes inside ignored artifact roots and requires explicit overwrite", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "smartfarm-submission-output-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "artifacts", "submission"), { recursive: true });
  await mkdir(join(root, "artifacts", "usability"), { recursive: true });

  const safe = parseArguments([
    "--out", "artifacts/submission/new-rehearsal",
    "--usability-out", "artifacts/usability/new-summary",
  ]);
  const paths = await prepareRehearsalOutputs(safe, root);
  assert.equal(paths.reportOutputDirectory, join(root, "artifacts/submission/new-rehearsal"));
  assert.equal(paths.usabilityOutputDirectory, join(root, "artifacts/usability/new-summary"));

  await writeFile(join(paths.reportOutputDirectory, "report.md"), "preserve\n", "utf8");
  await assert.rejects(
    prepareRehearsalOutputs(safe, root),
    /Output already exists/,
  );
  await prepareRehearsalOutputs({ ...safe, force: true }, root);

  await assert.rejects(
    prepareRehearsalOutputs({ ...safe, outputDirectory: "../outside" }, root),
    /must stay inside artifacts\/submission/,
  );
  await assert.rejects(
    prepareRehearsalOutputs({ ...safe, usabilityOutput: "/tmp/outside" }, root),
    /must stay inside artifacts\/usability/,
  );

  const outside = join(root, "outside");
  await mkdir(outside);
  await symlink(outside, join(root, "artifacts", "submission", "linked"));
  await assert.rejects(
    prepareRehearsalOutputs({
      ...safe,
      outputDirectory: "artifacts/submission/linked/rehearsal",
    }, root),
    /must not traverse a symbolic link/,
  );
});

test("counts only unchecked Markdown checklist items", () => {
  assert.equal(countUncheckedChecklistItems("- [ ] one\n- [x] two\n  - [ ] three\n"), 2);
  assert.equal(evaluateChecklistText("- [x] done", "gate", "Gate").status, "pass");
  assert.equal(evaluateChecklistText(
    "- [x] done\nPending owner confirmation",
    "gate",
    "Gate",
    ["Pending owner confirmation"],
  ).status, "block");
});

test("derives block before warn before pass", () => {
  assert.equal(deriveDecision([{ status: "pass" }]), "pass");
  assert.equal(deriveDecision([{ status: "pass" }, { status: "warn" }]), "warn");
  assert.equal(deriveDecision([{ status: "warn" }, { status: "block" }]), "block");
});

test("rejects empty or placeholder release licenses", () => {
  assert.equal(evaluateLicenseText("TBD", "LICENSE").status, "block");
  assert.equal(evaluateLicenseText("permission ".repeat(30), "LICENSE").status, "block");
  const mitCandidate = [
    "MIT License",
    "Copyright (c) 2026 Project contributors",
    "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction.",
    "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.",
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.',
  ].join("\n\n");
  const result = evaluateLicenseText(mitCandidate, "LICENSE");
  assert.equal(result.status, "pass");
  assert.match(result.summary, /provenance and compatibility approval remain separate/);
});

test("evaluates privacy reports without exposing finding values", () => {
  assert.equal(evaluatePrivacyReport({}).status, "block");
  assert.equal(evaluatePrivacyReport({
    summary: { block_findings: 1, warn_findings: 0, opf_status: "available" },
  }).status, "block");
  assert.equal(evaluatePrivacyReport({
    summary: { block_findings: 0, warn_findings: 2, opf_status: "missing" },
  }).status, "warn");
  assert.equal(evaluatePrivacyReport({
    summary: { block_findings: 0, warn_findings: 0, opf_status: "available" },
  }).status, "pass");
});

test("requires a passing three-to-five-session usability summary", () => {
  assert.equal(evaluateUsabilitySummary({
    schemaVersion: "smartfarm.usability-summary.v1",
    decision: "pass",
    sessionCount: 3,
  }).status, "pass");
  assert.equal(evaluateUsabilitySummary({
    schemaVersion: "smartfarm.usability-summary.v1",
    decision: "pass",
    sessionCount: 2,
  }).status, "block");
  assert.equal(evaluateUsabilitySummary({
    schemaVersion: "smartfarm.usability-summary.v1",
    decision: "fail",
    sessionCount: 5,
  }).status, "block");
});

test("validates reviewed video proof and the 180-second limit", () => {
  const base = {
    schemaVersion: "smartfarm.submission-video-proof.v1",
    filePath: "artifacts/submission/demo.mp4",
    durationSeconds: 180,
    sha256: "a".repeat(64),
    reviewed: true,
  };
  assert.equal(evaluateVideoProof(base).status, "pass");
  assert.equal(evaluateVideoProof({ ...base, durationSeconds: 181 }).status, "block");
  assert.equal(evaluateVideoProof({ ...base, reviewed: false }).status, "block");
});

test("accepts only one strict decimal from ffprobe without exposing probe output", async () => {
  const valid = await probeVideoDuration("/ignored/demo.mp4", {
    spawnSyncImpl: () => ({ status: 0, stdout: "165.40\n", stderr: "" }),
  });
  const malformed = await probeVideoDuration("/ignored/demo.mp4", {
    spawnSyncImpl: () => ({ status: 0, stdout: "165.4junk\n", stderr: "private detail" }),
  });
  const failed = await probeVideoDuration("/ignored/demo.mp4", {
    spawnSyncImpl: () => ({ status: 1, stdout: "", stderr: "private detail" }),
  });

  assert.equal(valid, 165.4);
  assert.equal(malformed, null);
  assert.equal(failed, null);
});

test("requires the reviewed video proof hash to match a real ignored artifact", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "smartfarm-submission-video-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const artifactDirectory = join(root, "artifacts", "submission");
  await mkdir(artifactDirectory, { recursive: true });
  const videoPath = join(artifactDirectory, "demo.mp4");
  await writeFile(videoPath, "deterministic-video-fixture", "utf8");
  const proofPath = join(artifactDirectory, "video-proof.json");
  const proof = {
    schemaVersion: "smartfarm.submission-video-proof.v1",
    filePath: "artifacts/submission/demo.mp4",
    durationSeconds: 165,
    sha256: sha256("deterministic-video-fixture"),
    reviewed: true,
  };
  await writeFile(proofPath, JSON.stringify(proof), "utf8");

  assert.equal((await evaluateVideoArtifact(root, proofPath, {
    probeDuration: async () => 165.4,
  })).status, "pass");
  await writeFile(proofPath, JSON.stringify({ ...proof, sha256: "a".repeat(64) }), "utf8");
  assert.equal((await evaluateVideoArtifact(root, proofPath, {
    probeDuration: async () => 165.4,
  })).status, "block");
  await writeFile(proofPath, JSON.stringify(proof), "utf8");
  assert.equal((await evaluateVideoArtifact(root, proofPath, {
    probeDuration: async () => 181,
  })).status, "block");
});

test("privacy freshness ignores Git-ignored runtime database artifacts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "smartfarm-submission-source-time-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  const ignorePath = join(root, ".gitignore");
  const sourcePath = join(root, "source.md");
  const ignoredPath = join(root, "runtime.sqlite");
  await writeFile(ignorePath, "*.sqlite\n", "utf8");
  await writeFile(sourcePath, "release source\n", "utf8");
  await writeFile(ignoredPath, "runtime state\n", "utf8");
  const sourceTime = new Date("2026-08-09T00:00:00.000Z");
  const ignoredTime = new Date("2026-08-09T01:00:00.000Z");
  await utimes(ignorePath, sourceTime, sourceTime);
  await utimes(sourcePath, sourceTime, sourceTime);
  await utimes(ignoredPath, ignoredTime, ignoredTime);

  const latest = await latestSourceModificationTime(root);
  assert.equal(latest, (await stat(sourcePath)).mtimeMs);
  assert.ok(latest < (await stat(ignoredPath)).mtimeMs);
});

test("creates a deterministic status-only report", () => {
  const report = createReadinessReport([
    { id: "one", status: "pass", summary: "ok" },
    { id: "two", status: "warn", summary: "review" },
  ], "2026-08-09T00:00:00.000Z");
  assert.equal(report.decision, "warn");
  assert.deepEqual(report.counts, { pass: 1, warn: 1, block: 0 });
  assert.equal(sha256("SmartFarmOS"), "61eb0159fd8220969655b6a1a35dbce1f73ade9442057483601b21a785f567f3");
});
