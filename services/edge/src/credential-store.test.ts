import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EdgeCredentialRecordSchema } from "@smartfarm-os/contracts";
import {
  EDGE_CREDENTIAL_FILE_SCHEMA,
  credentialStatus,
  parseEdgeCredential,
  readEdgeCredential,
  writeEdgeCredential,
} from "./credential-store.js";

const opaqueSecret = "a".repeat(43);

function credentialKey(id = "edge-credential:demo-edge"): string {
  return `${id}.${opaqueSecret}`;
}

function credentialRecord(id = "edge-credential:demo-edge") {
  return EdgeCredentialRecordSchema.parse({
    schemaVersion: "smartfarm.edge-credential-record.v1",
    id,
    farmId: "farm:demo",
    deviceId: "device:bed-1",
    status: "active",
    createdFromEnrollmentId: "gateway-enrollment:demo-enroll",
    createdAt: "2026-08-12T00:00:00.000Z",
    revokedAt: null,
    revokedByActorId: null,
  });
}

test("writes a credential file atomically with private permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-edge-credential-"));
  try {
    const credentialPath = join(directory, "credential.json");
    await writeEdgeCredential(credentialPath, {
      schemaVersion: EDGE_CREDENTIAL_FILE_SCHEMA,
      credential: credentialRecord(),
      edgeKey: credentialKey(),
    });

    const loaded = await readEdgeCredential(credentialPath);
    const fileStatus = await stat(credentialPath);
    assert.equal(loaded.credential.id, "edge-credential:demo-edge");
    assert.equal(loaded.edgeKey, credentialKey());
    assert.equal(fileStatus.isFile(), true);
    if (process.platform !== "win32") {
      assert.equal(fileStatus.mode & 0o777, 0o600);
    }
    assert.equal((await credentialStatus(credentialPath)).exists, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("overwrites through rename without leaving a partial file behind", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-edge-credential-rewrite-"));
  try {
    const credentialPath = join(directory, "credential.json");
    await writeEdgeCredential(credentialPath, {
      schemaVersion: EDGE_CREDENTIAL_FILE_SCHEMA,
      credential: credentialRecord(),
      edgeKey: credentialKey(),
    });
    await writeEdgeCredential(credentialPath, {
      schemaVersion: EDGE_CREDENTIAL_FILE_SCHEMA,
      credential: credentialRecord("edge-credential:demo-edge-2"),
      edgeKey: credentialKey("edge-credential:demo-edge-2"),
    });

    const text = await readFile(credentialPath, "utf8");
    assert.equal(text.includes("edge-credential:demo-edge-2"), true);
    assert.equal(text.includes("\"edge-credential:demo-edge\""), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects too-open credential permissions on POSIX", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-edge-credential-mode-"));
  try {
    const credentialPath = join(directory, "credential.json");
    await writeEdgeCredential(credentialPath, {
      schemaVersion: EDGE_CREDENTIAL_FILE_SCHEMA,
      credential: credentialRecord(),
      edgeKey: credentialKey(),
    });

    if (process.platform !== "win32") {
      await chmod(credentialPath, 0o644);
      await assert.rejects(readEdgeCredential(credentialPath), /must not grant group or other access/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("parses only the expected credential schema", () => {
  assert.equal(parseEdgeCredential({
    schemaVersion: EDGE_CREDENTIAL_FILE_SCHEMA,
    credential: credentialRecord(),
    edgeKey: credentialKey(),
  }).credential.id, "edge-credential:demo-edge");

  assert.throws(
    () => parseEdgeCredential({
      schemaVersion: "unexpected",
      credential: credentialRecord(),
      edgeKey: credentialKey(),
    }),
    /schemaVersion is invalid/,
  );
  assert.throws(
    () => parseEdgeCredential({
      schemaVersion: EDGE_CREDENTIAL_FILE_SCHEMA,
      credential: credentialRecord(),
      edgeKey: credentialKey("edge-credential:other-edge"),
    }),
    /key IDs do not match/,
  );
  assert.throws(
    () => parseEdgeCredential({
      schemaVersion: EDGE_CREDENTIAL_FILE_SCHEMA,
      credential: {
        ...credentialRecord(),
        status: "revoked",
        revokedAt: "2026-08-12T00:01:00.000Z",
        revokedByActorId: "admin:demo",
      },
      edgeKey: credentialKey(),
    }),
    /must be active/,
  );
});

test("reports missing credential status without throwing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "smartfarm-edge-credential-status-"));
  try {
    assert.deepEqual(
      await credentialStatus(join(directory, "missing.json")),
      { exists: false, issuedAt: null, mode: null },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
