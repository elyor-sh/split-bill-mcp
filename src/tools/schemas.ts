import { z } from "zod";

export const langSchema = z.string().min(2).max(8).optional();

const billItemSchema = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  priceWithVat: z.number().positive().optional(),
  vat: z.boolean().optional(),
});

const readyParticipantSchema = z.object({
  user: z.string().min(1),
  items: z.array(billItemSchema).min(1),
  totalSum: z.number().positive(),
});

const receiptItemSchema = billItemSchema.extend({
  consumers: z.array(z.string().min(1)).min(1),
  portions: z.array(z.number().positive()).optional(),
}).refine((it) => !it.portions || it.portions.length === it.consumers.length, {
  message: "portions length must match consumers length",
});

export const createBillInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("ready_split"),
    participants: z.array(readyParticipantSchema).min(1),
    payerId: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    lang: langSchema,
  }),
  z.object({
    mode: z.literal("raw_receipt"),
    receipt_items: z.array(receiptItemSchema).min(1),
    payer: z.string().min(1),
    title: z.string().optional(),
    description: z.string().optional(),
    lang: langSchema,
  }),
]);

const dateStringSchema = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: "must be a parseable date",
}).optional();

export const listBillsInputSchema = z.object({
  status: z.enum(["all", "paid", "unpaid", "pending_confirmation", "partial"]).default("all"),
  role: z.enum(["all", "creator", "payer", "debtor"]).default("all"),
  search: z.string().optional(),
  date_from: dateStringSchema,
  date_to: dateStringSchema,
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
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
  include_requests: z.boolean().default(false),
  lang: langSchema,
});

export const getStatsInputSchema = z.object({ lang: langSchema });

export type CreateBillInput = z.infer<typeof createBillInputSchema>;
