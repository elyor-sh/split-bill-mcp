export class AuthError extends Error {
  readonly code = "AUTH_FAILED" as const;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class ApiError extends Error {
  readonly code = "BILL_API_ERROR" as const;
  constructor(
    public readonly status: number,
    public readonly upstream: string,
  ) {
    super(`SplitBill API ${status}: ${upstream}`);
    this.name = "ApiError";
  }
}

export class ResolveError extends Error {
  readonly code = "RESOLVE_FAILED" as const;
  constructor(
    message: string,
    public readonly candidates: { name: string; email: string }[] = [],
  ) {
    super(message);
    this.name = "ResolveError";
  }
}

export class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR" as const;
  constructor(message: string) { super(message); this.name = "ValidationError"; }
}
