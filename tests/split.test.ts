import { describe, expect, it } from "vitest";
import {
  splitPosition,
  splitReceiptItems,
  toCents,
  toUnits,
  verifyReadySplit,
} from "../src/logic/split.js";

describe("toCents/toUnits", () => {
  it("converts without float drift", () => {
    expect(toCents(45.5)).toBe(4550);
    expect(toUnits(4550)).toBe(45.5);
  });
});

describe("splitPosition", () => {
  it("splits equally", () => {
    const shares = splitPosition(1200, ["a", "b", "c"]);
    expect([...shares.values()].sort()).toEqual([40000, 40000, 40000]);
  });

  it("assigns remainder cents to first consumers", () => {
    const shares = splitPosition(100, ["a", "b", "c"]);
    expect(shares.get("a")).toBe(3334);
    expect(shares.get("b")).toBe(3333);
    expect(shares.get("c")).toBe(3333);
  });

  it("splits by portions", () => {
    const shares = splitPosition(100, ["a", "b"], [3, 1]);
    expect(shares.get("a")).toBe(7500);
    expect(shares.get("b")).toBe(2500);
  });

  it("throws on empty consumers", () => {
    expect(() => splitPosition(100, [])).toThrow(/at least one consumer/);
  });
});

describe("splitReceiptItems", () => {
  it("aggregates per-user totals with invariant", () => {
    const out = splitReceiptItems([
      { name: "Pizza", price: 1200, consumers: ["a@x", "b@x"] },
      { name: "Tea", price: 300, consumers: ["a@x"] },
    ]);
    const total = out.reduce((s, p) => s + toCents(p.totalSum), 0);
    expect(total).toBe(toCents(1500));
    expect(out.find((p) => p.user === "a@x")!.totalSum).toBe(900);
    expect(out.find((p) => p.user === "b@x")!.totalSum).toBe(600);
  });
});

describe("verifyReadySplit", () => {
  it("accepts matching sums", () => {
    expect(
      verifyReadySplit([
        { user: "a", items: [{ name: "X", price: 400 }], totalSum: 400 },
      ]),
    ).toEqual({ ok: true, total: 400 });
  });

  it("rejects mismatch above 1 cent", () => {
    const res = verifyReadySplit([
      { user: "ann@x", items: [{ name: "Pizza", price: 400 }], totalSum: 399 },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/ann@x/);
  });
});
