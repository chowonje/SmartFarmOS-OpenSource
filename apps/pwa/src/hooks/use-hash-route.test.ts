import { describe, expect, it } from "vitest";
import { APP_ROUTES } from "../modules/web-module-registry";
import { parseHashRoute } from "./use-hash-route";

describe("parseHashRoute", () => {
  it("accepts supported deep links", () => {
    expect(parseHashRoute("#overview", APP_ROUTES)).toBe("overview");
    expect(parseHashRoute("#crops", APP_ROUTES)).toBe("crops");
    expect(parseHashRoute("#control", APP_ROUTES)).toBe("control");
    expect(parseHashRoute("#weather", APP_ROUTES)).toBe("weather");
    expect(parseHashRoute("#environment", APP_ROUTES)).toBe("environment");
    expect(parseHashRoute("#settings", APP_ROUTES)).toBe("settings");
  });

  it("falls back to overview for unsupported hashes", () => {
    expect(parseHashRoute("#unknown", APP_ROUTES)).toBe("overview");
    expect(parseHashRoute("", APP_ROUTES)).toBe("overview");
  });
});
