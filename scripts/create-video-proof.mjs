#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const DEFAULT_OUTPUT_PATH = "artifacts/submission/video-proof.json";
const ALLOWED_DIRECTORY = join(repositoryRoot, "artifacts", "submission");
const VIDEO_EXTENSION_PATTERN = /\.(?:mkv|mov|mp4|webm)$/i;
const JSON_EXTENSION_PATTERN = /\.json$/i;
const SCHEMA_VERSION = "smartfarm.submission-video-proof.v1";
const STRICT_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

const HELP_TEXT = `Usage: node scripts/create-video-proof.mjs VIDEO [--out PATH] --reviewed

Generates one strict reviewed video-proof manifest for contest submission.

Arguments:
  VIDEO               Reviewed video file inside artifacts/submission

Options:
  --out <path>        Proof output path inside artifacts/submission
                      (default: artifacts/submission/video-proof.json)
  --reviewed          Required human assertion that privacy, claims, and narration
                      were reviewed before publishing this proof
  --help              Show this help
`;

class CliUsageError extends Error {}
class ValidationError extends Error {}
class ProofExistsError extends Error {}

export function parseCliArgs(args, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  let help = false;
  let reviewed = false;
  let outputPath = resolve(cwd, DEFAULT_OUTPUT_PATH);
  let outputDefined = false;
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      help = true;
      continue;
    }
    if (argument === "--reviewed") {
      if (reviewed) throw new CliUsageError("--reviewed must be provided at most once");
      reviewed = true;
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
    if (argument.startsWith("--")) {
      throw new CliUsageError("Unknown argument");
    }
    positional.push(argument);
  }

  if (help) {
    if (positional.length > 0 || reviewed || outputDefined) {
      throw new CliUsageError("--help cannot be combined with other arguments");
    }
    return {
      help: true,
      reviewed: false,
      videoPath: null,
      outputPath,
    };
  }

  if (positional.length !== 1) {
    throw new CliUsageError("Expected exactly one video file path");
  }
  if (!reviewed) {
    throw new CliUsageError("--reviewed is required");
  }

  return {
    help: false,
    reviewed: true,
    videoPath: resolve(cwd, positional[0]),
    outputPath,
  };
}

export async function createVideoProof(options) {
  const {
    repositoryRoot: root = repositoryRoot,
    videoPath,
    outputPath = join(root, DEFAULT_OUTPUT_PATH),
    reviewed,
    env = process.env,
    spawnSyncImpl = spawnSync,
    linkImpl = link,
    lstatImpl = lstat,
    mkdirImpl = mkdir,
    readFileImpl = readFile,
    realpathImpl = realpath,
    rmImpl = rm,
    statImpl = stat,
    writeFileImpl = writeFile,
  } = options ?? {};

  if (reviewed !== true) {
    throw new ValidationError("Reviewed proof requires explicit human review");
  }

  const video = await resolveVideoInput(videoPath, {
    repositoryRoot: root,
    lstatImpl,
    realpathImpl,
    statImpl,
  });
  const output = await resolveProofOutput(outputPath, {
    repositoryRoot: root,
    lstatImpl,
    mkdirImpl,
    realpathImpl,
  });

  if (await pathExists(output.absolutePath, access)) {
    throw new ProofExistsError("Proof output already exists");
  }

  const measuredDurationSeconds = await probeVideoDuration(video.absolutePath, {
    env,
    spawnSyncImpl,
  });
  if (!Number.isFinite(measuredDurationSeconds) || measuredDurationSeconds <= 0) {
    throw new ValidationError("Video duration could not be verified");
  }
  if (measuredDurationSeconds > 180.01) {
    throw new ValidationError("Video duration exceeds the 180-second contest limit");
  }

  const sha256 = await sha256File(video.absolutePath);
  const proof = {
    schemaVersion: SCHEMA_VERSION,
    filePath: video.relativePath,
    durationSeconds: Math.round(measuredDurationSeconds),
    sha256,
    reviewed: true,
  };
  const validatedProof = revalidateProof(proof);

  const payload = `${JSON.stringify(validatedProof, null, 2)}\n`;
  await persistProofFile(payload, output.absolutePath, {
    linkImpl,
    readFileImpl,
    rmImpl,
    writeFileImpl,
  });

  return {
    outputPath: output.absolutePath,
    relativeOutputPath: output.relativePath,
    proof: validatedProof,
    measuredDurationSeconds,
  };
}

