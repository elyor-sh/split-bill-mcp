# split-bill-mcp

MCP server (stdio) for SplitBill: create bills from agent-split receipts, list/filter bills, update payments.

## Prereqs

- Node 20+
- Running SplitBill — `SPLITBILL_BASE_URL` must be set (e.g. `http://localhost:3000`)
- Service user registered via SplitBill `/auth/register`

## Setup

```bash
npm install
cp .env.example .env  # then fill in SPLITBILL_EMAIL / SPLITBILL_PASSWORD
npm run build
```

## Connect a client (Claude Code / Codex)

```json
{ "mcpServers": { "split-bill": {
  "command": "node",
  "args": ["/Users/elyorsh/Desktop/projects/mcp-custom/split-bill-mcp/dist/index.js"],
  "env": {
    "SPLITBILL_BASE_URL": "http://localhost:3000",
    "SPLITBILL_EMAIL": "agent@example.com",
    "SPLITBILL_PASSWORD": "change-me"
  }
} } }
```

## Tools

`create_bill` (ready_split | raw_receipt), `list_bills`, `get_bill`,
`update_payment`, `search_users`, `list_friends`, `get_dashboard_stats`.

Responses: `{ data, summary, lang }`. Summaries default to English;
pass `lang: "ru"` for Russian. Item names are never translated.

## Dev

```bash
npm test        # vitest
npm run dev     # stdio with tsx
npm run typecheck
```
