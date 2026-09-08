import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("parses valid env and trims trailing slash", () => {
    const cfg = loadConfig({
      SPLITBILL_BASE_URL: "http://localhost:3000/",
      SPLITBILL_EMAIL: "agent@example.com",
      SPLITBILL_PASSWORD: "secret",
    });
    expect(cfg.SPLITBILL_BASE_URL).toBe("http://localhost:3000");
    expect(cfg.SPLITBILL_TIMEOUT_MS).toBe(15000);
    expect(cfg.LOG_LEVEL).toBe("info");
  });

  it("throws on missing password with actionable message", () => {
    expect(() =>
      loadConfig({
        SPLITBILL_BASE_URL: "http://localhost:3000",
        SPLITBILL_EMAIL: "agent@example.com",
      }),
    ).toThrow(/Invalid MCP configuration.*SPLITBILL_PASSWORD/);
  });

  it("throws on bad URL", () => {
    expect(() =>
      loadConfig({
        SPLITBILL_BASE_URL: "not-a-url",
        SPLITBILL_EMAIL: "agent@example.com",
        SPLITBILL_PASSWORD: "secret",
      }),
    ).toThrow(/Invalid MCP configuration/);
  });
});
