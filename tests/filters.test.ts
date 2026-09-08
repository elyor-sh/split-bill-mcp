import { describe, expect, it } from "vitest";
import {
  aggregateBillStatus,
  filterBills,
  groupByStatus,
  paginate,
  type BillLike,
} from "../src/logic/filters.js";

const ME = "me-id";
const bill = (over: Partial<BillLike> = {}): BillLike => ({
  _id: "b1",
  title: "Dinner",
  total: 100,
  createdAt: "2026-09-01T10:00:00.000Z",
  creator: { _id: ME },
  payer: { _id: "p1" },
  participants: [
    { user: { _id: ME }, status: "unpaid" },
    { user: { _id: "p1" }, status: "paid" },
  ],
  ...over,
});

describe("aggregateBillStatus", () => {
  it("returns partial for mixed statuses", () => {
    expect(
      aggregateBillStatus([{ status: "paid" }, { status: "unpaid" }]),
    ).toBe("partial");
  });
  it("returns single status when uniform", () => {
    expect(aggregateBillStatus([{ status: "paid" }, { status: "paid" }])).toBe("paid");
  });
});

describe("filterBills", () => {
  const bills = [
    bill({ _id: "b1", title: "Dinner out" }),
    bill({
      _id: "b2",
      title: "Taxi",
      creator: { _id: "other" },
      participants: [{ user: { _id: ME }, status: "paid" }],
    }),
  ];
  it("filters by role debtor", () => {
    expect(filterBills(bills, ME, { role: "debtor" }).map((b) => b._id)).toEqual(["b1"]);
  });
  it("filters by search substring case-insensitively", () => {
    expect(filterBills(bills, ME, { search: "tax" }).map((b) => b._id)).toEqual(["b2"]);
  });
  it("filters by status paid", () => {
    expect(filterBills(bills, ME, { status: "paid" }).map((b) => b._id)).toEqual(["b2"]);
  });
});

describe("paginate + groupByStatus", () => {
  it("slices pages and reports hasMore", () => {
    const r = paginate([1, 2, 3], 1, 2);
    expect(r).toEqual({ items: [1, 2], total: 3, page: 1, limit: 2, hasMore: true });
  });
  it("groups mixed bills", () => {
    const g = groupByStatus([
      bill(),
      bill({ participants: [{ user: { _id: ME }, status: "paid" }] }),
    ]);
    expect(g).toEqual({ paid: 1, unpaid: 0, pending_confirmation: 0, partial: 1 });
  });
});
