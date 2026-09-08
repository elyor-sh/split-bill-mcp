import type {
  BillItemInput,
  ComputedParticipant,
  ReadyParticipantInput,
  ReceiptItemInput,
} from "../types.js";

export const toCents = (n: number): number => Math.round(n * 100);
export const toUnits = (cents: number): number => Math.round(cents) / 100;

export function splitPosition(
  price: number,
  consumers: string[],
  portions?: number[],
): Map<string, number> {
  if (consumers.length === 0) throw new Error("Position must have at least one consumer");
  const weights = portions ?? consumers.map(() => 1);
  if (weights.length !== consumers.length) {
    throw new Error("portions length must match consumers length");
  }
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (!(totalWeight > 0)) throw new Error("Total portions must be positive");
  const totalCents = toCents(price);
  const shares = new Map<string, number>();
  let assigned = 0;
  consumers.forEach((c, i) => {
    const floor = Math.floor((totalCents * weights[i]) / totalWeight);
    shares.set(c, (shares.get(c) ?? 0) + floor);
    assigned += floor;
  });
  let rest = totalCents - assigned;
  let i = 0;
  while (rest > 0) {
    const c = consumers[i % consumers.length];
    shares.set(c, (shares.get(c) ?? 0) + 1);
    rest -= 1;
    i += 1;
  }
  return shares;
}

function scaleVat(
  item: BillItemInput,
  ratio: number,
): Pick<BillItemInput, "priceWithVat" | "vat"> {
  if (item.priceWithVat === undefined) return {};
  return {
    priceWithVat: toUnits(Math.round(toCents(item.priceWithVat) * ratio)),
    ...(item.vat !== undefined ? { vat: item.vat } : {}),
  };
}

export function splitReceiptItems(items: ReceiptItemInput[]): ComputedParticipant[] {
  const byUser = new Map<string, { items: BillItemInput[]; cents: number }>();
  for (const item of items) {
    const shares = splitPosition(item.price, item.consumers, item.portions);
    const itemCents = toCents(item.price);
    for (const [user, cents] of shares) {
      const entry = byUser.get(user) ?? { items: [], cents: 0 };
      const ratio = itemCents === 0 ? 0 : cents / itemCents;
      entry.items.push({
        name: item.name,
        price: toUnits(cents),
        ...scaleVat(item, ratio),
      });
      entry.cents += cents;
      byUser.set(user, entry);
    }
  }
  return [...byUser.entries()].map(([user, e]) => ({
    user,
    items: e.items,
    totalSum: toUnits(e.cents),
  }));
}

export function verifyReadySplit(
  participants: ReadyParticipantInput[],
): { ok: true; total: number } | { ok: false; message: string } {
  let totalCents = 0;
  for (const p of participants) {
    const itemsCents = p.items.reduce((a, it) => a + toCents(it.price), 0);
    const declared = toCents(p.totalSum);
    if (itemsCents !== declared) {
      return {
        ok: false,
        message: `Participant '${p.user}': items sum ${toUnits(itemsCents).toFixed(2)} != declared totalSum ${toUnits(declared).toFixed(2)}`,
      };
    }
    totalCents += declared;
  }
  return { ok: true, total: toUnits(totalCents) };
}
