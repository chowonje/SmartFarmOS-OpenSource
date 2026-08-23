#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const LOCKFILE_PATH = join(repositoryRoot, "package-lock.json");
const SCHEMA_VERSION = "smartfarm.dependency-license-inventory.v1";
const LICENSE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 .()+:-]{0,199}$/;
const HELP_TEXT = `Usage: node scripts/verify-dependency-licenses.mjs

Verifies that every external package entry in package-lock.json declares a
bounded license expression. Local workspace links are excluded.

This is an inventory completeness check, not legal compatibility approval.
`;

class ValidationError extends Error {}

export function createDependencyLicenseInventory(lockfile) {
  if (!isPlainObject(lockfile) || lockfile.lockfileVersion !== 3) {
    throw new ValidationError("Expected a package-lock v3 object");
  }
  if (!isPlainObject(lockfile.packages)) {
    throw new ValidationError("Lockfile packages are missing");
  }

  const declarations = [];
  for (const [packagePath, entry] of Object.entries(lockfile.packages)) {
    if (!packagePath.startsWith("node_modules/")) continue;
    if (!isPlainObject(entry)) {
      throw new ValidationError("External package metadata is invalid");
    }
    if (entry.link === true) {
      const expectedWorkspaceName = packagePath.slice("node_modules/".length);
      const workspaceEntry = typeof entry.resolved === "string"
        ? lockfile.packages[entry.resolved]
        : undefined;
      if (
        !packagePath.startsWith("node_modules/@smartfarm-os/")
        || typeof entry.resolved !== "string"
        || !/^(?:apps|packages|services|tools)\/[A-Za-z0-9._/-]+$/.test(entry.resolved)
        || entry.resolved.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
        || !isPlainObject(workspaceEntry)
        || workspaceEntry.name !== expectedWorkspaceName
        || typeof workspaceEntry.version !== "string"
        || workspaceEntry.version.length === 0
      ) {
        throw new ValidationError("Local workspace link metadata is invalid");
      }
      continue;
    }
    if (!isCanonicalPackagePath(packagePath)) {
      throw new ValidationError("External package path is invalid");
    }
    if (typeof entry.version !== "string" || entry.version.length === 0 || entry.version.length > 100) {
      throw new ValidationError(`External package version is missing: ${packagePath}`);
    }
    const license = entry.license;
    if (
      typeof license !== "string"
      || !LICENSE_PATTERN.test(license)
      || license === "UNLICENSED"
      || license.startsWith("SEE LICENSE IN")
    ) {
      throw new ValidationError(`External package license is missing or unresolved: ${packagePath}`);
    }
    declarations.push(Object.freeze({ packagePath, version: entry.version, license }));
  }

  if (declarations.length === 0) {
    throw new ValidationError("No external package license declarations were found");
  }
  declarations.sort((left, right) => left.packagePath.localeCompare(right.packagePath));

  const counts = new Map();
  for (const declaration of declarations) {
    counts.set(declaration.license, (counts.get(declaration.license) ?? 0) + 1);
  }
  const licenses = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([license, count]) => Object.freeze({ license, count }));

  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    packageCount: declarations.length,
    declarations: Object.freeze(declarations),
    licenses: Object.freeze(licenses),
  });
}

export function formatInventorySummary(inventory) {
  if (
    !isPlainObject(inventory)
    || inventory.schemaVersion !== SCHEMA_VERSION
    || !Number.isInteger(inventory.packageCount)
    || inventory.packageCount < 1
    || !Array.isArray(inventory.licenses)
  ) {
    throw new ValidationError("Dependency license inventory is invalid");
  }
  const total = inventory.licenses.reduce((sum, item) => {
    if (
      !isPlainObject(item)
      || typeof item.license !== "string"
      || !Number.isInteger(item.count)
      || item.count < 1
    ) {
      throw new ValidationError("Dependency license summary is invalid");
    }
    return sum + item.count;
  }, 0);
  if (total !== inventory.packageCount) {
    throw new ValidationError("Dependency license counts do not match the package count");
  }
  const distribution = inventory.licenses
    .map(({ license, count }) => `${license} ${count}`)
    .join(", ");
  return `Dependency license declarations passed: ${inventory.packageCount} external package entries (${distribution}).`;
}

export async function runCli(args, streams = {}, options = {}) {
  const stdout = streams.stdout ?? process.stdout;
  const stderr = streams.stderr ?? process.stderr;
  if (args.length === 1 && args[0] === "--help") {
    stdout.write(HELP_TEXT);
    return 0;
  }
  if (args.length > 0) {
    stderr.write("[smartfarm-license-audit] Unknown argument\n");
    stderr.write(HELP_TEXT);
    return 2;
  }

  try {
    const readFileImpl = options.readFileImpl ?? readFile;
    const lockfilePath = options.lockfilePath ?? LOCKFILE_PATH;
    const lockfile = JSON.parse(await readFileImpl(lockfilePath, "utf8"));
    const inventory = createDependencyLicenseInventory(lockfile);
    stdout.write(`${formatInventorySummary(inventory)}\n`);
    stdout.write("This inventory does not choose the project license or approve legal compatibility.\n");
    return 0;
  } catch (error) {
    if (error instanceof SyntaxError) {
      stderr.write("[smartfarm-license-audit] Lockfile JSON is invalid\n");
      return 1;
    }
    if (error instanceof ValidationError) {
      stderr.write(`[smartfarm-license-audit] ${error.message}\n`);
      return 1;
    }
    stderr.write("[smartfarm-license-audit] Unable to verify dependency license declarations\n");
    return 1;
  }
}

function isCanonicalPackagePath(packagePath) {
  if (packagePath.includes("\\") || packagePath.includes("//")) return false;
  const segments = packagePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  return segments.some((segment) => segment === "node_modules")
    && segments.at(-1) !== "node_modules";
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli(process.argv.slice(2));
}
