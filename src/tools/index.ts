import type { SplitBillClient } from "../client/client.js";
import { ApiError, ValidationError } from "../client/errors.js";
import { filterBills, groupByStatus, paginate } from "../logic/filters.js";
import { splitReceiptItems, verifyReadySplit } from "../logic/split.js";
import type { BillDto } from "../types.js";
import {
  billCreatedSummary,
  billsListedSummary,
  paymentUpdatedSummary,
} from "./summaries.js";
import {
  createBillInputSchema,
  getBillInputSchema,
  getStatsInputSchema,
  listBillsInputSchema,
  listFriendsInputSchema,
  searchUsersInputSchema,
  updatePaymentInputSchema,
} from "./schemas.js";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: unknown) => Promise<Record<string, unknown>>;
}

const str = (extra: Record<string, unknown> = {}) => ({ type: "string", ...extra });
const num = (extra: Record<string, unknown> = {}) => ({ type: "number", ...extra });
const bool = (extra: Record<string, unknown> = {}) => ({ type: "boolean", ...extra });
const arr = (items: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: "array",
  items,
  ...extra,
});
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
});
const opt = (s: Record<string, unknown>) => ({ ...s });

const withVatDefaults = (items: { name: string; price: number; priceWithVat?: number; vat?: boolean }[]) =>
  items.map((it) => ({ ...it, priceWithVat: it.priceWithVat ?? it.price, vat: it.vat ?? false }));

