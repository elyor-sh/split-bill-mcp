import { z } from "zod";

// LLM agents (OpenAI-style function calling, some MCP bridges) often send
// arrays/objects/numbers as JSON-encoded strings, e.g.
// participants: "[{\"user\":\"a@x\",...}]" instead of a real array.
// These helpers make create_bill tolerant without loosening real validation.

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length === 0) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function parseFlexibleNumber(value: unknown): unknown {
  const parsed = tryParseJson(value);
  if (typeof parsed === "number") return parsed;
  if (typeof parsed === "string") {
    const cleaned = parsed.replace(/[\s_']/g, "");
    if (cleaned.length === 0) return value;
    let normalized = cleaned;
    // "20,5" (1-2 decimals) -> decimal dot; otherwise commas are thousand seps.
    if (/^-?\d+,\d{1,2}$/.test(normalized)) {
      normalized = normalized.replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
    const n = Number(normalized);
    return Number.isFinite(n) ? n : value;
  }
  return parsed;
}

function parseFlexibleBoolean(value: unknown): unknown {
  const parsed = tryParseJson(value);
  if (typeof parsed === "boolean") return parsed;
  if (typeof parsed === "number") {
    if (parsed === 1) return true;
    if (parsed === 0) return false;
    return value;
  }
  if (typeof parsed === "string") {
    const low = parsed.trim().toLowerCase();
    if (["true", "1", "yes", "y", "да"].includes(low)) return true;
    if (["false", "0", "no", "n", "нет"].includes(low)) return false;
  }
  return parsed;
}

/** Parse a top-level array that may arrive as a JSON string or a single object. */
function parseTopArray(value: unknown): unknown {
  const parsed = tryParseJson(value);
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null && typeof parsed === "object") return [parsed];
  return parsed;
}

/** consumers: real array, JSON-string array, single email string, or comma-list. */
function parseConsumers(value: unknown): unknown {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const parsed = tryParseJson(value);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === "string" && parsed !== value) {
      // e.g. '"a@x"' -> single email
      const t = parsed.trim();
      return t ? [t] : value;
    }
    if (parsed !== null && typeof parsed === "object") return [parsed];
    if (value.includes(",") || value.includes(";") || value.includes("\n")) {
      const parts = value
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length > 0) return parts;
    }
    const single = value.trim();
    return single ? [single] : value;
  }
  return value;
}

const flexPositive = z.preprocess(parseFlexibleNumber, z.number().positive());
const flexPositiveOptional = z.preprocess(parseFlexibleNumber, z.number().positive().optional());
const flexVat = z.preprocess(parseFlexibleBoolean, z.boolean().optional());

const flexConsumers = z.preprocess(parseConsumers, z.array(z.string().min(1)).min(1));
const flexPortions = z.preprocess(
  parseTopArray,
  z.array(z.preprocess(parseFlexibleNumber, z.number().positive())).optional(),
);

export const langSchema = z.string().min(2).max(8).optional();

const billItemObject = z.object({
  name: z.string().min(1),
  price: flexPositive,
  priceWithVat: flexPositiveOptional,
  vat: flexVat,
});

// Accept a single item stringified as JSON: "{\"name\":\"...\",...}".
const billItemFlex = z.preprocess(tryParseJson, billItemObject);

const flexItemsArray = z.preprocess(parseTopArray, z.array(billItemFlex).min(1));

const readyParticipantObject = z.object({
  user: z.string().min(1),
  items: flexItemsArray,
  totalSum: flexPositive,
});

const readyParticipantFlex = z.preprocess(tryParseJson, readyParticipantObject);

const receiptItemObject = billItemObject.extend({
  consumers: flexConsumers,
  portions: flexPortions,
}).refine((it) => !it.portions || it.portions.length === it.consumers.length, {
  message: "portions length must match consumers length",
});

const receiptItemFlex = z.preprocess(tryParseJson, receiptItemObject);

const flexParticipants = z.preprocess(parseTopArray, z.array(readyParticipantFlex).min(1));
const flexReceiptItems = z.preprocess(parseTopArray, z.array(receiptItemFlex).min(1));

// Normalize common LLM slips before discriminated-union validation:
// - whole args object sent as a JSON string
// - missing mode (infer from which array is present)
// - payer/payerId alias confusion between the two modes
function normalizeCreateBillArgs(value: unknown): unknown {
  const root = tryParseJson(value);
  if (root === null || typeof root !== "object" || Array.isArray(root)) return root;
  const r = { ...(root as Record<string, unknown>) };
  if (typeof r.mode !== "string") {
    if (r.receipt_items !== undefined || r.receiptItems !== undefined) r.mode = "raw_receipt";
    else if (r.participants !== undefined) r.mode = "ready_split";
  }
  // snake_case/camelCase alias
  if (r.receiptItems !== undefined && r.receipt_items === undefined) {
    r.receipt_items = r.receiptItems;
  }
  if (r.mode === "ready_split") {
    if (r.payerId === undefined && typeof r.payer === "string") r.payerId = r.payer;
  } else if (r.mode === "raw_receipt") {
    if (r.payer === undefined && typeof r.payerId === "string") r.payer = r.payerId;
  }
  return r;
}

export const createBillInputSchema = z.preprocess(
  normalizeCreateBillArgs,
  z.discriminatedUnion("mode", [
    z.object({
      mode: z.literal("ready_split"),
      participants: flexParticipants,
      payerId: z.string().min(1),
      title: z.string().optional(),
      description: z.string().optional(),
      lang: langSchema,
    }),
    z.object({
      mode: z.literal("raw_receipt"),
      receipt_items: flexReceiptItems,
      payer: z.string().min(1),
      title: z.string().optional(),
      description: z.string().optional(),
      lang: langSchema,
    }),
  ]),
);

const dateStringSchema = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: "must be a parseable date",
}).optional();

export const listBillsInputSchema = z.object({
  status: z.enum(["all", "paid", "unpaid", "pending_confirmation", "partial"]).default("all"),
  role: z.enum(["all", "creator", "payer", "debtor"]).default("all"),
  search: z.string().optional(),
  date_from: dateStringSchema,
  date_to: dateStringSchema,
  page: z.preprocess(parseFlexibleNumber, z.number().int().positive().default(1)),
  limit: z.preprocess(parseFlexibleNumber, z.number().int().positive().max(100).default(20)),
  lang: langSchema,
});

export const getBillInputSchema = z.object({
  billId: z.string().min(1),
  lang: langSchema,
});

export const updatePaymentInputSchema = z.object({
  billId: z.string().min(1),
  participant: z.string().min(1),
  status: z.enum(["paid", "unpaid", "pending_confirmation"]),
  lang: langSchema,
});

export const searchUsersInputSchema = z.object({
  query: z.string().min(2).max(100),
  lang: langSchema,
});

export const listFriendsInputSchema = z.object({
  include_requests: z.preprocess(parseFlexibleBoolean, z.boolean().default(false)),
  lang: langSchema,
});

export const getStatsInputSchema = z.object({ lang: langSchema });

export type CreateBillInput = z.infer<typeof createBillInputSchema>;
