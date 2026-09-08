import type { SplitBillConfig } from "../config.js";
import { ApiError, AuthError } from "./errors.js";

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
      return await fetch(`${this.cfg.SPLITBILL_BASE_URL}${path}`, {
        ...init,
        headers,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async login(): Promise<void> {
    const csrfRes = await this.raw("/api/auth/csrf", { method: "GET" });
    if (!csrfRes.ok) throw new AuthError(`CSRF request failed: HTTP ${csrfRes.status}`);
    const csrfJson = (await csrfRes.json()) as { csrfToken?: string };
    if (!csrfJson.csrfToken) throw new AuthError("CSRF response had no csrfToken");
    const csrfCookie = csrfRes.headers.get("set-cookie") ?? "";
    const body = new URLSearchParams({
      csrfToken: csrfJson.csrfToken,
      email: this.cfg.SPLITBILL_EMAIL,
      password: this.cfg.SPLITBILL_PASSWORD,
      callbackUrl: `${this.cfg.SPLITBILL_BASE_URL}/dashboard`,
      json: "true",
    });
    const res = await fetch(`${this.cfg.SPLITBILL_BASE_URL}/api/auth/callback/credentials`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(csrfCookie ? { Cookie: csrfCookie } : {}),
      },
      body,
    });
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    const setCookie = res.headers.get("set-cookie") ?? "";
    const session = setCookie
      .split(/,(?=[^;,]+=[^;,]+)/)
      .map((c) => c.split(";")[0].trim())
      .filter(
        (c) =>
          c.startsWith("next-auth.session-token=") ||
          c.startsWith("__Secure-next-auth.session-token="),
      )
      .join("; ");
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
