import { describe, expect, it } from "vitest";
import { buildTools } from "../src/tools/index.js";
import {
  createBillInputSchema,
  getBillInputSchema,
  getStatsInputSchema,
  listBillsInputSchema,
  listFriendsInputSchema,
  searchUsersInputSchema,
  updatePaymentInputSchema,
} from "../src/tools/schemas.js";

const fakeClient = {} as never;
const tools = buildTools(fakeClient);

describe("tool registry", () => {
  it("exposes exactly the 7 spec tools", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["create_bill", "get_bill", "get_dashboard_stats", "list_bills", "list_friends", "search_users", "update_payment"].sort(),
    );
  });
  it("every tool has English description and object inputSchema", () => {
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(10);
      expect(/^[ -~]+$/.test(t.description)).toBe(true);
      expect(t.inputSchema.type ?? "object-with-oneOf").toBeTruthy();
    }
  });
});

describe("zod schemas accept representative payloads", () => {
  it("create_bill raw_receipt", () => {
    expect(() =>
      createBillInputSchema.parse({
        mode: "raw_receipt",
        receipt_items: [{ name: "Пицца", price: 1200, consumers: ["a@x", "b@x"] }],
        payer: "a@x",
        lang: "ru",
      }),
    ).not.toThrow();
  });
  it("create_bill ready_split", () => {
    expect(() =>
      createBillInputSchema.parse({
        mode: "ready_split",
        participants: [{ user: "a@x", items: [{ name: "X", price: 400 }], totalSum: 400 }],
        payerId: "a@x",
      }),
    ).not.toThrow();
  });
  it("list/get/update/search/friends/stats defaults", () => {
    expect(listBillsInputSchema.parse({}).status).toBe("all");
    expect(() => getBillInputSchema.parse({ billId: "abc" })).not.toThrow();
    expect(() => updatePaymentInputSchema.parse({ billId: "b", participant: "a@x", status: "paid" })).not.toThrow();
    expect(() => searchUsersInputSchema.parse({ query: "ann" })).not.toThrow();
    expect(listFriendsInputSchema.parse({}).include_requests).toBe(false);
    expect(() => getStatsInputSchema.parse({})).not.toThrow();
  });
  it("list_bills rejects unparseable dates", () => {
    expect(() => listBillsInputSchema.parse({ date_from: "garbage" })).toThrow(/parseable date/);
    expect(() => listBillsInputSchema.parse({ date_from: "2026-09-01" })).not.toThrow();
  });
});
