# split-bill-mcp

MCP server (stdio) for [SplitBill](https://github.com/elyor-sh/split-bill)
(a Next.js app for splitting bills between friends).
It lets an AI agent create bills from split receipts, list and filter bills,
update payment statuses, and look up users — all through the SplitBill REST API.

## How it works

- The server logs in to SplitBill as a **service user**
  (email + password from env) via the NextAuth credentials flow,
  caches the session cookie, and re-logs in once on `401`.
- Money math is **cent-exact**: receipt positions are split per consumer,
  remainder cents go to the first consumers, and
  `Σ per-person == total` is verified before every `create_bill`.
- Responses are language-neutral JSON (`data`) plus a short human `summary`
  (English by default, Russian with `lang: "ru"`).
  Item names and titles are never translated — they pass through byte-for-byte.

## Prereqs

- Node 20+
- A running SplitBill instance, e.g. `http://localhost:3000`
- A service user registered in SplitBill via `/auth/register`
  **and confirmed** (registration sends a confirmation link;
  the account must be confirmed before the MCP server can log in as it)

## Setup

```bash
git clone <this-repo> split-bill-mcp
cd split-bill-mcp
npm install
cp .env.example .env  # then fill in the values below
npm run build
```

### Environment

| Variable              | Required | Default | Description                                          |
|-----------------------|----------|---------|------------------------------------------------------|
| `SPLITBILL_BASE_URL`  | yes      | —       | SplitBill origin, e.g. `http://localhost:3000`       |
| `SPLITBILL_EMAIL`     | yes      | —       | Service-user email                                   |
| `SPLITBILL_PASSWORD`  | yes      | —       | Service-user password                                |
| `SPLITBILL_TIMEOUT_MS`| no       | `15000` | HTTP timeout per request (ms)                        |
| `LOG_LEVEL`           | no       | `info`  | `debug` \| `info` \| `warn` \| `error` (reserved)    |

Missing/invalid vars fail fast at startup with
`Invalid MCP configuration: VAR: reason`.

## Connect a client

Replace `<path-to-split-bill-mcp>` with the directory where you cloned this repo.
Secrets can live in the MCP client config `env` (below) or in a `.env` file —
`env` in the client config takes precedence.

**Claude Code** (`~/.claude.json` or project `.mcp.json`):

```json
{ "mcpServers": { "split-bill": {
  "command": "node",
  "args": ["<path-to-split-bill-mcp>/dist/index.js"],
  "env": {
    "SPLITBILL_BASE_URL": "http://localhost:3000",
    "SPLITBILL_EMAIL": "agent@example.com",
    "SPLITBILL_PASSWORD": "change-me"
  }
} } }
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.split-bill]
command = "node"
args = ["<path-to-split-bill-mcp>/dist/index.js"]

[mcp_servers.split-bill.env]
SPLITBILL_BASE_URL = "http://localhost:3000"
SPLITBILL_EMAIL = "agent@example.com"
SPLITBILL_PASSWORD = "change-me"
```

Any other MCP client: run `node <path-to-split-bill-mcp>/dist/index.js`
over stdio with the env vars above set.

## Tools

All tools accept an optional `lang` (`"en"` default, `"ru"` for Russian summaries)
and return `{ data, summary, lang }`.
Users are referenced by **email or userId** everywhere and resolved automatically
(ObjectId passthrough → own email → user search → friends).

### `create_bill`

Create a bill. Two modes:

- `mode: "ready_split"` — agent already split the receipt:
  `participants: [{ user, items: [{ name, price, priceWithVat?, vat? }], totalSum }]`,
  `payerId`, optional `title`/`description`.
  Item sums are verified per participant (mismatch > 1 cent → `VALIDATION_ERROR`).
- `mode: "raw_receipt"` — agent sends receipt positions and who shared what:
  `receipt_items: [{ name, price, priceWithVat?, vat?, consumers: [email|userId], portions? }]`,
  `payer`, optional `title`/`description`.
  The server splits each position across consumers (equally or by `portions`)
  and builds the participants itself.

Missing `priceWithVat` defaults to `price`, missing `vat` to `false`
(upstream requires `priceWithVat`).

Example (raw receipt, agent already figured out who ate what):

```json
{ "mode": "raw_receipt",
  "receipt_items": [
    { "name": "Pizza", "price": 1200, "consumers": ["ann@x.ru", "bob@x.ru"] },
    { "name": "Tea", "price": 300, "consumers": ["ann@x.ru"] }
  ],
  "payer": "ann@x.ru", "title": "Dinner", "lang": "ru" }
```

→ `data: { billId, title, total, per-person amounts/statuses }`.

### `list_bills`

List my bills with local filters (upstream has none):
`status` (`all|paid|unpaid|pending_confirmation|partial`),
`role` (`all|creator|payer|debtor`), `search` (title substring),
`date_from`/`date_to` (must be parseable dates), `page`/`limit`.
Returns the page plus `grouped_by_status` counts and a totals summary.

### `get_bill`

`billId` → full bill with participants, amounts, and payment statuses.

### `update_payment`

`billId`, `participant` (email or userId, case-insensitive),
`status` (`paid|unpaid|pending_confirmation`).
Marks one participant's share; returns the refreshed bill.

### `search_users`

`query` (min 2 chars) → `[{ id, name, email }]`.
Note: upstream search excludes you and your friends —
use it to find strangers to add, `list_friends` for existing friends.

### `list_friends`

Your friends as `[{ id, name, email }]`.
`include_requests: true` also returns `{ sent, received }` request queues.

### `get_dashboard_stats`

`{ totalBills, totalOwed, totalOwing, pendingBills, completedBills }`.

## Error codes

| `code`              | Meaning / what to do                                     |
|---------------------|----------------------------------------------------------|
| `AUTH_FAILED`       | Service-user login failed — check email/password, confirm the account, check `SPLITBILL_BASE_URL`. Single re-login only, no retry loops. |
| `VALIDATION_ERROR`  | Input invalid (bad sums, bad dates, short query) — the message says exactly what mismatched. Fix the input, don't retry blindly. |
| `RESOLVE_FAILED`    | Email/user not found — clarify the email or add them as a friend; close name matches are included when available. |
| `BILL_API_ERROR`    | Upstream SplitBill error — `status` + verbatim `upstream` body included. `POST` calls are never auto-retried (not idempotent): on network/5xx failure during create, check `list_bills` before retrying to avoid duplicates. |

## Dev

```bash
npm test        # vitest, 30 tests
npm run dev     # stdio with tsx (needs env set)
npm run typecheck  # covers src + tests
npm run build   # tsc → dist/ (src only)
```
