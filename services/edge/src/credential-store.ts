import { constants as fsConstants } from "node:fs";
import {
  EdgeCredentialKeySchema,
  EdgeCredentialRecordSchema,
  type EdgeCredentialKey,
  type EdgeCredentialRecord,
} from "@smartfarm-os/contracts";
import {
  chmod,
  lstat,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { ensurePrivateEdgeDirectory } from "./agent-config.js";

export const EDGE_CREDENTIAL_FILE_SCHEMA = "smartfarm.edge-local-credential.v1";

export type LocalEdgeCredentialRecord = {
  readonly schemaVersion: typeof EDGE_CREDENTIAL_FILE_SCHEMA;
  readonly credential: EdgeCredentialRecord;
  readonly edgeKey: EdgeCredentialKey;
};

export async function readEdgeCredential(path: string): Promise<LocalEdgeCredentialRecord> {
  await ensurePrivateEdgeDirectory(dirname(path));
  const status = await lstat(path);
  if (!status.isFile()) {
    throw new Error("Edge credential path must be a regular file");
  }
  assertPrivateFile(status);

  const text = await readFile(path, "utf8");
  return parseEdgeCredential(JSON.parse(text));
}

export async function writeEdgeCredential(
  path: string,
  record: LocalEdgeCredentialRecord,
): Promise<void> {
  const serialized = JSON.stringify(parseEdgeCredential(record), null, 2) + "\n";
  await ensurePrivateEdgeDirectory(dirname(path));

  const temporaryPath = join(
    dirname(path),
    `.${randomUUID()}.tmp`,
  );
  let fileHandle: Awaited<ReturnType<typeof open>> | null = null;

  try {
    fileHandle = await open(temporaryPath, "wx", 0o600);
    await fileHandle.writeFile(serialized, "utf8");
    await fileHandle.sync();
    await fileHandle.close();
    fileHandle = null;
    if (process.platform !== "win32") {
      await chmod(temporaryPath, 0o600);
    }
    await rename(temporaryPath, path);
    await syncParentDirectory(dirname(path));
  } catch (error) {
    if (fileHandle !== null) {
      await fileHandle.close().catch(() => undefined);
    }
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function credentialStatus(path: string): Promise<{
  readonly exists: boolean;
  readonly issuedAt: string | null;
  readonly mode: number | null;
}> {
  try {
    await ensurePrivateEdgeDirectory(dirname(path));
    const fileStatus = await lstat(path);
    assertPrivateFile(fileStatus);
    const record = await readEdgeCredential(path);
    return {
      exists: true,
      issuedAt: record.credential.createdAt,
      mode: fileStatus.mode & 0o777,
    };
  } catch (error) {
    if (isFileNotFound(error)) {
      return { exists: false, issuedAt: null, mode: null };
    }
    throw error;
  }
}

export function parseEdgeCredential(input: unknown): LocalEdgeCredentialRecord {
  if (!isRecord(input)) {
    throw new Error("Edge credential record must be a JSON object");
  }
  if (input.schemaVersion !== EDGE_CREDENTIAL_FILE_SCHEMA) {
    throw new Error("Edge credential schemaVersion is invalid");
  }
  const credential = EdgeCredentialRecordSchema.parse(input.credential);
  const edgeKey = EdgeCredentialKeySchema.parse(input.edgeKey);
  if (credential.status !== "active") {
    throw new Error("Stored Edge credential must be active when installed");
  }
  if (edgeKey.slice(0, edgeKey.indexOf(".")) !== credential.id) {
    throw new Error("Stored Edge credential and key IDs do not match");
  }
  return {
    schemaVersion: EDGE_CREDENTIAL_FILE_SCHEMA,
    credential,
    edgeKey,
  };
}

function assertPrivateFile(status: {
  readonly mode: number;
  readonly uid: number;
}): void {
  if (process.platform === "win32") return;
  if ((status.mode & 0o077) !== 0) {
    throw new Error("Edge credential file permissions must not grant group or other access");
  }
  const currentUserId = process.getuid?.();
  if (currentUserId !== undefined && status.uid !== currentUserId) {
    throw new Error("Edge credential file must be owned by the current service account");
  }
}

async function syncParentDirectory(path: string): Promise<void> {
  if (process.platform === "win32") return;
  const directory = await open(path, fsConstants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function isFileNotFound(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT";
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null;
}
