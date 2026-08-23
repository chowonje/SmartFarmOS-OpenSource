import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createDependencyLicenseInventory,
  formatInventorySummary,
  runCli,
} from "./verify-dependency-licenses.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("collects external declarations and excludes local workspace links", () => {
  const inventory = createDependencyLicenseInventory({
    lockfileVersion: 3,
    packages: {
      "": { name: "fixture" },
      "node_modules/@smartfarm-os/local": { resolved: "packages/local", link: true },
      "node_modules/alpha": { version: "1.0.0", license: "MIT" },
      "node_modules/alpha/node_modules/beta": { version: "2.0.0", license: "Apache-2.0" },
      "packages/local": { name: "@smartfarm-os/local", version: "0.1.0" },
    },
  });
  assert.equal(inventory.packageCount, 2);
  assert.deepEqual(inventory.declarations, [
    { packagePath: "node_modules/alpha", version: "1.0.0", license: "MIT" },
    {
      packagePath: "node_modules/alpha/node_modules/beta",
      version: "2.0.0",
      license: "Apache-2.0",
    },
  ]);
  assert.deepEqual(inventory.licenses, [
    { license: "Apache-2.0", count: 1 },
    { license: "MIT", count: 1 },
  ]);
});

test("rejects malformed lockfiles and missing external declarations", () => {
  assert.throws(() => createDependencyLicenseInventory(null), /package-lock v3/);
  assert.throws(
    () => createDependencyLicenseInventory({ lockfileVersion: 2, packages: {} }),
    /package-lock v3/,
  );
  assert.throws(
    () => createDependencyLicenseInventory({ lockfileVersion: 3, packages: {} }),
    /No external package/,
  );
  assert.throws(
    () => createDependencyLicenseInventory({
      lockfileVersion: 3,
      packages: { "node_modules/example": { version: "1.0.0" } },
    }),
    /license is missing or unresolved/,
  );
});

test("rejects unresolved, unsafe, or incomplete external metadata", () => {
  for (const license of ["UNLICENSED", "SEE LICENSE IN LICENSE", "MIT\nsecret"]) {
    assert.throws(
      () => createDependencyLicenseInventory({
        lockfileVersion: 3,
        packages: { "node_modules/example": { version: "1.0.0", license } },
      }),
      /license is missing or unresolved/,
    );
  }
  assert.throws(
    () => createDependencyLicenseInventory({
      lockfileVersion: 3,
      packages: { "node_modules/example": { license: "MIT" } },
    }),
    /version is missing/,
  );
  assert.throws(
    () => createDependencyLicenseInventory({
      lockfileVersion: 3,
      packages: { "node_modules/../example": { version: "1.0.0", license: "MIT" } },
    }),
    /path is invalid/,
  );
  assert.throws(
    () => createDependencyLicenseInventory({
      lockfileVersion: 3,
      packages: {
        "node_modules/external-link": { resolved: "../outside", link: true },
      },
    }),
    /workspace link metadata is invalid/,
  );
  assert.throws(
    () => createDependencyLicenseInventory({
      lockfileVersion: 3,
      packages: {
        "node_modules/@smartfarm-os/fake": { resolved: "packages/fake", link: true },
        "packages/fake": { name: "@smartfarm-os/different", version: "0.1.0" },
      },
    }),
    /workspace link metadata is invalid/,
  );
});

test("formats deterministic counts and keeps CLI failures sanitized", async () => {
  const inventory = createDependencyLicenseInventory({
    lockfileVersion: 3,
    packages: {
      "node_modules/zeta": { version: "1.0.0", license: "MIT" },
      "node_modules/alpha": { version: "1.0.0", license: "Apache-2.0" },
    },
  });
  assert.equal(
    formatInventorySummary(inventory),
    "Dependency license declarations passed: 2 external package entries (Apache-2.0 1, MIT 1).",
  );

  const stdout = createStream();
  const stderr = createStream();
  assert.equal(await runCli(["--help"], { stdout, stderr }), 0);
  assert.match(stdout.value, /not legal compatibility approval/);
  assert.equal(await runCli(["--raw"], { stdout: createStream(), stderr }), 2);
  assert.match(stderr.value, /Unknown argument/);

  stderr.value = "";
  assert.equal(await runCli([], { stdout: createStream(), stderr }, {
    readFileImpl: async () => "not-json",
    lockfilePath: "/private/path/package-lock.json",
  }), 1);
  assert.equal(stderr.value, "[smartfarm-license-audit] Lockfile JSON is invalid\n");
  assert.equal(stderr.value.includes("/private/path"), false);
});

test("current lockfile has the reviewed complete external license distribution", async () => {
  const lockfile = JSON.parse(await readFile(join(repositoryRoot, "package-lock.json"), "utf8"));
  const inventory = createDependencyLicenseInventory(lockfile);
  assert.equal(inventory.packageCount, 155);
  assert.deepEqual(inventory.licenses, [
    { license: "0BSD", count: 1 },
    { license: "Apache-2.0", count: 23 },
    { license: "BSD-3-Clause", count: 5 },
    { license: "ISC", count: 5 },
    { license: "MIT", count: 109 },
    { license: "MPL-2.0", count: 12 },
  ]);
});

function createStream() {
  return {
    value: "",
    write(chunk) {
      this.value += String(chunk);
    },
  };
}
