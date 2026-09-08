import type { BillAggregateStatus, BillDto } from "../types.js";
import { toUnits } from "../logic/split.js";

export const summaryLang = (lang?: string): "ru" | "en" =>
  (lang ?? "en").toLowerCase().startsWith("ru") ? "ru" : "en";

const money = (n: number): string => toUnits(n * 100).toFixed(2);

export function billCreatedSummary(bill: BillDto, lang?: string): string {
  const per = bill.participants
    .map((p) => `${p.user.name}: ${money(p.totalSum ?? p.amountOwed)} (${p.status})`)
    .join(", ");
  return summaryLang(lang) === "ru"
    ? `Счёт «${bill.title}» создан: итого ${money(bill.total)}, ${bill.participants.length} уч. — ${per}. ID: ${bill._id}`
    : `Bill '${bill.title}' created: total ${money(bill.total)}, ${bill.participants.length} participants — ${per}. ID: ${bill._id}`;
}

export function billsListedSummary(
  total: number,
  groups: Record<BillAggregateStatus, number>,
  lang?: string,
): string {
  const g = `paid ${groups.paid}, unpaid ${groups.unpaid}, pending ${groups.pending_confirmation}, partial ${groups.partial}`;
  return summaryLang(lang) === "ru"
    ? `Найдено счетов: ${total} (${g})`
    : `Found ${total} bills (${g})`;
}

export function paymentUpdatedSummary(
  title: string,
  name: string,
  status: string,
  lang?: string,
): string {
  return summaryLang(lang) === "ru"
    ? `Счёт «${title}»: ${name} → ${status}`
    : `Bill '${title}': ${name} → ${status}`;
}
