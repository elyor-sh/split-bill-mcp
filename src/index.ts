#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import { loadConfig } from "./config.js";
import { SplitBillClient } from "./client/client.js";
import { ApiError, AuthError, ResolveError } from "./client/errors.js";
import { buildTools } from "./tools/index.js";

function fail(message: string): never {
  console.error(`split-bill-mcp: ${message}`);
  process.exit(1);
}

let client: SplitBillClient;
try {
  client = new SplitBillClient(loadConfig());
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}

const server = new Server({ name: "split-bill", version: "0.1.0" }, { capabilities: { tools: {} } });
const tools = buildTools(client!);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) {
    return { content: [{ type: "text", text: `Unknown tool '${req.params.name}'` }], isError: true };
  }
  try {
    const result = await tool.handler(req.params.arguments ?? {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (e instanceof ZodError) {
      return {
        content: [{ type: "text", text: JSON.stringify({ code: "VALIDATION_ERROR", message: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }) }],
        isError: true,
      };
    }
    const code =
      e instanceof AuthError || e instanceof ResolveError || e instanceof ApiError
        ? e.code
        : "BILL_API_ERROR";
    const extra =
      e instanceof ApiError ? { status: e.status, upstream: e.upstream } : {};
    console.error(`tool '${tool.name}' failed:`, e);
    return {
      content: [{ type: "text", text: JSON.stringify({ code, message, ...extra }) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("split-bill-mcp ready");