export async function resolveVideoInput(videoPath, options = {}) {
  const {
    repositoryRoot: root = repositoryRoot,
    lstatImpl = lstat,
    realpathImpl = realpath,
    statImpl = stat,
  } = options;

  if (typeof videoPath !== "string" || videoPath.length === 0) {
    throw new ValidationError("Video path is required");
  }

  const allowedDirectory = join(root, "artifacts", "submission");
  assertLexicallyInsideAllowedDirectory(videoPath, allowedDirectory, "Video");
  if (!VIDEO_EXTENSION_PATTERN.test(videoPath)) {
    throw new ValidationError("Video file extension is not supported");
  }

  await assertSubmissionDirectoryChainNoSymlink(root, allowedDirectory, { lstatImpl });
  await assertNoSymlinkSegments(allowedDirectory, videoPath, {
    includeLeaf: true,
    lstatImpl,
  });

  let videoStats;
  try {
    videoStats = await statImpl(videoPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ValidationError("Video file is missing");
    }
    throw error;
  }
  if (!videoStats.isFile()) {
    throw new ValidationError("Video path must point to a regular file");
  }

  const resolvedAllowedDirectory = await realpathImpl(allowedDirectory);
  const resolvedVideoPath = await realpathImpl(videoPath);
  assertResolvedInsideAllowedDirectory(resolvedVideoPath, resolvedAllowedDirectory, "Video");

  return {
    absolutePath: videoPath,
    relativePath: toRepositoryRelativePath(root, videoPath),
  };
}

export async function resolveProofOutput(outputPath, options = {}) {
  const {
    repositoryRoot: root = repositoryRoot,
    lstatImpl = lstat,
    mkdirImpl = mkdir,
    realpathImpl = realpath,
  } = options;

  if (typeof outputPath !== "string" || outputPath.length === 0) {
    throw new ValidationError("Proof output path is required");
  }

  const allowedDirectory = join(root, "artifacts", "submission");
  assertLexicallyInsideAllowedDirectory(outputPath, allowedDirectory, "Proof output");
  if (!JSON_EXTENSION_PATTERN.test(outputPath)) {
    throw new ValidationError("Proof output extension must be .json");
  }

  const outputDirectory = dirname(outputPath);
  await assertSubmissionDirectoryChainNoSymlink(root, allowedDirectory, { lstatImpl });
  await assertNoSymlinkSegments(allowedDirectory, outputDirectory, {
    includeLeaf: true,
    allowMissingLeaf: true,
    lstatImpl,
  });
  await mkdirImpl(outputDirectory, { recursive: true });
  await assertNoSymlinkSegments(allowedDirectory, outputDirectory, {
    includeLeaf: true,
    lstatImpl,
  });

  const resolvedAllowedDirectory = await realpathImpl(allowedDirectory);
  const resolvedOutputDirectory = await realpathImpl(outputDirectory);
  assertResolvedInsideAllowedDirectory(
    resolvedOutputDirectory,
    resolvedAllowedDirectory,
    "Proof output",
  );

  if (await pathExists(outputPath, access)) {
    const outputStats = await lstatImpl(outputPath);
    if (outputStats.isSymbolicLink()) {
      throw new ValidationError("Proof output path must not be a symbolic link");
    }
  }

  return {
    absolutePath: outputPath,
    relativePath: toRepositoryRelativePath(root, outputPath),
  };
}

export async function probeVideoDuration(videoPath, options = {}) {
  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
  const env = options.env ?? process.env;
  const result = spawnSyncImpl(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ],
    {
      encoding: "utf8",
      env,
      timeout: 30_000,
    },
  );

  if (result.error || result.status !== 0) {
    throw new ValidationError("Video duration could not be verified");
  }

  const trimmedStdout = String(result.stdout ?? "").trim();
  if (!STRICT_DECIMAL_PATTERN.test(trimmedStdout)) {
    throw new ValidationError("Video duration could not be verified");
  }
  const value = Number(trimmedStdout);
  if (!Number.isFinite(value)) {
    throw new ValidationError("Video duration could not be verified");
  }
  return value;
}

export async function sha256File(path) {
  return new Promise((resolvePromise, rejectPromise) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("error", rejectPromise);
    stream.on("end", () => {
      resolvePromise(hash.digest("hex"));
    });
  });
}

export function revalidateProof(proof) {
  if (!isPlainObject(proof)) {
    throw new ValidationError("Proof payload is invalid");
  }
  const keys = Object.keys(proof).sort();
  const expectedKeys = [
    "durationSeconds",
    "filePath",
    "reviewed",
    "schemaVersion",
    "sha256",
  ];
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new ValidationError("Proof payload is invalid");
  }
  if (proof.schemaVersion !== SCHEMA_VERSION) {
    throw new ValidationError("Proof payload is invalid");
  }
  if (typeof proof.filePath !== "string" || !isCanonicalSubmissionRelativePath(proof.filePath)) {
    throw new ValidationError("Proof payload is invalid");
  }
  if (!VIDEO_EXTENSION_PATTERN.test(proof.filePath)) {
    throw new ValidationError("Proof payload is invalid");
  }
  if (!Number.isInteger(proof.durationSeconds) || proof.durationSeconds < 1 || proof.durationSeconds > 180) {
    throw new ValidationError("Proof payload is invalid");
  }
  if (typeof proof.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(proof.sha256)) {
    throw new ValidationError("Proof payload is invalid");
  }
  if (proof.reviewed !== true) {
    throw new ValidationError("Proof payload is invalid");
  }
  return Object.freeze({ ...proof });
}

