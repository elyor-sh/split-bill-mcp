import { describe, expect, it, vi } from "vitest";
import { SplitBillClient } from "../src/client/client.js";
import { loadConfig } from "../src/config.js";

const cfg = loadConfig({
  SPLITBILL_BASE_URL: "http://localhost:3000",
  SPLITBILL_EMAIL: "Agent@Test.ru",
  SPLITBILL_PASSWORD: "x",
});

function testClient() {
  const c = new SplitBillClient(cfg);
  (c as unknown as { request: unknown }).request = async (path: string) => {
    if (path === "/api/user/me") {
      return { user: { _id: "me-id-12345678901234", name: "Agent", email: "agent@test.ru" } };
    }
    throw new Error("unexpected request " + path);
  };
  return c;
}

describe("resolveUserId", () => {
  it("resolves own email (any case, padded) via getMeId without search", async () => {
    const c = testClient();
    const search = vi.spyOn(c, "searchUsers").mockRejectedValue(new Error("must not be called"));
    const friends = vi.spyOn(c, "listFriends").mockRejectedValue(new Error("must not be called"));
    await expect(c.resolveUserId("  AGENT@test.ru  ")).resolves.toBe("me-id-12345678901234");
    expect(search).not.toHaveBeenCalled();
    expect(friends).not.toHaveBeenCalled();
  });

  it("passes 24-hex ids through without network", async () => {
    const c = testClient();
    (c as unknown as { request: unknown }).request = async () => {
      throw new Error("must not be called");
    };
    await expect(c.resolveUserId("6aa01b6078b10f5dbaf9b302")).resolves.toBe(
      "6aa01b6078b10f5dbaf9b302",
    );
  });

  it("resolves friend via search exact match", async () => {
    const c = testClient();
    vi.spyOn(c, "searchUsers").mockResolvedValue([
      { _id: "friend-id-123456789012", name: "Friend", email: "mcp-friend@test.ru" },
    ]);
    await expect(c.resolveUserId("mcp-friend@test.ru")).resolves.toBe("friend-id-123456789012");
  });
});
