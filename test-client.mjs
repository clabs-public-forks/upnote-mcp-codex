// Manual smoke test. Usage: node test-client.mjs [read|write|all]
//
// "write" creates real notes in your UpNote and they cannot be deleted
// programmatically, so you will have to trash them by hand.
//
// Override the fixtures with TEST_NOTEBOOK and TEST_QUERY.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";

const mode = process.argv[2] || "read";
const NOTEBOOK = process.env.TEST_NOTEBOOK || "Codex Notes";
const QUERY = process.env.TEST_QUERY || "test";
const server = path.join(import.meta.dirname, "server.mjs");

const client = new Client({ name: "smoke", version: "1.0.0" });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [server],
  env: { ...process.env },
}));

const call = async (name, args = {}) => {
  const t0 = Date.now();
  const r = await client.callTool({ name, arguments: args });
  const body = r.content.map(c => c.text).join("\n");
  console.log(`\n### ${name} ${JSON.stringify(args)}  (${Date.now() - t0}ms)`);
  console.log(body.length > 1200 ? body.slice(0, 1200) + "\n...[cut]" : body);
  return body;
};

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map(t => t.name).join(", "));

if (mode === "read" || mode === "all") {
  await call("upnote_list_notebooks");
  await call("upnote_list_tags");
  await call("upnote_recent_notes", { limit: 5 });
  await call("upnote_list_notes", { notebook: NOTEBOOK });
  await call("upnote_search_notes", { query: QUERY, limit: 5 });
  const first = await call("upnote_recent_notes", { limit: 1 });
  const id = (first.match(/\[id: ([^\]]+)\]/) || [])[1];
  if (id) await call("upnote_get_note", { id, max_chars: 400 });
  // error paths
  await call("upnote_list_notes", { notebook: "does-not-exist" });
  await call("upnote_get_note", { id: "nope" });
}

if (mode === "write" || mode === "all") {
  await call("upnote_create_notebook", { title: NOTEBOOK });
  await new Promise(r => setTimeout(r, 2500));
  await call("upnote_create_note", {
    title: "MCP smoke test " + new Date().toISOString().slice(0, 16),
    notebook: NOTEBOOK,
    content: "# It works\n\nCreated by the UpNote MCP server.\n\n- bullet one\n- bullet two\n\n" +
      "Special chars: & ? # % + = \"quotes\" and 'apostrophes'.\n",
  });
}

await client.close();
