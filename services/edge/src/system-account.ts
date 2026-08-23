import { spawn as nodeSpawn } from "node:child_process";

export const EDGE_PASSWORD_USER_ALLOWLIST = ["pi", "smartfarm", "smartfarm-edge"] as const;

export interface SystemAccountPort {
  changePassword(username: string, newPassword: string): Promise<void>;
}

export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: {
    readonly shell: boolean;
    readonly stdio: ["pipe", "ignore", "pipe"];
  },
) => {
  readonly stdin: {
    write(chunk: string): void;
    end(): void;
  } | null;
  readonly stderr: AsyncIterable<Buffer | string> | null;
  readonly on: (event: "error", listener: (error: Error) => void) => void;
  readonly once: (event: "close", listener: (code: number | null) => void) => void;
};

export type SpawnSystemAccountPortOptions = {
  readonly commandPath?: string;
  readonly spawn?: SpawnLike;
};

export function createSpawnSystemAccountPort(
  options: SpawnSystemAccountPortOptions = {},
): SystemAccountPort {
  const commandPath = options.commandPath ?? "/usr/sbin/chpasswd";
  const spawn = options.spawn ?? defaultSpawn;

  return {
    async changePassword(username: string, newPassword: string): Promise<void> {
      assertAllowedPasswordUser(username);
      assertPasswordValue(newPassword);

      await new Promise<void>((resolve, reject) => {
        const child = spawn(commandPath, [], {
          shell: false,
          stdio: ["pipe", "ignore", "pipe"],
        });
        let settled = false;
        let stderr = "";

        const fail = (message: string): void => {
          if (settled) return;
          settled = true;
          reject(new Error(message));
        };
        const succeed = (): void => {
          if (settled) return;
          settled = true;
          resolve();
        };

        child.on("error", () => {
          fail("Password change command could not be started");
        });
        child.once("close", (code) => {
          if (code === 0) {
            succeed();
            return;
          }
          fail(stderr.trim() === ""
            ? "Password change command failed"
            : "Password change command failed with a system error");
        });

        void (async () => {
          if (child.stderr === null) return;
          for await (const chunk of child.stderr) {
            stderr += String(chunk);
          }
        })().catch(() => undefined);

        if (child.stdin === null) {
          fail("Password change command did not expose stdin");
          return;
        }
        child.stdin.write(`${username}:${newPassword}\n`);
        child.stdin.end();
      });
    },
  };
}

export function assertAllowedPasswordUser(username: string): void {
  if (!EDGE_PASSWORD_USER_ALLOWLIST.includes(username as typeof EDGE_PASSWORD_USER_ALLOWLIST[number])) {
    throw new Error(`Password changes are restricted to: ${EDGE_PASSWORD_USER_ALLOWLIST.join(", ")}`);
  }
}

function assertPasswordValue(newPassword: string): void {
  if (newPassword.length < 12) {
    throw new Error("Password must be at least 12 characters long");
  }
  if (newPassword.trim() === "") {
    throw new Error("Password must contain a non-whitespace character");
  }
  if (newPassword.includes("\n") || newPassword.includes("\r") || newPassword.includes(":")) {
    throw new Error("Password contains unsupported characters");
  }
}

function defaultSpawn(
  command: string,
  args: readonly string[],
  options: {
    readonly shell: boolean;
    readonly stdio: ["pipe", "ignore", "pipe"];
  },
): ReturnType<SpawnLike> {
  return nodeSpawn(command, args, options);
}
