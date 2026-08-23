import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  EDGE_PASSWORD_USER_ALLOWLIST,
  assertAllowedPasswordUser,
  createSpawnSystemAccountPort,
  type SpawnLike,
} from "./system-account.js";

class FakeChild extends EventEmitter {
  readonly stderrChunks: string[];
  stdinWrites = "";
  readonly stdin = {
    write: (chunk: string) => {
      this.stdinWrites += chunk;
    },
    end: () => undefined,
  };
  readonly stderr: AsyncIterable<string>;

  constructor(
    private readonly closeCode: number | null,
    stderrChunks: string[] = [],
  ) {
    super();
    this.stderrChunks = stderrChunks;
    this.stderr = {
      [Symbol.asyncIterator]: async function* iterator(this: FakeChild) {
        yield* this.stderrChunks;
      }.bind(this),
    };
  }

  start(): void {
    queueMicrotask(() => {
      this.emit("close", this.closeCode);
    });
  }
}

test("writes only username and password to chpasswd stdin without a shell", async () => {
  let seenCommand = "";
  let seenOptions: { readonly shell: boolean; readonly stdio: readonly ("ignore" | "pipe")[] } | null = null;
  let stdinWrites = "";
  const spawn: SpawnLike = (command, _args, options) => {
    seenCommand = command;
    seenOptions = options;
    const child = new FakeChild(0);
    const originalWrite = child.stdin.write;
    child.stdin.write = (chunk: string) => {
      stdinWrites += chunk;
      originalWrite(chunk);
    };
    child.start();
    return child;
  };

  await createSpawnSystemAccountPort({ spawn }).changePassword("pi", "good-pass-01");

  assert.equal(seenCommand, "/usr/sbin/chpasswd");
  assert.deepEqual(seenOptions, {
    shell: false,
    stdio: ["pipe", "ignore", "pipe"],
  });
  assert.equal(stdinWrites, "pi:good-pass-01\n");
});

test("rejects disallowed users and surfaces sanitized process failures", async () => {
  assert.throws(() => assertAllowedPasswordUser("root"), /restricted to/);
  const port = createSpawnSystemAccountPort({
    spawn: () => {
      const child = new FakeChild(1, ["permission denied"]);
      child.start();
      return child;
    },
  });

  await assert.rejects(
    port.changePassword(EDGE_PASSWORD_USER_ALLOWLIST[0], "good-pass-01"),
    /Password change command failed/,
  );
});

test("rejects weak or line-breaking password values before spawning", async () => {
  let spawned = false;
  const port = createSpawnSystemAccountPort({
    spawn: () => {
      spawned = true;
      const child = new FakeChild(0);
      child.start();
      return child;
    },
  });

  await assert.rejects(port.changePassword("pi", "short-pass"), /at least 12/);
  await assert.rejects(port.changePassword("pi", "            "), /non-whitespace/);
  await assert.rejects(port.changePassword("pi", "long-pass-word\n"), /unsupported/);
  assert.equal(spawned, false);
});