export async function persistProofFile(payload, outputPath, options = {}) {
  const linkImpl = options.linkImpl ?? link;
  const readFileImpl = options.readFileImpl ?? readFile;
  const rmImpl = options.rmImpl ?? rm;
  const writeFileImpl = options.writeFileImpl ?? writeFile;
  const outputDirectory = dirname(outputPath);
  const tempPath = join(
    outputDirectory,
    `.video-proof.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );

  try {
    await writeFileImpl(tempPath, payload, { encoding: "utf8", flag: "wx" });
    await linkImpl(tempPath, outputPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new ProofExistsError("Proof output already exists");
    }
    throw error;
  } finally {
    await rmImpl(tempPath, { force: true });
  }

  const saved = JSON.parse(await readFileImpl(outputPath, "utf8"));
  revalidateProof(saved);
}

export async function runCli(args, streams = {}, options = {}) {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;

  let cliOptions;
  try {
    cliOptions = parseCliArgs(args, { cwd: options.cwd ?? process.cwd() });
  } catch (error) {
    if (error instanceof CliUsageError) {
      stderr.write(`[smartfarm-video-proof] ${error.message}\n`);
      stderr.write(HELP_TEXT);
      return 2;
    }
    stderr.write("[smartfarm-video-proof] Unable to parse options\n");
    return 2;
  }

  if (cliOptions.help) {
    stdout.write(HELP_TEXT);
    return 0;
  }

  try {
    const result = await createVideoProof({
      repositoryRoot: options.repositoryRoot ?? repositoryRoot,
      videoPath: cliOptions.videoPath,
      outputPath: cliOptions.outputPath,
      reviewed: cliOptions.reviewed,
      env: options.env ?? process.env,
      spawnSyncImpl: options.spawnSyncImpl ?? spawnSync,
      linkImpl: options.linkImpl,
      lstatImpl: options.lstatImpl,
      mkdirImpl: options.mkdirImpl,
      readFileImpl: options.readFileImpl,
      realpathImpl: options.realpathImpl,
      rmImpl: options.rmImpl,
      statImpl: options.statImpl,
      writeFileImpl: options.writeFileImpl,
    });
    stdout.write(
      `[smartfarm-video-proof] wrote ${result.relativeOutputPath} (${result.proof.durationSeconds}s)\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ProofExistsError) {
      stderr.write("[smartfarm-video-proof] Proof output already exists\n");
      return 1;
    }
    if (error instanceof ValidationError) {
      stderr.write(`[smartfarm-video-proof] ${error.message}\n`);
      return 1;
    }
    stderr.write("[smartfarm-video-proof] Failed to create video proof\n");
    return 1;
  }
}

function assertLexicallyInsideAllowedDirectory(candidatePath, allowedDirectory, label) {
  if (candidatePath !== allowedDirectory && !candidatePath.startsWith(`${allowedDirectory}${sep}`)) {
    throw new ValidationError(`${label} must be inside artifacts/submission`);
  }
}

function assertResolvedInsideAllowedDirectory(candidatePath, allowedDirectory, label) {
  if (candidatePath !== allowedDirectory && !candidatePath.startsWith(`${allowedDirectory}${sep}`)) {
    throw new ValidationError(`${label} resolves outside artifacts/submission`);
  }
}

async function assertNoSymlinkSegments(basePath, targetPath, options = {}) {
  const {
    includeLeaf = true,
    allowMissingLeaf = false,
    lstatImpl = lstat,
  } = options;

  const relativePath = relative(basePath, targetPath);
  const segments = relativePath === "" ? [] : relativePath.split(sep).filter(Boolean);
  let currentPath = basePath;
  const finalSegmentIndex = includeLeaf ? segments.length - 1 : segments.length - 2;

  for (let index = 0; index <= finalSegmentIndex; index += 1) {
    currentPath = join(currentPath, segments[index]);
    try {
      const currentStats = await lstatImpl(currentPath);
      if (currentStats.isSymbolicLink()) {
        throw new ValidationError("Symbolic links are not allowed in submission video paths");
      }
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      if (
        allowMissingLeaf
        && error?.code === "ENOENT"
        && index === finalSegmentIndex
      ) {
        return;
      }
      throw error;
    }
  }
}

async function assertSubmissionDirectoryChainNoSymlink(repositoryRootPath, allowedDirectory, options = {}) {
  const lstatImpl = options.lstatImpl ?? lstat;
  await assertNoSymlinkSegments(repositoryRootPath, allowedDirectory, {
    includeLeaf: true,
    lstatImpl,
  });
}

function isCanonicalSubmissionRelativePath(filePath) {
  if (filePath.length === 0 || filePath.includes("\\")) return false;
  const segments = filePath.split("/");
  if (segments.length < 3) return false;
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return false;
  }
  if (segments[0] !== "artifacts" || segments[1] !== "submission") return false;
  return posix.normalize(filePath) === filePath;
}

function toRepositoryRelativePath(root, absolutePath) {
  return relative(root, absolutePath).split(sep).join("/");
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
