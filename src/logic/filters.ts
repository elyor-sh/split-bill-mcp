import type { BillAggregateStatus, ParticipantStatus } from "../types.js";

export type { BillAggregateStatus, ParticipantStatus };

export interface BillLike {
  _id: string;
  title: string;
  total: number;
  createdAt: string;
  creator: { _id: string } | string;
  payer?: { _id: string } | string | null;
  participants: { user: { _id: string } | string; status: ParticipantStatus }[];
}

export interface BillFilter {
  status?: "all" | BillAggregateStatus;
  role?: "all" | "creator" | "payer" | "debtor";
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

const idOf = (ref: { _id: string } | string): string =>
  typeof ref === "string" ? ref : ref._id;

export function aggregateBillStatus(
  participants: { status: ParticipantStatus }[],
): BillAggregateStatus {
  const set = new Set(participants.map((p) => p.status));
  if (set.size === 1) return participants[0].status;
  return "partial";
}

export function filterBills<T extends BillLike>(bills: T[], selfId: string, f: BillFilter): T[] {
  return bills.filter((b) => {
    if (f.status && f.status !== "all" && aggregateBillStatus(b.participants) !== f.status) {
      return false;
    }
    if (f.role && f.role !== "all") {
      if (f.role === "creator" && idOf(b.creator) !== selfId) return false;
      if (f.role === "payer" && (!b.payer || idOf(b.payer) !== selfId)) return false;
      if (
        f.role === "debtor" &&
        !b.participants.some((p) => idOf(p.user) === selfId && p.status !== "paid")
      ) {
        return false;
      }
    }
    if (f.search && !b.title.toLowerCase().includes(f.search.toLowerCase())) return false;
    const created = new Date(b.createdAt).getTime();
    if (f.dateFrom && created < new Date(f.dateFrom).getTime()) return false;
    if (f.dateTo && created > new Date(f.dateTo).getTime()) return false;
    return true;
  });
}

export function paginate<T>(
  list: T[],
  page: number,
  limit: number,
): { items: T[]; total: number; page: number; limit: number; hasMore: boolean } {
  const p = Math.max(1, Math.floor(page) || 1);
  const l = Math.max(1, Math.min(100, Math.floor(limit) || 10));
  const start = (p - 1) * l;
  return {
    items: list.slice(start, start + l),
    total: list.length,
    page: p,
    limit: l,
    hasMore: start + l < list.length,
  };
}

export function groupByStatus(bills: BillLike[]): Record<BillAggregateStatus, number> {
  const groups: Record<BillAggregateStatus, number> = {
    paid: 0,
    unpaid: 0,
    pending_confirmation: 0,
    partial: 0,
  };
  for (const b of bills) groups[aggregateBillStatus(b.participants)] += 1;
  return groups;
}
