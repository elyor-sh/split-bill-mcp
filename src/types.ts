export interface BillItemInput {
  name: string;
  price: number;
  priceWithVat?: number;
  vat?: boolean;
}

export interface ReceiptItemInput extends BillItemInput {
  consumers: string[];
  portions?: number[];
}

export interface ReadyParticipantInput {
  user: string;
  items: BillItemInput[];
  totalSum: number;
}

export interface ComputedParticipant {
  user: string;
  items: BillItemInput[];
  totalSum: number;
}

export interface PopulatedUser {
  _id: string;
  name: string;
  email: string;
}

export type ParticipantStatus = "paid" | "unpaid" | "pending_confirmation";
export type BillAggregateStatus = ParticipantStatus | "partial";

export interface BillDto {
  _id: string;
  title: string;
  description?: string;
  total: number;
  createdAt: string;
  creator: PopulatedUser;
  payer?: PopulatedUser | null;
  participants: {
    user: PopulatedUser;
    amountOwed: number;
    totalSum: number;
    status: ParticipantStatus;
  }[];
}
