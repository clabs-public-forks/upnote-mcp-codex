#!/usr/bin/env node
// Unofficial UpNote MCP server for Codex CLI.
// Reads local synced data from a process-owned SQLite snapshot and dispatches
// create/open/navigation requests through UpNote's upnote:// URL scheme.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from "./config.mjs";
import { SnapshotDatabase } from "./database.mjs";
import { createLauncher } from "./launcher.mjs";
import { createToolService } from "./tools.mjs";

const config = loadConfig();
const database = new SnapshotDatabase({ sourcePath: () => config.databasePath, snapshotBaseDir: config.snapshotBaseDir });
const service = createToolService({ database, launcher: createLauncher(), config });
const instructions = [
  "UpNote MCP reads the local data that UpNote has synced to this computer.",
  "Write capabilities are create-only: this server cannot edit or delete existing notes.",
  "Create, open, and navigation tools dispatch documented upnote:// URLs to the local app; a dispatched request is not confirmation that UpNote processed it.",
  "upnote_open_tag, upnote_open_filter, and upnote_view accept explicit titles or IDs and do not discover tags, filters, spaces, or IDs through the local database.",
  "URL endpoint details and supported view modes follow https://help.getupnote.com/resources/x-callback-url-endpoints.",
].join(" ");

const server = new Server(
  { name: "upnote-mcp-codex", version: "1.0.0" },
  { capabilities: { tools: {} }, instructions },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: service.definitions }));
server.setRequestHandler(CallToolRequestSchema, async request => service.call(request.params.name, request.params.arguments || {}));

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  database.close();
}

process.once("exit", cleanup);
process.once("SIGINT", () => { cleanup(); process.exit(0); });
process.once("SIGTERM", () => { cleanup(); process.exit(0); });

const transport = new StdioServerTransport();
transport.onclose = cleanup;
await server.connect(transport);
