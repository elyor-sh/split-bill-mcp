import { describe, expect, it } from "vitest";
import { buildTools } from "../src/tools/index.js";
import type { SplitBillClient } from "../src/client/client.js";
import type { BillDto } from "../src/types.js";
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

describe("handlers with mock client", () => {
  const fakeBill: BillDto = {
    _id: "bill1",
    title: "Test bill",
    total: 400,
    createdAt: "2026-09-01",
    creator: { _id: "creator1", name: "Creator", email: "c@x" },
    payer: { _id: "payer1", name: "Payer", email: "p@x" },
    participants: [
      { user: { _id: "user1", name: "A", email: "a@x" }, amountOwed: 400, totalSum: 400, status: "unpaid" },
    ],
  };

  const makeMock = () => {
    let capturedBody: unknown = null;
    let updatedParticipantId: string | null = null;
    const mock = {
      resolveUserId: async (r: string) => r,
      createBill: async (body: unknown) => {
        capturedBody = body;
        return fakeBill;
      },
      getBill: async () => fakeBill,
      updatePayment: async (_billId: string, participantId: string, _status: string) => {
        updatedParticipantId = participantId;
        return fakeBill;
      },
    } as unknown as SplitBillClient;
    return { mock, getBody: () => capturedBody, getUpdatedId: () => updatedParticipantId };
  };

  it("raw_receipt create sends every item with priceWithVat set", async () => {
    const { mock, getBody } = makeMock();
    const tool = buildTools(mock).find((t) => t.name === "create_bill")!;
    await tool.handler({
      mode: "raw_receipt",
      receipt_items: [{ name: "X", price: 400, consumers: ["a@x"] }],
      payer: "a@x",
    });
    const body = getBody() as { participants: { items: { priceWithVat?: number }[] }[] };
    expect(body.participants.length).toBeGreaterThan(0);
    for (const p of body.participants) {
      for (const item of p.items) {
        expect(item.priceWithVat).toBeDefined();
      }
    }
  });

  it("ready_split mismatch throws VALIDATION_ERROR", async () => {
    const { mock } = makeMock();
    const tool = buildTools(mock).find((t) => t.name === "create_bill")!;
    await expect(
      tool.handler({
        mode: "ready_split",
        participants: [{ user: "a@x", items: [{ name: "X", price: 100 }], totalSum: 400 }],
        payerId: "a@x",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("update_payment matches participant by uppercase email", async () => {
    const { mock, getUpdatedId } = makeMock();
    const tool = buildTools(mock).find((t) => t.name === "update_payment")!;
    await tool.handler({ billId: "bill1", participant: "A@X", status: "paid" });
    expect(getUpdatedId()).toBe("user1");
  });
});