export function buildTools(client: SplitBillClient): ToolDef[] {
  const compact = (b: BillDto) => ({
    id: b._id,
    title: b.title,
    total: b.total,
    createdAt: b.createdAt,
    payer: b.payer?.name ?? null,
    participants: b.participants.map((p) => ({
      name: p.user.name,
      email: p.user.email,
      amount: p.totalSum ?? p.amountOwed,
      status: p.status,
    })),
  });

  return [
    {
      name: "create_bill",
      description:
        "Create a SplitBill bill. mode=ready_split takes pre-split participants with totals; mode=raw_receipt takes receipt positions with consumers and splits them. Pass real arrays/numbers (not JSON strings). raw_receipt example: {mode:'raw_receipt',receipt_items:[{name:'Plov',price:20000,consumers:['a@x']}],payer:'a@x',title:'SamOsh'}.",
      // Flat schema on purpose: oneOf/anyOf makes many LLM bridges stringify
      // nested arrays (participants/receipt_items/consumers) which then fails
      // zod with "Expected array, received string". Zod still enforces
      // per-mode required fields; this JSON Schema is only the LLM hint.
      inputSchema: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["ready_split", "raw_receipt"],
            description: "ready_split = you already split totals; raw_receipt = server splits receipt positions",
          },
          participants: arr(
            obj({
              user: str({ description: "email or userId" }),
              items: arr(
                obj({ name: str(), price: num(), priceWithVat: opt(num()), vat: opt(bool()) }),
                { minItems: 1 },
              ),
              totalSum: num(),
            }),
            { minItems: 1, description: "Required when mode=ready_split" },
          ),
          payerId: str({ description: "email or userId. Required when mode=ready_split (payer also accepted as alias)" }),
          receipt_items: arr(
            obj({
              name: str(),
              price: num(),
              priceWithVat: opt(num()),
              vat: opt(bool()),
              consumers: arr(str(), { minItems: 1, description: "emails or userIds sharing this position" }),
              portions: opt(arr(num(), { description: "weights, same length as consumers" })),
            }),
            { minItems: 1, description: "Required when mode=raw_receipt" },
          ),
          payer: str({ description: "email or userId. Required when mode=raw_receipt (payerId also accepted as alias)" }),
          title: opt(str()),
          description: opt(str()),
          lang: opt(str({ description: "'en' default, 'ru' for Russian summary" })),
        },
        required: ["mode"],
      },
      handler: async (rawArgs) => {
        const args =
          typeof rawArgs === "string"
            ? (() => {
                try {
                  return JSON.parse(rawArgs);
                } catch {
                  return rawArgs;
                }
              })()
            : rawArgs;
        const input = createBillInputSchema.parse(args);
        const lang = input.lang;
        if (input.mode === "raw_receipt") {
          const computed = splitReceiptItems(input.receipt_items);
          const payerId = await client.resolveUserId(input.payer);
          const participants = await Promise.all(
            computed.map(async (p) => ({
              user: await client.resolveUserId(p.user),
              items: withVatDefaults(p.items),
              totalSum: p.totalSum,
            })),
          );
          const bill = await client.createBill({
            participants,
            payerId,
            title: input.title,
            description: input.description,
          });
          return { data: { billId: bill._id, ...compact(bill) }, summary: billCreatedSummary(bill, lang), lang: lang ?? "en" };
        }
        const check = verifyReadySplit(input.participants);
        if (!check.ok) {
          throw new ValidationError(check.message);
        }
        const payerId = await client.resolveUserId(input.payerId);
        const participants = await Promise.all(
          input.participants.map(async (p) => ({
            user: await client.resolveUserId(p.user),
            items: withVatDefaults(p.items),
            totalSum: p.totalSum,
          })),
        );
        const bill = await client.createBill({
          participants,
          payerId,
          title: input.title,
          description: input.description,
        });
        return { data: { billId: bill._id, ...compact(bill) }, summary: billCreatedSummary(bill, lang), lang: lang ?? "en" };
      },
    },
    {
      name: "list_bills",
      description: "List my SplitBill bills with filters by payment status, my role, title search, date range, and pagination.",
      inputSchema: obj({
        status: { type: "string", enum: ["all", "paid", "unpaid", "pending_confirmation", "partial"], default: "all" },
        role: { type: "string", enum: ["all", "creator", "payer", "debtor"], default: "all" },
        search: opt(str()),
        date_from: opt(str()),
        date_to: opt(str()),
        page: { type: "integer", minimum: 1, default: 1 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        lang: opt(str()),
      }),
      handler: async (args) => {
        const input = listBillsInputSchema.parse(args);
        const me = await client.getMeId();
        const bills = await client.getBills();
        const filtered = filterBills(bills, me, {
          status: input.status,
          role: input.role,
          search: input.search,
          dateFrom: input.date_from,
          dateTo: input.date_to,
        });
        const groups = groupByStatus(filtered);
        const page = paginate(filtered, input.page, input.limit);
        return {
          data: {
            bills: page.items.map(compact),
            total: page.total,
            page: page.page,
            limit: page.limit,
            hasMore: page.hasMore,
            grouped_by_status: groups,
          },
          summary: billsListedSummary(page.total, groups, input.lang),
          lang: input.lang ?? "en",
        };
      },
    },
    {
      name: "get_bill",
      description: "Get one SplitBill bill by ID with participants and payment statuses.",
      inputSchema: obj({ billId: str(), lang: opt(str()) }, ["billId"]),
      handler: async (args) => {
        const input = getBillInputSchema.parse(args);
        const bill = await client.getBill(input.billId);
        return { data: compact(bill), summary: `Bill '${bill.title}': total ${bill.total}`, lang: input.lang ?? "en" };
      },
    },
    {
      name: "update_payment",
      description: "Update a participant payment status (paid, unpaid, pending_confirmation) on a bill.",
      inputSchema: obj(
        {
          billId: str(),
          participant: str({ description: "participant email or userId" }),
          status: { type: "string", enum: ["paid", "unpaid", "pending_confirmation"] },
          lang: opt(str()),
        },
        ["billId", "participant", "status"],
      ),
      handler: async (args) => {
        const input = updatePaymentInputSchema.parse(args);
        const bill = await client.getBill(input.billId);
        const ref = input.participant.toLowerCase();
        const match = bill.participants.find(
          (p) => p.user._id.toLowerCase() === input.participant.toLowerCase() || p.user.email.toLowerCase() === ref,
        );
        if (!match) throw new ApiError(404, `Participant '${input.participant}' not on bill '${bill.title}'`);
        const updated = await client.updatePayment(bill._id, match.user._id, input.status);
        const full = await client.getBill(updated._id);
        return {
          data: compact(full),
          summary: paymentUpdatedSummary(full.title, match.user.name, input.status, input.lang),
          lang: input.lang ?? "en",
        };
      },
    },
    {
      name: "search_users",
      description: "Search SplitBill users by name or email (to resolve participant IDs).",
      inputSchema: obj({ query: str({ minLength: 2, maxLength: 100 }), lang: opt(str()) }, ["query"]),
      handler: async (args) => {
        const input = searchUsersInputSchema.parse(args);
        const users = await client.searchUsers(input.query);
        return {
          data: { users: users.map((u) => ({ id: u._id, name: u.name, email: u.email })) },
          summary: `Found ${users.length} users`,
          lang: input.lang ?? "en",
        };
      },
    },
    {
      name: "list_friends",
      description: "List my SplitBill friends (for picking bill participants).",
      inputSchema: obj({ include_requests: { type: "boolean", default: false }, lang: opt(str()) }),
      handler: async (args) => {
        const input = listFriendsInputSchema.parse(args);
        const res = await client.listFriends();
        const data: Record<string, unknown> = {
          friends: res.friends.map((f) => ({ id: f._id, name: f.name, email: f.email })),
        };
        if (input.include_requests) {
          data.requests = { sent: res.sentRequests ?? [], received: res.receivedRequests ?? [] };
        }
        return { data, summary: `${res.friends.length} friends`, lang: input.lang ?? "en" };
      },
    },
    {
      name: "get_dashboard_stats",
      description: "Get SplitBill dashboard totals: bill count, amounts owed and owing.",
      inputSchema: obj({ lang: opt(str()) }),
      handler: async (args) => {
        const input = getStatsInputSchema.parse(args);
        const stats = await client.getStats();
        return { data: stats, summary: `${stats.totalBills} bills, owed ${stats.totalOwed}, owing ${stats.totalOwing}`, lang: input.lang ?? "en" };
      },
    },
  ];
}
