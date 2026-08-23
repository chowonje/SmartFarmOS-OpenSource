import { describe, expect, it } from "vitest";
import { resolveAdminConsoleUrl } from "./admin-console";

const loopbackLocation = {
  hostname: "127.0.0.1",
  origin: "http://127.0.0.1:5173",
  port: "5173",
  protocol: "http:",
};

describe("resolveAdminConsoleUrl", () => {
  it("derives the adjacent local admin port for the local demo", () => {
    expect(resolveAdminConsoleUrl(undefined, loopbackLocation)).toBe("http://127.0.0.1:5174");
  });

  it("accepts HTTPS and loopback HTTP admin locations", () => {
    expect(resolveAdminConsoleUrl("https://admin.smartfarm.example", loopbackLocation))
      .toBe("https://admin.smartfarm.example");
    expect(resolveAdminConsoleUrl("http://localhost:5174", loopbackLocation))
      .toBe("http://localhost:5174");
  });

  it("accepts a same-origin path for a reverse-proxy deployment", () => {
    const httpsLocation = {
      hostname: "farm.example",
      origin: "https://farm.example",
      port: "",
      protocol: "https:",
    };

    expect(resolveAdminConsoleUrl("/admin", httpsLocation)).toBe("https://farm.example/admin");
  });

  it("rejects insecure remote, credential-bearing, and script URLs", () => {
    expect(resolveAdminConsoleUrl("http://farm.example/admin", loopbackLocation)).toBeNull();
    expect(resolveAdminConsoleUrl("https://name:secret@farm.example", loopbackLocation)).toBeNull();
    expect(resolveAdminConsoleUrl("javascript:alert(1)", loopbackLocation)).toBeNull();
    expect(resolveAdminConsoleUrl("https://farm.example/admin?token=secret", loopbackLocation)).toBeNull();
  });

  it("does not guess an admin address on a deployed hostname", () => {
    expect(resolveAdminConsoleUrl(undefined, {
      hostname: "farm.example",
      origin: "https://farm.example",
      port: "",
      protocol: "https:",
    })).toBeNull();
  });
});
