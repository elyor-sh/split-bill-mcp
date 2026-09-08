import type { SplitBillConfig } from "../config.js";
import type { BillDto, ParticipantStatus, PopulatedUser } from "../types.js";
import { ApiError, AuthError, ResolveError } from "./errors.js";

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

export class SplitBillClient {
  private cookie: string | null = null;
  private meId: string | null = null;
  readonly emailCache = new Map<string, string>();

  constructor(private readonly cfg: SplitBillConfig) {}

  private async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.SPLITBILL_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...((init.headers as Record<string, string> | undefined) ?? {}),
      };
      if (init.body !== undefined && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      try {
        return await fetch(`${this.cfg.SPLITBILL_BASE_URL}${path}`, {
          ...init,
          headers,
          signal: ctrl.signal,
        });
      } catch (e) {
        if ((e as { name?: unknown })?.name === "AbortError") {
          throw new ApiError(504, `Request to ${path} timed out after ${this.cfg.SPLITBILL_TIMEOUT_MS}ms`);
        }
        throw e;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private getSetCookies(res: Response): string[] {
    const headers = res.headers as Headers & { getSetCookie?: () => string[] };
    if (typeof headers.getSetCookie === "function") {
      const arr = headers.getSetCookie();
      if (arr.length > 0) return arr;
    }
    const single = res.headers.get("set-cookie") ?? "";
    if (!single) return [];
    return single.split(/,(?=[^;,]+=[^;,]+)/);
  }

  private toCookieHeader(cookies: string[]): string {
    return cookies
      .map((c) => c.split(";")[0].trim())
      .filter((c) => c.length > 0)
      .join("; ");
  }

  async login(): Promise<void> {
    const csrfRes = await this.raw("/api/auth/csrf", { method: "GET" });
    if (!csrfRes.ok) throw new AuthError(`CSRF request failed: HTTP ${csrfRes.status}`);
    const csrfJson = (await csrfRes.json()) as { csrfToken?: string };
    if (!csrfJson.csrfToken) throw new AuthError("CSRF response had no csrfToken");
    const csrfCookie = this.toCookieHeader(this.getSetCookies(csrfRes));
    const body = new URLSearchParams({
      csrfToken: csrfJson.csrfToken,
      email: this.cfg.SPLITBILL_EMAIL,
      password: this.cfg.SPLITBILL_PASSWORD,
      callbackUrl: `${this.cfg.SPLITBILL_BASE_URL}/dashboard`,
      json: "true",
    });
    const res = await this.raw("/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(csrfCookie ? { Cookie: csrfCookie } : {}),
      },
      body,
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    const session = this.toCookieHeader(
      this.getSetCookies(res).filter(
        (c) =>
          c.startsWith("next-auth.session-token=") ||
          c.startsWith("__Secure-next-auth.session-token="),
      ),
    );
    if (!res.ok || payload.error || !session) {
      throw new AuthError(
        `Login failed for ${this.cfg.SPLITBILL_EMAIL}: HTTP ${res.status}${payload.error ? ` (${payload.error})` : ""}`,
      );
    }
    this.cookie = session;
    this.meId = null;
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.cookie) await this.login();
    let res = await this.raw(path, init);
    if (res.status === 401) {
      await this.login();
      res = await this.raw(path, init);
    }
    if (res.status === 401) throw new AuthError("Session expired and re-login failed");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ApiError(res.status, text.slice(0, 500));
    }
    return (await res.json()) as T;
  }

  async getMeId(): Promise<string> {
    if (this.cachedMeId) return this.cachedMeId;
    const me = await this.request<{ user?: { _id?: unknown } }>("/api/user/me");
    const id = me?.user?._id;
    if (typeof id !== "string" || id.length === 0) {
      throw new ApiError(500, "Unexpected /api/user/me response shape");
    }
    this.cachedMeId = id;
    return id;
  }

  async getBills(): Promise<BillDto[]> {
    const res = await this.request<{ bills: BillDto[] }>("/api/bills");
    return res.bills;
  }

  async getBill(billId: string): Promise<BillDto> {
    try {
      const res = await this.request<{ bill: BillDto }>(
        `/api/bills/${encodeURIComponent(billId)}`,
      );
      return res.bill;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new ApiError(404, "Bill not found");
      }
      throw err;
    }
  }

  async createBill(body: {
    participants: { user: string; items: { name: string; price: number; priceWithVat?: number; vat?: boolean }[]; totalSum: number }[];
    payerId: string;
    title?: string;
    description?: string;
  }): Promise<BillDto> {
    const res = await this.request<{ bill: BillDto }>("/api/bills", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return res.bill;
  }

  async updatePayment(billId: string, participantId: string, status: ParticipantStatus): Promise<BillDto> {
    const res = await this.request<{ bill: BillDto }>(
      `/api/bills/${encodeURIComponent(billId)}`,
      { method: "PATCH", body: JSON.stringify({ participantId, status }) },
    );
    return res.bill;
  }

  async searchUsers(query: string): Promise<PopulatedUser[]> {
    const res = await this.request<{ users: PopulatedUser[] }>(
      `/api/users/search?q=${encodeURIComponent(query)}`,
    );
    return res.users;
  }

  async listFriends(): Promise<{ friends: PopulatedUser[]; sentRequests?: unknown; receivedRequests?: unknown }> {
    return this.request<{ friends: PopulatedUser[]; sentRequests?: unknown; receivedRequests?: unknown }>("/api/friends");
  }

  async getStats(): Promise<{
    totalBills: number;
    totalOwed: number;
    totalOwing: number;
    pendingBills: number;
    completedBills: number;
  }> {
    const res = await this.request<{
      stats: {
        totalBills: number;
        totalOwed: number;
        totalOwing: number;
        pendingBills: number;
        completedBills: number;
      };
    }>("/api/dashboard/stats");
    return res.stats;
  }

  async resolveUserId(ref: string): Promise<string> {
    if (/^[0-9a-fA-F]{24}$/.test(ref)) return ref;
    // Upstream user search excludes the caller, so the service user's own
    // email is never searchable — resolve it directly via /api/user/me.
    if (ref.toLowerCase() === this.cfg.SPLITBILL_EMAIL.toLowerCase()) {
      return this.getMeId();
    }
    const cached = this.emailCache.get(ref.toLowerCase());
    if (cached) return cached;
    const found = await this.searchUsers(ref);
    const exact = found.find((u) => u.email.toLowerCase() === ref.toLowerCase());
    if (exact) {
      this.emailCache.set(ref.toLowerCase(), exact._id);
      return exact._id;
    }
    const { friends } = await this.listFriends();
    const friend = friends.find((u) => u.email.toLowerCase() === ref.toLowerCase());
    if (friend) {
      this.emailCache.set(ref.toLowerCase(), friend._id);
      return friend._id;
    }
    throw new ResolveError(
      `User '${ref}' not found. Clarify the email or add them as a friend.`,
      [...found, ...friends]
        .slice(0, 5)
        .map((u) => ({ name: u.name, email: u.email })),
    );
  }

  protected invalidateMe(): void {
    this.meId = null;
  }

  protected get cachedMeId(): string | null {
    return this.meId;
  }

  protected set cachedMeId(id: string | null) {
    this.meId = id;
  }

  protected get isRecordHelper(): typeof isRecord {
    return isRecord;
  }
}
